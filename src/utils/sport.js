// src/utils/sport.js
// Sport names are stored as free text, so matching should be case-insensitive.
function sportRegex(sport) {
  const escaped = String(sport || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

module.exports = { sportRegex };
