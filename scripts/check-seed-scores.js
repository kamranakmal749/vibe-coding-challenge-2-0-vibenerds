// scripts/check-seed-scores.js
// Read-only check script to verify all seeded match scores fall within [0, 20].
const fs = require('fs');
const path = require('path');

const seedPath = path.resolve(__dirname, 'seed.js');
const content = fs.readFileSync(seedPath, 'utf8');
const lines = content.split('\n');

const scoreRegex = /score\s*:\s*(\d+)/;
const foundScores = [];
const violations = [];

lines.forEach((line, idx) => {
  const match = line.match(scoreRegex);
  if (match) {
    const lineNum = idx + 1;
    const value = parseInt(match[1], 10);
    const trimmed = line.trim();
    foundScores.push({ lineNum, value, trimmed });

    if (value < 0 || value > 20) {
      violations.push({ lineNum, value, line: trimmed });
    }
  }
});

console.log('=== Seed Scores Validation Report ===');
console.log(`File: ${seedPath}`);
console.log(`Total score entries found: ${foundScores.length}\n`);

foundScores.forEach(s => {
  const status = (s.value >= 0 && s.value <= 20) ? 'VALID' : 'INVALID';
  console.log(`  Line ${String(s.lineNum).padStart(3)}: [${status}] score = ${String(s.value).padStart(2)} -> ${s.trimmed}`);
});

console.log('\n----------------------------------------');
if (violations.length > 0) {
  console.error(`FAILED: Found ${violations.length} score(s) outside allowed range [0, 20]:`);
  violations.forEach(v => {
    console.error(`  scripts/seed.js:${v.lineNum}: score=${v.value} -> ${v.line}`);
  });
  process.exit(1);
} else {
  console.log(`PASSED: All ${foundScores.length} score entries in scripts/seed.js are within [0, 20].`);
  process.exit(0);
}
