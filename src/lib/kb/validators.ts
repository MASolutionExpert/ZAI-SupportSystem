/**
 * Knowledge Base — Zod validation schemas for the /api/admin/kb routes.
 * Persian messages mirror the Phase-2 validators tone. Server-side
 * validation is authoritative; client forms mirror these rules.
 */

import { z } from "zod";
import { db } from "@/lib/db";
import { KbInputError } from "./pipeline";
import { KB_COLLECTION_ACCESS } from "./types";

// ------------------------------------------------------------- departments --

const departmentIdSchema = z.string().min(1, "شناسه دپارتمان نامعتبر است.");

/**
 * Dedupe + validate department ids against the database.
 * Throws KbInputError (Persian message) when any id is unknown.
 */
export async function resolveValidDepartmentIds(rawIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(rawIds));
  if (ids.length === 0) return [];
  const found = await db.department.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new KbInputError("یک یا چند دپارتمان انتخاب‌شده یافت نشد.");
  }
  return ids;
}

// ------------------------------------------------------------- collections --

export const kbCollectionCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "نام مجموعه الزامی است.")
    .max(120, "نام مجموعه حداکثر ۱۲۰ کاراکتر است."),
  description: z
    .string()
    .trim()
    .max(500, "توضیح حداکثر ۵۰۰ کاراکتر است.")
    .optional(),
  access: z.enum(KB_COLLECTION_ACCESS),
  departmentIds: z.array(departmentIdSchema).max(100, "حداکثر ۱۰۰ دپارتمان مجاز است.").optional(),
});

export const kbCollectionUpdateSchema = z.object({
  name: z.string().trim().min(1, "نام مجموعه الزامی است.").max(120, "نام مجموعه حداکثر ۱۲۰ کاراکتر است.").optional(),
  description: z.string().trim().max(500, "توضیح حداکثر ۵۰۰ کاراکتر است.").optional(),
  access: z.enum(KB_COLLECTION_ACCESS).optional(),
  isActive: z.boolean().optional(),
});

export const kbCollectionDepartmentsSchema = z.object({
  departmentIds: z.array(departmentIdSchema).max(100, "حداکثر ۱۰۰ دپارتمان مجاز است."),
});

// --------------------------------------------------------------- documents --

export const kbDocumentPatchSchema = z.object({
  title: z.string().trim().min(1, "عنوان سند الزامی است.").max(200, "عنوان سند حداکثر ۲۰۰ کاراکتر است.").optional(),
  collectionId: departmentIdSchema.optional(),
  isActive: z.boolean().optional(),
});

// -------------------------------------------------------------------- Q&A --

export const kbQaCreateSchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "پرسش باید حداقل ۳ کاراکتر باشد.")
    .max(300, "پرسش حداکثر ۳۰۰ کاراکتر است."),
  officialAnswer: z
    .string()
    .trim()
    .min(1, "پاسخ رسمی الزامی است.")
    .max(8000, "پاسخ رسمی حداکثر ۸۰۰۰ کاراکتر است."),
  category: z.string().trim().max(80, "دسته‌بندی حداکثر ۸۰ کاراکتر است.").optional(),
  keywords: z
    .array(z.string().trim().min(1, "کلیدواژه نمی‌تواند خالی باشد.").max(40, "هر کلیدواژه حداکثر ۴۰ کاراکتر است."))
    .max(12, "حداکثر ۱۲ کلیدواژه مجاز است.")
    .optional(),
  alternates: z
    .array(
      z
        .string()
        .trim()
        .min(3, "هر پرسش جایگزین باید حداقل ۳ کاراکتر باشد.")
        .max(300, "هر پرسش جایگزین حداکثر ۳۰۰ کاراکتر است.")
    )
    .max(10, "حداکثر ۱۰ پرسش جایگزین مجاز است.")
    .optional(),
  departmentIds: z
    .array(departmentIdSchema)
    .min(1, "انتخاب حداقل یک دپارتمان الزامی است.")
    .max(20, "حداکثر ۲۰ دپارتمان مجاز است."),
  status: z.enum(["DRAFT", "PUBLISHED"]).default("DRAFT"),
});

export const kbQaUpdateSchema = z.object({
  question: z.string().trim().min(3, "پرسش باید حداقل ۳ کاراکتر باشد.").max(300, "پرسش حداکثر ۳۰۰ کاراکتر است.").optional(),
  officialAnswer: z.string().trim().min(1, "پاسخ رسمی الزامی است.").max(8000, "پاسخ رسمی حداکثر ۸۰۰۰ کاراکتر است.").optional(),
  category: z.string().trim().max(80, "دسته‌بندی حداکثر ۸۰ کاراکتر است.").optional(),
  keywords: z
    .array(z.string().trim().min(1, "کلیدواژه نمی‌تواند خالی باشد.").max(40, "هر کلیدواژه حداکثر ۴۰ کاراکتر است."))
    .max(12, "حداکثر ۱۲ کلیدواژه مجاز است.")
    .optional(),
  alternates: z
    .array(
      z
        .string()
        .trim()
        .min(3, "هر پرسش جایگزین باید حداقل ۳ کاراکتر باشد.")
        .max(300, "هر پرسش جایگزین حداکثر ۳۰۰ کاراکتر است.")
    )
    .max(10, "حداکثر ۱۰ پرسش جایگزین مجاز است.")
    .optional(),
});

export const kbQaDepartmentsSchema = z.object({
  departmentIds: z
    .array(departmentIdSchema)
    .min(1, "انتخاب حداقل یک دپارتمان الزامی است.")
    .max(20, "حداکثر ۲۰ دپارتمان مجاز است."),
});

export const kbQaPublishSchema = z.object({
  published: z.boolean(),
});
