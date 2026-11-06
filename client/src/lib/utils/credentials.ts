// client/src/lib/credentials.ts
import crypto from 'crypto';

/**
 * Generate a cryptographically secure, readable temporary password.
 * Format: 10 chars containing uppercase, lowercase, numbers, and symbols.
 * Excludes ambiguous characters (0, O, 1, l, I).
 */
export function generateSecureTemporaryPassword(length: number = 10): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';

  // Ensure at least one of each required character category
  const chars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
    symbols[crypto.randomInt(0, symbols.length)]
  ];

  const pool = upper + lower + digits + symbols;
  for (let i = chars.length; i < length; i++) {
    chars.push(pool[crypto.randomInt(0, pool.length)]);
  }

  // Shuffle using Fisher-Yates
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join('');
}

