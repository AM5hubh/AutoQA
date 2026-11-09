import 'dotenv/config';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { planSchema } from '@autoqa/contracts';
import { connectBrowser, inspect } from '../workers/browser-worker/src/executor.ts';
import { queue } from '../packages/database/src/runtime.ts';
import { demoEnabled, demoOrigin } from '../packages/contracts/src/network.ts';
if (!demoEnabled()) throw new Error('Enable the local demo target to run fixture evaluations');
const cases = JSON.parse(await readFile('tests/fixtures/evaluation.json', 'utf8')) as {
  id: string;
  prompt: string;
  paths: string[];
  expected: string;
}[];
const browser = await connectBrowser();
const results: unknown[] = [];
try {
  for (const item of cases) {
    const started = Date.now();
    try {
      const observations = await inspect(
        browser,
        demoOrigin,
        item.paths,
        AbortSignal.timeout(60000),
      );
      const response = await fetch(`${process.env.AI_SERVICE_URL}/plan`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.AI_SERVICE_TOKEN}`,
        },
        body: JSON.stringify({ instructions: item.prompt, observations }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`AI returned ${response.status}`);
      const data = await response.json();
      const plan = planSchema.parse(data.plan);
      results.push({
        id: item.id,
        valid: true,
        expectedRequirement: item.expected,
        requirementCovered: null,
        needsHumanReview: true,
        plan,
        model: data.model,
        usage: data.usage,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        id: item.id,
        valid: false,
        error: String(error),
        durationMs: Date.now() - started,
      });
    }
  }
  await mkdir('artifacts/evaluations', { recursive: true });
  const file = `artifacts/evaluations/${Date.now()}.json`;
  await writeFile(file, JSON.stringify(results, null, 2));
  console.log(
    `Evaluation saved to ${file}. Review coverage manually; schema validity is not correctness.`,
  );
} finally {
  await browser.close();
  await queue.close();
}
