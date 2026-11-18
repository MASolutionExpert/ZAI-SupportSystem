import "server-only";

import { connect } from "net";
import type { ScanOutcome } from "./types";

/**
 * Antivirus scanning integration point (spec §10) — ClamAV clamd over TCP
 * using the INSTREAM protocol (connect, send `zINSTREAM\0`, chunked content,
 * read verdict).
 *
 * Mandatory-scan semantics: when a provider IS configured, a scan that cannot
 * complete (unreachable daemon, timeout) FAILS CLOSED — the upload is
 * rejected, never stored unscanned. When no provider is configured the
 * outcome is honestly reported as SKIPPED (the UI shows the honest state;
 * nothing pretends to be scanned).
 */

const CHUNK_SIZE = 32 * 1024;

export function scanBuffer(
  data: Buffer,
  settings: { provider: string; host: string; port: number; timeoutMs: number }
): Promise<ScanOutcome> {
  if (settings.provider === "none") {
    return Promise.resolve({ verdict: "SKIPPED" });
  }
  return clamdInstream(data, settings).catch((error: Error) => ({
    verdict: "SCAN_ERROR" as const,
    error: error?.message || "خطای ناشناخته اسکن",
  }));
}

function clamdInstream(
  data: Buffer,
  settings: { host: string; port: number; timeoutMs: number }
): Promise<ScanOutcome> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host: settings.host, port: settings.port },
      () => {
        socket.write("zINSTREAM\0");
        for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
          const chunk = data.subarray(offset, offset + CHUNK_SIZE);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(chunk.length, 0);
          socket.write(header);
          socket.write(chunk);
        }
        const end = Buffer.alloc(4);
        end.writeUInt32BE(0, 0);
        socket.write(end);
      }
    );

    let response = "";
    let settled = false;

    const finish = (outcome: ScanOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(settings.timeoutMs);
    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("اسکن آنتی‌ویروس بیش از حد انتظار طول کشید."));
    });
    socket.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      reject(new Error(`اتصال به سرویس آنتی‌ویروس ناموفق بود (${error.message}).`));
    });
    socket.on("data", (buf: Buffer) => {
      response += buf.toString("latin1");
      if (!response.endsWith("\n")) return;
      const line = response.trim();
      if (line.endsWith("OK")) {
        finish({ verdict: "CLEAN" });
      } else if (line.includes("FOUND")) {
        const signature = line.split(":").slice(1).join(":").replace(/\s*FOUND\s*$/, "").trim();
        finish({ verdict: "INFECTED", signature: signature || "unknown" });
      } else {
        finish({ verdict: "SCAN_ERROR", error: line || "پاسخ نامعتبر از سرویس اسکن" });
      }
    });
    socket.on("close", () => {
      // Some daemons close without a trailing newline — parse what we have.
      if (settled) return;
      const line = response.trim();
      if (line.endsWith("OK")) {
        finish({ verdict: "CLEAN" });
      } else if (line.includes("FOUND")) {
        const signature = line.split(":").slice(1).join(":").replace(/\s*FOUND\s*$/, "").trim();
        finish({ verdict: "INFECTED", signature: signature || "unknown" });
      } else {
        settled = true;
        socket.destroy();
        reject(new Error("پاسخ ناقص از سرویس آنتی‌ویروس."));
      }
    });
  });
}

/**
 * Standard EICAR test string — exported for the verification script and for
 * environments that want to prove the integration point end-to-end.
 */
export const EICAR_TEST_STRING =
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
