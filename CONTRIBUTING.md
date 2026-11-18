# =============================================================================
# ZAI Support System — Contributing guide
# =============================================================================

## Development setup

Prerequisites: [Bun](https://bun.sh) 1.x (the project uses `bun.lock` — no
package-lock.json), plus a POSIX shell. No external services are required;
the database is a single-file SQLite database.

```bash
bun install                       # install dependencies (frozen lockfile)
cp .env.example .env              # then fill DATABASE_URL / AUTH_SECRET
bunx prisma migrate deploy        # or: bun run db:push (dev convenience)
bun run dev                       # http://localhost:3000 (logs -> dev.log)
```

Minimum `.env` for development:

```
DATABASE_URL="file:./db/custom.db"
AUTH_SECRET="<openssl rand -base64 48>"
APP_URL="http://localhost:3000"
```

In non-production environments missing `AUTH_SECRET` / `SUPERADMIN_PASSWORD`
fall back to deterministic development values (a loud warning is printed).
Production never falls back — it refuses to start.

## Branching & pull requests

- `main` is protected: **lint**, **typecheck**, **build** and **tests
  (phase 4-7)** must pass before merge, force pushes are blocked.
- One feature or fix per branch: `feat/<topic>`, `fix/<topic>`,
  `docs/<topic>`, `chore/<topic>`.
- Conventional Commits are used in this repo — keep them:
  `feat(portal): ...`, `fix(rag): ...`, `docs(readme): ...`.

## Verification before you open a PR

```bash
bun run lint
bun run typecheck
bun scripts/test-phase4-concurrency.ts    # needs a migrated dev DB
bun scripts/test-phase5-security.ts       # needs a migrated dev DB
bun scripts/test-phase6-security.ts       # needs the dev server on :3000
bun scripts/test-phase7-hardening.ts      # needs the dev server on :3000
```

CI runs exactly these suites on every PR — if they pass locally, CI passes.

## Release process (maintainers)

1. Update the `VERSION` file (and `package.json` "version") — e.g. `0.9.1`.
2. Commit: `chore(release): v0.9.1`.
3. Tag and push: `git tag v0.9.1 && git push origin main v0.9.1`.
4. The **Release** workflow verifies tag == VERSION, builds the production
   image and publishes it to `ghcr.io/miladalefbusiness/zai-supportsystem`
   with `X.Y.Z` / `X.Y` / `X` tags (never `:latest`).
5. Deploy with `./scripts/supportdesk.sh update 0.9.1` (backup + health gate)
   or via the **Production Deploy** GitHub Action.

## Security

Do not open public issues for security vulnerabilities — see
[SECURITY.md](SECURITY.md) for the reporting policy. Never commit secrets:
`.env`, backups and databases are git-ignored and CI scans keep it that way.
