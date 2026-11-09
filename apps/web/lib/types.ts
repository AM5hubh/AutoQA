export type Target =
  | { kind: 'role'; role: string; name: string }
  | { kind: 'label' | 'testId'; value: string };
export type Step = {
  action: string;
  path?: string;
  target?: Target;
  expected?: string;
  value?: string;
  checked?: boolean;
};
export type TestCase = {
  id: string;
  title: string;
  requirement: string;
  priority: string;
  preconditions: string[];
  assumptions: string[];
  steps: Step[];
};
export type Plan = { title: string; tests: TestCase[]; limitations: string[] };
export type Suite = {
  id: string;
  projectId: string;
  title: string;
  revision: number;
  approvedRevision: number | null;
  approvedTargetRevision: number | null;
  plan: Plan;
  paths: string[];
  model?: string;
  promptVersion?: string;
  project?: Project;
};
export type Generation = {
  id: string;
  status: string;
  instructions: string;
  error?: string;
  suiteId?: string;
};
export type Project = {
  id: string;
  name: string;
  baseUrl: string;
  additionalOrigins: string[];
  targetRevision: number;
  verifiedAt: string | null;
  verificationToken: string | null;
  verificationMethod: string | null;
  suites?: Suite[];
  generations?: Generation[];
  _count?: { suites: number };
};
export type Summary = {
  PASSED: number;
  FAILED: number;
  BLOCKED: number;
  SKIPPED: number;
  passRate: number | null;
};
export type Artifact = { id: string; type: string; expired: boolean; expiresAt: string };
export type Result = {
  id: string;
  testId: string;
  title: string;
  viewport: string;
  status: string;
  durationMs: number;
  steps: {
    id: string;
    action: string;
    status: string;
    durationMs: number;
    expected?: string;
    actual?: string;
    error?: string;
  }[];
  diagnostics: { type: string; message: string }[];
  artifacts: Artifact[];
};
export type Run = {
  id: string;
  suiteId: string;
  revision: number;
  status: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  analysisWarning?: string;
  cancelRequested: boolean;
  summary: Summary;
  suite: Suite;
  results: Result[];
  config: { viewports: string[]; accessibility: boolean; responsive: boolean };
  analysis?: {
    findings: {
      resultId: string;
      category: string;
      explanation: string;
      investigation: string;
      uncertainty: string;
      evidenceIds: string[];
    }[];
  };
  previous?: { id: string; results: Pick<Result, 'testId' | 'viewport' | 'status'>[] };
  usage?: Record<string, unknown>;
};
