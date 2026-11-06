// scripts/compare-403-message.js
const { execSync } = require('child_process');

// 1. Express under TZ=Asia/Kolkata
const expScript = `
  const d = new Date(2026, 10, 10, 17, 0, 0, 0);
  const unlock = new Date(d.getTime() + 60 * 60 * 1000);
  const unlockStr = unlock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const saveAllLock = \`Scoring is locked until \${unlockStr} (60 minutes after match kickoff)\`;
  const completeLock = \`Cannot complete match before scoring unlock time (\${unlockStr})\`;
  console.log(JSON.stringify({ unlockStr, saveAllLock, completeLock }));
`;

const expRes = JSON.parse(
  execSync(`node -e "${expScript.replace(/\n/g, ' ')}"`, {
    env: { ...process.env, TZ: 'Asia/Kolkata' }
  }).toString()
);

// 2. Next.js under TZ=UTC
const nextScript = `
  const { istDateTime } = require('./client/src/lib/ist');
  const kickoff = istDateTime('2026-11-10', '17:00:00');
  const unlock = new Date(kickoff.getTime() + 60 * 60 * 1000);
  const unlockStr = unlock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const saveAllLock = \`Scoring is locked until \${unlockStr} (60 minutes after match kickoff)\`;
  const completeLock = \`Cannot complete match before scoring unlock time (\${unlockStr})\`;
  console.log(JSON.stringify({ unlockStr, saveAllLock, completeLock }));
`;

const nextRes = JSON.parse(
  execSync(`npx tsx -e "${nextScript.replace(/\n/g, ' ')}"`, {
    env: { ...process.env, TZ: 'UTC' }
  }).toString()
);

console.log('\n=== EXACT 403 SCORING LOCK MESSAGE COMPARISON ===\n');
console.log('--- Express (TZ=Asia/Kolkata) ---');
console.log('Unlock Time String: ', expRes.unlockStr);
console.log('Save-All 403 Message:', expRes.saveAllLock);
console.log('Complete 403 Message:', expRes.completeLock);

console.log('\n--- Next.js (TZ=UTC) ---');
console.log('Unlock Time String: ', nextRes.unlockStr);
console.log('Save-All 403 Message:', nextRes.saveAllLock);
console.log('Complete 403 Message:', nextRes.completeLock);

console.log('\n--- Equality Assertion ---');
console.log('Save-All Message Identical:', expRes.saveAllLock === nextRes.saveAllLock ? 'YES (IDENTICAL)' : 'NO');
console.log('Complete Message Identical:', expRes.completeLock === nextRes.completeLock ? 'YES (IDENTICAL)' : 'NO');
