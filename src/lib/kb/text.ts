/**
 * Knowledge Base — Persian-aware text utilities (normalize / tokenize / score).
 *
 * Deterministic keyword baseline for retrieval (no provider calls): the same
 * normalization MUST be applied to both indexed corpora and queries so scores
 * are comparable. Normalization is idempotent.
 */

// ------------------------------------------------------------- normalization

const ARABIC_CHAR_MAP: Record<string, string> = {
  "\u064A": "\u06CC", // Arabic yeh ي → Persian yeh ی
  "\u0643": "\u06A9", // Arabic kaf ك → Persian kaf ک
  "\u0624": "\u0648", // ؤ → و
  "\u0625": "\u0627", // إ → ا
  "\u0623": "\u0627", // أ → ا
  "\u0671": "\u0627", // ٱ → ا
  "\u0629": "\u0647", // ة → ه
};

/** Arabic diacritics (tashkeel) + tatweel — meaningless for search. */
const DIACRITICS_AND_TATWEEL = /[\u064B-\u065F\u0670\u0640]/g;

/** Directional marks / ZWNJ — stripped entirely (search-space separator). */
const INVISIBLE_MARKS = /[\u200C\u200D\u200E\u200F\uFEFF]/g;

/** Normalize Persian/Arabic text into its canonical search form. */
export function normalizePersian(raw: string): string {
  // NFKC (not just NFC): legacy Persian documents (Word/PDF) frequently
  // store glyphs as Arabic presentation forms (U+FE70–FEFF); compatibility
  // decomposition collapses them to their base letters first, so the
  // explicit Arabic→Persian mappings below always see canonical input.
  let text = raw.normalize("NFKC").toLowerCase();

  let mapped = "";
  for (const ch of text) {
    mapped += ARABIC_CHAR_MAP[ch] ?? ch;
  }
  text = mapped;

  text = text.replace(DIACRITICS_AND_TATWEEL, "");
  text = text.replace(INVISIBLE_MARKS, "");
  // Collapse all whitespace runs (incl. newlines) to single spaces.
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

// ----------------------------------------------------------------- stopwords

/**
 * Common Persian stopwords (normalized + raw spellings). Built from a raw
 * list so that words containing ZWNJ (e.g. "می‌شود") still match after
 * normalization strips the ZWNJ.
 */
const RAW_STOPWORDS_FA: readonly string[] = [
  "و", "در", "به", "از", "که", "این", "را", "با", "است", "برای",
  "آن", "یک", "های", "ها", "می", "شد", "شده", "کند", "کنید", "دارد",
  "دارند", "یا", "هم", "تا", "بر", "اگر", "اما", "چه", "چگونه", "چطور",
  "می‌شود", "بود", "هست", "شدن", "کردن", "خود", "شما", "ما", "ایا", "آیا",
  "هر", "نیز", "پس", "دیگر", "بین", "روی", "درباره", "طبق", "مثل", "باید",
  "نشده", "نکند",
  // sensible extensions
  "شود", "بودن", "کرد", "کنم", "کنند", "کنیم", "میان", "هیچ", "چیز",
  "وقتی", "هنگامی", "مورد", "صورت", "ممکن", "لذا", "بنابراین", "البته",
  "بله", "خیر", "نه",
];

const STOPWORDS_FA: ReadonlySet<string> = new Set([
  ...RAW_STOPWORDS_FA,
  ...RAW_STOPWORDS_FA.map((word) => normalizePersian(word)),
]);

// ----------------------------------------------------------------- tokenize

const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;

/**
 * Tokenize arbitrary text for keyword matching: normalize, split on any
 * non-letter/non-number, drop 1-char tokens and stopwords. Duplicates are
 * kept — callers dedupe when needed.
 */
export function tokenize(text: string): string[] {
  const normalized = normalizePersian(text);
  if (!normalized) return [];
  const tokens: string[] = [];
  for (const token of normalized.split(TOKEN_SPLIT)) {
    if (token.length < 2) continue;
    if (STOPWORDS_FA.has(token)) continue;
    tokens.push(token);
  }
  return tokens;
}

// ------------------------------------------------------------------ scoring

export type TextScore = {
  /** distinct query tokens found in the corpus */
  matchedTokens: number;
  /** total occurrence count across all matched tokens */
  occurrences: number;
};

/**
 * Count occurrences of each distinct query token inside the (already
 * normalized) corpus via indexOf scanning — no regex, predictable cost.
 */
export function scoreText(
  queryTokens: string[],
  normalizedCorpus: string
): TextScore {
  if (queryTokens.length === 0 || !normalizedCorpus) {
    return { matchedTokens: 0, occurrences: 0 };
  }

  let matchedTokens = 0;
  let occurrences = 0;
  for (const token of new Set(queryTokens)) {
    let count = 0;
    let position = normalizedCorpus.indexOf(token);
    while (position !== -1) {
      count += 1;
      position = normalizedCorpus.indexOf(token, position + token.length);
    }
    if (count > 0) {
      matchedTokens += 1;
      occurrences += count;
    }
  }
  return { matchedTokens, occurrences };
}

/**
 * Title boost: share of distinct query tokens present in the (normalized)
 * title. Returns 0..1.
 */
export function titleBoost(
  queryTokens: string[],
  normalizedTitle: string
): number {
  const distinct = new Set(queryTokens);
  if (distinct.size === 0 || !normalizedTitle) return 0;
  let matched = 0;
  for (const token of distinct) {
    if (normalizedTitle.includes(token)) matched += 1;
  }
  return matched / distinct.size;
}
