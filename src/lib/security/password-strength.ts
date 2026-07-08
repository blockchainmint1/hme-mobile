/**
 * Lightweight wallet-password strength check with no external dependency.
 *
 * This is the LAST line of defence for the encrypted seed envelope: the
 * ciphertext lives in localStorage, so an attacker who copies it off a
 * compromised device can brute-force it offline. A short or common password
 * defeats the KDF no matter how many iterations it runs. We therefore reject
 * weak passwords at set time instead of only enforcing a length floor.
 *
 * Scoring is deliberately conservative and transparent (character-class
 * variety + length + a common-password blocklist). If you later add a real
 * estimator (zxcvbn), keep this module's signature so callers don't change.
 */

const MIN_LENGTH = 10;

// Small blocklist of the most abused passwords / obvious wallet strings.
// Not exhaustive — a server-side check against a leaked-password set (k-anon
// HIBP range API) is the recommended upgrade (see SECURITY-AUDIT.md, M2).
const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwerty123",
  "letmein123",
  "iloveyou1",
  "admin1234",
  "welcome123",
  "changeme1",
  "seedphrase",
  "walletpass",
  "cryptowallet",
  "bitcoin123",
  "honestmoney",
  "texitcoin1",
]);

export type PasswordVerdict = {
  ok: boolean;
  /** 0 (unusable) .. 4 (strong) */
  score: 0 | 1 | 2 | 3 | 4;
  label: "too weak" | "weak" | "fair" | "good" | "strong";
  /** Actionable message when not ok; empty when ok. */
  message: string;
};

function classes(pw: string): number {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}

/** Count distinct characters — cheap proxy for "not aaaate/repeated". */
function distinct(pw: string): number {
  return new Set(pw.split("")).size;
}

export function assessPassword(pwRaw: string): PasswordVerdict {
  const pw = pwRaw ?? "";
  if (pw.length < MIN_LENGTH) {
    return {
      ok: false,
      score: 0,
      label: "too weak",
      message: `Use at least ${MIN_LENGTH} characters. A short passphrase of a few random words is easiest to remember and hard to crack.`,
    };
  }
  if (COMMON.has(pw.toLowerCase())) {
    return {
      ok: false,
      score: 0,
      label: "too weak",
      message:
        "That password is on the list of most-guessed passwords. Pick something unique to you.",
    };
  }
  if (distinct(pw) < 5) {
    return {
      ok: false,
      score: 1,
      label: "weak",
      message: "Too repetitive. Mix in more different characters or use several unrelated words.",
    };
  }

  // Score: length tiers + character-class variety.
  const cls = classes(pw);
  let score = 1;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (cls >= 3) score++;
  score = Math.min(4, score) as 1 | 2 | 3 | 4;

  // A 3+ word passphrase (spaces) is strong even with one class.
  const wordish = pw
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (wordish.length >= 4) score = 4;

  const label = (["too weak", "weak", "fair", "good", "strong"] as const)[score];

  // Require at least "fair": length >= 10 and either 2+ classes or a
  // multi-word passphrase.
  const passphrase = wordish.length >= 3;
  const ok = score >= 2 && (cls >= 2 || passphrase);
  return {
    ok,
    score: score as 0 | 1 | 2 | 3 | 4,
    label,
    message: ok ? "" : "Add another word, or mix in a number, capital, or symbol.",
  };
}
