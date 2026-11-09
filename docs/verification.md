# Verification record

Verified locally on 8 November 2026 using Windows, Node.js 24, Python 3.13, and Docker Desktop with Linux containers.

| Check                                          | Observed result                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| TypeScript lint, type checking, and unit tests | Passed; 35 tests                                                                                                 |
| Python contract and AI service tests           | Passed; 10 tests                                                                                                 |
| Production Next.js build and Compose startup   | Passed                                                                                                           |
| Full UI workflow                               | Project creation, suite review, revision approval, desktop/mobile execution, report export, and evidence display |
| Controlled demo execution                      | 12 passed, 0 failed, 0 blocked, including optional accessibility and overflow checks                             |
| Seeded cart regression                         | Broken cart failed with observed count 0; corrected revision passed; previous snapshot preserved                 |
| Authorization and lifecycle                    | Ownership, CSRF, unsafe targets, cancellation, artifact expiry, and duplicate submission checks passed           |
| Interrupted execution                          | Stale run failed while retaining evidence; duplicate delivery did not restart actions                            |
| Browser network isolation                      | Direct internet, private service, and metadata access blocked; approved demo traffic through proxy succeeded     |
| Database recovery                              | Dump restored to a separate database; all 12 runs present at the time of backup; live database unchanged         |

The UI accessibility check exposed low-contrast report text and a keyboard-inaccessible scrolling timeline. The shared colors were darkened and the timeline made focusable. The targeted workflow rerun passed with zero axe WCAG 2 A/AA violations on the mobile report page. Across the acceptance checks, four scenarios passed and the missing-credentials scenario was skipped. Automated checks are scoped to the tested page and do not establish full accessibility compliance.

Reproduce the checks using the README, `npm run test:e2e`, `docker compose exec -T worker node --import tsx scripts/network-check.ts`, and `node scripts/restore-check.mjs`. Browser screenshots and the Playwright report are generated in ignored `test-results/` and `playwright-report/` directories. End-to-end fixtures create local accounts and preserve their evidence.

## Groq integration update

Switched to the existing OpenAI Python SDK with Groq's endpoint and default model `openai/gpt-oss-20b`. All 19 Python tests passed, including HTTP-mocked SDK requests for planning and analysis, strict schemas, credential isolation, refusal, invalid/truncated output, and rate limits without retries. The AI container was rebuilt and restarted.

Live Groq authentication and model availability were confirmed. A synthetic planning request through the local service returned HTTP 200 with one validated test and token usage of 1,699 input / 185 output. An initial live request returned a generic 502; subsequent authentication, direct structured-output, and service checks succeeded. This is a smoke check, not a reliability or quality benchmark.

## Not verified

- Groq generation quality across the evaluation set, live diagnosis quality, cost, and quantitative coverage benchmarks. The missing-credentials end-to-end case was previously skipped because the test process reported an API key; service error behavior is covered by Python tests.
- Public HTTPS deployment, GitHub Actions execution, and registry publishing. The configuration is provided but was not deployed remotely.
- Artifact archive restoration, physical devices, other browser engines, load testing, and hostile multi-tenant sandbox resistance.

This is a controlled portfolio application for approved demo/staging targets. Use the evaluation procedure before making accuracy or reliability claims.
