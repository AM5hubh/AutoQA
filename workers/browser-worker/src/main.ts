import 'dotenv/config';
import { Worker, type Job } from 'bullmq';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { db, json } from '@autoqa/database';
import { analysisSchema, limits, planSchema, runInput, terminalStates } from '@autoqa/contracts';
import {
  artifactDir,
  enqueue,
  queue,
  redisConnection,
} from '../../../packages/database/src/runtime.ts';
import { connectBrowser, executeSuite, inspect } from './executor.ts';
import { analysisInput } from './analysis-input.ts';
import { requireVerifiedWebsite, verifyWebsite } from '../../../packages/contracts/src/network.ts';

async function verifyProject(
  project: Parameters<typeof requireVerifiedWebsite>[0] & { id: string; targetRevision: number },
) {
  requireVerifiedWebsite(project);
  try {
    await verifyWebsite(project, project.verificationMethod || '');
  } catch {
    await db.project.updateMany({
      where: { id: project.id, targetRevision: project.targetRevision },
      data: { verifiedAt: null },
    });
    throw new Error(
      'Website ownership proof is no longer available. Verify again in project settings.',
    );
  }
}

async function aiCall(route: string, data: unknown, signal: AbortSignal) {
  const response = await fetch(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}${route}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.AI_SERVICE_TOKEN || ''}`,
    },
    body: JSON.stringify(data),
    signal: AbortSignal.any([signal, AbortSignal.timeout(limits.aiMs)]),
  });
  if (!response.ok)
    throw new Error(
      `AI service returned ${response.status}. Check service configuration and model availability.`,
    );
  return await response.json();
}
async function event(runId: string, type: string, payload: unknown) {
  await db.runEvent.create({ data: { runId, type, payload: json(payload) } });
}
async function generate(id: string) {
  const claimed = await db.generation.updateMany({
    where: { id, status: 'QUEUED' },
    data: { status: 'PREPARING', heartbeat: new Date() },
  });
  if (!claimed.count) return;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Generation deadline exceeded')),
    180000,
  );
  const heartbeat = setInterval(() => {
    void db.generation
      .updateMany({ where: { id, status: 'PREPARING' }, data: { heartbeat: new Date() } })
      .catch(() => controller.abort(new Error('Database unavailable')));
  }, 5000);
  const browser = await connectBrowser().catch((error) => {
    clearTimeout(timer);
    clearInterval(heartbeat);
    throw error;
  });
  try {
    const generation = await db.generation.findUniqueOrThrow({
      where: { id },
      include: { project: true },
    });
    await verifyProject(generation.project);
    const origin = generation.project.baseUrl;
    const observations = await inspect(
      browser,
      origin,
      generation.paths as string[],
      controller.signal,
      generation.project.additionalOrigins,
      id,
    );
    await db.generation.update({ where: { id }, data: { observations: json(observations) } });
    const response = await aiCall(
      '/plan',
      { instructions: generation.instructions, observations },
      controller.signal,
    );
    const plan = planSchema.parse(response.plan);
    await db.$transaction(async (tx) => {
      const changed = await tx.generation.updateMany({
        where: { id, status: 'PREPARING' },
        data: { status: 'COMPLETED', usage: json(response.usage || {}) },
      });
      if (!changed.count) return;
      const suite = await tx.suite.create({
        data: {
          projectId: generation.projectId,
          title: plan.title,
          paths: generation.paths!,
          plan: json(plan),
          model: response.model,
          promptVersion: response.promptVersion,
        },
      });
      await tx.generation.update({ where: { id }, data: { suiteId: suite.id } });
    });
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    await browser.close();
  }
}
async function execute(id: string) {
  const claimed = await db.run.updateMany({
    where: { id, status: 'QUEUED', cancelRequested: false },
    data: { status: 'PREPARING', startedAt: new Date(), heartbeat: new Date() },
  });
  if (!claimed.count) return;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Execution deadline exceeded')),
    limits.runMs,
  );
  let polling = false;
  const heartbeat = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const current = await db.run.findUniqueOrThrow({
        where: { id },
        select: { status: true, cancelRequested: true },
      });
      if (current.cancelRequested) controller.abort(new Error('Cancelled'));
      else if (terminalStates.includes(current.status))
        controller.abort(new Error('Run interrupted'));
      else await db.run.update({ where: { id }, data: { heartbeat: new Date() } });
    } catch {
      controller.abort(new Error('Database unavailable'));
    } finally {
      polling = false;
    }
  }, 1000);
  try {
    const run = await db.run.findUniqueOrThrow({
      where: { id },
      include: { suite: { include: { project: true } } },
    });
    const snapshot = run.snapshot as {
      plan: unknown;
      baseUrl: string;
      paths: string[];
      additionalOrigins?: string[];
      targetRevision?: number;
    };
    await verifyProject(run.suite.project);
    if (snapshot.targetRevision !== run.suite.project.targetRevision)
      throw new Error('Website configuration changed. Create a new run.');
    const origin = snapshot.baseUrl;
    const plan = planSchema.parse(snapshot.plan);
    const config = runInput.parse(run.config);
    const browser = await connectBrowser();
    try {
      await db.run.updateMany({ where: { id, status: 'PREPARING' }, data: { status: 'RUNNING' } });
      await event(id, 'status', { status: 'RUNNING' });
      await executeSuite(browser, origin, plan, snapshot.paths, config, {
        additionalOrigins: snapshot.additionalOrigins || [],
        jobId: id,
        signal: controller.signal,
        artifactDir,
        event: (type, payload) => event(id, type, payload),
        result: async (result, files) => {
          await db.$transaction(async (tx) => {
            await tx.testResult.create({
              data: {
                ...result,
                runId: id,
                steps: json(result.steps),
                diagnostics: json(result.diagnostics),
              },
            });
            if (files.length)
              await tx.artifact.createMany({
                data: files.map((f) => ({
                  ...f,
                  runId: id,
                  expiresAt: new Date(Date.now() + limits.retentionDays * 86400000),
                })),
              });
          });
        },
      });
    } finally {
      await browser.close();
    }
    controller.signal.throwIfAborted();
    const failures = await db.testResult.findMany({
      where: { runId: id, status: { in: ['FAILED', 'BLOCKED'] } },
    });
    if (failures.length) {
      await db.run.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'ANALYZING' } });
      await event(id, 'status', { status: 'ANALYZING' });
      try {
        const evidence = analysisInput(failures);
        const response = await aiCall('/analyze', evidence, controller.signal);
        const analysis = analysisSchema.parse(response.analysis);
        for (const finding of analysis.findings) {
          const result = evidence.results.find((r) => r.id === finding.resultId);
          if (
            !result ||
            finding.evidenceIds.some(
              (e) => !(result.steps as { id: string }[]).some((s) => s.id === e),
            )
          )
            throw new Error('AI cited evidence that does not exist');
        }
        await db.run.update({
          where: { id },
          data: {
            analysis: json(analysis),
            usage: json(response.usage || {}),
            analysisWarning:
              failures.length > evidence.results.length
                ? `AI explanations cover the first ${evidence.results.length} failures; all browser evidence is retained.`
                : null,
          },
        });
      } catch (error) {
        await db.run.update({
          where: { id },
          data: {
            analysisWarning: error instanceof Error ? error.message : 'Analysis unavailable',
          },
        });
      }
    }
    controller.signal.throwIfAborted();
    const current = await db.run.findUniqueOrThrow({
      where: { id },
      select: { cancelRequested: true },
    });
    const status = current.cancelRequested ? 'CANCELLED' : 'COMPLETED';
    const finalized = await db.run.updateMany({
      where: { id, status: { notIn: terminalStates } },
      data: { status, finishedAt: new Date() },
    });
    if (finalized.count) await event(id, 'status', { status });
  } catch (error) {
    const run = await db.run.findUnique({ where: { id } });
    const status = run?.cancelRequested ? 'CANCELLED' : 'FAILED';
    await db.run.updateMany({
      where: { id, status: { notIn: terminalStates } },
      data: {
        status,
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : 'Execution failed',
      },
    });
    await event(id, 'status', { status });
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}
async function processJob(job: Job) {
  console.log(JSON.stringify({ event: 'job-started', kind: job.name, id: job.data.id }));
  if (job.name === 'run') return execute(job.data.id);
  if (job.name === 'generation') {
    try {
      await generate(job.data.id);
    } catch (error) {
      await db.generation.updateMany({
        where: { id: job.data.id, status: { notIn: terminalStates } },
        data: {
          status: 'FAILED',
          error: error instanceof Error ? error.message : 'Generation failed',
        },
      });
    }
  }
}
let maintenanceRunning = false;
async function maintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    const stale = new Date(Date.now() - 90000);
    await db.run.updateMany({
      where: { status: { in: ['PREPARING', 'RUNNING', 'ANALYZING'] }, heartbeat: { lt: stale } },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: 'Worker interrupted. Browser actions were not replayed; start a new run.',
      },
    });
    await db.generation.updateMany({
      where: { status: 'PREPARING', heartbeat: { lt: stale } },
      data: { status: 'FAILED', error: 'Generation worker interrupted. Please generate again.' },
    });
    const [runs, generations] = await Promise.all([
      db.run.findMany({
        where: { status: 'QUEUED', cancelRequested: false },
        select: { id: true },
      }),
      db.generation.findMany({ where: { status: 'QUEUED' }, select: { id: true } }),
    ]);
    for (const run of runs) await enqueue('run', run.id);
    for (const generation of generations) await enqueue('generation', generation.id);
    const expired = await db.artifact.findMany({
      where: { expired: false, expiresAt: { lt: new Date() } },
      take: 50,
    });
    for (const artifact of expired) {
      const filename = path.resolve(artifactDir, artifact.storageKey);
      if (!filename.startsWith(artifactDir + path.sep)) throw new Error('Invalid artifact path');
      await unlink(filename).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await db.artifact.update({ where: { id: artifact.id }, data: { expired: true } });
    }
    const redis = await queue.client;
    await redis.set('autoqa:worker:heartbeat', String(Date.now()), { EX: 30 });
  } catch (error) {
    console.error(JSON.stringify({ event: 'maintenance-error', message: String(error) }));
  } finally {
    maintenanceRunning = false;
  }
}
const worker = new Worker('autoqa', processJob, {
  connection: redisConnection,
  concurrency: 1,
  maxStalledCount: 0,
});
worker.on('error', (error) =>
  console.error(JSON.stringify({ event: 'worker-error', message: error.message })),
);
const interval = setInterval(() => {
  void maintenance();
}, 5000);
void maintenance();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    clearInterval(interval);
    await worker.close();
    await queue.close();
    await db.$disconnect();
    process.exit(0);
  });
console.log('AutoQA worker ready');
