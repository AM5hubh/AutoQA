import { signPolicy } from '../packages/contracts/src/network.ts';
import assert from 'node:assert/strict';
import { connectBrowser, safeContext } from '../workers/browser-worker/src/executor.ts';
const browser = await connectBrowser();
try {
  const direct = await browser.newContext();
  const page = await direct.newPage();
  for (const url of ['http://1.1.1.1', 'http://postgres:5432', 'http://169.254.169.254']) {
    let blocked = false;
    try {
      await page.goto(url, { timeout: 4000 });
    } catch {
      blocked = true;
    }
    assert(blocked, `Browser reached forbidden direct destination ${url}`);
  }
  await direct.close();
  const proxied = await browser.newContext({
    proxy: {
      server: 'http://egress:3128',
      bypass: '<-loopback>',
      username: 'network-check',
      password: signPolicy('network-check', ['http://demo-site:4100']),
    },
  });
  const proxyPage = await proxied.newPage();
  const denied = await proxyPage.goto('http://169.254.169.254', { timeout: 5000 });
  assert.equal(denied?.status(), 403);
  const allowed = await proxyPage.goto('http://demo-site:4100/products', { timeout: 5000 });
  assert.equal(allowed?.status(), 200);
  await proxied.close();
  const context = await safeContext(
    browser,
    'http://demo-site:4100',
    'desktop',
    new AbortController().signal,
  );
  const guarded = await context.newPage();
  await assert.rejects(guarded.goto('http://example.com', { timeout: 5000 }));
  await context.close();
  console.log(
    'PASS: direct browser egress, private service access, metadata access, proxy allowlist, and request origin guard',
  );
} finally {
  await browser.close();
}
