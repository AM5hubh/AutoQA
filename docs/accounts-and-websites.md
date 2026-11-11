# Accounts and website setup

## Local signup and recovery

Run `npm run setup`, then `docker compose up -d --build`. Setup adds missing settings without replacing your existing secrets. Open [Create account](http://localhost:3000/signup), enter an email and a password of at least 12 characters, then open the verification email in [Mailpit](http://localhost:8025). Click the link and confirm verification before signing in.

Mailpit captures development emails locally; it does not deliver to real inboxes. Forgot password and resend verification use the same inbox. Verification links expire after 24 hours; reset links expire after 30 minutes. Requesting a replacement invalidates the previous link. Resetting a password invalidates all existing sessions. Links are consumed on explicit submission, not by merely opening the email.

Existing accounts and data are preserved. Existing users must use **Resend verification** and verify their email before signing in. The optional provisioning CLI still creates accounts, but it does not bypass verification.

## Production email

Set these values in the private `.env` file and recreate the API service:

```dotenv
COMPOSE_PROFILES=
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_FROM=AutoQA <no-reply@your-domain.com>
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
```

Use `SMTP_SECURE=true` for implicit TLS on port 465. Production requires TLS and rejects the local Mailpit/localhost configuration. Configure the sender domain with your email provider. Do not publish Mailpit; its inbox contains account recovery links.

## Google and GitHub sign-in

Create your own OAuth applications. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, and `GITHUB_CLIENT_SECRET` in `.env`, then run `docker compose up -d api`. These secrets are passed only to the API. Buttons remain visibly unavailable until the respective provider is configured.

Register these exact local callback URLs:

- Google: `http://localhost:3000/api/auth/google/callback`
- GitHub: `http://localhost:3000/api/auth/github/callback`

For production, replace `http://localhost:3000` with the HTTPS `APP_ORIGIN`; register separate provider applications when separate callback registrations are required. Google testing-mode applications may require adding allowed test users in the consent configuration. GitHub requires a verified primary email, including when it is hidden from the public profile.

Google requests OpenID, email, and profile scopes. GitHub requests `read:user` and `user:email`; no repository access. Provider tokens are not retained. If an account already uses the email, sign into that account and connect the provider in **Account settings**. Matching emails do not silently merge accounts. A provider connection must use the same verified email.

Provider setup references: [Google web applications](https://developers.google.com/identity/protocols/oauth2/web-server), [GitHub OAuth applications](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps).

## Add your website

Create a project with an origin such as `https://staging.example.com`. Use a domain on HTTP port 80 or HTTPS port 443, with no path, credentials, query, or fragment. Starting page paths are entered separately when generating tests. Private networks, localhost, IP literals, and IPv6-only hosts are unsupported.

Choose either ownership method in **Website settings**:

1. **DNS TXT:** publish the displayed `autoqa-verification=...` value at `_autoqa-challenge.staging.example.com`, then click **Check DNS record**.
2. **Hosted file:** serve that same value at `https://staging.example.com/.well-known/autoqa-verification.txt`, then click **Check verification file**. This requires a valid TLS certificate, HTTP 200, no redirect, and a response under 4 KiB.

Proof is bound to this project and exact hostname. Keep it published; the worker rechecks before each job. No administrator approval is needed. An unavailable proof blocks new execution until verification succeeds again.

List required CDN/API origins explicitly, up to ten, one per line. This allows resources and API requests to those origins, while test navigation remains on the main website. Popups, cross-origin frames/navigation, WebSockets, downloads, and service workers remain unsupported.

Changing the website clears verification and rotates its challenge. Changing the website or additional origins invalidates suite approvals. Review and approve the suite again; previous run snapshots and evidence remain unchanged. Configuration cannot change while the project has queued or active jobs.

`ENABLE_DEMO_TARGET=true` enables the built-in Demo Shop shortcut for local development; the production overlay disables it. No other private-network exception exists.
