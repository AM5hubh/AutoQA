import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { requestAllowed, signPolicy } from '../../../packages/contracts/src/network.ts';
import {
  assertSameOrigin,
  limits,
  viewports,
  type Plan,
  type Step,
  type Target,
  type Outcome,
  type StepEvidence,
} from '@autoqa/contracts';

export type Diagnostic = { type: string; message: string };
export type Result = {
  id: string;
  testId: string;
  title: string;
  viewport: string;
  status: Outcome;
  durationMs: number;
  steps: StepEvidence[];
  diagnostics: Diagnostic[];
};
export type EvidenceFile = {
  id: string;
  resultId: string;
  type: string;
  storageKey: string;
  size: number;
};
export type ExecutionHooks = {
  additionalOrigins?: string[];
  jobId?: string;
  signal: AbortSignal;
  artifactDir: string;
  event: (type: string, payload: unknown) => Promise<void>;
  result: (result: Result, files: EvidenceFile[]) => Promise<void>;
};
export function locate(page: Page, target: Target) {
  if (target.kind === 'role')
    return page.getByRole(target.role, { name: target.name, exact: true });
  if (target.kind === 'label') return page.getByLabel(target.value, { exact: true });
  return page.getByTestId(target.value);
}
export async function connectBrowser() {
  if (!process.env.BROWSER_WS_ENDPOINT) throw new Error('BROWSER_WS_ENDPOINT is required');
  return chromium.connect(process.env.BROWSER_WS_ENDPOINT, { timeout: 15000 });
}
export async function safeContext(
  browser: Browser,
  origin: string,
  viewport: keyof typeof viewports,
  signal: AbortSignal,
  additionalOrigins: string[] = [],
  jobId: string = randomUUID(),
) {
  signal.throwIfAborted();
  const context = await browser.newContext({
    ...viewports[viewport],
    viewport: viewports[viewport],
    serviceWorkers: 'block',
    acceptDownloads: false,
    ...(process.env.BROWSER_PROXY
      ? {
          proxy: {
            server: process.env.BROWSER_PROXY,
            bypass: '<-loopback>',
            username: jobId,
            password: signPolicy(jobId, [origin, ...additionalOrigins]),
          },
        }
      : {}),
  });
  context.setDefaultTimeout(limits.actionMs);
  context.setDefaultNavigationTimeout(limits.navigationMs);
  await context.route('**/*', async (route) => {
    try {
      if (
        !requestAllowed(
          route.request().url(),
          origin,
          additionalOrigins,
          route.request().isNavigationRequest(),
        )
      )
        throw new Error('Destination denied');
      await route.continue();
    } catch {
      await route.abort('blockedbyclient').catch(() => {});
    }
  });
  await context.routeWebSocket('**/*', (socket) => socket.close());
  const abort = () => {
    void context.close().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  context.once('close', () => signal.removeEventListener('abort', abort));
  if (signal.aborted) {
    await context.close();
    signal.throwIfAborted();
  }
  return context;
}
const clean = (message: string) =>
  message
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1[redacted]')
    .replace(/([?&](?:token|key|password|secret)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 2000);
function diagnostics(page: Page): Diagnostic[] {
  const items: Diagnostic[] = [
    {
      type: 'environment',
      message: `Chromium ${page.context().browser()?.version()}; viewport ${JSON.stringify(page.viewportSize())}`,
    },
  ];
  const add = (type: string, message: string) => {
    if (items.length < 50) items.push({ type, message: clean(message) });
  };
  page.on('pageerror', (e) => add('exception', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') add('console', m.text());
  });
  page.on('requestfailed', (r) =>
    add('request', `${r.method()} ${r.url()}: ${r.failure()?.errorText}`),
  );
  page.on('response', (r) => {
    if (r.status() >= 400) add('http', `${r.status()} ${r.url()}`);
  });
  page.on('dialog', (d) => {
    void d.dismiss();
  });
  page.on('popup', (p) => {
    void p.close();
  });
  return items;
}
export async function inspect(
  browser: Browser,
  origin: string,
  paths: string[],
  signal: AbortSignal,
  additionalOrigins: string[] = [],
  jobId: string = randomUUID(),
) {
  const context = await safeContext(browser, origin, 'desktop', signal, additionalOrigins, jobId);
  try {
    const page = await context.newPage();
    const observations = [];
    for (const pathname of paths) {
      signal.throwIfAborted();
      const url = assertSameOrigin(pathname, origin);
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      const snapshot = await page.locator('body').ariaSnapshot({ timeout: limits.actionMs });
      const elements = await page
        .locator('a,button,input,select,[data-testid]')
        .evaluateAll((nodes) =>
          nodes.slice(0, 100).map((node) => ({
            tag: node.tagName,
            text: (node.textContent || '').trim().slice(0, 120),
            testId: node.getAttribute('data-testid'),
            label: node.getAttribute('aria-label'),
            type: node.getAttribute('type'),
            href: node.getAttribute('href'),
          })),
        );
      const content = JSON.stringify({ snapshot, elements });
      observations.push({
        url: page.url(),
        title: await page.title(),
        content: content.slice(0, 20000),
        truncated: content.length > 20000,
      });
    }
    return observations;
  } finally {
    await context.close();
  }
}
async function executeStep(
  page: Page,
  step: Step,
  origin: string,
): Promise<{ expected?: string; actual?: string }> {
  switch (step.action) {
    case 'navigate': {
      const response = await page.goto(assertSameOrigin(step.path, origin).href, {
        waitUntil: 'domcontentloaded',
      });
      if (response && response.status() >= 400)
        throw new Error(`Navigation returned HTTP ${response.status()}`);
      return { actual: page.url() };
    }
    case 'click':
      await locate(page, step.target).click();
      return {};
    case 'fill':
      await locate(page, step.target).fill(step.value);
      return {};
    case 'select':
      await locate(page, step.target).selectOption(step.value);
      return {};
    case 'check':
      await locate(page, step.target).setChecked(step.checked);
      return {};
    case 'assertVisible':
      await expect(locate(page, step.target)).toBeVisible({ timeout: limits.actionMs });
      return { expected: 'visible', actual: 'visible' };
    case 'assertText':
      await expect(locate(page, step.target)).toHaveText(step.expected, {
        timeout: limits.actionMs,
      });
      return {
        expected: step.expected,
        actual: (await locate(page, step.target).textContent()) || '',
      };
    case 'assertURL': {
      const expected = assertSameOrigin(step.path, origin).href;
      await expect(page).toHaveURL(expected, { timeout: limits.actionMs });
      return { expected, actual: page.url() };
    }
    case 'screenshot':
      return {};
  }
}
export function classifyFailure(step: Step, signal: AbortSignal, error: unknown): Outcome {
  if (signal.aborted) return signal.reason?.message === 'Cancelled' ? 'SKIPPED' : 'BLOCKED';
  const message = error instanceof Error ? error.message : String(error);
  if (/strict mode violation|Target.*closed|browser.*closed|net::/i.test(message)) return 'BLOCKED';
  return step.action.startsWith('assert') ? 'FAILED' : 'BLOCKED';
}
export async function executeSuite(
  browser: Browser,
  origin: string,
  plan: Plan,
  paths: string[],
  config: { viewports: (keyof typeof viewports)[]; accessibility: boolean; responsive: boolean },
  hooks: ExecutionHooks,
) {
  await mkdir(hooks.artifactDir, { recursive: true });
  for (const viewport of config.viewports) {
    for (const test of plan.tests) {
      const started = Date.now();
      const result: Result = {
        id: randomUUID(),
        testId: test.id,
        title: test.title,
        viewport,
        status: 'PASSED',
        durationMs: 0,
        steps: [],
        diagnostics: [],
      };
      const files: EvidenceFile[] = [];
      let context: BrowserContext | undefined;
      let page: Page | undefined;
      const capture = async (type: string, bytes?: Buffer) => {
        const artifactId = randomUUID();
        const storageKey = `${artifactId}.${type === 'trace' ? 'zip' : 'png'}`;
        const filename = path.join(hooks.artifactDir, storageKey);
        if (type === 'trace') await context!.tracing.stop({ path: filename });
        else await writeFile(filename, bytes!);
        files.push({
          id: artifactId,
          resultId: result.id,
          type,
          storageKey,
          size: (await stat(filename)).size,
        });
      };
      try {
        hooks.signal.throwIfAborted();
        context = await safeContext(
          browser,
          origin,
          viewport,
          hooks.signal,
          hooks.additionalOrigins,
          hooks.jobId,
        );
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        page = await context.newPage();
        result.diagnostics = diagnostics(page);
        await hooks.event('test-started', { testId: test.id, title: test.title, viewport });
        for (let index = 0; index < test.steps.length; index++) {
          const step = test.steps[index];
          const start = Date.now();
          const evidence: StepEvidence = {
            id: `${result.id}-${index}`,
            action: step.action,
            status: 'PASSED',
            durationMs: 0,
          };
          try {
            hooks.signal.throwIfAborted();
            Object.assign(evidence, await executeStep(page, step, origin));
            if (step.action === 'screenshot')
              await capture('screenshot', await page.screenshot({ fullPage: true, timeout: 5000 }));
          } catch (error) {
            evidence.status = classifyFailure(step, hooks.signal, error);
            result.status = evidence.status;
            evidence.error = clean(error instanceof Error ? error.message : String(error));
            if (step.action === 'assertText') {
              evidence.expected = step.expected;
              evidence.actual =
                (await locate(page, step.target)
                  .textContent({ timeout: 300 })
                  .catch(() => '<not found or ambiguous>')) || '';
            }
            if (step.action === 'assertVisible') {
              evidence.expected = 'visible';
              evidence.actual = 'not visible';
            }
            if (step.action === 'assertURL') {
              evidence.expected = assertSameOrigin(step.path, origin).href;
              evidence.actual = page.url();
            }
          }
          evidence.durationMs = Date.now() - start;
          result.steps.push(evidence);
          await hooks.event('step', { testId: test.id, viewport, ...evidence });
          if (evidence.status !== 'PASSED') break;
        }
      } catch (error) {
        result.status =
          hooks.signal.aborted && hooks.signal.reason?.message === 'Cancelled'
            ? 'SKIPPED'
            : 'BLOCKED';
        result.diagnostics.push({
          type: 'execution',
          message: clean(error instanceof Error ? error.message : String(error)),
        });
      } finally {
        if (page && !page.isClosed()) {
          try {
            await capture('screenshot', await page.screenshot({ fullPage: true, timeout: 5000 }));
          } catch (error) {
            result.diagnostics.push({ type: 'evidence', message: clean(String(error)) });
          }
        }
        if (context) {
          await capture('trace').catch((error) => {
            result.diagnostics.push({ type: 'evidence', message: clean(String(error)) });
          });
          await context.close().catch(() => {});
        }
        result.durationMs = Date.now() - started;
        await hooks.result(result, files);
        await hooks.event('test-finished', { testId: test.id, viewport, status: result.status });
      }
    }
    if (!config.accessibility && !config.responsive) continue;
    for (const pathname of paths) {
      for (const check of ['accessibility', 'responsive'] as const) {
        if (!config[check]) continue;
        const start = Date.now();
        const result: Result = {
          id: randomUUID(),
          testId: `${check}:${pathname}`,
          title: `${check === 'accessibility' ? 'Accessibility audit' : 'Horizontal overflow'} · ${pathname}`,
          viewport,
          status: 'PASSED',
          durationMs: 0,
          steps: [],
          diagnostics: [],
        };
        let context: BrowserContext | undefined;
        const files: EvidenceFile[] = [];
        try {
          context = await safeContext(
            browser,
            origin,
            viewport,
            hooks.signal,
            hooks.additionalOrigins,
            hooks.jobId,
          );
          const page = await context.newPage();
          await page.goto(assertSameOrigin(pathname, origin).href, {
            waitUntil: 'domcontentloaded',
          });
          let actual: string;
          if (check === 'accessibility') {
            const audit = await new AxeBuilder({ page })
              .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
              .analyze();
            actual = JSON.stringify(
              audit.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                help: v.help,
                helpUrl: v.helpUrl,
                nodes: v.nodes.slice(0, 5).map((n) => n.target),
              })),
            );
            result.status = audit.violations.length ? 'FAILED' : 'PASSED';
          } else {
            const overflow = await page.evaluate(
              () =>
                Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
                window.innerWidth,
            );
            actual = `${overflow}px horizontal overflow`;
            result.status = overflow > 1 ? 'FAILED' : 'PASSED';
          }
          result.steps.push({
            id: `${result.id}-0`,
            action: check,
            status: result.status,
            expected:
              check === 'accessibility'
                ? 'No violations in selected axe rules'
                : 'At most 1px horizontal overflow',
            actual,
            durationMs: Date.now() - start,
          });
          const artifactId = randomUUID();
          const storageKey = `${artifactId}.png`;
          const bytes = await page.screenshot({ fullPage: true, timeout: 5000 });
          await writeFile(path.join(hooks.artifactDir, storageKey), bytes);
          files.push({
            id: artifactId,
            resultId: result.id,
            type: 'screenshot',
            storageKey,
            size: bytes.length,
          });
        } catch (error) {
          result.status = hooks.signal.reason?.message === 'Cancelled' ? 'SKIPPED' : 'BLOCKED';
          result.diagnostics.push({ type: 'audit', message: clean(String(error)) });
        } finally {
          await context?.close().catch(() => {});
          result.durationMs = Date.now() - start;
          await hooks.result(result, files);
          await hooks.event('test-finished', {
            testId: result.testId,
            viewport,
            status: result.status,
          });
        }
      }
    }
  }
}
