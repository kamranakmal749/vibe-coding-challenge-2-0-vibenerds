// client/src/lib/utils/idGenerator.ts
import { istYear } from '../ist';
const Counter = require('../models/Counter');

/**
 * Safely generate an atomic, unique playerId in the format md<YY><sequence>
 * @param {Date|string} registeredOn 
 * @returns {Promise<string>} e.g. "md260001"
 */
export async function generatePlayerId(registeredOn: Date | string = new Date()): Promise<string> {
  const regDate = new Date(registeredOn);
  const fullYear = isNaN(regDate.getTime()) ? istYear() : istYear(regDate);
  const yy = String(fullYear).slice(-2);
  const key = `player_${yy}`;

  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );

  const seqStr = String(counter.seq).padStart(4, '0');
  return `md${yy}${seqStr}`;
}

