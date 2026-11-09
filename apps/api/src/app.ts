import express, { type Request, type Response, type NextFunction } from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import path from 'node:path';
import { z } from 'zod';
import { db, json, Prisma } from '@autoqa/database';
import {
  analysisSchema,
  generationInput,
  limits,
  planSchema,
  runInput,
  summarize,
  terminalStates,
} from '@autoqa/contracts';
import { reportHtml } from './report.ts';
import { appOrigin, artifactDir } from '../../../packages/database/src/runtime.ts';

import { HttpError } from './http-error.ts';
import { authRouter, requireAccount } from './auth.ts';
import { projectRouter } from './projects.ts';
import { requireVerifiedWebsite } from '../../../packages/contracts/src/network.ts';

const requireValue = <T>(value: T | null | undefined): T => {
  if (!value) throw new HttpError(404, 'Not found');
  return value;
};
const id = (req: Request, field = 'id') => z.string().uuid().parse(req.params[field]);
const active = ['QUEUED', 'PREPARING', 'RUNNING', 'ANALYZING'];

async function admission(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
  const since = new Date(Date.now() - 86400000);
  const [generations, runs, activeGenerations, activeRuns] = await Promise.all([
    tx.generation.count({ where: { project: { ownerId: userId }, createdAt: { gte: since } } }),
    tx.run.count({ where: { suite: { project: { ownerId: userId } }, createdAt: { gte: since } } }),
    tx.generation.count({ where: { project: { ownerId: userId }, status: { in: active } } }),
    tx.run.count({ where: { suite: { project: { ownerId: userId } }, status: { in: active } } }),
  ]);
  if (generations + runs >= limits.dailyJobs)
    throw new HttpError(429, 'Daily job limit reached. Try again tomorrow.');
  if (activeGenerations + activeRuns)
    throw new HttpError(409, 'Wait for your active job to finish or cancel it.');
}
async function ownedRun(req: Request) {
  const run = requireValue(
    await db.run.findFirst({
      where: { id: id(req), suite: { project: { ownerId: req.session.userId! } } },
      include: { results: { include: { artifacts: true } }, suite: { include: { project: true } } },
    }),
  );
  const snapshot = run.snapshot as { plan: { title: string } };
  return { ...run, suite: { ...run.suite, title: snapshot.plan.title } };
}
export function createApp() {
  const app = express();
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('SESSION_SECRET must have at least 32 characters');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '128kb' }));
  const Store = pgSession(session);
  app.use(
    session({
      store: new Store({ conString: process.env.DATABASE_URL, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET,
      name: 'autoqa.sid',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 8 * 3600000,
      },
    }),
  );
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== appOrigin)
        return res.status(403).json({ error: 'Invalid request origin' });
      if (
        ![
          '/auth/login',
          '/auth/signup',
          '/auth/verify-email',
          '/auth/reset-password',
          '/auth/resend-verification',
          '/auth/forgot-password',
        ].includes(req.path) &&
        (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf)
      )
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    next();
  });
  app.use('/api/auth', authRouter());
  app.use('/api', requireAccount);
  app.use('/api', projectRouter());
  app.post('/api/projects/:id/generations', async (req, res) => {
    const input = generationInput.parse(req.body);
    const project = requireValue(
      await db.project.findFirst({ where: { id: id(req), ownerId: req.session.userId! } }),
    );
    const generation = await db.$transaction(async (tx) => {
      await admission(tx, req.session.userId!);
      const current = requireValue(await tx.project.findUnique({ where: { id: project.id } }));
      try {
        requireVerifiedWebsite(current);
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      return tx.generation.create({
        data: { projectId: project.id, instructions: input.instructions, paths: json(input.paths) },
      });
    });
    res.status(202).json(generation);
  });
  app.get('/api/generations/:id', async (req, res) =>
    res.json(
      requireValue(
        await db.generation.findFirst({
          where: { id: id(req), project: { ownerId: req.session.userId! } },
        }),
      ),
    ),
  );
  app.post('/api/projects/:id/suites', async (req, res) => {
    const input = z
      .object({ plan: planSchema, paths: generationInput.shape.paths })
      .strict()
      .parse(req.body);
    const project = requireValue(
      await db.project.findFirst({ where: { id: id(req), ownerId: req.session.userId! } }),
    );
    res.status(201).json(
      await db.suite.create({
        data: {
          projectId: project.id,
          title: input.plan.title,
          plan: json(input.plan),
          paths: json(input.paths),
        },
      }),
    );
  });
  app.get('/api/suites/:id', async (req, res) =>
    res.json(
      requireValue(
        await db.suite.findFirst({
          where: { id: id(req), project: { ownerId: req.session.userId! } },
          include: { project: true },
        }),
      ),
    ),
  );
  app.patch('/api/suites/:id', async (req, res) => {
    const input = z
      .object({ revision: z.number().int().positive(), plan: planSchema })
      .strict()
      .parse(req.body);
    const suite = requireValue(
      await db.suite.findFirst({
        where: { id: id(req), project: { ownerId: req.session.userId! } },
      }),
    );
    const updated = await db.suite.updateMany({
      where: { id: suite.id, revision: input.revision },
      data: {
        plan: json(input.plan),
        title: input.plan.title,
        revision: { increment: 1 },
        approvedRevision: null,
      },
    });
    if (!updated.count) throw new HttpError(409, 'Suite changed. Reload before editing.');
    res.json(await db.suite.findUnique({ where: { id: suite.id } }));
  });
  app.post('/api/suites/:id/approve', async (req, res) => {
    const { revision, targetRevision } = z
      .object({
        revision: z.number().int().positive(),
        targetRevision: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.session.userId!}))`;
      const suite = requireValue(
        await tx.suite.findFirst({
          where: { id: id(req), project: { ownerId: req.session.userId! } },
          include: { project: true },
        }),
      );
      if (suite.revision !== revision || suite.project.targetRevision !== targetRevision)
        throw new HttpError(409, 'Suite or website changed. Review the latest configuration.');
      planSchema.parse(suite.plan);
      try {
        requireVerifiedWebsite(suite.project);
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      await tx.suite.update({
        where: { id: suite.id },
        data: { approvedRevision: revision, approvedTargetRevision: targetRevision },
      });
    });
    res.json({ approvedRevision: revision, approvedTargetRevision: targetRevision });
  });
  app.post('/api/runs', async (req, res) => {
    const input = runInput.parse(req.body);
    const key = `${req.session.userId!}-${z.string().uuid().parse(req.get('idempotency-key'))}`;
    const run = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${req.session.userId!}))`;
      const existing = await tx.run.findUnique({ where: { idempotencyKey: key } });
      if (existing) {
        if (
          existing.suiteId !== input.suiteId ||
          existing.revision !== input.revision ||
          JSON.stringify(runInput.parse(existing.config)) !== JSON.stringify(input)
        ) {
          throw new HttpError(409, 'Idempotency key was already used for a different request');
        }
        return existing;
      }
      await admission(tx, req.session.userId!);
      const suite = requireValue(
        await tx.suite.findFirst({
          where: { id: input.suiteId, project: { ownerId: req.session.userId! } },
          include: { project: true },
        }),
      );
      if (
        suite.revision !== input.revision ||
        suite.approvedRevision !== input.revision ||
        suite.approvedTargetRevision !== suite.project.targetRevision
      )
        throw new HttpError(409, 'Approve the current suite revision before running');
      try {
        requireVerifiedWebsite(suite.project);
      } catch (e) {
        throw new HttpError(409, (e as Error).message);
      }
      const plan = planSchema.parse(suite.plan);
      return tx.run.create({
        data: {
          suiteId: suite.id,
          revision: suite.revision,
          snapshot: json({
            plan,
            baseUrl: suite.project.baseUrl,
            additionalOrigins: suite.project.additionalOrigins,
            targetRevision: suite.project.targetRevision,
            paths: suite.paths,
            model: suite.model,
            promptVersion: suite.promptVersion,
          }),
          config: json(input),
          idempotencyKey: key,
        },
      });
    });
    res.status(202).json(run);
  });
  app.get('/api/projects/:id/runs', async (req, res) => {
    requireValue(
      await db.project.findFirst({ where: { id: id(req), ownerId: req.session.userId! } }),
    );
    const runs = await db.run.findMany({
      where: { suite: { projectId: id(req) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { results: { select: { status: true } }, suite: { select: { title: true } } },
    });
    res.json(
      runs.map((r) => ({
        ...r,
        suite: { ...r.suite, title: (r.snapshot as { plan: { title: string } }).plan.title },
        summary: summarize(r.results),
      })),
    );
  });
  app.get('/api/runs/:id', async (req, res) => {
    const run = await ownedRun(req);
    const previous = await db.run.findFirst({
      where: { suiteId: run.suiteId, createdAt: { lt: run.createdAt }, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      include: { results: { select: { testId: true, viewport: true, status: true } } },
    });
    res.json({ ...run, summary: summarize(run.results), previous });
  });
  app.post('/api/runs/:id/cancel', async (req, res) => {
    const run = await ownedRun(req);
    await db.run.updateMany({
      where: { id: run.id, status: { notIn: terminalStates } },
      data: { cancelRequested: true },
    });
    await db.run.updateMany({
      where: { id: run.id, status: 'QUEUED' },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    res.json({ accepted: !terminalStates.includes(run.status) });
  });
  app.get('/api/runs/:id/events', async (req, res) => {
    const run = await ownedRun(req);
    let cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(req.get('last-event-id') || req.query.after || 0);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    let closed = false;
    req.on('close', () => {
      closed = true;
    });
    try {
      while (!closed) {
        const events = await db.runEvent.findMany({
          where: { runId: run.id, id: { gt: cursor } },
          orderBy: { id: 'asc' },
          take: 100,
        });
        for (const event of events) {
          cursor = event.id;
          res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        const current = await db.run.findUniqueOrThrow({
          where: { id: run.id },
          select: { status: true },
        });
        if (events.length < 100 && terminalStates.includes(current.status)) {
          res.write(`event: finished\ndata: ${JSON.stringify(current)}\n\n`);
          break;
        }
        res.write(': heartbeat\n\n');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      if (!closed) res.write('event: reconnect\ndata: {}\n\n');
    }
    res.end();
  });
  app.get('/api/runs/:id/report', async (req, res) => {
    const run = await ownedRun(req);
    const format = z.enum(['json', 'html']).parse(req.query.format || 'json');
    const report = { ...run, summary: summarize(run.results) };
    res.attachment(`autoqa-${run.id}.${format}`);
    if (format === 'json') return res.json(report);
    const analysis = analysisSchema.safeParse(run.analysis);
    const html = reportHtml(
      run,
      report.summary,
      analysis.success ? analysis.data : null,
      appOrigin,
    );
    res.type('html').send(html);
  });
  app.get('/api/artifacts/:id', async (req, res) => {
    const artifact = requireValue(
      await db.artifact.findFirst({
        where: { id: id(req), run: { suite: { project: { ownerId: req.session.userId! } } } },
      }),
    );
    if (artifact.expired || artifact.expiresAt < new Date())
      throw new HttpError(410, 'This artifact has expired');
    const file = path.resolve(artifactDir, artifact.storageKey);
    if (!file.startsWith(artifactDir + path.sep)) throw new HttpError(404, 'Not found');
    res.setHeader('Cache-Control', 'private, no-store');
    if (artifact.type === 'trace') res.attachment('trace.zip');
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(410).json({ error: 'Artifact unavailable' });
    });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof z.ZodError)
      return res.status(422).json({
        error: 'Validation failed',
        details: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    console.error(
      JSON.stringify({
        event: 'api-error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    res.status(500).json({ error: 'The request could not be completed. Please retry.' });
  });
  return app;
}
