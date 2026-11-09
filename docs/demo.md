# Demo and evaluation

## Five-minute product walkthrough

1. Sign in, create a Demo Shop project, and choose the hand-authored demo suite (or generate one with an API key).
2. Show the expected cart count and required-email assertion. Explain that approval records a specific revision.
3. Run desktop + mobile with the additional checks. Inspect screenshots and download a trace.
4. Introduce a defect in the target: set `DEMO_BUGS=cart` in `.env`, then `docker compose up -d demo-site`.
5. Rerun the same approved suite. Show the expected `1`, observed `0`, screenshot, and explanation availability.
6. Clear `DEMO_BUGS`, restart only the demo site, and rerun. The same approved assertion now passes. Historical evidence remains unchanged.

Independent defect names: `search`, `cart`, `validation`, `overflow`, `accessibility`. Query strings such as `/products?bugs=cart` are also available for automated fixtures; no real orders or emails are generated.

## Browser reliability

Repeat a fixed approved suite ten times against a fixed fixture version. Record the configuration, image versions, run IDs, outcomes, and durations. Count inconsistent results rather than calling every retry a successful test. Evaluate the buggy and fixed versions separately.

The seeded fixture contains five documented defects. Precision is confirmed reported defects divided by reported defects; recall is detected seeded defects divided by seeded defects relevant to the reviewed suite. State the suite's coverage: the starter cart/email suite does not claim to test search. Optional axe and overflow checks cover their respective seeded defects.

## Live-model planning evaluation

The ten prompts in `tests/fixtures/evaluation.json` cover cart counts, search visibility, newsletter validation, and an unsupported payment requirement. The expected-requirement descriptions are evaluator labels and are not passed to the model.

With a configured API key:

```sh
docker compose exec worker node --import tsx scripts/evaluate.ts
```

This consumes Groq model quota and may incur charges on a paid account. Free-tier rate limits can interrupt the evaluation; failures are recorded rather than retried automatically. Results are written inside the private artifact volume under `evaluations/`. It records schema validity, duration, token usage, model, and proposed plans. Human requirement-coverage fields remain null until evaluated; valid JSON is not proof of correct tests. Review and approve plans through the app before executing them.

Record the number of plans executable without edits, edits needed, requirement coverage, unsafe or unsupported proposals, and model refusals. Do not publish unmeasured precision, reliability, or cost claims.

## Reports

HTML exports are escaped and printable. Open a downloaded report and use your browser's Save as PDF option. Artifact links require your signed-in session and expire after seven days. Download evidence separately if you need it longer. Use the local Playwright trace viewer for downloaded traces: `npx playwright show-trace trace.zip`.
