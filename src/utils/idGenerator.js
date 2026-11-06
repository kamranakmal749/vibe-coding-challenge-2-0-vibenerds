// src/utils/idGenerator.js
const Counter = require('../models/Counter');

/**
 * Safely generate an atomic, unique playerId in the format md<YY><sequence>
 * @param {Date|string} registeredOn 
 * @returns {Promise<string>} e.g. "md260001"
 */
async function generatePlayerId(registeredOn = new Date()) {
  const regDate = new Date(registeredOn);
  const fullYear = isNaN(regDate.getTime()) ? new Date().getFullYear() : regDate.getFullYear();
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

module.exports = {
  generatePlayerId
};

