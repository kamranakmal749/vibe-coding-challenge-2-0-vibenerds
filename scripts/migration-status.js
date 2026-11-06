// scripts/migration-status.js
// Runs every parity test file against BASE_URL (Next.js server) and prints a table of pass/fail status
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const port = process.env.PORT || '3000';
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');

const parityDir = path.resolve(__dirname, '../test/parity');
const files = fs.readdirSync(parityDir)
  .filter(f => f.endsWith('.parity.test.js'))
  .sort();

console.log(`\n=== NEXT.JS MIGRATION PARITY STATUS ===`);
console.log(`Target URL: ${baseUrl}`);
console.log(`Database:   ${parityUri.replace(/\/\/.*@/, '//***:***@')}`);
console.log(`Found ${files.length} parity test suites.\n`);

const results = [];
let totalPass = 0;
let totalFail = 0;

for (const file of files) {
  const filePath = path.join(parityDir, file);
  process.stdout.write(`Testing ${file}... `);

  let output = '';
  try {
    output = execSync(
      `node -r ./scripts/dns-preload.js --test --test-force-exit "${filePath}"`,
      {
        env: {
          ...process.env,
          BASE_URL: baseUrl,
          MONGODB_URI: parityUri,
          PORT: port
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 90000
      }
    );
  } catch (err) {
    output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const lines = output.split('\n');
  let filePass = 0;
  let fileFail = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const passMatch = trimmed.match(/^✔\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);
    const failMatch = trimmed.match(/^✖\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);

    if (passMatch) {
      results.push({ file, test: passMatch[1].trim(), status: 'PASS' });
      filePass++;
      totalPass++;
    } else if (failMatch) {
      if (trimmed.startsWith('✖ failing tests:')) continue;
      const testName = failMatch[1].trim();
      const already = results.some(r => r.file === file && r.test === testName && r.status === 'FAIL');
      if (!already) {
        results.push({ file, test: testName, status: 'FAIL' });
        fileFail++;
        totalFail++;
      }
    }
  }

  if (filePass === 0 && fileFail === 0) {
    results.push({ file, test: `${file} suite execution`, status: 'FAIL' });
    fileFail++;
    totalFail++;
  }

  console.log(`${filePass} PASS, ${fileFail} FAIL`);
}

console.log('\n--- DETAILED TEST STATUS TABLE ---');
console.table(results);

console.log(`\n=== SUMMARY: ${totalPass} PASSED, ${totalFail} FAILED (TOTAL: ${totalPass + totalFail}) ===\n`);
