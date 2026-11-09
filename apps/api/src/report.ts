import { escapeHtml, type Analysis } from '@autoqa/contracts';

type ReportRun = {
  id: string;
  revision: number;
  status: string;
  createdAt: Date;
  suite: { title: string };
  snapshot: unknown;
  config: unknown;
  results: {
    title: string;
    status: string;
    viewport: string;
    durationMs: number;
    steps: unknown;
    diagnostics: unknown;
    artifacts: { id: string; type: string; expired: boolean; expiresAt: Date }[];
  }[];
  analysisWarning: string | null;
};
export function reportHtml(
  run: ReportRun,
  summary: unknown,
  analysis: Analysis | null,
  appOrigin: string,
) {
  const json = (value: unknown) => `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoQA report</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:20px;color:#18222b}article{border-top:1px solid #ddd;padding:20px 0;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#465666}@media print{body{margin:0}a{color:inherit}}</style></head><body>
  <h1>AutoQA execution report</h1><p>${escapeHtml(run.suite.title)} · Revision ${run.revision} · ${escapeHtml(run.status)}</p>
  <p>Run: ${escapeHtml(run.id)}<br>Created: ${run.createdAt.toISOString()}</p>
  <h2>Summary</h2>${json(summary)}
  <h2>Approved plan and target</h2>${json(run.snapshot)}
  <h2>Execution configuration</h2>${json(run.config)}
  ${run.results.map((r) => `<article><h2>${escapeHtml(r.title)}</h2><p>${escapeHtml(r.status)} · ${escapeHtml(r.viewport)} · ${r.durationMs} ms</p><h3>Step evidence</h3>${json(r.steps)}<h3>Diagnostics</h3>${json(r.diagnostics)}${r.artifacts.map((a) => `<p>${escapeHtml(a.type)}: ${a.expired || a.expiresAt < new Date() ? 'expired' : `<a href="${escapeHtml(appOrigin)}/api/artifacts/${escapeHtml(a.id)}">Open evidence (sign-in required)</a>`}</p>`).join('')}</article>`).join('')}
  <h2>AI hypotheses</h2>${analysis ? json(analysis) : `<p>${escapeHtml(run.analysisWarning || 'No analysis needed.')}</p>`}
  </body></html>`;
}
