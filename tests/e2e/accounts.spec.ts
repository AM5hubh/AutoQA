import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import argon2 from 'argon2';
import { db } from '@autoqa/database';
import fixture from '../fixtures/plan.json' with { type: 'json' };

const origin = process.env.APP_ORIGIN || 'http://localhost:3000';
async function emailLink(request: APIRequestContext, email: string, subject: string) {
  let id = '';
  await expect
    .poll(
      async () => {
        const mailbox = await (await request.get('http://localhost:8025/api/v1/messages')).json();
        id =
          mailbox.messages.find(
            (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
              m.Subject === subject && m.To.some((t) => t.Address === email),
          )?.ID || '';
        return id;
      },
      { timeout: 15000 },
    )
    .not.toBe('');
  const message = await (await request.get(`http://localhost:8025/api/v1/message/${id}`)).json();
  return (message.Text as string).match(/https?:\/\/\S+#token=[a-f0-9]+/)![0];
}
test.afterAll(async () => {
  await db.$disconnect();
});
test('public signup, verification, password recovery and session invalidation', async ({
  page,
  request,
  playwright,
}) => {
  const email = `signup-${randomUUID()}@example.test`,
    password = randomUUID() + 'Aa1!';
  await page.goto('/signup');
  const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(
    audit.violations.map((v) => ({ rule: v.id, nodes: v.nodes.map((n) => n.failureSummary) })),
  ).toEqual([]);
  await page.screenshot({ path: 'test-results/signup-desktop.png', fullPage: true });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('email');
  expect(
    (
      await request.post('/api/auth/login', { headers: { origin }, data: { email, password } })
    ).status(),
  ).toBe(403);
  const verify = await emailLink(request, email, 'Verify your AutoQA email');
  await page.goto(verify);
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Email verified');
  const token = new URLSearchParams(new URL(verify).hash.slice(1)).get('token');
  expect(
    (
      await request.post('/api/auth/verify-email', { headers: { origin }, data: { token } })
    ).status(),
  ).toBe(422);
  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Testing, with a clear view.' })).toBeVisible();
  const old = await playwright.request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('email');
  const reset = await emailLink(request, email, 'Reset your AutoQA password');
  await page.goto(reset);
  const updated = randomUUID() + 'Bb2!';
  await page.getByLabel('New password', { exact: true }).fill(updated);
  await page.getByLabel('Confirm password').fill(updated);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('status')).toContainText('Password updated');
  expect((await old.get('/api/auth/me')).status()).toBe(401);
  await old.dispose();
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { origin },
        data: { email, password: updated },
      })
    ).status(),
  ).toBe(200);
  const stored = await db.user.findUniqueOrThrow({ where: { email } });
  expect(await argon2.verify(stored.passwordHash!, password)).toBe(false);
});

test('expired tokens and concurrent verification fail closed', async ({ request }) => {
  const user = await db.user.create({ data: { email: `tokens-${randomUUID()}@example.test` } });
  async function issue(expiresAt: Date, kind = 'verify') {
    const token = randomBytes(32).toString('hex');
    await db.authToken.create({
      data: {
        userId: user.id,
        kind,
        hash: createHash('sha256').update(token).digest('hex'),
        expiresAt,
      },
    });
    return token;
  }
  const expired = await issue(new Date(0));
  expect(
    (
      await request.post('/api/auth/verify-email', {
        headers: { origin },
        data: { token: expired },
      })
    ).status(),
  ).toBe(422);
  const token = await issue(new Date(Date.now() + 60000));
  const results = await Promise.all(
    [1, 2].map(() =>
      request.post('/api/auth/verify-email', { headers: { origin }, data: { token } }),
    ),
  );
  expect(results.map((r) => r.status()).sort()).toEqual([200, 422]);
  const reset = await issue(new Date(Date.now() + 60000), 'reset');
  expect(
    (
      await request.post('/api/auth/verify-email', { headers: { origin }, data: { token: reset } })
    ).status(),
  ).toBe(422);
});

test('user website edits invalidate approval and preserve historical snapshots', async ({
  request,
  page,
}) => {
  const email = `targets-${randomUUID()}@example.test`,
    password = randomUUID();
  await db.user.create({
    data: { email, passwordHash: await argon2.hash(password), emailVerifiedAt: new Date() },
  });
  const login = await (
    await request.post('/api/auth/login', { headers: { origin }, data: { email, password } })
  ).json();
  const headers = { origin, 'x-csrf-token': login.csrf };
  const project = await (
    await request.post('/api/projects', {
      headers,
      data: { name: 'User target', baseUrl: 'http://demo-site:4100' },
    })
  ).json();
  const suite = await (
    await request.post(`/api/projects/${project.id}/suites`, {
      headers,
      data: { plan: fixture, paths: ['/products'] },
    })
  ).json();
  expect(
    (
      await request.post(`/api/suites/${suite.id}/approve`, {
        headers,
        data: { revision: 1, targetRevision: 1 },
      })
    ).status(),
  ).toBe(200);
  const run = await db.run.create({
    data: {
      suiteId: suite.id,
      revision: 1,
      snapshot: { baseUrl: project.baseUrl, plan: fixture, targetRevision: 1 },
      config: {},
      status: 'COMPLETED',
      idempotencyKey: randomUUID(),
      finishedAt: new Date(),
    },
  });
  const active = await db.run.create({
    data: {
      suiteId: suite.id,
      revision: 1,
      snapshot: {},
      config: {},
      status: 'PREPARING',
      heartbeat: new Date(),
      idempotencyKey: randomUUID(),
    },
  });
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        headers,
        data: { name: 'Blocked edit', baseUrl: 'https://example.com', targetRevision: 1 },
      })
    ).status(),
  ).toBe(409);
  await db.run.update({
    where: { id: active.id },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
  const edited = await request.patch(`/api/projects/${project.id}`, {
    headers,
    data: {
      name: 'My website',
      baseUrl: 'https://example.com',
      additionalOrigins: ['https://www.example.com'],
      targetRevision: 1,
    },
  });
  expect(edited.status()).toBe(200);
  const current = await edited.json();
  await page.context().addCookies((await request.storageState()).cookies);
  await page.goto(`/projects/${project.id}`);
  await expect(
    page.getByRole('button', { name: 'Generate test plan', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText('Verify website ownership', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/website-mobile.png', fullPage: true });
  expect(current.verifiedAt).toBeNull();
  expect(current.targetRevision).toBe(2);
  expect(current.verificationToken).not.toBe(project.verificationToken);
  const updatedSuite = await (await request.get(`/api/suites/${suite.id}`)).json();
  expect(updatedSuite.approvedRevision).toBeNull();
  expect(
    (
      await request.post(`/api/projects/${project.id}/generations`, {
        headers,
        data: { instructions: 'Check the website headline', paths: ['/'] },
      })
    ).status(),
  ).toBe(409);
  const history = await (await request.get(`/api/runs/${run.id}`)).json();
  expect(history.snapshot.baseUrl).toBe('http://demo-site:4100');
  expect(
    (
      await request.patch(`/api/projects/${project.id}`, {
        headers,
        data: { name: 'Stale edit', baseUrl: 'https://example.com', targetRevision: 1 },
      })
    ).status(),
  ).toBe(409);
});
