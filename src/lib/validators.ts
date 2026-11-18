import { z } from "zod";
import { DEPARTMENT_ICON_KEYS } from "@/lib/department-icons";
import { ALL_PERMISSION_KEYS } from "@/lib/rbac/permissions";

/**
 * Shared Zod schemas for Phase 2 management endpoints.
 * Server-side validation is authoritative; client forms mirror these rules.
 */

// ---------------------------------------------------------------- identity --

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "نام کاربری باید حداقل ۳ کاراکتر باشد.")
  .max(32, "نام کاربری حداکثر ۳۲ کاراکتر است.")
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/, "نام کاربری فقط می‌تواند شامل حروف لاتین کوچک، عدد، نقطه، خط تیره و زیرخط باشد.");

export const nameSchema = z
  .string()
  .trim()
  .min(2, "نام باید حداقل ۲ کاراکتر باشد.")
  .max(60, "نام حداکثر ۶۰ کاراکتر است.");

export const optionalEmailSchema = z
  .union([z.literal(""), z.string().trim().email("ایمیل معتبر نیست.").max(120)])
  .transform((v) => (v === "" ? null : v))
  .optional()
  .nullable();

// ------------------------------------------------------------- departments --

const iconKeys = DEPARTMENT_ICON_KEYS;

export const departmentCreateSchema = z.object({
  name: nameSchema,
  description: z.string().trim().max(300, "توضیح حداکثر ۳۰۰ کاراکتر است.").optional().nullable(),
  iconKey: z.string().refine((k) => iconKeys.includes(k), "آیکن انتخاب‌شده مجاز نیست.").default("MessageCircle"),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  aiEnabled: z.boolean().default(false),
  welcomeMessage: z.string().trim().max(200, "پیام خوش‌آمد حداکثر ۲۰۰ کاراکتر است.").optional().nullable(),
});

export const departmentUpdateSchema = departmentCreateSchema.partial();

export const departmentReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1, "فهرست ترتیب خالی است.").max(200),
});

// ------------------------------------------------------------------- users --

export const userCreateSchema = z.object({
  username: usernameSchema,
  name: nameSchema,
  email: optionalEmailSchema,
  password: z.string().min(1, "رمز عبور الزامی است."),
  roleKey: z.string().min(1, "نقش الزامی است."),
});

export const userUpdateSchema = z.object({
  name: nameSchema.optional(),
  email: optionalEmailSchema,
  roleKey: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  isAvailable: z.boolean().optional(),
});

export const membershipSchema = z.object({
  departmentId: z.string().min(1),
  isManager: z.boolean().default(false),
});

export const membershipsPutSchema = z.object({
  memberships: z.array(membershipSchema).max(100),
});

export const overridesPutSchema = z.object({
  overrides: z
    .array(
      z.object({
        permissionKey: z.string().refine((k) => ALL_PERMISSION_KEYS.includes(k), "مجوز ناشناس."),
        effect: z.enum(["ALLOW", "DENY"]),
        note: z.string().trim().max(140).optional().nullable(),
      })
    )
    .max(ALL_PERMISSION_KEYS.length),
});

export const resetPasswordSchema = z
  .object({
    generate: z.boolean().optional(),
    password: z.string().optional(),
  })
  .refine((v) => v.generate === true || (v.password?.length ?? 0) > 0, {
    message: "رمز عبور جدید الزامی است.",
    path: ["password"],
  });

// ------------------------------------------------------------------- roles --

export const roleKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "کلید نقش باید حداقل ۳ کاراکتر باشد.")
  .max(40, "کلید نقش حداکثر ۴۰ کاراکتر است.")
  .regex(/^[A-Z][A-Z0-9_]*$/, "کلید نقش فقط حروف لاتین بزرگ، عدد و زیرخط (شروع با حرف).");

export const roleCreateSchema = z.object({
  key: roleKeySchema,
  name: nameSchema,
  description: z.string().trim().max(200).optional().nullable(),
});

export const roleUpdateSchema = z.object({
  name: nameSchema.optional(),
  description: z.string().trim().max(200).optional().nullable(),
});

export const roleBindingsPutSchema = z.object({
  permissionKeys: z.array(z.string().refine((k) => ALL_PERMISSION_KEYS.includes(k), "مجوز ناشناس.")),
});

export type MembershipInput = z.infer<typeof membershipSchema>;
export type OverrideInput = z.infer<typeof overridesPutSchema>["overrides"][number];
