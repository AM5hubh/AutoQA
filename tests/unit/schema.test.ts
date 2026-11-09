import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Ajv } from 'ajv';
import fixture from '../fixtures/plan.json' with { type: 'json' };
test('the Python-exported schema accepts the shared TypeScript execution fixture', () => {
  const ajv = new Ajv({ strict: false });
  const schema = JSON.parse(readFileSync('packages/contracts/schemas/plan.json', 'utf8'));
  const validate = ajv.compile(schema);
  expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
});
