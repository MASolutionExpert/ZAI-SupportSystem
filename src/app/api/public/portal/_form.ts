import { NextResponse } from "next/server";
import { apiError } from "@/lib/api";
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES } from "@/lib/tickets/attachments";

/**
 * Shared multipart helpers for the portal routes (ticket creation and
 * customer replies). Files arrive as multiple `files` entries and are read
 * into Buffers here; the authoritative validation (MIME sniffing, size,
 * extension allowlist) happens inside the ticketing service.
 */

export type FormAttachment = { filename: string; buffer: Buffer };

export type FormFilesResult =
  | { ok: true; attachments: FormAttachment[] }
  | { ok: false; response: NextResponse };

/** Parse the request body as multipart form data (null when malformed). */
export async function parseFormData(req: Request): Promise<FormData | null> {
  try {
    return await req.formData();
  } catch {
    return null;
  }
}

/** Extract `files` entries, enforcing the count/size caps with Persian errors. */
export async function readFormAttachments(
  form: FormData,
  field = "files"
): Promise<FormFilesResult> {
  const entries = form.getAll(field).filter(
    (value): value is File => value instanceof File && value.size > 0
  );

  if (entries.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return {
      ok: false,
      response: apiError(
        "حداکثر ۵ فایل پیوست در هر ارسال مجاز است.",
        422,
        "TOO_MANY_FILES"
      ),
    };
  }

  const attachments: FormAttachment[] = [];
  for (const file of entries) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return {
        ok: false,
        response: apiError(
          `حجم فایل «${file.name}» بیش از سقف ۱۰ مگابایت است.`,
          422,
          "FILE_TOO_LARGE"
        ),
      };
    }
    attachments.push({
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
    });
  }

  return { ok: true, attachments };
}
