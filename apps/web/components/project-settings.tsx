'use client';
import { useState } from 'react';
import { Button } from './ui/button';
import { api } from '../lib/api';
import type { Project } from '../lib/types';
export function ProjectSettings({
  project,
  onChange,
}: {
  project: Project;
  onChange: () => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const hostname = new URL(project.baseUrl).hostname;
  const demo = project.baseUrl === 'http://demo-site:4100';
  async function action(route: string, body: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/projects/${project.id}${route}`, { method: 'POST', body: JSON.stringify(body) });
      await onChange();
      setMessage('Website verification updated.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel website-settings">
      <div className="section-heading">
        <h2>Website settings</h2>
        <span className="small">
          {project.verifiedAt || demo ? 'Verified' : 'Verification required'} · revision{' '}
          {project.targetRevision}
        </span>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success-text">
          {message}
        </p>
      )}
      {!demo && (
        <div className="verification">
          <h3>Verify website ownership</h3>
          <p>Choose either method. Keep the proof in place: it is checked before each job.</p>
          {project.verificationToken ? (
            <>
              <p>
                <strong>DNS TXT:</strong> add this record at{' '}
                <code>_autoqa-challenge.{hostname}</code>
              </p>
              <pre tabIndex={0}>{`autoqa-verification=${project.verificationToken}`}</pre>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void action('/verify', { method: 'dns' })}
              >
                Check DNS record
              </Button>
              <p>
                <strong>HTTPS file:</strong> serve the same text at{' '}
                <code>https://{hostname}/.well-known/autoqa-verification.txt</code>, without a
                redirect.
              </p>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void action('/verify', { method: 'file' })}
              >
                Check verification file
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => void action('/verification/challenge', {})}>
              Create verification challenge
            </Button>
          )}
        </div>
      )}
      <details>
        <summary>Edit website configuration</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            const form = new FormData(e.currentTarget);
            try {
              await api(`/projects/${project.id}`, {
                method: 'PATCH',
                body: JSON.stringify({
                  name: form.get('name'),
                  baseUrl: form.get('baseUrl'),
                  additionalOrigins: String(form.get('additionalOrigins'))
                    .split('\n')
                    .map((v) => v.trim())
                    .filter(Boolean),
                  targetRevision: project.targetRevision,
                }),
              });
              await onChange();
              setMessage(
                'Settings saved. Review and approve suites after changing website access.',
              );
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Project name
            <input name="name" required maxLength={100} defaultValue={project.name} />
          </label>
          <label>
            Website origin
            <input name="baseUrl" type="url" required defaultValue={project.baseUrl} />
          </label>
          <label>
            Additional CDN/API origins
            <textarea
              name="additionalOrigins"
              rows={3}
              defaultValue={project.additionalOrigins.join('\n')}
              placeholder="https://cdn.example.com"
            />
          </label>
          <p className="small muted">
            Up to ten exact origins, one per line. Changes invalidate suite approval. A new website
            needs fresh ownership verification.
          </p>
          <Button disabled={busy}>Save website settings</Button>
        </form>
      </details>
    </section>
  );
}
