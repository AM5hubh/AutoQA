import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import {
  normalizeOrigin,
  requestAllowed,
  signPolicy,
  verifyPolicy,
  validateOrigins,
  verifyWebsite,
  requireVerifiedWebsite,
} from '../../packages/contracts/src/network.ts';

beforeEach(() => {
  vi.stubEnv('PROXY_SIGNING_SECRET', 'x'.repeat(32));
  vi.stubEnv('ENABLE_DEMO_TARGET', 'false');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
test.each([
  'http://127.0.0.1',
  'http://2130706433',
  'http://[::1]',
  'https://user:pass@example.com',
  'https://example.com:8443',
  'https://example.com/path',
  'https://example.com?x=1',
  'https://example.com#x',
  'http://a.local',
  'https://*.example.com',
  'http://demo-site:4100',
])('rejects unsafe website origin %s', (value) => expect(() => normalizeOrigin(value)).toThrow());
test('normalizes hostname, standard port and trailing slash without changing scope', () =>
  expect(normalizeOrigin('https://EXAMPLE.com:443/')).toBe('https://example.com'));
test('demo exception requires explicit configuration', () => {
  vi.stubEnv('ENABLE_DEMO_TARGET', 'true');
  expect(normalizeOrigin('http://demo-site:4100')).toBe('http://demo-site:4100');
  expect(() => normalizeOrigin('http://demo-site:4101')).toThrow();
});
test('rejects mixed public/private DNS answers and checks additional origins', async () => {
  const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ] as never);
  await expect(validateOrigins('https://example.com', [])).rejects.toThrow('Private');
  lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  const value = await validateOrigins('https://example.com', [
    'https://cdn.example.com',
    'https://cdn.example.com',
  ]);
  expect(value.additionalOrigins).toEqual(['https://cdn.example.com']);
  expect(lookup).toHaveBeenCalledWith('cdn.example.com', { all: true, family: 4 });
});
test('signed policies reject tampering, expiry and oversized origin lists', () => {
  const token = signPolicy('job1', ['https://example.com']);
  expect(verifyPolicy(token).jobId).toBe('job1');
  expect(() => verifyPolicy('x' + token)).toThrow();
  expect(() => verifyPolicy(token + '.extra')).toThrow();
  expect(() => signPolicy('job1', Array(12).fill('https://example.com'))).toThrow();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601000);
  expect(() => verifyPolicy(token)).toThrow('Expired');
});
test('declared origins allow resources but never off-site navigation', () => {
  expect(
    requestAllowed(
      'https://cdn.example.com/x.js',
      'https://example.com',
      ['https://cdn.example.com'],
      false,
    ),
  ).toBe(true);
  expect(
    requestAllowed(
      'https://cdn.example.com/x',
      'https://example.com',
      ['https://cdn.example.com'],
      true,
    ),
  ).toBe(false);
  expect(
    requestAllowed(
      'https://other.example.com/x',
      'https://example.com',
      ['https://cdn.example.com'],
      false,
    ),
  ).toBe(false);
  expect(requestAllowed('https://a:b@example.com', 'https://example.com', [], false)).toBe(false);
});
test('DNS verification binds proof to exact hostname and challenge', async () => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  const txt = vi
    .spyOn(dns.Resolver.prototype, 'resolveTxt')
    .mockResolvedValue([['autoqa-verification=', 'challenge']]);
  const project = { baseUrl: 'https://example.com', verificationToken: 'challenge' };
  await verifyWebsite(project, 'dns');
  expect(txt).toHaveBeenCalledWith('_autoqa-challenge.example.com');
  txt.mockResolvedValue([['wrong']]);
  await expect(verifyWebsite(project, 'dns')).rejects.toThrow('does not match');
});
test.each([200, 302])('HTTPS proof pins DNS and accepts only HTTP 200 (%s)', async (status) => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as never);
  const get = vi.spyOn(https, 'get').mockImplementation((...args: Parameters<typeof https.get>) => {
    const callback = args.at(-1) as (response: IncomingMessage) => void;
    const request = new EventEmitter() as ClientRequest;
    const response = new EventEmitter() as IncomingMessage;
    response.statusCode = status;
    response.resume = () => response;
    queueMicrotask(() => {
      callback(response);
      response.emit('data', Buffer.from('autoqa-verification=challenge'));
      response.emit('end');
      request.emit('close');
    });
    return request;
  });
  const result = verifyWebsite(
    { baseUrl: 'https://example.com', verificationToken: 'challenge' },
    'file',
  );
  if (status === 200) await expect(result).resolves.toBeUndefined();
  else await expect(result).rejects.toThrow('without redirects');
  expect(get.mock.calls[0][0]).toBe('https://example.com/.well-known/autoqa-verification.txt');
  const options = get.mock.calls[0][1] as https.RequestOptions;
  const callback = vi.fn();
  options.lookup!('example.com', {}, callback);
  expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
});
test('unverified projects cannot be admitted even with a valid public URL', () =>
  expect(() =>
    requireVerifiedWebsite({
      baseUrl: 'https://example.com',
      verificationToken: 'a',
      verificationMethod: null,
      verifiedAt: null,
    }),
  ).toThrow('Verify website'));
