# Verification record

## Public accounts and user-managed websites — 11 November 2026

Verified locally with Windows, Node.js 24, Docker Desktop/Linux containers, and Microsoft Edge for application acceptance tests.

| Check                                 | Result                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, TypeScript checking, unit tests | Passed; 66 tests                                                                                                                                      |
| Production Next.js/Compose build      | Passed; services rebuilt and running                                                                                                                  |
| Browser acceptance suite              | Seven passed; one skipped because Groq credentials are configured                                                                                     |
| Public signup                         | Account creation, local email delivery, verification, and login passed                                                                                |
| Password recovery                     | Local reset email, password replacement, old-password rejection, and session invalidation passed                                                      |
| Token safety                          | Expiry, wrong-purpose tokens, replay, and simultaneous consumption passed                                                                             |
| OAuth integration                     | Mocked Google/GitHub code flows passed; PKCE, state, signatures, nonce, verified emails, collision handling, and explicit connection checked          |
| Website management                    | Public origin validation, ownership instructions, active-job edit rejection, stale edits, approval invalidation, and historical snapshots checked     |
| Ownership proof                       | DNS TXT matching and pinned HTTPS-file requests tested with mocked DNS/HTTP; redirects and private addresses rejected                                 |
| Browser execution                     | Demo suite completed with 12 passed, 0 failed, 0 blocked                                                                                              |
| Security and recovery                 | Ownership/CSRF, cancellation, artifact expiry, stale-worker handling, and duplicate delivery passed                                                   |
| Network isolation                     | Live Docker check passed: direct browser internet/private-service/metadata access blocked; signed demo traffic allowed; off-origin navigation blocked |
| Accessibility/layout                  | Signup and report automated WCAG A/AA audits passed; mobile website settings checked without horizontal overflow                                      |

The acceptance suite initially exceeded the login throttle because it repeated unnecessary logins. It now reuses an existing session to check reset invalidation; production rate limits remain enabled. A targeted mobile website-settings rerun also passed. Screenshots and reports are generated under ignored `test-results/` and `playwright-report/` directories.

Google and GitHub report configured credentials in the local API. Real provider consent/callback sessions have not been exercised; automated provider checks use mocked responses. Mailpit delivered local test messages only. Live SMTP delivery and a real user-owned domain's verification remain deployment checks.

## Earlier checks

On 8 November, all 19 Python/Groq service tests passed. A live synthetic request through the local AI endpoint returned a validated `openai/gpt-oss-20b` plan (1,699 input / 185 output tokens). An initial request failed with 502; later authentication, direct structured-output, and service requests succeeded. This is a smoke check, not a model quality benchmark.

The database backup exercise restored all 12 runs present at that time into a separate database without modifying the live database. The public-account migration subsequently added schema fields and tables without resetting existing data.

## Remaining limits

- No public deployment, remote CI run, or registry publishing has been performed.
- No broad Groq accuracy/cost benchmark, physical-device test, load test, artifact archive restore, or hostile multi-tenant sandbox assessment has been completed.
- The dependency audit performed during installation reported an existing Prisma configuration-tooling advisory through `deepmerge-ts` (recursive object graphs). Its suggested fix requires a Prisma major upgrade; this feature change did not force that unrelated migration.
- Email/provider credentials and recovery links must remain private. The local Mailpit inbox is for development and must not be exposed publicly.

Reproduce checks with the README commands, `npm run test:e2e`, and `docker compose exec -T worker node --import tsx scripts/network-check.ts`. Use the evaluation procedure before making accuracy or reliability claims.
