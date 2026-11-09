import 'dotenv/config';
import { createApp } from './app.ts';
import { db } from '@autoqa/database';
import { queue } from '../../../packages/database/src/runtime.ts';
const server = createApp().listen(Number(process.env.API_PORT || 4000), '0.0.0.0', () =>
  console.log('AutoQA API listening on port ' + (process.env.API_PORT || 4000)),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () =>
    server.close(() => {
      void Promise.all([db.$disconnect(), queue.close()]).then(() => process.exit(0));
    }),
  );
