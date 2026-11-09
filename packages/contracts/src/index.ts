import { z } from 'zod';

export const limits = {
  tests: 5,
  steps: 15,
  actionMs: 10000,
  navigationMs: 20000,
  runMs: 300000,
  aiMs: 60000,
  dailyJobs: 20,
  retentionDays: 7,
} as const;
export const targetSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('role'),
      role: z.enum([
        'button',
        'link',
        'textbox',
        'checkbox',
        'combobox',
        'heading',
        'alert',
        'status',
        'listitem',
      ]),
      name: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ kind: z.literal('label'), value: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('testId'), value: z.string().min(1).max(200) }).strict(),
]);
const localPath = z
  .string()
  .max(2000)
  .refine(
    (v) =>
      v.startsWith('/') &&
      !v.startsWith('//') &&
      !v.includes('\\') &&
      ![...v].some((c) => c.charCodeAt(0) < 32),
    'Use a relative path beginning with one slash',
  );
export const stepSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('navigate'), path: localPath }).strict(),
  z.object({ action: z.literal('click'), target: targetSchema }).strict(),
  z
    .object({ action: z.literal('fill'), target: targetSchema, value: z.string().max(1000) })
    .strict(),
  z
    .object({ action: z.literal('select'), target: targetSchema, value: z.string().max(200) })
    .strict(),
  z.object({ action: z.literal('check'), target: targetSchema, checked: z.boolean() }).strict(),
  z.object({ action: z.literal('assertVisible'), target: targetSchema }).strict(),
  z
    .object({
      action: z.literal('assertText'),
      target: targetSchema,
      expected: z.string().min(1).max(1000),
    })
    .strict(),
  z.object({ action: z.literal('assertURL'), path: localPath }).strict(),
  z.object({ action: z.literal('screenshot') }).strict(),
]);
export const caseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    title: z.string().min(1).max(200),
    requirement: z.string().min(1).max(1000),
    priority: z.enum(['low', 'medium', 'high']),
    preconditions: z.array(z.string().max(500)).max(5),
    assumptions: z.array(z.string().max(500)).max(5),
    steps: z.array(stepSchema).min(2).max(limits.steps),
  })
  .strict()
  .refine((t) => t.steps[0].action === 'navigate', 'First step must navigate')
  .refine((t) => t.steps.some((s) => s.action.startsWith('assert')), 'A test needs an assertion');
export const planSchema = z
  .object({
    title: z.string().min(1).max(200),
    tests: z.array(caseSchema).min(1).max(limits.tests),
    limitations: z.array(z.string().max(1000)).max(10),
  })
  .strict()
  .refine(
    (p) => new Set(p.tests.map((t) => t.id)).size === p.tests.length,
    'Test IDs must be unique',
  );
export type Plan = z.infer<typeof planSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Target = z.infer<typeof targetSchema>;
export type Outcome = 'PASSED' | 'FAILED' | 'BLOCKED' | 'SKIPPED';
export type Lifecycle =
  | 'QUEUED'
  | 'PREPARING'
  | 'RUNNING'
  | 'ANALYZING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export const terminalStates = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const viewports = {
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
} as const;
export const runInput = z
  .object({
    suiteId: z.string().uuid(),
    revision: z.number().int().positive(),
    viewports: z
      .array(z.enum(['desktop', 'mobile']))
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
    accessibility: z.boolean(),
    responsive: z.boolean(),
  })
  .strict();
export const generationInput = z
  .object({ instructions: z.string().min(10).max(4000), paths: z.array(localPath).min(1).max(3) })
  .strict();
export const analysisSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            resultId: z.string(),
            category: z.enum([
              'assertion',
              'locator',
              'network',
              'timeout',
              'accessibility',
              'layout',
              'environment',
            ]),
            explanation: z.string().max(1500),
            evidenceIds: z.array(z.string()).max(10),
            investigation: z.string().max(1500),
            uncertainty: z.string().max(500),
          })
          .strict(),
      )
      .max(15),
  })
  .strict();
export type Analysis = z.infer<typeof analysisSchema>;
export type StepEvidence = {
  id: string;
  action: string;
  status: Outcome;
  durationMs: number;
  expected?: string;
  actual?: string;
  error?: string;
};

export function assertSameOrigin(value: string, origin: string): URL {
  const url = new URL(value, origin);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== new URL(origin).origin ||
    url.username ||
    url.password
  )
    throw new Error('Destination is not approved');
  return url;
}
export function summarize(results: { status: string }[]) {
  const counts = { PASSED: 0, FAILED: 0, BLOCKED: 0, SKIPPED: 0 };
  for (const r of results) if (r.status in counts) counts[r.status as Outcome]++;
  return {
    ...counts,
    passRate:
      counts.PASSED + counts.FAILED
        ? Math.round((100 * counts.PASSED) / (counts.PASSED + counts.FAILED))
        : null,
  };
}
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
