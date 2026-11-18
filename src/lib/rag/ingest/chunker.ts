/**
 * RAG Engine — structure-aware parent/child chunker.
 *
 * Input: ordered `StructureBlock`s from ingest/extract.ts. Output: a chunk
 * plan with two kinds:
 *   - SECTION parents  — one per heading-delimited content run (context unit)
 *   - PARAGRAPH children — precise retrieval units inside a section, each
 *     linked to its parent for expansion (task §4.E parent-child retrieval)
 *
 * Provenance per chunk: document-wide ordinal, heading path ("بخش > زیربخش"),
 * page number (when the format provides it), kind, parent link. Children embed
 * their heading path in the *embedded text* (context-aware embeddings) while
 * the stored display text stays clean. No naive fixed-size splitting: unit
 * boundaries follow blocks, sentences split only oversized paragraphs, and
 * consecutive short paragraphs merge into one retrieval unit.
 */

import type { StructureBlock } from "./extract";
import { normalizePersian } from "@/lib/kb/text";

export type PlannedChunk = {
  ordinal: number;
  kind: "SECTION" | "PARAGRAPH";
  parentOrdinal: number | null;
  headingPath: string | null;
  page: number | null;
  /** Display text (no heading prefix). */
  text: string;
  /** Normalized text (lexical index; includes heading path for children). */
  normalized: string;
  /** Text used for the embedding (heading-path contextualized). */
  embedText: string;
};

export type ChunkPlan = {
  chunks: PlannedChunk[];
  sectionCount: number;
  childCount: number;
};

/** Max chars of a single child retrieval unit (before sentence splitting). */
const CHILD_MAX_CHARS = 550;
/** Sentence-split granularity floor — shorter fragments merge with neighbors. */
const CHILD_MERGE_MIN = 120;
/** Min meaningful fragment — shorter trailing pieces are dropped. */
const MIN_FRAGMENT_CHARS = 25;
/** Max chars of a SECTION parent context (expansion unit). */
const SECTION_MAX_CHARS = 1800;
/** Max characters per table block chunk. */
const TABLE_MAX_CHARS = 1200;
/** Hard safety cap on chunks per document. */
const MAX_CHUNKS_PER_DOCUMENT = 800;
/** Heading-path depth cap. */
const MAX_HEADING_DEPTH = 6;

type SectionRun = {
  headingPath: string | null;
  page: number | null;
  parts: Array<{ text: string; page: number | null; type: "paragraph" | "table" }>;
};

/** Split oversized text by sentence boundaries (Persian-aware terminators). */
function splitBySentences(text: string, maxChars: number): string[] {
  const sentences =
    text.match(/[^.!؟?\n]+[.!؟?\n]+|[^.!؟?\n]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) pieces.push(current);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      flush();
      let rest = sentence;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(" ", maxChars);
        if (cut < MIN_FRAGMENT_CHARS) cut = maxChars;
        pieces.push(rest.slice(0, cut));
        rest = rest.slice(cut).trimStart();
      }
      current = rest;
      continue;
    }
    if (current.length + sentence.length > maxChars) flush();
    current += sentence;
  }
  flush();
  return pieces;
}

/** Split section parts into child unit texts (merge small, split oversized). */
function buildChildUnits(section: SectionRun): Array<{ text: string; page: number | null }> {
  const units: Array<{ text: string; page: number | null }> = [];

  for (const part of section.parts) {
    const raw =
      part.type === "table"
        ? part.text.slice(0, TABLE_MAX_CHARS)
        : part.text;

    if (raw.length <= CHILD_MAX_CHARS) {
      // Merge with the previous small unit when both are fragments.
      const previous = units[units.length - 1];
      if (
        previous &&
        previous.text.length + raw.length + 2 <= CHILD_MAX_CHARS &&
        previous.text.length < CHILD_MERGE_MIN
      ) {
        previous.text = `${previous.text}\n${raw}`;
        continue;
      }
      units.push({ text: raw, page: part.page });
      continue;
    }

    for (const piece of splitBySentences(raw, CHILD_MAX_CHARS)) {
      const trimmed = piece.trim();
      if (trimmed.length >= MIN_FRAGMENT_CHARS) {
        units.push({ text: trimmed, page: part.page });
      }
    }
  }

  // Merge undersized trailing fragments.
  const merged: Array<{ text: string; page: number | null }> = [];
  for (const unit of units) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.text.length + unit.text.length + 2 <= CHILD_MAX_CHARS &&
      previous.text.length < CHILD_MERGE_MIN
    ) {
      previous.text = `${previous.text}\n${unit.text}`;
      continue;
    }
    merged.push(unit);
  }
  return merged.filter((unit) => unit.text.trim().length >= MIN_FRAGMENT_CHARS);
}

/**
 * Build the parent/child chunk plan from extracted structure blocks.
 * Ordinals are document-wide and stable (parent before its children).
 */
export function planChunks(blocks: StructureBlock[]): ChunkPlan {
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentSection: SectionRun = { headingPath: null, page: null, parts: [] };
  const sections: SectionRun[] = [];

  const flushSection = () => {
    if (currentSection.parts.length > 0) sections.push(currentSection);
    currentSection = {
      headingPath: headingStack.map((h) => h.text).join(" > ") || null,
      page: currentSection.page,
      parts: [],
    };
  };

  for (const block of blocks) {
    if (block.type === "heading") {
      flushSection();
      // Maintain the stack relative to the new heading's level.
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1]!.level >= block.level
      ) {
        headingStack.pop();
      }
      if (headingStack.length < MAX_HEADING_DEPTH) {
        headingStack.push({ level: block.level, text: block.text });
      }
      currentSection.headingPath = headingStack.map((h) => h.text).join(" > ");
      continue;
    }

    // Track a coarse page for sections (first content page seen).
    if (currentSection.page === null && block.page !== null) {
      currentSection.page = block.page;
    }
    currentSection.parts.push({ text: block.text, page: block.page, type: block.type === "table" ? "table" : "paragraph" });
  }
  flushSection();

  const chunks: PlannedChunk[] = [];
  let ordinal = 0;

  for (const section of sections) {
    const parentOrdinal = ordinal;
    const sectionText = section.parts.map((p) => p.text).join("\n\n");
    const parentDisplay = sectionText.slice(0, SECTION_MAX_CHARS);
    const normalizedFull = normalizePersian(
      [section.headingPath ?? "", sectionText].filter(Boolean).join(" ")
    );

    chunks.push({
      ordinal: ordinal++,
      kind: "SECTION",
      parentOrdinal: null,
      headingPath: section.headingPath,
      page: section.page,
      text: parentDisplay,
      normalized: normalizedFull.slice(0, 4000),
      embedText: [section.headingPath ?? "", sectionText]
        .filter(Boolean)
        .join("\n")
        .slice(0, 3000),
    });

    const children = buildChildUnits(section);
    for (const child of children) {
      if (ordinal - parentOrdinal - 1 >= 12) break; // per-section child cap
      chunks.push({
        ordinal: ordinal++,
        kind: "PARAGRAPH",
        parentOrdinal,
        headingPath: section.headingPath,
        page: child.page,
        text: child.text,
        normalized: normalizePersian(
          [section.headingPath ?? "", child.text].filter(Boolean).join(" ")
        ).slice(0, 4000),
        embedText: [section.headingPath ?? "", child.text]
          .filter(Boolean)
          .join("\n")
          .slice(0, 2000),
      });
    }

    if (chunks.length > MAX_CHUNKS_PER_DOCUMENT) {
      throw new Error("تعداد قطعه‌های سند بیش از حد مجاز است؛ سند را کوچک‌تر کنید.");
    }
  }

  return {
    chunks,
    sectionCount: chunks.filter((c) => c.kind === "SECTION").length,
    childCount: chunks.filter((c) => c.kind === "PARAGRAPH").length,
  };
}

/** Build the embedding input for a chunk (heading-contextualized). */
export function chunkEmbedText(input: {
  headingPath: string | null;
  text: string;
  kind: "SECTION" | "PARAGRAPH";
}): string {
  return [input.headingPath ?? "", input.text].filter(Boolean).join("\n").slice(0, 3000);
}
