import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '@autoqa/database';
import fixture from '../fixtures/plan.json' with { type: 'json' };
import AxeBuilder from '@axe-core/playwright';

let email: string, password: string, userId: string;
test.beforeAll(async () => {
  email = `e2e-${randomUUID()}@example.test`;
  password = randomUUID() + 'Aa1!';
  const user = await db.user.create({
    data: { email, emailVerifiedAt: new Date(), passwordHash: await argon2.hash(password) },
  });
  userId = user.id;
});
test.afterAll(async () => {
  await db.$disconnect();
});
async function login(request: APIRequestContext) {
  const response = await request.post('/api/auth/login', {
    headers: { origin: process.env.APP_ORIGIN || 'http://localhost:3000' },
    data: { email, password },
  });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  return { origin: process.env.APP_ORIGIN || 'http://localhost:3000', 'x-csrf-token': data.csrf };
}
async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Testing, with a clear view.' })).toBeVisible();
}
async function awaitRun(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => (await (await request.get(`/api/runs/${id}`)).json()).status, {
      timeout: 90000,
      intervals: [1000],
    })
    .toMatch(/COMPLETED|FAILED|CANCELLED/);
  return (await request.get(`/api/runs/${id}`)).json();
}
test('review, approve, execute, and inspect real browser evidence', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await page.getByLabel('Project name').fill('E2E storefront');
  await page.getByRole('button', { name: 'Use Demo Shop', exact: true }).click();
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'Use demo suite' }).click();
  await expect(page.getByRole('button', { name: 'Run approved suite' })).toBeDisabled();
  await page.getByLabel('I reviewed the requirements, locators, and assumptions.').check();
  await page.getByRole('button', { name: 'Approve revision 1' }).click();
  await page.getByLabel('Run accessibility audits').check();
  await page.getByRole('button', { name: 'Run approved suite' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  const id = new URL(page.url()).pathname.split('/').pop()!;
  const run = await awaitRun(page.request, id);
  expect(run.status).toBe('COMPLETED');
  expect(run.summary.FAILED).toBe(0);
  expect(run.summary.BLOCKED).toBe(0);
  expect(run.summary.PASSED).toBe(12);
  expect(run.results.some((r: { artifacts: unknown[] }) => r.artifacts.length >= 2)).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Execution timeline' })).toBeVisible();
  await expect(page.locator('.evidence-image').first()).toBeVisible();
  const report = await page.request.get(`/api/runs/${id}/report?format=json`);
  expect(report.ok()).toBeTruthy();
  await page.screenshot({ path: 'test-results/report-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/report-mobile.png', fullPage: true });
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    accessibility.violations.map((v) => ({
      rule: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
});
test('seeded defect fails, a corrected revision passes, and history is immutable', async ({
  request,
}) => {
  const headers = await login(request);
  const targets = await (await request.get('/api/targets')).json();
  const project = await (
    await request.post('/api/projects', {
      headers,
      data: { name: 'E2E bug regression', baseUrl: targets[0].origin },
    })
  ).json();
  const broken = structuredClone(fixture);
  broken.tests[0].steps[0].path = '/products?bugs=cart';
  const suite = await (
    await request.post(`/api/projects/${project.id}/suites`, {
      headers,
      data: { plan: broken, paths: ['/products'] },
    })
  ).json();
  const config = {
    suiteId: suite.id,
    revision: 1,
    viewports: ['desktop'],
    accessibility: false,
    responsive: false,
  };
  expect(
    (
      await request.post('/api/runs', {
        headers: { ...headers, 'idempotency-key': randomUUID() },
        data: config,
      })
    ).status(),
  ).toBe(409);
  await request.post(`/api/suites/${suite.id}/approve`, {
    headers,
    data: { revision: 1, targetRevision: 1 },
  });
  const key = randomUUID();
  const first = await (
    await request.post('/api/runs', {
      headers: { ...headers, 'idempotency-key': key },
      data: config,
    })
  ).json();
  const duplicate = await (
    await request.post('/api/runs', {
      headers: { ...headers, 'idempotency-key': key },
      data: config,
    })
  ).json();
  expect(duplicate.id).toBe(first.id);
  const failed = await awaitRun(request, first.id);
  expect(failed.status).toBe('COMPLETED');
  expect(failed.summary.FAILED).toBe(1);
  expect(failed.results[0].steps.at(-1).actual).toBe('0');
  const fixed = structuredClone(fixture);
  fixed.title = 'Cart contract fixed';
  await request.patch(`/api/suites/${suite.id}`, { headers, data: { revision: 1, plan: fixed } });
  expect(
    (
      await request.post(`/api/suites/${suite.id}/approve`, {
        headers,
        data: { revision: 1, targetRevision: 1 },
      })
    ).status(),
  ).toBe(409);
  const old = await (await request.get(`/api/runs/${first.id}`)).json();
  expect(old.snapshot.plan.title).toBe('Cart contract');
  expect(old.snapshot.plan.tests[0].steps[0].path).toContain('bugs=cart');
  await request.post(`/api/suites/${suite.id}/approve`, {
    headers,
    data: { revision: 2, targetRevision: 1 },
  });
  const second = await (
    await request.post('/api/runs', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: { ...config, revision: 2 },
    })
  ).json();
  const passed = await awaitRun(request, second.id);
  expect(passed.summary.PASSED).toBe(1);
  expect(passed.previous.id).toBe(first.id);
});
test('ownership, CSRF, unsafe targets, and cancelled jobs are enforced', async ({
  request,
  playwright,
}) => {
  const headers = await login(request);
  const targets = await (await request.get('/api/targets')).json();
  expect(
    (
      await request.post('/api/projects', {
        headers: { origin: headers.origin },
        data: { name: 'CSRF', baseUrl: targets[0].origin },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/projects', {
        headers,
        data: { name: 'SSRF', baseUrl: 'http://169.254.169.254' },
      })
    ).status(),
  ).toBe(422);
  const project = await (
    await request.post('/api/projects', {
      headers,
      data: { name: 'E2E ownership', baseUrl: targets[0].origin },
    })
  ).json();
  const otherEmail = `other-${randomUUID()}@example.test`;
  await db.user.create({
    data: {
      email: otherEmail,
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password),
    },
  });
  const other = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
  });
  await other.post('/api/auth/login', {
    headers: { origin: headers.origin },
    data: { email: otherEmail, password },
  });
  expect((await other.get(`/api/projects/${project.id}`)).status()).toBe(404);
  const suite = await (
    await request.post(`/api/projects/${project.id}/suites`, {
      headers,
      data: { plan: fixture, paths: ['/products'] },
    })
  ).json();
  await request.post(`/api/suites/${suite.id}/approve`, {
    headers,
    data: { revision: 1, targetRevision: 1 },
  });
  const run = await (
    await request.post('/api/runs', {
      headers: { ...headers, 'idempotency-key': randomUUID() },
      data: {
        suiteId: suite.id,
        revision: 1,
        viewports: ['desktop'],
        accessibility: false,
        responsive: false,
      },
    })
  ).json();
  await request.post(`/api/runs/${run.id}/cancel`, { headers });
  expect((await awaitRun(request, run.id)).status).toBe('CANCELLED');
  expect((await other.get(`/api/runs/${run.id}`)).status()).toBe(404);
  expect((await other.get(`/api/runs/${run.id}/events`)).status()).toBe(404);
  expect((await other.get(`/api/runs/${run.id}/report?format=html`)).status()).toBe(404);
  const artifact = await db.artifact.create({
    data: {
      runId: run.id,
      type: 'screenshot',
      storageKey: `test-${randomUUID()}.png`,
      size: 1,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect((await other.get(`/api/artifacts/${artifact.id}`)).status()).toBe(404);
  await db.artifact.update({ where: { id: artifact.id }, data: { expiresAt: new Date(0) } });
  expect((await request.get(`/api/artifacts/${artifact.id}`)).status()).toBe(410);
  await other.dispose();
  await db.user.delete({ where: { email: otherEmail } });
  expect(userId).toBeTruthy();
});

test('interrupted runs retain evidence and cannot restart on duplicate delivery', async ({
  request,
}) => {
  const headers = await login(request);
  const targets = await (await request.get('/api/targets')).json();
  const project = await (
    await request.post('/api/projects', {
      headers,
      data: { name: 'E2E interrupted run', baseUrl: targets[0].origin },
    })
  ).json();
  const suite = await db.suite.create({
    data: { projectId: project.id, title: fixture.title, plan: fixture, paths: ['/products'] },
    include: { project: true },
  });
  const id = randomUUID();
  await db.run.create({
    data: {
      id,
      suiteId: suite.id,
      revision: suite.revision,
      snapshot: { plan: fixture, baseUrl: suite.project.baseUrl, paths: ['/products'] },
      config: {
        suiteId: suite.id,
        revision: suite.revision,
        viewports: ['desktop'],
        accessibility: false,
        responsive: false,
      },
      status: 'RUNNING',
      heartbeat: new Date(Date.now() - 120000),
      startedAt: new Date(Date.now() - 120000),
      idempotencyKey: randomUUID(),
      results: {
        create: {
          testId: 'partial',
          title: 'Preserved partial evidence',
          viewport: 'desktop',
          status: 'PASSED',
          durationMs: 1,
          steps: [{ action: 'navigate', actual: '/products' }],
          diagnostics: [],
        },
      },
    },
  });
  const run = await awaitRun(request, id);
  expect(run.status).toBe('FAILED');
  expect(run.error).toContain('not replayed');
  expect(run.results).toHaveLength(1);
  const { queue } = await import('../../packages/database/src/runtime.ts');
  await queue.add('run', { id }, { jobId: `recovery-test-${id}` });
  await expect
    .poll(async () => (await queue.getJob(`recovery-test-${id}`))?.getState())
    .toBe('completed');
  const unchanged = await (await request.get(`/api/runs/${id}`)).json();
  expect(unchanged.status).toBe('FAILED');
  expect(unchanged.results).toHaveLength(1);
  await queue.close();
});

test('missing model credentials fail generation explicitly after browser inspection', async ({
  request,
}) => {
  test.skip(
    Boolean(process.env.GROQ_API_KEY),
    'Live model evaluation is separate from acceptance tests',
  );
  const headers = await login(request);
  const targets = await (await request.get('/api/targets')).json();
  const project = await (
    await request.post('/api/projects', {
      headers,
      data: { name: 'E2E AI unavailable', baseUrl: targets[0].origin },
    })
  ).json();
  const generation = await (
    await request.post(`/api/projects/${project.id}/generations`, {
      headers,
      data: {
        instructions: 'Adding one shirt must increase the cart count to one.',
        paths: ['/products'],
      },
    })
  ).json();
  await expect
    .poll(
      async () => (await (await request.get(`/api/generations/${generation.id}`)).json()).status,
      { timeout: 30000 },
    )
    .toBe('FAILED');
  const failed = await (await request.get(`/api/generations/${generation.id}`)).json();
  expect(failed.error).toContain('503');
  expect(failed.observations[0].content).toContain('add-shirt');
  expect(failed.suiteId).toBeNull();
});
