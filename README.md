# AutoQA Agent

A self-service website testing workspace with verified accounts and website ownership. Describe expected behavior, review a structured plan, approve its revision, and execute it in an isolated Chromium browser. Reports preserve assertions, screenshots, traces, and diagnostics. Groq-hosted GPT-OSS explains failures without changing their outcomes.

## Run locally

Requirements: Node.js 22.12+ (24 recommended), Docker Desktop with Linux containers, and approximately 6 GB available Docker memory. Python 3.13 is needed only when developing the AI service outside Docker.

```sh
npm ci
npm run setup
docker compose up -d --build
```

Open **http://localhost:3000/signup**, create an account, and verify your email. Development emails arrive in the local inbox at **http://localhost:8025**; Mailpit does not send them to the internet. Login, password recovery, and resend verification are available from the sign-in page.

Create a project with your website's origin, then verify control using a DNS TXT record or an HTTPS file. Add any required CDN/API origins in Website settings. See [Accounts and website setup](docs/accounts-and-websites.md) for Google/GitHub configuration and verification instructions.

For a no-key walkthrough, click **Use Demo Shop** when creating a project, then **Use demo suite**. Review its requirements, approve the revision, and run it. The demo is enabled only in the development configuration.

For AI planning and diagnosis, add `GROQ_API_KEY` to the ignored `.env` file, then run:

```sh
docker compose up -d ai
```

The default model is `openai/gpt-oss-20b`, OpenAI's open-weight model hosted by Groq. The existing OpenAI Python SDK connects to `https://api.groq.com/openai/v1`; no OpenAI API key or Groq SDK is needed. Configure:

```dotenv
GROQ_API_KEY=your-groq-key
GROQ_MODEL=openai/gpt-oss-20b
```

Groq lists this model on its [free tier](https://console.groq.com/docs/rate-limits), subject to account quotas. This is not unlimited free usage; your Groq account's plan determines billing. Strict structured output and local validation remain enabled. Rate limits, missing credentials, refused output, and invalid plans fail explicitly; browser results remain available when diagnosis fails.

If upgrading from the original OpenAI configuration, move your Groq key to `GROQ_API_KEY` and replace `OPENAI_MODEL` with `GROQ_MODEL`. Rebuild the service with `docker compose up -d --build ai`. OpenAI credentials are not used as a fallback.

First startup downloads browser and application images and can take several minutes. Check `docker compose ps` and `docker compose logs --tail 50 api worker ai browser` if a service is not ready. The dashboard is not ready until database migration and frontend startup finish.

## What is implemented

- Public signup, verified email/password login, password reset, Google/GitHub sign-in, secure sessions, CSRF checks, and submission quotas.
- User-owned website targets with DNS/file verification, explicit CDN/API origins, project history, AI planning, structured editing, and revision-specific approval.
- Immutable run snapshots; asynchronous Redis/BullMQ execution; cancellation; interruption detection without action replay.
- Chromium desktop/mobile presets, deterministic assertions, optional overflow checks and axe audits.
- Live event replay, screenshots, traces, diagnostics, previous-run comparison, HTML/JSON reports.
- Private seven-day artifact retention and explicit expired-artifact responses.
- Python planning/diagnosis service, shared contract fixtures, and a live-model evaluation command.
- Docker Compose, a production HTTPS overlay, CI checks, and a controlled defective storefront.

## Development

The supported complete runtime is Docker Compose. For frontend iteration, stop only the web container and start Next.js locally; the API remains in Docker:

```sh
docker compose stop web
npm run dev
```

For API iteration, stop `api`, run `npm run db:generate`, then `npm run dev:api`. Set `SMTP_HOST=localhost` in that process to reach the published Mailpit SMTP port (1025). The local API uses the `.env` loopback database and Redis addresses. Its artifact directory must contain the worker's files if you want local artifact previews; use the container API for full pipeline tests.

Browser workers are designed to run inside the Compose network. Do not expose the Playwright control endpoint publicly or replace it with an unrestricted local browser for arbitrary websites.

For the Python service:

```sh
python -m venv .venv
# Windows: .venv\Scripts\python.exe; Linux/macOS: .venv/bin/python
python -m pip install -r services/ai/requirements.txt
# Export AI_SERVICE_TOKEN, GROQ_API_KEY, and GROQ_MODEL in your shell first.
python -m uvicorn app.main:app --app-dir services/ai --port 8000
```

Use the activated virtual environment for those commands. Docker supplies these environment variables automatically; a standalone Python process reads them from your shell.

## Checks

```sh
npm run db:generate
npm run check
python -m pytest -q
npm run build
# With the full Compose application running:
npx playwright install chromium
npm run test:e2e
```

Windows E2E tests use installed Microsoft Edge by default. Set `E2E_BROWSER_CHANNEL=chromium` to use Playwright Chromium instead. On Linux CI, install browsers with `npx playwright install --with-deps chromium`.

E2E tests provision unique test accounts and projects in the development database, preserving their run evidence for inspection. Run them only against the local development instance. They do not delete existing projects or disable security checks. Never point them at production.

## Documentation

- [Accounts and website setup](docs/accounts-and-websites.md)
- [Architecture and API](docs/architecture.md)
- [Operations, deployment, and recovery](docs/operations.md)
- [Demo and benchmark instructions](docs/demo.md)
- [Verification record](docs/verification.md)

## Boundaries

Registration is public; website ownership must be verified before generation or execution. Use authorized demo/staging sites and synthetic data. Public signup does not make this single-host portfolio deployment a hardened hostile-code hosting service. Target credentials, real payments, account deletion, multi-browser runs, scheduled runs, visual baselines, and self-healing are intentionally outside this release. Automated accessibility checks cover selected rules, not full compliance. Mobile emulation is not physical-device testing.

Artifacts, traces, and exported reports may contain all data shown on the target. Use synthetic data only. Browser contexts isolate ordinary test state; they are not a hardened multi-tenant hostile-code service.
