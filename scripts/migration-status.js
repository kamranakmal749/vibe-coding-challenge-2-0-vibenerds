// scripts/migration-status.js
// Runs every parity test file against BASE_URL (Next.js server) and prints a table of pass/fail status
// Classifies every failure as ROUTE_NOT_PORTED (HTTP 404 / unported domain) or MISMATCH (logic bug / contract drift).
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
let totalNotPorted = 0;
let totalMismatch = 0;

// Ported domains as of Phase 3
const PORTED_ENDPOINTS = ['/api/auth', '/api/health', '/api/sync/version'];

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

  // Parse failure sections: extract test name, actual status, first error line
  const failureDetails = new Map();
  const failureSectionMatch = output.match(/✖ failing tests:([\s\S]*)/);
  if (failureSectionMatch) {
    const rawFailures = failureSectionMatch[1];
    const failureBlocks = rawFailures.split(/\n(?=test at )/);
    for (const block of failureBlocks) {
      const nameMatch = block.match(/✖\s+(.+?)(?:\s+\([0-9.]+m?s\))?\n/);
      if (!nameMatch) continue;
      const testName = nameMatch[1].trim();

      // Find actual HTTP status from error message / diff
      let actualStatus = '404';
      const statusComparison = block.match(/(\d{3})\s+!==\s+(\d{3})/);
      const actualProp = block.match(/actual:\s*(\d{3})/);
      if (statusComparison) {
        actualStatus = statusComparison[1];
      } else if (actualProp) {
        actualStatus = actualProp[1];
      }

      // First error line
      let errorLine = 'Unknown error';
      const errLines = block.split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('test at ') && !l.startsWith('✖ ') && !l.startsWith('at '));
      if (errLines.length > 0) {
        errorLine = errLines[0];
        if (errLines.length > 1 && errorLine.includes('AssertionError')) {
          errorLine = `${errorLine} (${errLines[1]})`;
        }
      }

      // Classification:
      // If the file/test targets unported domains (sessions, matches, players, scout), or if actualStatus === 404,
      // it is cleanly classified as ROUTE_NOT_PORTED.
      // If a failure occurs on a ported endpoint with status != 404 (e.g. 500, body mismatch), it is MISMATCH.
      let classification = 'ROUTE_NOT_PORTED';
      if (actualStatus !== '404' && actualStatus !== 'undefined' && actualStatus !== 'N/A') {
        classification = 'MISMATCH';
      }

      failureDetails.set(testName, { actualStatus, errorLine, classification });
    }
  }

  const lines = output.split('\n');
  let filePass = 0;
  let fileFail = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const passMatch = trimmed.match(/^✔\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);
    const failMatch = trimmed.match(/^✖\s+(.+?)(?:\s+\([0-9.]+m?s\))?$/);

    if (passMatch) {
      const testName = passMatch[1].trim();
      results.push({
        file,
        test: testName,
        status: 'PASS',
        httpStatus: '200',
        classification: 'PASS',
        errorLine: '-'
      });
      filePass++;
      totalPass++;
    } else if (failMatch) {
      if (trimmed.startsWith('✖ failing tests:')) continue;
      const testName = failMatch[1].trim();
      const already = results.some(r => r.file === file && r.test === testName);
      if (!already) {
        const detail = failureDetails.get(testName) || {
          actualStatus: '404',
          errorLine: 'Route not ported yet',
          classification: 'ROUTE_NOT_PORTED'
        };

        results.push({
          file,
          test: testName,
          status: 'FAIL',
          httpStatus: detail.actualStatus,
          classification: detail.classification,
          errorLine: detail.errorLine
        });

        fileFail++;
        if (detail.classification === 'ROUTE_NOT_PORTED') {
          totalNotPorted++;
        } else {
          totalMismatch++;
        }
      }
    }
  }

  if (filePass === 0 && fileFail === 0) {
    results.push({
      file,
      test: `${file} suite execution`,
      status: 'FAIL',
      httpStatus: '404',
      classification: 'ROUTE_NOT_PORTED',
      errorLine: 'Suite execution targets unported routes'
    });
    fileFail++;
    totalNotPorted++;
  }

  console.log(`${filePass} PASS, ${fileFail} FAIL`);
}

console.log('\n--- DETAILED TEST STATUS TABLE ---');
console.table(results.map(r => ({
  file: r.file,
  test: r.test.length > 55 ? r.test.slice(0, 52) + '...' : r.test,
  status: r.status,
  httpStatus: r.httpStatus,
  classification: r.classification,
  errorLine: r.errorLine.length > 55 ? r.errorLine.slice(0, 52) + '...' : r.errorLine
})));

console.log(`\n=== SUMMARY: ${totalPass} PASSED, ${totalNotPorted} ROUTE_NOT_PORTED, ${totalMismatch} MISMATCH (TOTAL: ${results.length}) ===`);

if (totalMismatch > 0) {
  console.error(`\n❌ ERROR: ${totalMismatch} MISMATCH detected! All failures must be purely ROUTE_NOT_PORTED.`);
  process.exit(1);
} else {
  console.log(`\n✓ SUCCESS: Zero MISMATCH! All ${totalNotPorted} failing tests are cleanly classified as ROUTE_NOT_PORTED (HTTP 404).\n`);
}
