import bcrypt from "bcryptjs";

/**
 * Password hashing — bcrypt with cost 12.
 * Established library; hashing parameters are part of the resulting hash.
 */

const BCRYPT_COST = 12;

/** Password policy: >= 12 chars with lower + upper + digit. */
const PASSWORD_POLICY = {
  minLength: 12,
  regex: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
};

export function validatePasswordStrength(password: string): {
  ok: boolean;
  reason?: string;
} {
  if (password.length < PASSWORD_POLICY.minLength) {
    return { ok: false, reason: "حداقل طول رمز عبور ۱۲ کاراکتر است." };
  }
  if (!PASSWORD_POLICY.regex.test(password)) {
    return {
      ok: false,
      reason: "رمز عبور باید شامل حروف کوچک و بزرگ لاتین و عدد باشد.",
    };
  }
  return { ok: true };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Constant-time-ish dummy verification target used when the account does not
 * exist, so login timing does not reveal whether a username exists.
 */
const DUMMY_HASH = bcrypt.hashSync("timing-equalization-dummy", BCRYPT_COST);

export async function verifyDummyPassword(): Promise<void> {
  await bcrypt.compare("invalid-input-value", DUMMY_HASH);
}
