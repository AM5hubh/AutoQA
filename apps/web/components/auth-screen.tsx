'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FlaskConical, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { api, setCsrf } from '../lib/api';

const titles: Record<string, string> = {
  login: 'Welcome back.',
  signup: 'Create your account.',
  'verify-email': 'Verify your email.',
  'resend-verification': 'Get a new verification link.',
  'forgot-password': 'Reset your password.',
  'reset-password': 'Choose a new password.',
};
export const authPaths = Object.keys(titles).map((p) => `/${p}`);
export function AuthScreen({ onLogin }: { onLogin: (user: { email: string }) => void }) {
  const path = usePathname().slice(1);
  const mode = titles[path] ? path : 'login';
  const router = useRouter();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [token, setToken] = useState('');
  const [providers, setProviders] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setError(new URLSearchParams(window.location.search).get('error') || '');
    setMessage('');
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
    void api<Record<string, boolean>>('/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({}));
  }, [mode]);
  const needsPassword = ['login', 'signup', 'reset-password'].includes(mode);
  const needsEmail = !['verify-email', 'reset-password'].includes(mode);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    const form = new FormData(e.currentTarget);
    if (mode !== 'login' && needsPassword && form.get('password') !== form.get('confirm')) {
      setError('Passwords do not match');
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ message?: string; user?: { email: string }; csrf?: string }>(
        `/auth/${mode}`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...(needsEmail ? { email: form.get('email') } : { token }),
            ...(needsPassword ? { password: form.get('password') } : {}),
          }),
        },
      );
      if (result.user && result.csrf) {
        setCsrf(result.csrf);
        onLogin(result.user);
        router.push('/');
      } else {
        setMessage(result.message || 'Check your email for the next step.');
        if (['verify-email', 'reset-password'].includes(mode)) {
          window.history.replaceState(null, '', window.location.pathname);
          setToken('');
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="login-story">
        <Link href="/login" className="brand">
          <span className="brand-mark">
            <FlaskConical size={21} />
          </span>
          autoqa<span className="brand-ai">AGENT</span>
        </Link>
        <div>
          <p className="eyebrow">A LITTLE LESS GUESSWORK.</p>
          <h1>
            From “does it work?”
            <br />
            to <span>here’s the evidence.</span>
          </h1>
          <p className="login-description">
            Your website. Your expectations. Browser tests you can review, run, and trust.
          </p>
          <div className="login-flow">
            Describe <ArrowRight size={16} /> Review <ArrowRight size={16} /> Verify
          </div>
        </div>
        <p className="muted">AI-assisted planning. Deterministic browser results.</p>
      </section>
      <section className="login-form">
        <div>
          <p className="eyebrow">YOUR TESTING WORKSPACE</p>
          <h2>{titles[mode]}</h2>
          <p className="muted">
            {mode === 'signup'
              ? 'Sign up, verify your email, and add your website.'
              : mode === 'login'
                ? 'Sign in to your personal workspace.'
                : 'Use the secure link sent to your email address.'}
          </p>
          <form onSubmit={submit}>
            {needsEmail && (
              <label>
                Email address
                <input name="email" type="email" autoComplete="email" required maxLength={254} />
              </label>
            )}
            {needsPassword && (
              <label>
                {mode === 'reset-password' ? 'New password' : 'Password'}
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={mode === 'login' ? 1 : 12}
                  maxLength={128}
                />
              </label>
            )}
            {needsPassword && mode !== 'login' && (
              <>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                  />
                </label>
                <p className="small muted">Use at least 12 characters.</p>
              </>
            )}
            {!needsEmail && !token && !message && (
              <p role="alert">Open the link from your email, or request a new one below.</p>
            )}
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="success-text" role="status">
                {message}
              </p>
            )}
            <Button disabled={busy || (!needsEmail && !token)} type="submit">
              {busy && <Loader2 size={16} className="spin" />}
              {
                (
                  {
                    login: 'Sign in',
                    signup: 'Create account',
                    'verify-email': 'Verify email',
                    'resend-verification': 'Send verification email',
                    'forgot-password': 'Send reset link',
                    'reset-password': 'Update password',
                  } as Record<string, string>
                )[mode]
              }
            </Button>
          </form>
          {['login', 'signup'].includes(mode) && (
            <div className="auth-social">
              <p className="muted small">Or continue with</p>
              {['google', 'github'].map((provider) => (
                <Button
                  key={provider}
                  variant="outline"
                  disabled={!providers[provider]}
                  onClick={() => {
                    window.location.href = `/api/auth/${provider}/start`;
                  }}
                >
                  Continue with {provider === 'google' ? 'Google' : 'GitHub'}
                  {!providers[provider] ? ' (not configured)' : ''}
                </Button>
              ))}
            </div>
          )}
          <nav className="auth-links" aria-label="Account help">
            <Link href={mode === 'login' ? '/signup' : '/login'}>
              {mode === 'login' ? 'Create an account' : 'Back to sign in'}
            </Link>
            <Link href="/forgot-password">Forgot password?</Link>
            <Link href="/resend-verification">Resend verification</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}
export function AccountSettings() {
  const [providers, setProviders] = useState<Record<string, boolean>>({}),
    [connected, setConnected] = useState<string[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([
      api<Record<string, boolean>>('/auth/providers'),
      api<{ user: { identities: { provider: string }[] } }>('/auth/me'),
    ])
      .then(([p, u]) => {
        setProviders(p);
        setConnected(u.user.identities.map((i) => i.provider));
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <h1>Account settings</h1>
      <p className="muted">Connect another sign-in method with the same verified email address.</p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <div className="auth-social">
        {['google', 'github'].map((p) => (
          <Button
            variant="outline"
            key={p}
            disabled={!providers[p] || connected.includes(p)}
            onClick={async () => {
              try {
                const result = await api<{ url: string }>(`/auth/${p}/connect`, { method: 'POST' });
                window.location.href = result.url;
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            {p === 'google' ? 'Google' : 'GitHub'} ·{' '}
            {connected.includes(p) ? 'Connected' : providers[p] ? 'Connect' : 'Not configured'}
          </Button>
        ))}
      </div>
      <Link className="text-link" href="/forgot-password">
        Set or reset your password
      </Link>
    </section>
  );
}
