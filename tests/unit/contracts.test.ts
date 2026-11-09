import { describe, expect, test } from 'vitest';
import { assertSameOrigin, escapeHtml, planSchema, summarize } from '@autoqa/contracts';
import fixture from '../fixtures/plan.json' with { type: 'json' };
describe('execution trust boundary', () => {
  test('accepts the shared executable fixture', () =>
    expect(planSchema.parse(fixture).tests).toHaveLength(1));
  test.each([
    '//evil.example/path',
    '/\\evil.example',
    'https://evil.example/',
    'javascript:alert(1)',
    '/\n/path',
  ])('rejects navigation path %s', (path) => {
    const plan = structuredClone(fixture);
    plan.tests[0].steps[0].path = path;
    expect(planSchema.safeParse(plan).success).toBe(false);
  });
  test('rejects unsupported executable actions', () => {
    const plan = structuredClone(fixture);
    plan.tests[0].steps[0].action = 'evaluate';
    expect(planSchema.safeParse(plan).success).toBe(false);
  });
  test('requires assertions and unique IDs', () => {
    const plan = structuredClone(fixture);
    plan.tests[0].steps.pop();
    expect(planSchema.safeParse(plan).success).toBe(false);
    expect(
      planSchema.safeParse({ ...fixture, tests: [fixture.tests[0], fixture.tests[0]] }).success,
    ).toBe(false);
  });
  test('rejects unknown fields and excessive steps', () => {
    expect(planSchema.safeParse({ ...fixture, execute: 'anything' }).success).toBe(false);
    const plan = structuredClone(fixture);
    plan.tests[0].steps = Array(16).fill(plan.tests[0].steps[0]);
    expect(planSchema.safeParse(plan).success).toBe(false);
  });
  test.each([
    'http://127.0.0.1',
    'https://evil.test',
    'https://user:pass@good.test',
    '//evil.test',
  ])('blocks URL escape %s', (url) =>
    expect(() => assertSameOrigin(url, 'https://good.test')).toThrow(),
  );
  test('preserves same-origin navigation', () =>
    expect(assertSameOrigin('/cart?a=1', 'https://good.test').href).toBe(
      'https://good.test/cart?a=1',
    ));
});
test('pass rate excludes blocked/skipped and empty results have no rate', () => {
  expect(
    summarize([
      { status: 'PASSED' },
      { status: 'FAILED' },
      { status: 'BLOCKED' },
      { status: 'SKIPPED' },
    ]).passRate,
  ).toBe(50);
  expect(summarize([{ status: 'BLOCKED' }]).passRate).toBeNull();
});
test('exported HTML escapes target-controlled content', () =>
  expect(escapeHtml('<img onerror="alert(1)">&')).toBe(
    '&lt;img onerror=&quot;alert(1)&quot;&gt;&amp;',
  ));
