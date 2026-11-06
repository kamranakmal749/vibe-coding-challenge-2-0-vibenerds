// scripts/diff-legacy-baseline.js
// Compares per-test pass/fail status against the frozen Express baseline in test/baseline/legacy-express.json
const fs = require('fs');
const path = require('path');

const baselinePath = path.resolve(__dirname, '../test/baseline/legacy-express.json');
if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline file not found at ${baselinePath}`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

/**
 * Compares current run results against baseline
 * @param {Array<{ file: string, test: string, status: 'PASS' | 'FAIL' }>} currentResults
 */
function diffBaseline(currentResults) {
  const baselineMap = new Map(baseline.map(b => [`${b.file}:::${b.test}`, b.status]));
  const currentMap = new Map(currentResults.map(c => [`${c.file}:::${c.test}`, c.status]));

  const regressions = [];
  const improvements = [];
  const identical = [];
  const missingFromCurrent = [];

  for (const [key, baseStatus] of baselineMap) {
    const currStatus = currentMap.get(key);
    if (!currStatus) {
      missingFromCurrent.push({ key, baseStatus });
      continue;
    }

    if (baseStatus === currStatus) {
      identical.push({ key, status: currStatus });
    } else if (baseStatus === 'PASS' && currStatus === 'FAIL') {
      regressions.push({ key, baseStatus, currStatus });
    } else if (baseStatus === 'FAIL' && currStatus === 'PASS') {
      improvements.push({ key, baseStatus, currStatus });
    }
  }

  return {
    totalBaseline: baseline.length,
    totalCurrent: currentResults.length,
    identicalCount: identical.length,
    regressions,
    improvements,
    missingFromCurrent,
    isIdentical: regressions.length === 0 && identical.length === baseline.length
  };
}

module.exports = { diffBaseline };

if (require.main === module) {
  console.log(`Loaded Express legacy baseline with ${baseline.length} tests.`);
  console.log('To run a comparison, invoke diffBaseline(currentResults) or run with current test output.');
}
