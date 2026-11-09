import type { StepEvidence } from '@autoqa/contracts';

export function analysisInput(
  results: { id: string; title: string; status: string; steps: unknown; diagnostics: unknown }[],
) {
  // shortcut: analyze the first ten failures, add paged analysis if larger suites are introduced.
  const payload = {
    results: results.slice(0, 10).map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      steps: (r.steps as StepEvidence[])
        .slice(-3)
        .map((s) => ({
          ...s,
          expected: s.expected?.slice(0, 1000),
          actual: s.actual?.slice(0, 1000),
          error: s.error?.slice(0, 1000),
        })),
      diagnostics: (r.diagnostics as { type: string; message: string }[])
        .slice(0, 3)
        .map((d) => ({ type: d.type, message: d.message.slice(0, 500) })),
    })),
  };
  while (Buffer.byteLength(JSON.stringify(payload)) > 100000) payload.results.pop();
  return payload;
}
