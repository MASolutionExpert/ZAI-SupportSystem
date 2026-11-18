# Summary of changes

What does this PR change, and why?

# Checklist

- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] Verification suites affected by this change pass locally
      (`scripts/test-phase4-concurrency.ts`, `test-phase5-security.ts`,
      `test-phase6-security.ts`, `test-phase7-hardening.ts` — CI runs them all)
- [ ] No secrets committed (`.env`, passwords, keys, tokens, backups, *.db)
- [ ] Docs updated when behavior or configuration changed
      (README / DEPLOYMENT.md / SECURITY.md / DATABASE.md as applicable)
- [ ] DB changes go through a versioned Prisma migration
      (`bunx prisma migrate dev --name <change>`), never `db:push` on a
      deployed system
