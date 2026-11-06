// client/src/lib/utils/sport.ts
// Sport names are stored as free text, so matching should be case-insensitive.
export function sportRegex(sport?: string): RegExp {
  const escaped = String(sport || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

module.exports = {
  sportRegex
};

