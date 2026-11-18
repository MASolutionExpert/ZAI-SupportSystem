/** Persian (Jalali) date & number formatting helpers. */

const faNumber = new Intl.NumberFormat("fa-IR");
const faDateTime = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeStyle: "short",
});
const faDate = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" });

export function faNum(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return String(value);
  return faNumber.format(n);
}

export function faDateTimeFormat(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return faDateTime.format(d);
}

export function faDateFormat(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return faDate.format(d);
}

/** Human-readable bytes (Persian units). */
export function faBytes(bytes: number): string {
  if (bytes < 0) return "—";
  if (bytes < 1024) return `${faNum(bytes)} بایت`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${faNum(kb.toFixed(1))} کیلوبایت`;
  const mb = kb / 1024;
  if (mb < 1024) return `${faNum(mb.toFixed(1))} مگابایت`;
  const gb = mb / 1024;
  return `${faNum(gb.toFixed(2))} گیگابایت`;
}
