/**
 * Knowledge Base — heading/paragraph-aware chunking.
 *
 * Splits extracted document text into indexable chunks (target 150–900
 * chars): Markdown ATX headings and blank lines separate blocks, a heading
 * always stays attached to its following paragraph, plain paragraphs are
 * merged greedily while the chunk stays ≤ 900 chars, and oversized
 * paragraphs are split by sentence boundaries (`.`, `!`, `؟`, `?`, newline).
 *
 * Normalization note: `normalizePersian` collapses ALL whitespace (including
 * newlines), so it must NOT be applied to the whole text before chunking —
 * the line structure would be destroyed. Instead, each line is normalized
 * individually inside the splitter; the pipeline additionally stores
 * `normalizePersian(chunk.text)` as the flat search-index string.
 */

import { normalizePersian } from "./text";

export type KbChunk = { ordinal: number; text: string };

/** Upper bound for a single chunk (chars). */
const MAX_CHUNK_CHARS = 900;
/** Minimum meaningful chunk length — shorter trailing fragments are dropped. */
const MIN_CHUNK_CHARS = 25;

type Unit = { text: string; forceNew: boolean };

/** Markdown ATX heading (`#`, `##`, …) — detected on a normalized line. */
function isAtxHeading(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line);
}

/** Strip the ATX marker from a heading line (markup, not content). */
function stripAtxMarker(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").trim();
}

/** Split one oversized text by sentence boundaries into ≤MAX pieces. */
function splitBySentences(text: string): string[] {
  const sentences = text.match(/[^.!؟?\n]+[.!؟?\n]+|[^.!؟?\n]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) pieces.push(current);
    current = "";
  };

  for (const sentence of sentences) {
    // A single sentence longer than the cap is hard-split on word borders.
    if (sentence.length > MAX_CHUNK_CHARS) {
      flush();
      let rest = sentence;
      while (rest.length > MAX_CHUNK_CHARS) {
        let cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
        if (cut < MIN_CHUNK_CHARS) cut = MAX_CHUNK_CHARS;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      current = rest;
      continue;
    }
    if (current.length + sentence.length > MAX_CHUNK_CHARS) flush();
    current += sentence;
  }
  flush();
  return pieces;
}

/**
 * Build indexable chunks from raw extracted text. Ordinals are 0..n-1.
 */
export function chunkText(rawText: string): KbChunk[] {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");

  // Group lines into paragraphs; attach pending headings to the next block.
  let pendingHeading: string | null = null;
  const units: Unit[] = [];

  let paragraphLines: string[] = [];
  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const paragraph = paragraphLines.join("\n").trim();
    paragraphLines = [];
    if (!paragraph) return;
    const text = pendingHeading ? `${pendingHeading}\n\n${paragraph}` : paragraph;
    units.push({ text, forceNew: !!pendingHeading });
    pendingHeading = null;
  };

  for (const rawLine of lines) {
    const line = normalizePersian(rawLine);
    if (!line) {
      flushParagraph();
      continue;
    }
    if (isAtxHeading(line)) {
      flushParagraph();
      const heading = stripAtxMarker(line);
      pendingHeading = pendingHeading
        ? `${pendingHeading}\n\n${heading}`
        : heading;
      continue;
    }
    paragraphLines.push(line);
  }
  flushParagraph();
  if (pendingHeading) units.push({ text: pendingHeading, forceNew: true });

  // Split oversized units into ≤MAX pieces (the first piece keeps the flag).
  const pieces: Unit[] = [];
  for (const unit of units) {
    if (unit.text.length <= MAX_CHUNK_CHARS) {
      pieces.push(unit);
      continue;
    }
    const split = splitBySentences(unit.text);
    split.forEach((text, index) => {
      pieces.push({ text: text.trim(), forceNew: index === 0 ? unit.forceNew : false });
    });
  }

  // Greedy merge: plain pieces join the open chunk while it fits; a piece
  // that starts with a heading always opens a fresh chunk (section boundary).
  const chunks: string[] = [];
  let current: string | null = null;
  for (const piece of pieces) {
    if (
      current !== null &&
      !piece.forceNew &&
      current.length + 2 + piece.text.length <= MAX_CHUNK_CHARS
    ) {
      current = `${current}\n\n${piece.text}`;
    } else {
      if (current !== null) chunks.push(current);
      current = piece.text;
    }
  }
  if (current !== null) chunks.push(current);

  // Drop a dangling trailing fragment (< MIN chars) — anti-noise, and never
  // drop mid-list content.
  if (chunks.length > 0 && chunks[chunks.length - 1]!.trim().length < MIN_CHUNK_CHARS) {
    chunks.pop();
  }

  return chunks.map((text, ordinal) => ({ ordinal, text: text.trim() }));
}
