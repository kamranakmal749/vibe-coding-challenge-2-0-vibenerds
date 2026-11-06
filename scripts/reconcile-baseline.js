// scripts/reconcile-baseline.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert/strict');

const baselineScript = path.resolve(__dirname, './record-legacy-baseline.js');
const baselineDir = path.resolve(__dirname, '../test/baseline');
const run1Path = path.join(baselineDir, 'run1.json');
const run2Path = path.join(baselineDir, 'run2.json');

console.log('=== Step 1: Running baseline recorder Run 1 ===');
execSync(`node "${baselineScript}"`, { stdio: 'inherit' });
fs.copyFileSync(path.join(baselineDir, 'legacy-express.json'), run1Path);

console.log('\n=== Step 2: Running baseline recorder Run 2 ===');
execSync(`node "${baselineScript}"`, { stdio: 'inherit' });
fs.copyFileSync(path.join(baselineDir, 'legacy-express.json'), run2Path);

console.log('\n=== Step 3: Comparing Run 1 vs Run 2 ===');
const run1 = JSON.parse(fs.readFileSync(run1Path, 'utf8'));
const run2 = JSON.parse(fs.readFileSync(run2Path, 'utf8'));

assert.equal(run1.length, run2.length, `Count mismatch: Run 1 has ${run1.length}, Run 2 has ${run2.length}`);

let differences = [];
for (let i = 0; i < run1.length; i++) {
  const item1 = run1[i];
  const item2 = run2[i];
  if (item1.file !== item2.file || item1.test !== item2.test || item1.status !== item2.status) {
    differences.push({ index: i, run1: item1, run2: item2 });
  }
}

if (differences.length === 0) {
  console.log(`✓ PERFECT MATCH: Run 1 and Run 2 are 100% identical (${run1.length}/${run1.length} tests)! Zero flakiness detected.`);
} else {
  console.error(`Found ${differences.length} differences (flaky tests):`, differences);
  process.exit(1);
}
