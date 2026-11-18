# Support Desk — Backup & Restore Guide

This document defines the backup policy, the exact contents of a backup archive, manual and CLI-driven procedures, restore verification, and disaster-recovery notes for the self-hosted Support Desk deployment.

---

## 1. What is backed up

A `supportdesk backup` archive (`./backups/supportdesk-backup-YYYYMMDD-HHMMSS.tar.gz`) contains:

| Member | Source | Notes |
|---|---|---|
| `database.dump` | `pg_dump --format=custom` snapshot of the `supportdesk_pgdata` volume (via the `db` service) | MVCC-consistent logical snapshot, engine-version-matched |
| `storage.tar.gz` | All files from the `supportdesk_storage` volume (`/app/storage`) | Uploaded/persistent files |
| `.env` | Deployment configuration (mode **600** inside the archive) | Contains **secrets** — handle archives accordingly |

## 2. Policy

- **Before every update:** `supportdesk update` runs a backup automatically — keep it until the new version is verified.
- **Regular schedule:** at least daily. Example cron (root):

  ```cron
  # /etc/cron.d/supportdesk-backup
  15 2 * * *  root  cd /opt/supportdesk && ./scripts/supportdesk.sh backup >> /var/log/supportdesk-backup.log 2>&1
  25 3 * * *  root  find /opt/supportdesk/backups -name 'supportdesk-backup-*.tar.gz' -mtime +30 -delete
  ```

- **Retention:** 30 days is a sensible default for Phase 1 (adjust to your compliance needs).
- **Offsite copies:** backups are useless on the same disk that dies. Sync `./backups` off-host nightly, e.g.:
  ```bash
  rclone copy /opt/supportdesk/backups remote:supportdesk-backups --min-age 5m
  # or: rsync -a /opt/supportdesk/backups/ backup-server:/srv/backups/supportdesk/
  ```
  Because archives include `.env` (secrets), **encrypt offsite copies** or store them only in access-controlled storage.
- **Test restores** at least quarterly on a scratch machine.

## 3. Downtime (honest statement)

`supportdesk backup` runs **online with no downtime**: it executes `pg_dump --format=custom` against the running `db` container (a consistent MVCC snapshot — readers and writers continue unaffected) and archives the storage volume alongside. The app container is **not** stopped or restarted by backups. The only caveat is the classic logical-backup one: objects created during the dump window appear only if committed before the dump's snapshot point.

## 4. Backup — commands

### Using the management CLI (recommended)

```bash
cd /opt/supportdesk
./scripts/supportdesk.sh backup
# -> prints the archive path, e.g. ./backups/supportdesk-backup-20260101-023000.tar.gz
```

### Manual equivalent (plain Docker)

```bash
cd /opt/supportdesk
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p backups/.manual-$STAMP

# 1. Online database snapshot (custom format, engine-version matched)
docker compose exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > backups/.manual-$STAMP/database.dump

# 2. Storage volume archive
STOR_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' supportdesk-app)
IMAGE=$(docker inspect -f '{{.Config.Image}}' supportdesk-app)
docker run --rm -v "$STOR_VOL:/src:ro" -v "$PWD/backups/.manual-$STAMP:/dst" "$IMAGE" \
  sh -c 'tar czf /dst/storage.tar.gz -C /src .'

# 3. Configuration
cp .env backups/.manual-$STAMP/.env && chmod 600 backups/.manual-$STAMP/.env

tar -C "backups/.manual-$STAMP" -czf "backups/supportdesk-backup-$STAMP.tar.gz" .env database.dump storage.tar.gz
rm -rf "backups/.manual-$STAMP"
```

## 5. Restore procedure

> **Restore is destructive**: it replaces the current database, storage files and `.env`. The CLI requires typing `YES` and keeps a copy of the previous `.env` as `.env.pre-restore-<stamp>`.

### Using the management CLI (recommended)

```bash
cd /opt/supportdesk
./scripts/supportdesk.sh restore backups/supportdesk-backup-20260101-023000.tar.gz
```

Steps performed: confirm (type `YES`) → stop the app (db/cache keep running) → `pg_restore --clean --if-exists` of `database.dump` into the running `db` service → wipe & refill the `supportdesk_storage` volume from `storage.tar.gz` → restore `.env` → restart the app → wait for `/api/health`.

### Manual equivalent (plain Docker)

```bash
cd /opt/supportdesk
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /tmp/sd-restore-$STAMP && tar -xzf backups/supportdesk-backup-<stamp>.tar.gz -C /tmp/sd-restore-$STAMP

docker compose stop app          # app only; the db service stays up
docker compose exec -T db sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  < /tmp/sd-restore-$STAMP/database.dump

STOR_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' supportdesk-app)
IMAGE=$(docker inspect -f '{{.Config.Image}}' supportdesk-app)
docker run --rm -v "$STOR_VOL:/dst" -v "/tmp/sd-restore-$STAMP:/src:ro" "$IMAGE" \
  sh -c 'find /dst -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /src/storage.tar.gz -C /dst'
cp /tmp/sd-restore-$STAMP/.env .env && chmod 600 .env
rm -rf /tmp/sd-restore-$STAMP

docker compose start app
```

### Restore verification checklist

1. `./scripts/supportdesk.sh status` → compose services `(healthy)` and health JSON shows `"status":"ok"` with `"database":true`.
2. `./scripts/supportdesk.sh version` → VERSION file, running image and health-endpoint version agree with the expected (pre-incident) release.
3. Log in as an administrator and confirm expected accounts/departments exist.
4. Spot-check a known uploaded file in the file hub (storage volume restored).
5. Check `AuditLog` timestamps in the admin panel match the backup point in time.
6. Only after verification, prune older backups.

## 6. Disaster recovery notes

- **Rebuild a lost host:** install Docker → clone/download the deployment folder → restore `.env` from your offsite copy (or re-run `supportdesk install` with a **new** `AUTH_SECRET`; note that changing `AUTH_SECRET` invalidates existing sessions, which is safe) → `supportdesk install` → `supportdesk restore <archive>`.
- **Offsite first:** the same-disk backup only protects against software failure, not disk/host loss.
- **Encrypt** archives that leave the host (they contain `.env`).
- **Application version matters:** restore a database against the *same app version* that created it whenever possible (check the `version` field inside the archive's `.env`/health output).

## 7. Database rollback after updates (honest limitation)

**Database rollback after incompatible migrations is NOT automatic.** Prisma's `migrate deploy` only applies migrations forward; it never down-migrates. The supported recovery strategy when an update must be undone is:

1. `./scripts/supportdesk.sh restore <pre-update backup>` — restores the database (and storage/`.env`) to the pre-update state;
2. revert the image tag: set `SUPPORTDESK_IMAGE=ghcr.io/<org>/<repo>:<previous-version>` in `.env`;
3. `docker compose up -d` and verify `/api/health`.

This is why `supportdesk update` always creates a backup first — see `DEPLOYMENT.md` §6.

## 8. Historical note — SQLite-era WAL caveat (v0.9.x and earlier)

v0.9.x and earlier stored data in SQLite (WAL journal mode), where a valid backup required a graceful stop or copying the `custom.db` + `-wal` + `-shm` file trio together. **This entire class of problem is gone since v0.10.0**: PostgreSQL backups use `pg_dump` logical snapshots, which are transactionally consistent regardless of process state, and the CLI runs them online. Restore verification through the running app (§5 checklist) remains mandatory.

**Backward compatibility:** archives created by v0.9.x (containing `db/*.db` files instead of `database.dump`) cannot be restored into the PostgreSQL stack by `supportdesk restore`. Keep them as source material for the one-time data migration documented in `DATABASE.md` §5.
