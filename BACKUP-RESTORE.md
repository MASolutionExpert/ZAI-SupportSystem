# Support Desk — Backup & Restore Guide

This document defines the backup policy, the exact contents of a backup archive, manual and CLI-driven procedures, restore verification, and disaster-recovery notes for the self-hosted Support Desk deployment.

---

## 1. What is backed up

A `supportdesk backup` archive (`./backups/supportdesk-backup-YYYYMMDD-HHMMSS.tar.gz`) contains:

| Member | Source | Notes |
|---|---|---|
| `db/…` | SQLite database files from the `supportdesk_db` volume (`/app/db`) | Includes the DB and any journal/WAL remnants |
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

`supportdesk backup` **stops the app container** first, then copies files, then restarts it. This yields a crash-consistent SQLite copy without requiring sqlite3 inside the container; the trade-off is **brief downtime** — usually a few seconds (copy duration grows with storage size). The CLI prints a warning before stopping and performs a health check after restarting. If the container was already stopped, it is left stopped.

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
mkdir -p backups/.manual-$STAMP/db

docker compose stop app                                   # brief downtime

# resolve the actual (project-prefixed) volume names
DB_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/db"}}{{.Name}}{{end}}{{end}}' supportdesk-app)
STOR_VOL=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/storage"}}{{.Name}}{{end}}{{end}}' supportdesk-app)
IMAGE=$(docker inspect -f '{{.Config.Image}}' supportdesk-app)

docker run --rm -v "$DB_VOL:/src:ro" -v "$PWD/backups/.manual-$STAMP/db:/dst" "$IMAGE" sh -c 'cp -a /src/. /dst/'
docker run --rm -v "$STOR_VOL:/src:ro" -v "$PWD/backups/.manual-$STAMP:/dst" "$IMAGE" sh -c 'tar czf /dst/storage.tar.gz -C /src .'
cp .env backups/.manual-$STAMP/.env && chmod 600 backups/.manual-$STAMP/.env

tar -C "backups/.manual-$STAMP" -czf "backups/supportdesk-backup-$STAMP.tar.gz" .env db storage.tar.gz
rm -rf "backups/.manual-$STAMP"

docker compose start app
```

## 5. Restore procedure

> **Restore is destructive**: it replaces the current database, storage files and `.env`. The CLI requires typing `YES` and keeps a copy of the previous `.env` as `.env.pre-restore-<stamp>`.

### Using the management CLI (recommended)

```bash
cd /opt/supportdesk
./scripts/supportdesk.sh restore backups/supportdesk-backup-20260101-023000.tar.gz
```

Steps performed: confirm (type `YES`) → stop the app → wipe & refill the `supportdesk_db` volume from `db/` → wipe & refill the `supportdesk_storage` volume from `storage.tar.gz` → restore `.env` → restart the app → wait for `/api/health`.

### Manual equivalent (plain Docker)

```bash
cd /opt/supportdesk
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p /tmp/sd-restore-$STAMP && tar -xzf backups/supportdesk-backup-<stamp>.tar.gz -C /tmp/sd-restore-$STAMP

docker compose stop app
# resolve $DB_VOL / $STOR_VOL / $IMAGE as in §4, then:
docker run --rm -v "$DB_VOL:/dst" -v "/tmp/sd-restore-$STAMP/db:/src:ro" "$IMAGE" \
  sh -c 'find /dst -mindepth 1 -maxdepth 1 -exec rm -rf {} + && cp -a /src/. /dst/'
docker run --rm -v "$STOR_VOL:/dst" -v "/tmp/sd-restore-$STAMP:/src:ro" "$IMAGE" \
  sh -c 'find /dst -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar xzf /src/storage.tar.gz -C /dst'
cp /tmp/sd-restore-$STAMP/.env .env && chmod 600 .env
rm -rf /tmp/sd-restore-$STAMP

docker compose start app
```

### Restore verification checklist

1. `./scripts/supportdesk.sh status` → compose service `(healthy)` and health JSON shows `"status":"ok"` with `"database":true`.
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

## 8. SQLite WAL requirement — backups need a graceful stop (Phase 7 finding)

The SQLite database runs in **WAL journal mode**. Recent writes live in `custom.db-wal` until a checkpoint moves them into the main file; the app checkpoints automatically on a **clean close** of its last connection. Consequences for backups:

- **The supported CLI path is safe:** `supportdesk backup` / the manual Docker equivalent use `docker compose stop` (graceful), which closes connections cleanly, checkpoints the WAL, and yields a complete `custom.db`.
- **Copying only `custom.db` while the app was killed non-gracefully (SIGKILL / crash) is NOT a valid backup:** un-checkpointed WAL contents are lost, and the copy can silently be an older snapshot. If you must back up from scripts outside the CLI, either (a) stop the app gracefully first and verify no app process remains, or (b) copy **all three files** (`custom.db`, `custom.db-wal`, `custom.db-shm`) together — a restored pair of main+WAL replays the journal on next open.
- **Restore verification is mandatory** (§5 checklist) — verify through the *running app* (login + a data spot-check), not only through file-level checks: a stale process can keep serving the pre-restore data from an open file handle while the disk file differs.

Verified in Phase 7: graceful stop → `custom.db` only (no WAL) → backup → mutate → destructive restore → health OK, marker row gone, storage checksums byte-identical.
