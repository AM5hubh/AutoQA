import { Router, type Request, type Response, type NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import * as oauth from 'oauth4webapi';
import { z } from 'zod';
import { db } from '@autoqa/database';
import { appOrigin } from '../../../packages/database/src/runtime.ts';
import { HttpError } from './http-error.ts';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrf?: string;
    version?: number;
    oauth?: {
      provider: string;
      state: string;
      verifier: string;
      nonce: string;
      expires: number;
      linkUserId?: string;
    };
  }
}
const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128);
const tokenInput = z.string().regex(/^[a-f0-9]{64}$/);
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const generic = { message: 'If this address is eligible, an email will arrive shortly.' };
const publicUser = {
  id: true,
  email: true,
  emailVerifiedAt: true,
  identities: { select: { provider: true } },
} as const;
const limiter = (limit: number, byEmail = false) =>
  rateLimit({
    windowMs: 15 * 60000,
    limit,
    standardHeaders: byEmail ? false : 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait 15 minutes before trying again.' },
    ...(byEmail
      ? {
          keyGenerator: (req: Request) =>
            tokenHash(
              typeof req.body?.email === 'string'
                ? req.body.email.trim().toLowerCase().slice(0, 254)
                : 'invalid',
            ),
        }
      : {}),
  });

export async function requireAccount(req: Request, res: Response, next: NextFunction) {
  const user = req.session.userId
    ? await db.user.findUnique({ where: { id: req.session.userId } })
    : null;
  if (!user || req.session.version !== user.sessionVersion)
    return res.status(401).json({ error: 'Sign in to continue' });
  if (!user.emailVerifiedAt)
    return res.status(403).json({ error: 'Verify your email before continuing' });
  next();
}
async function signIn(req: Request, user: { id: string; sessionVersion: number }) {
  await new Promise<void>((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
  req.session.userId = user.id;
  req.session.version = user.sessionVersion;
  req.session.csrf = randomBytes(24).toString('hex');
  await new Promise<void>((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
}
export async function sendAuthEmail(userId: string, kind: 'verify' | 'reset') {
  const token = randomBytes(32).toString('hex');
  const record = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const recent = await tx.authToken.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - 15 * 60000) } },
    });
    if (recent >= 3) return null;
    await tx.authToken.updateMany({
      where: { userId, kind, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    const entry = await tx.authToken.create({
      data: {
        userId,
        kind,
        hash: tokenHash(token),
        expiresAt: new Date(Date.now() + (kind === 'verify' ? 86400000 : 1800000)),
      },
    });
    return { entry, email: user.email };
  });
  if (!record) return;
  const link = `${appOrigin}/${kind === 'verify' ? 'verify-email' : 'reset-password'}#token=${token}`;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: process.env.NODE_ENV === 'production',
    ...(process.env.SMTP_USER
      ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } }
      : {}),
    connectionTimeout: 10000,
    socketTimeout: 10000,
  });
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new Error('SMTP unavailable');
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to: record.email,
      subject: kind === 'verify' ? 'Verify your AutoQA email' : 'Reset your AutoQA password',
      text: `${kind === 'verify' ? 'Verify your email' : 'Reset your password'}: ${link}\n\nThis link expires in ${kind === 'verify' ? '24 hours' : '30 minutes'}. If you did not request this, ignore this email.`,
    });
  } catch {
    await db.authToken.update({ where: { id: record.entry.id }, data: { consumedAt: new Date() } });
    throw new HttpError(503, 'Email delivery is unavailable. Please try again later.');
  } finally {
    transport.close();
  }
}
export async function consumeAuthToken(
  token: string,
  kind: 'verify' | 'reset',
  newPassword?: string,
) {
  const hash = tokenHash(tokenInput.parse(token));
  const passwordHash =
    kind === 'reset'
      ? await argon2.hash(password.parse(newPassword), { type: argon2.argon2id })
      : undefined;
  return db.$transaction(async (tx) => {
    const entry = await tx.authToken.findUnique({ where: { hash } });
    if (!entry || entry.kind !== kind)
      throw new HttpError(422, 'This link is invalid or expired. Request a new one.');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${entry.userId}))`;
    const used = await tx.authToken.updateMany({
      where: { id: entry.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (!used.count)
      throw new HttpError(422, 'This link is invalid or expired. Request a new one.');
    await tx.authToken.updateMany({
      where: { userId: entry.userId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return tx.user.update({
      where: { id: entry.userId },
      data: {
        emailVerifiedAt: new Date(),
        ...(passwordHash ? { passwordHash, sessionVersion: { increment: 1 } } : {}),
      },
    });
  });
}

const providerName = z.enum(['google', 'github']);
export function providerConfig(name: string) {
  const provider = providerName.parse(name);
  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
  const secret = process.env[`${provider.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !secret) throw new HttpError(503, `${provider} sign-in is not configured`);
  return {
    provider,
    secret,
    client: { client_id: clientId } as oauth.Client,
    server:
      provider === 'google'
        ? {
            issuer: 'https://accounts.google.com',
            authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            token_endpoint: 'https://oauth2.googleapis.com/token',
            jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
          }
        : {
            issuer: 'https://github.com',
            authorization_endpoint: 'https://github.com/login/oauth/authorize',
            token_endpoint: 'https://github.com/login/oauth/access_token',
          },
    redirect: `${appOrigin}/api/auth/${provider}/callback`,
  };
}
export async function resolveIdentity(
  provider: string,
  subject: string,
  address: string,
  linkUserId?: string,
) {
  const normalized = email.parse(address);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))`;
    const identity = await tx.identity.findUnique({
      where: { provider_subject: { provider, subject } },
      include: { user: true },
    });
    if (identity) {
      if (linkUserId && identity.userId !== linkUserId)
        throw new HttpError(409, 'This provider account is already connected');
      return identity.user;
    }
    if (linkUserId) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: linkUserId } });
      if (!user.emailVerifiedAt || user.email !== normalized)
        throw new HttpError(409, 'Use a provider account with the same verified email');
      if (
        await tx.identity.findUnique({ where: { userId_provider: { userId: user.id, provider } } })
      )
        throw new HttpError(409, 'This provider is already connected');
      await tx.identity.create({ data: { userId: user.id, provider, subject } });
      return user;
    }
    if (await tx.user.findUnique({ where: { email: normalized } }))
      throw new HttpError(
        409,
        'An account already uses this email. Sign in, then connect this provider in Account settings.',
      );
    return tx.user.create({
      data: {
        email: normalized,
        emailVerifiedAt: new Date(),
        identities: { create: { provider, subject } },
      },
    });
  });
}
export function authRouter() {
  const router = Router();
  router.get('/providers', (_req, res) =>
    res.json(
      Object.fromEntries(
        ['google', 'github'].map((p) => [
          p,
          Boolean(
            process.env[`${p.toUpperCase()}_CLIENT_ID`] &&
              process.env[`${p.toUpperCase()}_CLIENT_SECRET`],
          ),
        ]),
      ),
    ),
  );
  router.post('/signup', limiter(5), limiter(5, true), async (req, res) => {
    const input = z.object({ email, password }).strict().parse(req.body);
    const hash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.email}))`;
      if (await tx.user.findUnique({ where: { email: input.email } })) return null;
      return tx.user.create({ data: { email: input.email, passwordHash: hash } });
    });
    if (user) await sendAuthEmail(user.id, 'verify');
    res.status(202).json(generic);
  });
  router.post('/login', limiter(10), limiter(10, true), async (req, res) => {
    const input = z
      .object({ email, password: z.string().min(1).max(128) })
      .strict()
      .parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, input.password)))
      throw new HttpError(401, 'Email or password is incorrect');
    if (!user.emailVerifiedAt)
      throw new HttpError(
        403,
        'Verify your email first. Use Resend verification to get a new link.',
      );
    await signIn(req, user);
    res.json({
      user: await db.user.findUnique({ where: { id: user.id }, select: publicUser }),
      csrf: req.session.csrf,
    });
  });
  for (const [route, kind] of [
    ['resend-verification', 'verify'],
    ['forgot-password', 'reset'],
  ] as const) {
    router.post(`/${route}`, limiter(10), limiter(3, true), async (req, res) => {
      const input = z.object({ email }).strict().parse(req.body);
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (user && (kind === 'reset' || !user.emailVerifiedAt)) await sendAuthEmail(user.id, kind);
      res.status(202).json(generic);
    });
  }
  router.post('/verify-email', limiter(10), async (req, res) => {
    const input = z.object({ token: tokenInput }).strict().parse(req.body);
    await consumeAuthToken(input.token, 'verify');
    res.json({ message: 'Email verified. You can now sign in.' });
  });
  router.post('/reset-password', limiter(10), async (req, res) => {
    const input = z.object({ token: tokenInput, password }).strict().parse(req.body);
    await consumeAuthToken(input.token, 'reset', input.password);
    req.session.destroy(() => {});
    res
      .clearCookie('autoqa.sid')
      .json({ message: 'Password updated. Sign in with your new password.' });
  });
  async function start(req: Request, link = false) {
    const config = providerConfig(String(req.params.provider));
    const state = oauth.generateRandomState(),
      verifier = oauth.generateRandomCodeVerifier(),
      nonce = oauth.generateRandomNonce();
    req.session.oauth = {
      provider: config.provider,
      state,
      verifier,
      nonce,
      expires: Date.now() + 600000,
      ...(link ? { linkUserId: req.session.userId } : {}),
    };
    const url = new URL(config.server.authorization_endpoint!);
    url.search = new URLSearchParams({
      client_id: config.client.client_id,
      redirect_uri: config.redirect,
      response_type: 'code',
      state,
      code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      scope: config.provider === 'google' ? 'openid email profile' : 'read:user user:email',
      ...(config.provider === 'google' ? { nonce } : {}),
    }).toString();
    await new Promise<void>((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    return url.href;
  }
  router.get('/:provider/start', limiter(20), async (req, res) => res.redirect(await start(req)));
  router.post('/:provider/connect', requireAccount, async (req, res) =>
    res.json({ url: await start(req, true) }),
  );
  router.get('/:provider/callback', limiter(20), async (req, res) => {
    try {
      const config = providerConfig(String(req.params.provider));
      const flow = req.session.oauth;
      delete req.session.oauth;
      await new Promise<void>((resolve, reject) =>
        req.session.save((e) => (e ? reject(e) : resolve())),
      );
      if (!flow || flow.provider !== config.provider || flow.expires < Date.now())
        throw new HttpError(400, 'Sign-in expired. Please try again.');
      if (flow.linkUserId) {
        const account = await db.user.findUnique({ where: { id: flow.linkUserId } });
        if (
          !account?.emailVerifiedAt ||
          req.session.userId !== account.id ||
          req.session.version !== account.sessionVersion
        )
          throw new HttpError(401, 'Sign in again before connecting an account');
      }
      const parameters = oauth.validateAuthResponse(
        config.server,
        config.client,
        new URL(req.originalUrl, appOrigin),
        flow.state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        config.server,
        config.client,
        oauth.ClientSecretPost(config.secret),
        parameters,
        config.redirect,
        flow.verifier,
        { signal: AbortSignal.timeout(10000) },
      );
      const tokens = await oauth.processAuthorizationCodeResponse(
        config.server,
        config.client,
        response,
        config.provider === 'google' ? { expectedNonce: flow.nonce, requireIdToken: true } : {},
      );
      let address: string, subject: string;
      if (config.provider === 'google') {
        await oauth.validateApplicationLevelSignature(config.server, response, {
          signal: AbortSignal.timeout(10000),
        });
        const claims = oauth.getValidatedIdTokenClaims(tokens)!;
        if (claims.email_verified !== true || typeof claims.email !== 'string')
          throw new HttpError(422, 'A verified provider email is required');
        address = claims.email;
        subject = claims.sub;
      } else {
        const options = {
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(10000),
        };
        const [profileResponse, emailResponse] = await Promise.all([
          fetch('https://api.github.com/user', options),
          fetch('https://api.github.com/user/emails', options),
        ]);
        if (!profileResponse.ok || !emailResponse.ok) throw new Error('Provider unavailable');
        const profile = z
          .object({ id: z.number().int().positive() })
          .parse(await profileResponse.json());
        const emails = z
          .array(z.object({ email, primary: z.boolean(), verified: z.boolean() }))
          .parse(await emailResponse.json());
        const primary = emails.find((e) => e.primary && e.verified);
        if (!primary) throw new HttpError(422, 'A verified primary GitHub email is required');
        address = primary.email;
        subject = String(profile.id);
      }
      const user = await resolveIdentity(config.provider, subject, address, flow.linkUserId);
      await signIn(req, user);
      res.redirect(flow.linkUserId ? '/account' : '/');
    } catch (error) {
      const message =
        error instanceof HttpError
          ? error.message
          : 'Provider sign-in failed or was cancelled. Please try again.';
      res.redirect(`/login?error=${encodeURIComponent(message)}`);
    }
  });
  router.get('/me', requireAccount, async (req, res) =>
    res.json({
      user: await db.user.findUnique({ where: { id: req.session.userId! }, select: publicUser }),
      csrf: req.session.csrf,
    }),
  );
  router.post('/logout', (req, res, next) =>
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('autoqa.sid').status(204).end();
    }),
  );
  return router;
}
