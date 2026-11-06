// scripts/record-legacy-baseline.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
if (!parityUri.includes('academy_parity')) {
  console.error('Safety check failed: URI does not contain academy_parity');
  process.exit(1);
}

const testDir = path.resolve(__dirname, '../test');
const files = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js') && !f.includes('parity'))
  .sort();

console.log(`Recording per-test baseline for ${files.length} legacy test files against academy_parity...`);

const perTestResults = [];
const fileSummaries = [];

for (const file of files) {
  const filePath = path.join(testDir, file);
  process.stdout.write(`Recording ${file}... `);
  let output = '';
  try {
    output = execSync(
      `node -r ./scripts/dns-preload.js --test --test-force-exit "${filePath}"`,
      {
        env: { ...process.env, MONGODB_URI: parityUri },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 45000
      }
    );
  } catch (err) {
    output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  // Extract individual tests from output
  // Matches lines like:
  // ✔ CHECK 1 — Attendance register... (3128.0308ms)
  // ✖ CHECK 2 — Match on same day... (168.7255ms)
  // or TAP: ok 1 - ... / not ok 1 - ...
  const lines = output.split('\n');
  let filePass = 0;
  let fileFail = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const passMatch = trimmed.match(/^✔\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);
    const failMatch = trimmed.match(/^✖\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);

    if (passMatch) {
      const testName = passMatch[1].trim();
      perTestResults.push({ file, test: testName, status: 'PASS' });
      filePass++;
    } else if (failMatch) {
      // In node --test, failing tests are listed at summary too; ignore "failing tests:" header
      if (trimmed.startsWith('✖ failing tests:')) continue;
      const testName = failMatch[1].trim();
      // Avoid duplicate entry if node --test printed it in execution and in failing tests summary
      const alreadyAdded = perTestResults.some(r => r.file === file && r.test === testName && r.status === 'FAIL');
      if (!alreadyAdded) {
        perTestResults.push({ file, test: testName, status: 'FAIL' });
        fileFail++;
      }
    }
  }

  // If no ✔ / ✖ found (e.g. syntax error or whole suite crashed before running any test)
  if (filePass === 0 && fileFail === 0) {
    perTestResults.push({ file, test: `${file} suite execution`, status: 'FAIL' });
    fileFail++;
  }

  console.log(`done: ${filePass} pass, ${fileFail} fail`);
  fileSummaries.push({ file, pass: filePass, fail: fileFail, total: filePass + fileFail });
}

console.log('\n--- PER-FILE SUMMARY ---');
console.table(fileSummaries);
console.log(`Total per-test items recorded: ${perTestResults.length}`);

const baselineDir = path.resolve(__dirname, '../test/baseline');
if (!fs.existsSync(baselineDir)) {
  fs.mkdirSync(baselineDir, { recursive: true });
}

const outPath = path.join(baselineDir, 'legacy-express.json');
fs.writeFileSync(outPath, JSON.stringify(perTestResults, null, 2), 'utf8');
console.log(`\nSuccessfully wrote ${perTestResults.length} test results to ${outPath}`);
