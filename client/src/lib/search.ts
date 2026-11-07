// client/src/lib/search.ts

export interface SearchablePlayer {
  _id?: string;
  name?: string;
  username?: string;
  sport?: string;
  age?: number | string;
  [key: string]: any;
}

/**
 * Pure filter function for players:
 * - Case-insensitive
 * - Trims whitespace
 * - Matches player name or username
 * - If query is empty / whitespace-only / null / undefined, returns all players untouched
 */
export function filterPlayersByQuery<T extends SearchablePlayer>(
  players: T[],
  query: string | null | undefined
): T[] {
  if (!Array.isArray(players)) return [];
  const q = (query || '').trim().toLowerCase();
  if (!q) return [...players];
  return players.filter((p) => {
    if (!p) return false;
    const name = (p.name || '').trim().toLowerCase();
    const username = (p.username || '').trim().toLowerCase();
    return name.includes(q) || username.includes(q);
  });
}

