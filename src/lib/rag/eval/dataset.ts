import "server-only";

/**
 * RAG Engine — acceptance evaluation dataset (task §10 / §13).
 *
 * Cases map 1:1 onto the task's acceptance criteria. Gold evidence is declared
 * by human-readable fragments (document title / Q&A question substring) and
 * resolved against the CURRENT database content at run time — the dataset
 * stays valid across re-seeding. Fixture-dependent scenarios (conflict,
 * superseded, department isolation, reindex integrity) are provisioned and
 * cleaned up by the runner itself.
 */

export type EvalCaseKind =
  | "answerable"
  | "unanswerable"
  | "exact-term"
  | "paraphrase"
  | "multi-doc"
  | "conflict"
  | "superseded"
  | "dept-scoped"
  | "reindex-integrity";

export type GoldRef =
  | { kind: "QA"; questionIncludes: string }
  | { kind: "DOC"; titleIncludes: string };

export type EvalCase = {
  id: string;
  kind: EvalCaseKind;
  /** Demo department key: training | membership | finance | tech */
  department: "training" | "membership" | "finance" | "tech";
  question: string;
  expect: {
    status: "ANSWERED" | "CLARIFY" | "ABSTAIN";
    gold?: GoldRef[];
    mustCite?: boolean;
    mustContainAny?: string[];
    expectConflict?: boolean;
    expectSuperseded?: boolean;
  };
};

export const EVAL_DATASET_ID = "acceptance-v1";

export const EVAL_CASES: EvalCase[] = [
  // 1 — paraphrased wording still finds the correct evidence
  {
    id: "ac1-paraphrase-qa",
    kind: "paraphrase",
    department: "training",
    question: "چه روزهایی می‌تونم درباره کلاس‌ها باهاتون تماس بگیرم؟",
    expect: {
      status: "ANSWERED",
      gold: [{ kind: "QA", questionIncludes: "ساعات کاری دپارتمان آموزش" }],
      mustCite: true,
      mustContainAny: ["شنبه"],
    },
  },
  // 2 — exact regulation number / identifier (document text below carries
  // «بند ۱۲۳» in the runner's fixture document)
  {
    id: "ac2-exact-identifier",
    kind: "exact-term",
    department: "membership",
    question: "طبق بند ۱۲۳ چه مدارکی برای عضویت لازم است؟",
    expect: {
      status: "ANSWERED",
      gold: [{ kind: "DOC", titleIncludes: "آیین‌نامه عضویت (ارزیابی)" }],
      mustCite: true,
      mustContainAny: ["مدرک", "فرم", "کارت ملی", "عکس"],
    },
  },
  // 3 — multi-section composition (regulation + procedure must combine)
  {
    id: "ac3-multi-doc",
    kind: "multi-doc",
    department: "membership",
    question: "تمدید عضویت از چند روز قبل فعال می‌شود و اگر عضویت بیش از ۳۰ روز منقضی شود چه باید کرد؟",
    expect: {
      status: "ANSWERED",
      gold: [{ kind: "DOC", titleIncludes: "راهنمای عضویت سازمان" }],
      mustCite: true,
      mustContainAny: ["۱۰", "۳۰", "از نو"],
    },
  },
  // 4+5 — insufficient evidence: the engine must abstain, not invent
  {
    id: "ac5-unanswerable",
    kind: "unanswerable",
    department: "training",
    question: "قیمت بلیط هواپیما از تهران به استانبول چند تومان است؟",
    expect: { status: "ABSTAIN" },
  },
  // 6 — conflicting documents: detected, never silently resolved
  {
    id: "ac6-conflict-detection",
    kind: "conflict",
    department: "membership",
    question: "هزینه صدور کارت عضویت چقدر است؟",
    expect: {
      status: "ABSTAIN",
      gold: [{ kind: "DOC", titleIncludes: "مصوبه جاری هزینه کارت" }],
      expectConflict: true,
    },
  },
  // 7 — superseded/expired document must never act as authoritative source
  {
    id: "ac7-superseded-authority",
    kind: "superseded",
    department: "membership",
    question: "تخفیف هزینه صدور کارت برای اعضای طلایی چقدر است؟",
    expect: {
      status: "ABSTAIN",
      gold: [{ kind: "DOC", titleIncludes: "مصوبه منقضی تخفیف کارت" }],
      expectSuperseded: true,
    },
  },
  // 8 — department isolation: restricted knowledge must never surface
  {
    id: "ac8-dept-isolation",
    kind: "dept-scoped",
    department: "training",
    question: "ضریب محرمانه محاسبه پورسانت فروش چیست؟",
    expect: { status: "ABSTAIN" },
  },
];
