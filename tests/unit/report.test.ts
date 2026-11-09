import { expect, test } from 'vitest';
import { reportHtml } from '../../apps/api/src/report.ts';
import { analysisInput } from '../../workers/browser-worker/src/analysis-input.ts';
test('HTML export includes immutable reproduction steps and escapes untrusted content', () => {
  const html = reportHtml(
    {
      id: 'run',
      revision: 1,
      status: 'COMPLETED',
      createdAt: new Date(0),
      suite: { title: '<script>alert(1)</script>' },
      snapshot: { plan: { steps: [{ action: 'fill', value: '<img src=x>' }] } },
      config: { viewports: ['desktop'] },
      results: [],
      analysisWarning: '<b>unavailable</b>',
    },
    {},
    null,
    'https://app.test',
  );
  expect(html).toContain('Approved plan and target');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).toContain('&lt;b&gt;unavailable');
});
test.each(['x', '😀'])(
  'large diagnosis payloads are bounded while preserving cited step IDs (%s)',
  (character) => {
    const results = Array.from({ length: 20 }, (_, i) => ({
      id: `r${i}`,
      title: 'x'.repeat(200),
      status: 'FAILED',
      steps: Array.from({ length: 15 }, (_, j) => ({
        id: `${i}-${j}`,
        action: 'assertText',
        status: 'FAILED',
        durationMs: 1,
        actual: 'x'.repeat(20000),
        expected: 'x'.repeat(20000),
        error: 'x'.repeat(20000),
      })),
      diagnostics: Array(50).fill({ type: 'http', message: 'x'.repeat(2000) }),
    }));
    for (const r of results) for (const s of r.steps) s.actual = character.repeat(20000);
    const payload = analysisInput(results);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(131072);
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.length).toBeLessThanOrEqual(10);
    expect(payload.results[0].steps.at(-1)?.id).toBe('0-14');
  },
);
