import 'dotenv/config';
import { Queue } from 'bullmq';
import path from 'node:path';

export const artifactDir = path.resolve(process.env.ARTIFACT_DIR || './artifacts');
export const appOrigin = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
const redis = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
export const redisConnection = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  username: redis.username || undefined,
  password: decodeURIComponent(redis.password) || undefined,
  ...(redis.protocol === 'rediss:' ? { tls: {} } : {}),
};
export const queue = new Queue('autoqa', {
  connection: { ...redisConnection, enableOfflineQueue: false, maxRetriesPerRequest: 1 },
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { age: 86400 },
    removeOnFail: { age: 604800 },
  },
});
queue.on('error', (error) =>
  console.error(JSON.stringify({ event: 'queue-error', message: error.message })),
);
export async function enqueue(kind: 'generation' | 'run', id: string) {
  const existing = await queue.getJob(`${kind}-${id}`);
  if (existing && ['completed', 'failed'].includes(await existing.getState()))
    await existing.remove();
  await queue.add(kind, { id }, { jobId: `${kind}-${id}` });
}
