'use client';
import { useCallback, useEffect, useState, useRef, useId } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  FileCheck2,
  FlaskConical,
  Folder,
  LayoutDashboard,
  Loader2,
  LogOut,
  Monitor,
  Play,
  Plus,
  Radio,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { AuthScreen, AccountSettings, authPaths } from './auth-screen';
import { ProjectSettings } from './project-settings';
import { Button } from './ui/button';
import { api, setCsrf } from '../lib/api';
import type { Project, Suite, Run, Plan, Step, Target } from '../lib/types';
import { demoPlan } from '../lib/demo-plan';

const terminal = ['COMPLETED', 'FAILED', 'CANCELLED'];
const stamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const duration = (run: Run) =>
  run.startedAt
    ? `${Math.round(((run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now()) - new Date(run.startedAt).getTime()) / 1000)}s`
    : '—';
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <CircleDot size={11} />
      {status.toLowerCase().replaceAll('_', ' ')}
    </span>
  );
}
function Notice({ error }: { error: string }) {
  return error ? (
    <div className="notice" role="alert">
      {error}
    </div>
  ) : null;
}
function Loading() {
  return (
    <div className="loading" role="status">
      <Loader2 size={20} className="spin" /> Loading workspace…
    </div>
  );
}
function useResource<T>(url: string, interval = 0) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(url));
      setError('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }, [url]);
  useEffect(() => {
    let live = true;
    api<T>(url)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    const timer = interval
      ? setInterval(() => {
          void reload();
        }, interval)
      : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, interval, reload]);
  return { data, error, reload };
}
export function DashboardApp() {
  const [user, setUser] = useState<{ email: string } | null>();
  const [create, setCreate] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    api<{ user: { email: string }; csrf: string }>('/auth/me')
      .then((r) => {
        setUser(r.user);
        setCsrf(r.csrf);
      })
      .catch(() => setUser(null));
  }, []);
  if (user === undefined) return <Loading />;
  if (user === null || authPaths.includes(pathname)) return <AuthScreen onLogin={setUser} />;
  const parts = pathname.split('/').filter(Boolean);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <FlaskConical size={20} />
          </span>
          autoqa<span className="brand-ai">AGENT</span>
        </Link>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            Portfolio workspace<small>Personal environment</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav>
          <Link className={pathname === '/' ? 'active' : ''} href="/">
            <LayoutDashboard size={18} />
            Overview
          </Link>
          <Link className={parts[0] === 'projects' ? 'active' : ''} href="/projects">
            <Folder size={18} />
            Projects
          </Link>
          <Link href="/account">Account settings</Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="guard-card">
            <ShieldCheck size={20} />
            <strong>Evidence comes first.</strong>
            <p>
              AI proposes the test.
              <br />
              Your browser verifies it.
            </p>
          </div>
          <button
            className="user-menu"
            onClick={async () => {
              try {
                await api('/auth/logout', { method: 'POST' });
                setUser(null);
                setCsrf('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <span className="user-avatar">{user.email[0].toUpperCase()}</span>
            <span>
              {user.email}
              <small>Sign out</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <span>
              {parts[0] === 'runs'
                ? 'Execution report'
                : parts[0] === 'suites'
                  ? 'Test suite'
                  : parts[0] === 'projects'
                    ? 'Projects'
                    : 'Overview'}
            </span>
          </div>
          <span className="environment">
            <span />
            Verified websites
          </span>
        </header>
        <main className="content">
          <Notice error={error} />
          {parts[0] === 'account' ? (
            <AccountSettings />
          ) : parts[0] === 'projects' && parts[1] ? (
            <ProjectPage key={parts[1]} id={parts[1]} />
          ) : parts[0] === 'suites' && parts[1] ? (
            <SuitePage key={parts[1]} id={parts[1]} />
          ) : parts[0] === 'runs' && parts[1] ? (
            <RunPage key={parts[1]} id={parts[1]} />
          ) : (
            <Overview
              key={`${parts[0]}-${revision}`}
              projectsOnly={parts[0] === 'projects'}
              onCreate={() => setCreate(true)}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>AutoQA / Portfolio Edition</span>
          <span>
            <Code2 size={13} />
            Built for verifiable results
          </span>
        </footer>
      </div>
      {create && (
        <CreateProject
          onClose={() => setCreate(false)}
          onCreated={(project) => {
            setCreate(false);
            setRevision((r) => r + 1);
            router.push(`/projects/${project.id}`);
          }}
        />
      )}
    </div>
  );
}
function CreateProject({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const { data: targets, error: loadError } =
    useResource<{ name: string; origin: string }[]>('/targets');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);
  return (
    <div className="modal-backdrop">
      <dialog ref={dialogRef} onCancel={onClose} className="modal" aria-labelledby="create-title">
        <div className="section-heading">
          <h2 id="create-title">New project</h2>
          <Button variant="ghost" aria-label="Close dialog" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        <p className="muted">Add your website, then verify ownership to start testing.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              onCreated(
                await api<Project>('/projects', {
                  method: 'POST',
                  body: JSON.stringify({
                    ...Object.fromEntries(new FormData(e.currentTarget)),
                    additionalOrigins: String(
                      new FormData(e.currentTarget).get('additionalOrigins'),
                    )
                      .split('\n')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  }),
                }),
              );
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Project name
            <input
              autoFocus
              name="name"
              required
              maxLength={100}
              placeholder="Storefront quality checks"
            />
          </label>
          <label>
            Website origin
            <input name="baseUrl" type="url" required placeholder="https://your-website.com" />
          </label>
          {!!targets?.length && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const input =
                  dialogRef.current?.querySelector<HTMLInputElement>('input[name="baseUrl"]');
                if (input) input.value = targets[0].origin;
              }}
            >
              Use Demo Shop
            </Button>
          )}
          <label>
            Additional CDN/API origins
            <textarea name="additionalOrigins" rows={2} placeholder="https://cdn.example.com" />
          </label>
          <p className="small muted">Optional: up to ten exact origins, one per line.</p>
          <Notice error={error || loadError} />
          <div className="actions">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy}>
              Create project
              <ArrowRight size={16} />
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
function Overview({ onCreate, projectsOnly }: { onCreate: () => void; projectsOnly: boolean }) {
  const { data: projects, error } = useResource<Project[]>('/projects');
  const [runs, setRuns] = useState<Run[]>([]);
  const [runError, setRunError] = useState('');
  useEffect(() => {
    if (projects)
      Promise.all(projects.map((p) => api<Run[]>(`/projects/${p.id}/runs`)))
        .then((all) => setRuns(all.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))))
        .catch((e) => setRunError(e.message));
  }, [projects]);
  const passed = runs.reduce((n, r) => n + r.summary.PASSED, 0),
    failed = runs.reduce((n, r) => n + r.summary.FAILED, 0),
    blocked = runs.reduce((n, r) => n + r.summary.BLOCKED, 0);
  if (!projects) return error ? <Notice error={error} /> : <Loading />;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR QUALITY PULSE</p>
          <h1>{projectsOnly ? 'Projects' : 'Testing, with a clear view.'}</h1>
          <p className="muted">
            {projectsOnly
              ? 'A focused workspace for each website you test.'
              : 'Your projects, browser runs, and the evidence behind every result.'}
          </p>
        </div>
        <Button onClick={onCreate}>
          <Plus size={17} />
          New project
        </Button>
      </div>
      <Notice error={runError} />
      {!projectsOnly && (
        <>
          <div className="metrics">
            <Metric
              label="Test runs"
              value={String(runs.length)}
              detail="Recent project history"
              icon={<Activity size={17} />}
            />
            <Metric
              label="Assertion pass rate"
              value={passed + failed ? `${Math.round((passed / (passed + failed)) * 100)}%` : '—'}
              detail={`${passed} passed · ${failed} failed`}
              icon={<CheckCircle2 size={17} />}
            />
            <Metric
              label="Checks to investigate"
              value={String(failed)}
              detail="Failed reviewed expectations"
              icon={<FileCheck2 size={17} />}
            />
            <Metric
              label="Blocked checks"
              value={String(blocked)}
              detail="Outcome could not be established"
              icon={<ShieldCheck size={17} />}
            />
          </div>
          <div className="intro-strip">
            <span className="intro-icon">
              <Sparkles size={22} />
            </span>
            <div>
              <h3>A requirement is all it takes to start.</h3>
              <p>Describe a flow. Review the plan. Let a real browser do the checking.</p>
            </div>
            <span className="text-label">
              Describe <ChevronRight size={14} /> Review <ChevronRight size={14} /> Run
            </span>
          </div>
        </>
      )}
      <section>
        <div className="section-heading">
          <h2>
            Your projects <span className="count">{projects.length}</span>
          </h2>
          <span className="muted small">Your verified websites</span>
        </div>
        {projects.length ? (
          <div className="project-grid">
            {projects.map((p) => (
              <Link href={`/projects/${p.id}`} className="project-card" key={p.id}>
                <div className="section-heading">
                  <span className="project-icon">
                    <Folder size={22} />
                  </span>
                  <ArrowUpRight size={18} />
                </div>
                <h3>{p.name}</h3>
                <p className="mono small muted">{p.baseUrl}</p>
                <div className="project-meta">
                  <span>{p._count?.suites || 0} test suites</span>
                  <span>
                    <ShieldCheck size={13} />
                    {p.verifiedAt ? 'Verified' : 'Verify ownership'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span className="empty-icon">
              <Folder size={28} />
            </span>
            <h3>Every reliable release starts somewhere.</h3>
            <p>Create your first project and turn a requirement into a repeatable check.</p>
            <Button variant="outline" onClick={onCreate}>
              <Plus size={16} />
              Create your first project
            </Button>
          </div>
        )}
      </section>
      {!projectsOnly && (
        <section className="panel">
          <div className="section-heading">
            <h2>Recent executions</h2>
            <span className="muted small">Browser evidence, kept together</span>
          </div>
          <RunTable runs={runs.slice(0, 8)} />
          <div className="panel-note">
            <ShieldCheck size={14} />
            Blocked and skipped checks are excluded from the assertion pass rate.
          </div>
        </section>
      )}
    </>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}
function RunTable({ runs }: { runs: Run[] }) {
  return runs.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Suite / execution</th>
            <th>Status</th>
            <th>Checks</th>
            <th>Duration</th>
            <th>Started</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>
                <Link className="table-title" href={`/runs/${r.id}`}>
                  {r.suite?.title || 'Test suite'}
                </Link>
                <span className="mono small muted">
                  {r.id.slice(0, 8)} · rev {r.revision}
                </span>
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              <td>
                <span className="success-text">{r.summary.PASSED} pass</span> /{' '}
                <span>{r.summary.FAILED} fail</span>
                {r.summary.BLOCKED > 0 && (
                  <small className="muted"> · {r.summary.BLOCKED} blocked</small>
                )}
              </td>
              <td>{duration(r)}</td>
              <td className="muted">{stamp(r.createdAt)}</td>
              <td>
                <Link aria-label={`Open run ${r.id.slice(0, 8)}`} href={`/runs/${r.id}`}>
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty compact">
      <Terminal size={25} />
      <h3>No executions yet</h3>
      <p>Your first run will appear here, with a result for every check.</p>
    </div>
  );
}
function ProjectPage({ id }: { id: string }) {
  const { data: project, error, reload } = useResource<Project>(`/projects/${id}`, 5000);
  const { data: runs } = useResource<Run[]>(`/projects/${id}/runs`, 5000);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (!project) return error ? <Notice error={error} /> : <Loading />;
  const activeGeneration = project.generations?.some((g) =>
    ['QUEUED', 'PREPARING'].includes(g.status),
  );
  return (
    <>
      <Link className="back-link" href="/projects">
        Projects <ChevronRight size={14} /> {project.name}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROJECT WORKSPACE</p>
          <h1>{project.name}</h1>
          <p className="mono muted">{project.baseUrl}</p>
        </div>
        <Badge status={project.verifiedAt ? 'VERIFIED' : 'PENDING'} />
      </div>
      <Notice error={message || error} />
      <ProjectSettings
        key={`${project.id}-${project.targetRevision}`}
        project={project}
        onChange={reload}
      />
      <div className="two-column">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <Sparkles size={18} /> Describe your test
            </h2>
            <span className="pill">AI planner</span>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');
              const data = new FormData(e.currentTarget);
              try {
                await api(`/projects/${id}/generations`, {
                  method: 'POST',
                  body: JSON.stringify({
                    instructions: data.get('instructions'),
                    paths: String(data.get('paths'))
                      .split('\n')
                      .map((p) => p.trim())
                      .filter(Boolean),
                  }),
                });
                await reload();
              } catch (err) {
                setMessage((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              What should happen?
              <textarea
                name="instructions"
                minLength={10}
                maxLength={4000}
                required
                rows={5}
                placeholder="Adding a shirt should increase the cart count to one. Submitting the newsletter without an email should show ‘Email is required’."
              />
            </label>
            <label>
              Starting paths <span className="muted small">Up to three, one per line</span>
              <textarea
                name="paths"
                required
                defaultValue={project.baseUrl === 'http://demo-site:4100' ? '/products' : '/'}
                rows={2}
                className="mono"
              />
            </label>
            <Button disabled={busy || activeGeneration || !project.verifiedAt}>
              <Sparkles size={16} />
              {activeGeneration ? 'Generating test plan…' : 'Generate test plan'}
            </Button>
          </form>
          <p className="footnote">You will review and approve the plan before anything runs.</p>
          {project.generations?.map((g) => (
            <div className="generation" key={g.id}>
              <div>
                <Badge status={g.status} />
                <span>{g.instructions.slice(0, 90)}</span>
              </div>
              {g.error && <p className="error-text">{g.error}</p>}
              {g.suiteId && (
                <Link className="text-link" href={`/suites/${g.suiteId}`}>
                  Review generated suite <ArrowRight size={14} />
                </Link>
              )}
            </div>
          ))}
        </section>
        <aside className="panel guide-panel">
          <span className="eyebrow">A BETTER FIRST TEST</span>
          <h2>Be specific about success.</h2>
          <p>
            “Test the cart” leaves room for assumptions. “Adding one shirt increases the cart count
            to one” gives the browser something verifiable.
          </p>
          <ol>
            <li>
              <span>01</span>Describe the expected behavior.
            </li>
            <li>
              <span>02</span>Review locators and assumptions.
            </li>
            <li>
              <span>03</span>Approve and run in a fresh browser.
            </li>
          </ol>
          <div className="divider" />
          {project.baseUrl === 'http://demo-site:4100' && (
            <>
              <h3>Try the controlled demo</h3>
              <p>Start with a hand-authored cart and form-validation suite. No AI key needed.</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const suite = await api<Suite>(`/projects/${id}/suites`, {
                      method: 'POST',
                      body: JSON.stringify({ plan: demoPlan, paths: ['/products', '/signup'] }),
                    });
                    router.push(`/suites/${suite.id}`);
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <FlaskConical size={16} />
                Use demo suite
              </Button>
            </>
          )}
        </aside>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>Test suites</h2>
          <span className="count">{project.suites?.length || 0}</span>
        </div>
        {project.suites?.length ? (
          project.suites.map((s) => (
            <Link className="suite-row" href={`/suites/${s.id}`} key={s.id}>
              <FileCheck2 size={20} />
              <div>
                <strong>{s.title}</strong>
                <small>
                  Revision {s.revision} · {s.plan.tests.length} tests
                </small>
              </div>
              <Badge status={s.approvedRevision === s.revision ? 'APPROVED' : 'DRAFT'} />
              <ChevronRight size={16} />
            </Link>
          ))
        ) : (
          <p className="muted">Generate a plan or start with the demo suite.</p>
        )}
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Execution history</h2>
        </div>
        <RunTable runs={runs || []} />
      </section>
    </>
  );
}
const actions = [
  'navigate',
  'click',
  'fill',
  'select',
  'check',
  'assertVisible',
  'assertText',
  'assertURL',
  'screenshot',
];
function StepEditor({
  step,
  onChange,
  onRemove,
  index,
}: {
  step: Step;
  onChange: (s: Step) => void;
  onRemove: () => void;
  index: number;
}) {
  const actionId = useId();
  const target = step.target;
  function changeAction(action: string) {
    onChange(
      action === 'navigate' || action === 'assertURL'
        ? { action, path: '/' }
        : action === 'screenshot'
          ? { action }
          : {
              action,
              target: { kind: 'testId', value: '' },
              ...(action === 'assertText' ? { expected: '' } : {}),
              ...(['fill', 'select'].includes(action) ? { value: '' } : {}),
              ...(action === 'check' ? { checked: true } : {}),
            },
    );
  }
  return (
    <div className="step-editor">
      <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
      <div className="step-fields">
        <label className="sr-only" htmlFor={actionId}>
          Action {index + 1}
        </label>
        <select
          id={actionId}
          aria-label={`Step ${index + 1} action`}
          value={step.action}
          onChange={(e) => changeAction(e.target.value)}
        >
          {actions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        {step.path !== undefined && (
          <input
            aria-label="Relative path"
            className="mono"
            value={step.path}
            onChange={(e) => onChange({ ...step, path: e.target.value })}
          />
        )}
        {target && (
          <>
            <select
              aria-label="Locator type"
              value={target.kind}
              onChange={(e) =>
                onChange({
                  ...step,
                  target:
                    e.target.value === 'role'
                      ? { kind: 'role', role: 'button', name: '' }
                      : { kind: e.target.value as 'label' | 'testId', value: '' },
                })
              }
            >
              <option value="testId">Test ID</option>
              <option value="role">Role + name</option>
              <option value="label">Label</option>
            </select>
            {target.kind === 'role' ? (
              <>
                <select
                  aria-label="Role"
                  value={target.role}
                  onChange={(e) =>
                    onChange({ ...step, target: { ...target, role: e.target.value } })
                  }
                >
                  {[
                    'button',
                    'link',
                    'textbox',
                    'checkbox',
                    'combobox',
                    'heading',
                    'alert',
                    'status',
                    'listitem',
                  ].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <input
                  aria-label="Accessible name"
                  value={target.name}
                  onChange={(e) =>
                    onChange({ ...step, target: { ...target, name: e.target.value } })
                  }
                />
              </>
            ) : (
              <input
                aria-label="Locator value"
                className="mono"
                value={target.value}
                onChange={(e) =>
                  onChange({ ...step, target: { ...target, value: e.target.value } as Target })
                }
              />
            )}
          </>
        )}
        {step.expected !== undefined && (
          <input
            aria-label="Expected exact text"
            value={step.expected}
            onChange={(e) => onChange({ ...step, expected: e.target.value })}
          />
        )}
        {step.value !== undefined && (
          <input
            aria-label="Input value"
            value={step.value}
            onChange={(e) => onChange({ ...step, value: e.target.value })}
          />
        )}
        {step.checked !== undefined && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={step.checked}
              onChange={(e) => onChange({ ...step, checked: e.target.checked })}
            />
            Checked
          </label>
        )}
      </div>
      <Button variant="ghost" aria-label={`Remove step ${index + 1}`} onClick={onRemove}>
        <X size={14} />
      </Button>
    </div>
  );
}
function SuitePage({ id }: { id: string }) {
  const { data: suite, error, reload } = useResource<Suite>(`/suites/${id}`);
  const [plan, setPlan] = useState<Plan>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(true);
  const [accessibility, setAccessibility] = useState(false);
  const [responsive, setResponsive] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (suite) {
      setPlan(structuredClone(suite.plan));
      setReviewed(false);
    }
  }, [suite]);
  if (!suite || !plan) return error ? <Notice error={error} /> : <Loading />;
  const dirty = JSON.stringify(plan) !== JSON.stringify(suite.plan);
  const approved =
    suite.approvedRevision === suite.revision &&
    suite.approvedTargetRevision === suite.project?.targetRevision &&
    !dirty;
  const mutate = (fn: (copy: Plan) => void) => {
    const copy = structuredClone(plan);
    fn(copy);
    setPlan(copy);
  };
  async function operation(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href={`/projects/${suite.projectId}`}>
        Project <ChevronRight size={14} /> Suite review
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">REVIEW BEFORE YOU RUN</p>
          <h1>{suite.title}</h1>
          <p className="muted">
            Revision {suite.revision} · {plan.tests.length} independent tests ·{' '}
            {suite.model || 'Hand-authored'}
          </p>
        </div>
        <Badge status={approved ? 'APPROVED' : 'DRAFT'} />
      </div>
      <Notice error={message || error} />
      <div className="editor-layout">
        <div>
          <section className="panel">
            <label>
              Suite title
              <input
                value={plan.title}
                onChange={(e) =>
                  mutate((p) => {
                    p.title = e.target.value;
                  })
                }
              />
            </label>
            {plan.limitations.length > 0 && (
              <div className="assumptions">
                <strong>Known limits</strong>
                <ul>
                  {plan.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {plan.tests.map((test, testIndex) => (
            <section className="panel test-editor" key={test.id}>
              <div className="section-heading">
                <span className="eyebrow">
                  TEST {String(testIndex + 1).padStart(2, '0')}{' '}
                  <span className="mono">/ {test.id}</span>
                </span>
                <span className="pill">{test.priority}</span>
              </div>
              <label>
                Title
                <input
                  value={test.title}
                  onChange={(e) =>
                    mutate((p) => {
                      p.tests[testIndex].title = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                Requirement / expected behavior
                <textarea
                  rows={2}
                  value={test.requirement}
                  onChange={(e) =>
                    mutate((p) => {
                      p.tests[testIndex].requirement = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                Assumptions{' '}
                <span className="muted small">One per line; confirm these before approval</span>
                <textarea
                  rows={2}
                  value={test.assumptions.join('\n')}
                  onChange={(e) =>
                    mutate((p) => {
                      p.tests[testIndex].assumptions = e.target.value.split('\n').filter(Boolean);
                    })
                  }
                />
              </label>
              {test.preconditions.length > 0 && (
                <p className="small muted">Preconditions: {test.preconditions.join('; ')}</p>
              )}
              <h3 className="steps-title">Browser steps</h3>
              {test.steps.map((step, i) => (
                <StepEditor
                  key={i}
                  index={i}
                  step={step}
                  onChange={(s) =>
                    mutate((p) => {
                      p.tests[testIndex].steps[i] = s;
                    })
                  }
                  onRemove={() =>
                    mutate((p) => {
                      p.tests[testIndex].steps.splice(i, 1);
                    })
                  }
                />
              ))}
              <Button
                variant="ghost"
                disabled={test.steps.length >= 15}
                onClick={() =>
                  mutate((p) => {
                    p.tests[testIndex].steps.push({ action: 'screenshot' });
                  })
                }
              >
                <Plus size={14} />
                Add step
              </Button>
            </section>
          ))}
        </div>
        <aside>
          <section className="panel sticky">
            <h2>Execution settings</h2>
            <p className="muted small">Fresh Chromium contexts for every test.</p>
            <div className="device-option">
              <Monitor size={19} />
              <span>
                Desktop<small>1440 × 900</small>
              </span>
              <Check size={16} />
            </div>
            <label className="device-option">
              <Smartphone size={19} />
              <span>
                Mobile<small>390 × 844 · emulated</small>
              </span>
              <input
                type="checkbox"
                checked={mobile}
                onChange={(e) => setMobile(e.target.checked)}
              />
            </label>
            <div className="divider" />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={responsive}
                onChange={(e) => setResponsive(e.target.checked)}
              />
              Check horizontal overflow
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accessibility}
                onChange={(e) => setAccessibility(e.target.checked)}
              />
              Run accessibility audits
            </label>
            <div className="divider" />
            <Button
              className="full-width"
              variant="outline"
              disabled={!dirty || busy}
              onClick={() =>
                operation(async () => {
                  await api(`/suites/${id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ revision: suite.revision, plan }),
                  });
                  await reload();
                })
              }
            >
              Save changes
            </Button>
            {!approved && (
              <>
                <label className="checkbox review-check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  I reviewed the requirements, locators, and assumptions.
                </label>
                <Button
                  className="full-width"
                  variant="outline"
                  disabled={dirty || !reviewed || busy}
                  onClick={() =>
                    operation(async () => {
                      await api(`/suites/${id}/approve`, {
                        method: 'POST',
                        body: JSON.stringify({
                          revision: suite.revision,
                          targetRevision: suite.project?.targetRevision,
                        }),
                      });
                      await reload();
                    })
                  }
                >
                  <Check size={16} />
                  Approve revision {suite.revision}
                </Button>
              </>
            )}
            <Button
              className="full-width run-button"
              disabled={!approved || busy}
              onClick={() =>
                operation(async () => {
                  const run = await api<Run>('/runs', {
                    method: 'POST',
                    headers: { 'idempotency-key': crypto.randomUUID() },
                    body: JSON.stringify({
                      suiteId: id,
                      revision: suite.revision,
                      viewports: mobile ? ['desktop', 'mobile'] : ['desktop'],
                      accessibility,
                      responsive,
                    }),
                  });
                  router.push(`/runs/${run.id}`);
                })
              }
            >
              {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}Run approved suite
            </Button>
            <p className="footnote">
              Edits invalidate approval. Past runs retain their original plans.
            </p>
          </section>
        </aside>
      </div>
    </>
  );
}
function RunPage({ id }: { id: string }) {
  const { data: run, error, reload } = useResource<Run>(`/runs/${id}`, 3000);
  const [events, setEvents] = useState<
    { id: number; type: string; createdAt: string; payload: Record<string, string> }[]
  >([]);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const stream = new EventSource(`/api/runs/${id}/events`);
    stream.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents((previous) =>
        previous.some((p) => p.id === event.id) ? previous : [...previous, event],
      );
    };
    stream.addEventListener('finished', () => {
      stream.close();
      void reload();
    });
    return () => stream.close();
  }, [id, reload]);
  if (!run) return error ? <Notice error={error} /> : <Loading />;
  const finished = terminal.includes(run.status);
  const result =
    run.results.find((r) => r.id === selected) ||
    run.results.find((r) => filter === 'ALL' || r.status === filter);
  const finding = run.analysis?.findings.find((f) => f.resultId === result?.id);
  const previous = run.previous?.results.find(
    (r) => r.testId === result?.testId && r.viewport === result?.viewport,
  );
  return (
    <>
      <Link className="back-link" href={`/suites/${run.suiteId}`}>
        Test suite <ChevronRight size={14} /> Execution {id.slice(0, 8)}
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{finished ? 'THE EVIDENCE IS IN' : 'BROWSER AT WORK'}</p>
          <h1>{run.suite.title}</h1>
          <p className="muted mono small">
            {id.slice(0, 8)} · revision {run.revision} · {stamp(run.createdAt)}
          </p>
        </div>
        <div className="actions">
          <Badge status={run.status} />
          {!finished ? (
            <Button
              variant="outline"
              disabled={run.cancelRequested}
              onClick={async () => {
                try {
                  await api(`/runs/${id}/cancel`, { method: 'POST' });
                  await reload();
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              <Square size={14} />
              {run.cancelRequested ? 'Cancelling…' : 'Cancel'}
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href={`/suites/${run.suiteId}`}>
                <Play size={15} />
                Review & rerun
              </Link>
            </Button>
          )}
        </div>
      </div>
      <Notice error={message || error || run.error || ''} />
      <div className="metrics">
        <Metric
          label="Passed"
          value={String(run.summary.PASSED)}
          detail="Verified expectations"
          icon={<CheckCircle2 size={17} />}
        />
        <Metric
          label="Failed"
          value={String(run.summary.FAILED)}
          detail="Expectations contradicted"
          icon={<FileCheck2 size={17} />}
        />
        <Metric
          label="Blocked / skipped"
          value={`${run.summary.BLOCKED} / ${run.summary.SKIPPED}`}
          detail="Not counted as passes"
          icon={<ShieldCheck size={17} />}
        />
        <Metric
          label="Elapsed"
          value={duration(run)}
          detail={run.config.viewports.join(' + ')}
          icon={<Clock3 size={17} />}
        />
      </div>
      <div className="section-heading">
        <div className="tabs" aria-label="Filter results">
          {['ALL', 'FAILED', 'PASSED', 'BLOCKED', 'SKIPPED'].map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              className={filter === f ? 'selected' : ''}
              onClick={() => {
                setFilter(f);
                setSelected(undefined);
              }}
            >
              {f.toLowerCase()}
            </button>
          ))}
        </div>
        <div className="actions">
          <a className="text-link" href={`/api/runs/${id}/report?format=html`}>
            <ArrowDownToLine size={15} />
            HTML report
          </a>
          <a className="text-link" href={`/api/runs/${id}/report?format=json`}>
            JSON
          </a>
        </div>
      </div>
      <div className="results-layout">
        <section className="panel result-list">
          {run.results
            .filter((r) => filter === 'ALL' || r.status === filter)
            .map((r) => (
              <button
                key={r.id}
                className={`result-row ${result?.id === r.id ? 'selected' : ''}`}
                onClick={() => setSelected(r.id)}
              >
                <div>
                  <Badge status={r.status} />
                  <span className="small muted">{r.viewport}</span>
                </div>
                <strong>{r.title}</strong>
                <small>
                  {Math.round(r.durationMs / 1000)}s <ChevronRight size={13} />
                </small>
              </button>
            ))}
          {!run.results.length && (
            <div className="empty compact">
              <Radio size={25} className={!finished ? 'pulse' : ''} />
              <h3>{finished ? 'No test results' : 'Waiting for browser evidence'}</h3>
              <p>
                {finished
                  ? 'Check the run error and timeline.'
                  : 'The timeline below will update as execution progresses.'}
              </p>
            </div>
          )}
        </section>
        <section className="panel evidence-panel">
          {result ? (
            <>
              <div className="section-heading">
                <h2>{result.title}</h2>
                <Badge status={result.status} />
              </div>
              <p className="muted small">
                {result.viewport} · {result.testId}
                {previous ? ` · Previous run: ${previous.status.toLowerCase()}` : ''}
              </p>
              {result.steps.map((s, i) => (
                <div className="evidence-step" key={s.id}>
                  <div>
                    <span className="step-number">{i + 1}</span>
                    <strong className="mono">{s.action}</strong>
                    <Badge status={s.status} />
                    <span className="small muted">{s.durationMs}ms</span>
                  </div>
                  {s.expected !== undefined && (
                    <dl>
                      <dt>Expected</dt>
                      <dd>{s.expected}</dd>
                      <dt>Observed</dt>
                      <dd>{s.actual || 'No value observed'}</dd>
                    </dl>
                  )}
                  {s.error && (
                    <details>
                      <summary>Error details</summary>
                      <pre>{s.error}</pre>
                    </details>
                  )}
                </div>
              ))}
              {result.artifacts.map((a) =>
                a.expired || new Date(a.expiresAt) < new Date() ? (
                  <p className="footnote" key={a.id}>
                    {a.type} expired
                  </p>
                ) : a.type === 'screenshot' ? (
                  <a key={a.id} href={`/api/artifacts/${a.id}`} target="_blank" rel="noreferrer">
                    <img
                      className="evidence-image"
                      alt={`Browser evidence for ${result.title} on ${result.viewport}`}
                      src={`/api/artifacts/${a.id}`}
                    />
                  </a>
                ) : (
                  <a key={a.id} className="text-link artifact-link" href={`/api/artifacts/${a.id}`}>
                    <ArrowDownToLine size={15} />
                    Download Playwright trace
                  </a>
                ),
              )}
              {result.diagnostics.length > 0 && (
                <details>
                  <summary>Browser diagnostics ({result.diagnostics.length})</summary>
                  <pre>{JSON.stringify(result.diagnostics, null, 2)}</pre>
                </details>
              )}
              {finding && (
                <div className="ai-finding">
                  <span className="eyebrow">
                    <Sparkles size={15} />
                    AI INVESTIGATION SUGGESTION
                  </span>
                  <p>{finding.explanation}</p>
                  <strong>Where to investigate</strong>
                  <p>{finding.investigation}</p>
                  <small>{finding.uncertainty}</small>
                </div>
              )}
              {run.analysisWarning && (
                <p className="footnote">
                  Analysis unavailable: {run.analysisWarning}. Browser results are preserved.
                </p>
              )}
            </>
          ) : (
            <div className="empty compact">
              <FileCheck2 size={25} />
              <h3>Select a check to inspect its evidence</h3>
            </div>
          )}
        </section>
      </div>
      <section className="panel timeline-panel">
        <div className="section-heading">
          <h2>
            <Terminal size={17} />
            Execution timeline
          </h2>
          <span className="small muted">{events.length} recorded events</span>
        </div>
        <div className="timeline" tabIndex={0} role="region" aria-label="Execution events">
          {events.length ? (
            events.map((e) => (
              <div key={e.id}>
                <time>{new Date(e.createdAt).toLocaleTimeString()}</time>
                <span className="timeline-dot" />
                <span className="mono small">{e.type}</span>
                <span>
                  {e.payload.title || e.payload.action || e.payload.status || e.payload.testId}
                </span>
                {e.payload.viewport && <small className="muted">{e.payload.viewport}</small>}
              </div>
            ))
          ) : (
            <p className="muted small">The worker checks queued jobs every few seconds.</p>
          )}
        </div>
      </section>
    </>
  );
}
