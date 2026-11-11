import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';

import {
  normalizeOrigin,
  publicAddress,
  demoEnabled,
  demoOrigin,
  verifyPolicy,
} from '../packages/contracts/src/network.ts';
export { isPublicIPv4 } from '../packages/contracts/src/network.ts';

export async function destination(
  hostname: string,
  port: number,
  protocol: string,
  approved: string[],
) {
  const origin = new URL(`${protocol}//${hostname}:${port}`).origin;
  if (!approved.includes(origin)) throw new Error('Origin denied');
  if (origin === demoOrigin && demoEnabled())
    return { address: (await dns.lookup(hostname, { family: 4 })).address, port };
  if ((protocol === 'https:' && port !== 443) || (protocol === 'http:' && port !== 80))
    throw new Error('Port denied');
  normalizeOrigin(origin, false);
  return { address: await publicAddress(hostname), port };
}
function policy(req: http.IncomingMessage) {
  const auth = req.headers['proxy-authorization'];
  if (!auth?.startsWith('Basic ')) throw new Error('Proxy authentication required');
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const separator = decoded.indexOf(':');
  const value = verifyPolicy(decoded.slice(separator + 1));
  if (decoded.slice(0, separator) !== value.jobId) throw new Error('Invalid job credential');
  return value;
}
export function createProxy() {
  const server = http.createServer(async (req, res) => {
    if (!req.headers['proxy-authorization']) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="AutoQA"' });
      res.end();
      return;
    }
    try {
      const access = policy(req);
      const url = new URL(req.url || '');
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error('Invalid URL');
      const target = await destination(
        url.hostname,
        Number(url.port || 80),
        url.protocol,
        access.origins,
      );
      const headers: http.OutgoingHttpHeaders = { ...req.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const upstream = http.request(
        {
          hostname: target.address,
          port: target.port,
          method: req.method,
          path: url.pathname + url.search,
          headers,
          timeout: 20000,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      upstream.on('timeout', () => upstream.destroy());
      const deadline = setTimeout(
        () => upstream.destroy(),
        Math.min(60000, access.expires - Date.now()),
      );
      upstream.on('close', () => clearTimeout(deadline));
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    } catch {
      res.writeHead(403);
      res.end('Destination denied');
    }
  });
  server.on('connect', async (req, client, head) => {
    if (!req.headers['proxy-authorization']) {
      client.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="AutoQA"\r\n\r\n',
      );
      return;
    }
    try {
      const access = policy(req);
      const url = new URL(`https://${req.url}`);
      if (url.username || url.password) throw new Error('Invalid tunnel');
      const target = await destination(
        url.hostname,
        Number(url.port || 443),
        'https:',
        access.origins,
      );
      const upstream = net.connect({ host: target.address, port: target.port });
      const deadline = setTimeout(
        () => {
          upstream.destroy();
          client.destroy();
        },
        Math.min(360000, access.expires - Date.now()),
      );
      upstream.on('close', () => clearTimeout(deadline));
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on('connect', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.on('close', () => upstream.destroy());
    } catch {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    }
  });
  return server;
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/egress.ts')) {
  createProxy().listen(3128, '0.0.0.0', () => console.log('Restricted browser egress ready'));
}
