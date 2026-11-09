# Operations

## Configuration

`npm run setup` creates `.env` without overwriting an existing file and generates random session/service secrets. Keep it out of source control. Set `GROQ_API_KEY` only for the AI container. API keys are never sent to Next.js or Chromium.

`APPROVED_TARGETS` is a JSON array of `{name, origin}` objects. Origins are exact HTTP(S) origins, without credentials, paths, queries, or fragments. External targets must use port 80 or 443 and public IPv4 DNS results. Only `http://demo-site:4100` is allowed as a private target. Restart API, worker, and egress after changing the allowlist.

Default execution settings: desktop 1440×900; mobile 390×844; 10-second actions; 20-second navigation; five-minute total execution deadline; one worker; seven-day artifacts. Browser memory is limited to 2 GiB. Run limits are in the shared contract module.

## Deploy to a Linux Docker host

1. Copy the repository or build the versioned images. Install Docker with Compose.
2. Run setup. Set a strong `POSTGRES_PASSWORD` **before first database initialization** and update `DATABASE_URL` for any host-side tooling.
3. Set `APP_ORIGIN=https://your-hostname` and `PUBLIC_HOST=your-hostname`. Point that hostname's DNS to the host.
4. Set Groq credentials and restrict the target allowlist to authorized staging sites.
5. Start: `docker compose -f compose.yaml -f compose.production.yaml up -d --build`.
6. Provision individual accounts through `docker compose exec api npm run user:create`.
7. Check HTTPS, cookie flags, cross-user access, proxy restrictions, and one complete run before sharing access.

Caddy handles HTTPS. All development ports bind to loopback; firewall the host so only 80/443 and your restricted administration port are reachable. Never expose the database, Redis, AI service, or browser-control port. Changing the password environment variable on an existing PostgreSQL volume does not rotate its database password; rotate it with PostgreSQL administration tools and update clients together.

No hosting account, domain, billing resource, or remote deployment is created automatically by the repository.

## Updates and recovery

- Stop new submissions during maintenance. `docker compose stop worker` waits up to six minutes for active work to finish.
- Back up before schema changes. Build the release, run the one-shot migrate service, then restart app services.
- Keep the previous image tags. Roll application code back only if compatible with the applied schema; never reset a database to make a migration pass.
- If a worker disappears, the reconciler marks its active runs interrupted after 90 seconds. Review partial evidence and start a new run. Do not retry the old browser job in a queue dashboard.
- A cancelled job retains completed results. Cancellation cannot undo an action already sent to the website.
- Artifact cleanup removes expired files; metadata and test outcomes remain available.

## Back up and restore

Run backups from a Linux shell on the deployment host, using a private backup directory. These are operator commands, not scheduled testing features:

```sh
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres pg_dump -U autoqa -d autoqa -Fc > backups/autoqa.dump
docker compose exec -T worker tar -C /app/artifacts -czf - . > backups/artifacts.tar.gz
```

Schedule these commands daily using the host scheduler, encrypt copies, and store them off-host. Backup files can contain target data. To verify a database backup without overwriting the application database:

```sh
docker compose exec -T postgres createdb -U autoqa autoqa_restore_check
docker compose exec -T postgres pg_restore -U autoqa -d autoqa_restore_check < backups/autoqa.dump
docker compose exec -T postgres psql -U autoqa -d autoqa_restore_check -c 'SELECT count(*) FROM "Run";'
```

Choose a fresh restore-check database name for subsequent exercises. Restore artifact archives into a separate scratch directory and verify referenced files before performing any production recovery. Never restore unreviewed archives over a live volume.

For a cross-platform local database check, stop new submissions and run `node scripts/restore-check.mjs`. It creates a uniquely named restore database, restores a custom-format dump, and asserts that the run count matches. It leaves both the restore database and dump available for inspection; their names are printed or derived from the same timestamp. It does not restore artifact files or overwrite the live database.

## Diagnostics

`docker compose ps` reports services. `docker compose logs --tail 100 api worker ai browser` provides errors with run IDs. `/health` is process health; `/ready` verifies database access. The worker stores `autoqa:worker:heartbeat` in Redis with a 30-second expiry. Alert on a missing heartbeat, growing queued records, repeated failed jobs, disk pressure, and unexpected model usage.

This single-host portfolio deployment has no high availability. Browser isolation is appropriate for approved controlled targets, not a substitute for an adversarial multi-tenant sandbox review.
