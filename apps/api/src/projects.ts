import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '@autoqa/database';
import {
  demoEnabled,
  demoOrigin,
  validateOrigins,
  verifyWebsite,
} from '../../../packages/contracts/src/network.ts';
import { HttpError } from './http-error.ts';

const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().max(2000),
    additionalOrigins: z.array(z.string().max(2000)).max(10).default([]),
  })
  .strict();
const active = ['QUEUED', 'PREPARING', 'RUNNING', 'ANALYZING'];
const uuid = (value: unknown) => z.string().uuid().parse(value);
async function owned(id: string, ownerId: string) {
  const project = await db.project.findFirst({ where: { id, ownerId } });
  if (!project) throw new HttpError(404, 'Not found');
  return project;
}
async function normalized(baseUrl: string, additionalOrigins: string[]) {
  try {
    return await validateOrigins(baseUrl, additionalOrigins);
  } catch {
    throw new HttpError(
      422,
      'Use public HTTP(S) domain origins on standard ports. Private networks, credentials, paths, and unresolved hosts are not allowed.',
    );
  }
}
export function projectRouter() {
  const router = Router();
  router.get('/targets', (_req, res) =>
    res.json(demoEnabled() ? [{ name: 'Demo Shop', origin: demoOrigin }] : []),
  );
  router.post('/projects', async (req, res) => {
    const input = inputSchema.parse(req.body);
    const urls = await normalized(input.baseUrl, input.additionalOrigins);
    res
      .status(201)
      .json(
        await db.project.create({
          data: {
            ...input,
            ...urls,
            ownerId: req.session.userId!,
            verificationToken: randomBytes(32).toString('hex'),
            ...(urls.baseUrl === demoOrigin
              ? { verifiedAt: new Date(), verificationMethod: 'demo' }
              : {}),
          },
        }),
      );
  });
  router.get('/projects', async (req, res) =>
    res.json(
      await db.project.findMany({
        where: { ownerId: req.session.userId! },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { suites: true } } },
      }),
    ),
  );
  router.get('/projects/:id', async (req, res) => {
    const project = await db.project.findFirst({
      where: { id: uuid(req.params.id), ownerId: req.session.userId! },
      include: {
        suites: { orderBy: { updatedAt: 'desc' } },
        generations: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });
    if (!project) throw new HttpError(404, 'Not found');
    res.json(project);
  });
  router.patch('/projects/:id', async (req, res) => {
    const input = inputSchema
      .extend({ targetRevision: z.number().int().positive() })
      .parse(req.body);
    const urls = await normalized(input.baseUrl, input.additionalOrigins);
    const project = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.session.userId!}))`;
      const current = await tx.project.findFirst({
        where: { id: uuid(req.params.id), ownerId: req.session.userId! },
      });
      if (!current) throw new HttpError(404, 'Not found');
      if (current.targetRevision !== input.targetRevision)
        throw new HttpError(409, 'Website changed. Reload settings.');
      const changed =
        current.baseUrl !== urls.baseUrl ||
        JSON.stringify(current.additionalOrigins) !== JSON.stringify(urls.additionalOrigins);
      if (changed) {
        const pending =
          (await tx.generation.count({
            where: { projectId: current.id, status: { in: active } },
          })) +
          (await tx.run.count({
            where: { suite: { projectId: current.id }, status: { in: active } },
          }));
        if (pending)
          throw new HttpError(409, 'Wait for queued or active jobs before changing the website');
        await tx.suite.updateMany({
          where: { projectId: current.id },
          data: { approvedRevision: null, approvedTargetRevision: null },
        });
      }
      return tx.project.update({
        where: { id: current.id },
        data: {
          name: input.name,
          ...urls,
          ...(changed ? { targetRevision: { increment: 1 } } : {}),
          ...(current.baseUrl !== urls.baseUrl
            ? {
                verificationToken: randomBytes(32).toString('hex'),
                verifiedAt: urls.baseUrl === demoOrigin ? new Date() : null,
                verificationMethod: urls.baseUrl === demoOrigin ? 'demo' : null,
              }
            : {}),
        },
      });
    });
    res.json(project);
  });
  router.post('/projects/:id/verification/challenge', async (req, res) => {
    const project = await owned(uuid(req.params.id), req.session.userId!);
    await db.project.updateMany({
      where: { id: project.id, verificationToken: null },
      data: { verificationToken: randomBytes(32).toString('hex') },
    });
    res.json(await owned(project.id, req.session.userId!));
  });
  router.post(
    '/projects/:id/verify',
    rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req, res) => {
      const { method } = z
        .object({ method: z.enum(['dns', 'file']) })
        .strict()
        .parse(req.body);
      const project = await owned(uuid(req.params.id), req.session.userId!);
      try {
        await verifyWebsite(project, method);
      } catch {
        throw new HttpError(
          422,
          'Ownership proof was not found. Check the TXT record or HTTPS file, wait for DNS propagation, and try again.',
        );
      }
      const updated = await db.project.updateMany({
        where: {
          id: project.id,
          targetRevision: project.targetRevision,
          verificationToken: project.verificationToken,
        },
        data: {
          verifiedAt: new Date(),
          verificationMethod: project.baseUrl === demoOrigin ? 'demo' : method,
        },
      });
      if (!updated.count)
        throw new HttpError(409, 'Website changed during verification. Please retry.');
      res.json(await owned(project.id, req.session.userId!));
    },
  );
  return router;
}
