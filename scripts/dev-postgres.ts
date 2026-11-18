/**
 * Local development PostgreSQL provisioner — no Docker, no root required.
 *
 * Boots a REAL PostgreSQL server (embedded-postgres ships the official
 * binaries) for local development and the verify suites:
 *
 *   bun run db:up      → start (idempotent; no-op when already running)
 *   bun run db:down    → stop
 *
 * Design notes:
 *  - The server runs in a DETACHED background process (`--serve`) so the
 *    `bun run dev` pipeline does not block on it; on sandbox/container restarts
 *    `db:up` simply re-launches it.
 *  - `persistent: true` — data survives restarts in db/pgdata (gitignored).
 *  - Credentials are dev-local constants; production never uses this script.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const HOST = process.env.DEV_PG_HOST ?? "127.0.0.1";
const PORT = Number(process.env.DEV_PG_PORT ?? 5433);
const USER = process.env.DEV_PG_USER ?? "supportdesk";
const PASSWORD = process.env.DEV_PG_PASSWORD ?? "supportdesk";
const DB_NAME = process.env.DEV_PG_DBNAME ?? "supportdesk";
const DATA_DIR = process.env.DEV_PG_DATA ?? path.join(process.cwd(), "db", "pgdata");
// NOTE: must live OUTSIDE the data dir — initdb refuses non-empty directories.
const LOG_FILE = path.join(process.cwd(), "db", "pgdata.postgres.log");

const PG_VERSION_MARKER = path.join(DATA_DIR, "PG_VERSION");
const PID_FILE = path.join(DATA_DIR, "postmaster.pid");

function log(message: string): void {
  console.log(`[dev-postgres] ${message}`);
}

/** TCP readiness probe — postgres listening means ready. */
function isPortOpen(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(PORT, HOST);
  });
}

async function waitForReady(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function serve(): Promise<void> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
  });

  if (!existsSync(PG_VERSION_MARKER)) {
    log(`initialising a fresh cluster in ${DATA_DIR} ...`);
    await pg.initialise();
  }

  await pg.start();
  log(`postgres is listening on ${HOST}:${PORT}`);

  // Ensure the application database exists (created on first boot only).
  try {
    await pg.createDatabase(DB_NAME);
    log(`database "${DB_NAME}" created`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|42P04/i.test(message)) {
      log(`createDatabase failed: ${message}`);
    }
  }

  const shutdown = async (signal: string) => {
    log(`received ${signal} — stopping postgres ...`);
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // Keep the detached process alive (postgres itself runs unmanaged).
  setInterval(() => {}, 1 << 30);
}

async function stop(): Promise<void> {
  if (await isPortOpen()) {
    try {
      const firstLine = readFileSync(PID_FILE, "utf8").split("\n")[0].trim();
      const pid = Number(firstLine);
      if (Number.isFinite(pid) && pid > 0) {
        process.kill(pid, "SIGTERM");
        log(`SIGTERM sent to postgres (pid ${pid}) — waiting ...`);
        const stopped = await (async () => {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            if (!(await isPortOpen())) return true;
            await new Promise((r) => setTimeout(r, 300));
          }
          return false;
        })();
        log(stopped ? "postgres stopped." : "postgres still closing — check the log.");
        return;
      }
    } catch (error) {
      log(`could not read ${PID_FILE}: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    log("postgres is not running.");
  }
}

async function up(): Promise<void> {
  if (await isPortOpen()) {
    log(`already running on ${HOST}:${PORT} (database: ${DB_NAME})`);
    return;
  }

  log(`starting postgres on ${HOST}:${PORT} (data: ${DATA_DIR}) ...`);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [process.argv[1] ?? "scripts/dev-postgres.ts", "--serve"], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  const ready = await waitForReady(120_000);
  if (!ready) {
    log("ERROR: postgres did not become ready in time — inspect the log:");
    log(`  tail -n 50 ${LOG_FILE}`);
    process.exit(1);
  }
  log(`ready: postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB_NAME}`);
}

const mode = process.argv[2];
if (mode === "--serve") {
  void serve();
} else if (mode === "--stop") {
  void stop().then(() => process.exit(0));
} else {
  void up().then(() => process.exit(0));
}
