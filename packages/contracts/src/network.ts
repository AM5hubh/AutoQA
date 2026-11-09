import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import dns from 'node:dns/promises';
import https from 'node:https';
import { z } from 'zod';

export const demoOrigin = 'http://demo-site:4100';
export const demoEnabled = () => process.env.ENABLE_DEMO_TARGET === 'true';
export function normalizeOrigin(value: string, allowDemo = demoEnabled()) {
  const url = new URL(value.trim());
  if (
    allowDemo &&
    url.origin === demoOrigin &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  )
    return demoOrigin;
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    net.isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    url.hostname.endsWith('.') ||
    !/^[a-z0-9.-]+$/.test(url.hostname) ||
    url.hostname.split('.').some((s) => !s || s.startsWith('-') || s.endsWith('-'))
  )
    throw new Error(
      'Use a public HTTP(S) domain origin on its standard port, without a path or credentials',
    );
  if (
    ['localhost', 'local', 'internal', 'test', 'invalid'].some(
      (s) => url.hostname === s || url.hostname.endsWith(`.${s}`),
    )
  )
    throw new Error('Private or reserved domain denied');
  return url.origin;
}
const denied = new net.BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(address, prefix);
export const isPublicIPv4 = (address: string) =>
  Boolean(net.isIPv4(address) && !denied.check(address));
export async function publicAddress(hostname: string) {
  const addresses = await dns.lookup(hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some((a) => !isPublicIPv4(a.address)))
    throw new Error('Private or reserved destination denied');
  return addresses[0].address;
}
export async function validateOrigins(baseUrl: string, additionalOrigins: string[]) {
  const origin = normalizeOrigin(baseUrl);
  const extras = [...new Set(additionalOrigins.map((v) => normalizeOrigin(v, false)))].filter(
    (v) => v !== origin,
  );
  if (extras.length > 10) throw new Error('Use at most ten additional origins');
  await Promise.all(
    [origin, ...extras]
      .filter((v) => v !== demoOrigin)
      .map((v) => publicAddress(new URL(v).hostname)),
  );
  return { baseUrl: origin, additionalOrigins: extras };
}
export type Website = {
  baseUrl: string;
  verificationToken: string | null;
  verificationMethod: string | null;
  verifiedAt: Date | null;
};
export function requireVerifiedWebsite(project: Website) {
  normalizeOrigin(project.baseUrl);
  if (project.baseUrl === demoOrigin && demoEnabled()) return;
  if (
    !project.verifiedAt ||
    !project.verificationToken ||
    !['dns', 'file'].includes(project.verificationMethod || '')
  )
    throw new Error('Verify website ownership before generating or running tests');
}
export async function verifyWebsite(
  project: Pick<Website, 'baseUrl' | 'verificationToken'>,
  method: string,
) {
  const origin = normalizeOrigin(project.baseUrl);
  if (origin === demoOrigin && demoEnabled()) return;
  if (!project.verificationToken)
    throw new Error('Generate a new verification challenge in project settings');
  const hostname = new URL(origin).hostname;
  const address = await publicAddress(hostname);
  const expected = `autoqa-verification=${project.verificationToken}`;
  if (method === 'dns') {
    const resolver = new dns.Resolver({ timeout: 5000, tries: 1 });
    const records = await resolver.resolveTxt(`_autoqa-challenge.${hostname}`);
    if (!records.some((r) => r.join('') === expected))
      throw new Error('Verification TXT record does not match');
  } else if (method === 'file') {
    const body = await new Promise<string>((resolve, reject) => {
      const request = https.get(
        `https://${hostname}/.well-known/autoqa-verification.txt`,
        {
          family: 4,
          lookup: (_host, _options, cb) => cb(null, address, 4),
          headers: { Accept: 'text/plain' },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error('Verification file must return HTTP 200 without redirects'));
            return;
          }
          let bytes = 0;
          const parts: Buffer[] = [];
          response.on('data', (part: Buffer) => {
            bytes += part.length;
            if (bytes > 4096) request.destroy(new Error('Verification file is too large'));
            else parts.push(part);
          });
          response.on('end', () => resolve(Buffer.concat(parts).toString('utf8').trim()));
          response.on('error', reject);
        },
      );
      const timer = setTimeout(
        () => request.destroy(new Error('Verification request timed out')),
        5000,
      );
      request.on('close', () => clearTimeout(timer));
      request.on('error', reject);
    });
    if (body !== expected) throw new Error('Verification file does not match');
  } else throw new Error('Choose DNS TXT or HTTPS file verification');
}
const policySchema = z
  .object({
    jobId: z.string().min(1).max(100),
    origins: z.array(z.string()).min(1).max(11),
    expires: z.number().int(),
  })
  .strict();
export type NetworkPolicy = z.infer<typeof policySchema>;
function signingKey() {
  const key = process.env.PROXY_SIGNING_SECRET;
  if (!key || key.length < 32)
    throw new Error('PROXY_SIGNING_SECRET must contain at least 32 characters');
  return key;
}
export function signPolicy(jobId: string, origins: string[]) {
  const body = Buffer.from(
    JSON.stringify(
      policySchema.parse({
        jobId,
        origins: origins.map((v) => normalizeOrigin(v)),
        expires: Date.now() + 600000,
      }),
    ),
  ).toString('base64url');
  return `${body}.${createHmac('sha256', signingKey()).update(body).digest('base64url')}`;
}
export function verifyPolicy(token: string): NetworkPolicy {
  if (token.length > 10000) throw new Error('Invalid proxy credential');
  const [body, signature, ...extra] = token.split('.');
  if (!body || !signature || extra.length) throw new Error('Invalid proxy credential');
  const expected = createHmac('sha256', signingKey()).update(body).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error('Invalid proxy credential');
  const policy = policySchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString()));
  if (policy.expires <= Date.now() || policy.expires > Date.now() + 601000)
    throw new Error('Expired proxy credential');
  policy.origins.forEach((v) => {
    if (normalizeOrigin(v) !== v) throw new Error('Invalid origin');
  });
  return policy;
}
export function requestAllowed(
  url: string,
  origin: string,
  additionalOrigins: string[],
  navigation: boolean,
) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    return false;
  return parsed.origin === origin || (!navigation && additionalOrigins.includes(parsed.origin));
}
