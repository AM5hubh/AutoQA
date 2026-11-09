# Architecture and contracts

Next.js serves the workspace UI. Express owns authentication, projects, suite approvals, and report access. PostgreSQL is the source of truth. Redis/BullMQ delivers jobs to one worker. The worker controls a separate sandboxed Chromium container, writes evidence to a private volume, and calls the stateless FastAPI service.

The browser has no database, Groq, or session credentials. Its Docker networks are internal. An allowlisted egress proxy resolves approved destinations to IPv4 addresses, rejects private/reserved addresses, and connects to the validated address rather than resolving it again. The local `demo-site:4100` fixture is the only explicit private-address exception. The proxy and the browser have no connection to the database network. The worker spans the control/data networks but exposes no listening service.

All browser HTTP requests are additionally checked against the project's exact origin. Cross-origin CDN assets, websockets, downloads, service workers, and popup flows are unsupported. Add self-contained approved targets; do not weaken the browser network restriction to make a third-party site load.

## Main records

Users own projects; projects contain suites and generation jobs. A suite stores a versioned JSON plan. Approval records the exact revision. Each run copies the plan, target, paths, model/prompt metadata, and configuration. Results contain ordered step evidence; artifacts reference private files. Events have database-assigned increasing IDs for SSE replay.

The database schema lives in `packages/database/schema.prisma`; the initial migration is committed. New schema changes require a new migration. Never use `prisma db push` against a deployed database.

## Job lifecycle

`QUEUED → PREPARING → RUNNING → ANALYZING → COMPLETED`, with terminal `FAILED` and `CANCELLED` states. Completed means execution finished, not that all checks passed. Result outcomes are `PASSED`, `FAILED`, `BLOCKED`, or `SKIPPED`.

The API writes queued records transactionally. A five-second reconciler dispatches queued records using stable queue IDs. Atomic status claims prevent duplicate execution. Stale active runs become failed after 90 seconds without a heartbeat. They are never automatically replayed. A rerun is a new record.

Only model explanations are optional after execution. A missing or failing AI service leaves deterministic results intact with an analysis warning. Generation fails explicitly when the model is unavailable.

The AI service uses the OpenAI Python SDK against Groq's Chat Completions endpoint, with `openai/gpt-oss-20b` by default. Pydantic schemas request strict structured output and validate the parsed plan locally, including semantic constraints. Calls have a 55-second timeout, a 4,096-token completion limit, and no automatic retries. Groq rate limits return an explicit error. The provider key is supplied only to the AI container; model metadata and normalized token usage are preserved in the existing response contract.

## API

All application endpoints use `/api`. Session authentication is required except login. Mutations require the configured exact `Origin` and, after login, `X-CSRF-Token`. `/auth/me` returns that token.

| Method and endpoint | Input / result |
| --- | --- |
| POST `/auth/login` | email/password → user and CSRF token |
| POST `/auth/logout` | End session |
| GET `/auth/me` | Current user and token |
| GET `/targets` | Administrator-approved origins |
| GET, POST `/projects` | List / create `{name, baseUrl}` |
| GET `/projects/:id` | Suites and recent generations |
| POST `/projects/:id/generations` | `{instructions, paths}` → 202 generation record |
| GET `/generations/:id` | Status, error, resulting suite ID |
| POST `/projects/:id/suites` | Hand-authored `{plan, paths}` |
| GET, PATCH `/suites/:id` | Read / save `{revision, plan}` |
| POST `/suites/:id/approve` | `{revision}` |
| POST `/runs` | `{suiteId, revision, viewports, accessibility, responsive}`, UUID `Idempotency-Key` |
| GET `/projects/:id/runs` | Latest 50 runs with summary counts |
| GET `/runs/:id` | Snapshot, results, analysis, previous completed run |
| GET `/runs/:id/events` | SSE; supports `Last-Event-ID` or `after` cursor |
| POST `/runs/:id/cancel` | Persistent cancellation request |
| GET `/runs/:id/report?format=json\|html` | Download report |
| GET `/artifacts/:id` | Authorized screenshot/trace; 410 after expiry |

Validation errors return 422; unapproved/stale revisions and duplicate-key conflicts return 409. Other owners' resource IDs return 404. Daily quota exhaustion returns 429. The initial limit is 20 generation/run submissions over a rolling 24-hour window and one active job per user.

Private AI endpoints `/plan` and `/analyze` require `Authorization: Bearer <AI_SERVICE_TOKEN>`. Bodies are capped at 128 KiB. Their Pydantic response schemas are exported by `python services/ai/export_schema.py`; TypeScript applies its own semantic validator before executing any action. Shared fixtures test both sides.

## Action vocabulary

Navigate uses a same-origin relative path. Targets use exact role/name, label, or data-testid. Allowed actions are navigate, click, fill, select, check, assertVisible, assertText, assertURL, and screenshot. No generated JavaScript is accepted. Every test must begin with navigation and include an assertion. Each suite supports at most five tests and each test at most fifteen steps.

Page observation is bounded to three supplied URLs and 20,000 characters per page. The planner records assumptions and unsupported requirements. No autonomous crawler or locator repair runs behind the review screen.
