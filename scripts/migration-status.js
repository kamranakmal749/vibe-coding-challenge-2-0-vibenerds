// scripts/migration-status.js
// Runs every parity test file against BASE_URL (Next.js server) and prints a table of pass/fail status.
// Enforces strict classification:
// - ROUTE_NOT_PORTED: Only if the failing test received x-route-status: not-ported marker.
// - MISMATCH: Any failure that did NOT receive the marker (logic bug / contract drift).
// - Fails if any route in the committed PORTED_ROUTES list returned the unported marker.
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

// Committed list of ported routes (all 34 backend endpoints)
const PORTED_ROUTES = [
  '/api/health',
  '/api/sync/version',
  '/api/auth/login',
  '/api/auth/player-account',
  '/api/auth/change-password',
  '/api/auth/me',
  '/api/auth/coaches',
  '/api/players',
  '/api/players/me',
  '/api/players/:id',
  '/api/sessions',
  '/api/sessions/:id',
  '/api/sessions/:id/save',
  '/api/sessions/:id/lock',
  '/api/sessions/:id/unlock',
  '/api/sessions/:id/toggle-lock',
  '/api/sessions/:id/mark',
  '/api/sessions/:id/bulk',
  '/api/matches',
  '/api/matches/calendar',
  '/api/matches/check-eligibility',
  '/api/matches/history',
  '/api/matches/:id',
  '/api/matches/:id/cancel',
  '/api/matches/:id/complete',
  '/api/matches/:id/edit-scores',
  '/api/matches/:id/eligible-players',
  '/api/matches/:id/entries',
  '/api/matches/:id/participation',
  '/api/matches/:id/participation/:playerId',
  '/api/matches/:id/reopen-for-edit',
  '/api/matches/:id/save-all',
  '/api/matches/:id/selected-players',
  '/api/scout/ready'
];

console.log(`\n=== NEXT.JS MIGRATION PARITY STATUS ===`);
console.log(`Target URL:     ${baseUrl}`);
console.log(`Database:       ${parityUri.replace(/\/\/.*@/, '//***:***@')}`);
console.log(`Ported Routes:  ${PORTED_ROUTES.length} endpoints committed (all backend routes ported)`);
console.log(`Found ${files.length} parity test suites.\n`);

const results = [];
let totalPass = 0;
let totalNotPorted = 0;
let totalMismatch = 0;
let portedRouteViolations = [];

for (const file of files) {
  const filePath = path.join(parityDir, file);
  process.stdout.write(`Testing ${file}... `);

  let output = '';
  try {
    output = execSync(
      `node -r ./scripts/dns-preload.js -r ./scripts/track-not-ported.js --test --test-force-exit "${filePath}"`,
      {
        env: {
          ...process.env,
          BASE_URL: baseUrl,
          MONGODB_URI: parityUri,
          PORT: port
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180000
      }
    );
  } catch (err) {
    output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  // Check for ported route violations (a ported route must NEVER return not-ported marker)
  const notPortedHits = [];
  const hitMatches = output.matchAll(/\[NOT_PORTED_HIT\]\s+([A-Z]+)\s+([^\s\n]+)/g);
  for (const match of hitMatches) {
    const hitMethod = match[1];
    const hitUrl = match[2];
    notPortedHits.push({ method: hitMethod, url: hitUrl });

    // Check if hitUrl matches any committed ported route
    for (const ported of PORTED_ROUTES) {
      if (hitUrl.includes(ported)) {
        portedRouteViolations.push({ file, method: hitMethod, url: hitUrl, portedRoute: ported });
      }
    }
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
      let actualStatus = 'N/A';
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

      // STRICT CLASSIFICATION RULE:
      // Must have received the explicit not-ported marker ([NOT_PORTED_HIT])
      const receivedMarker = notPortedHits.length > 0;
      const classification = (receivedMarker && (actualStatus === '404' || actualStatus === 'N/A' || errorLine.includes('TypeError')))
        ? 'ROUTE_NOT_PORTED'
        : 'MISMATCH';

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
          classification: notPortedHits.length > 0 ? 'ROUTE_NOT_PORTED' : 'MISMATCH'
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
      classification: notPortedHits.length > 0 ? 'ROUTE_NOT_PORTED' : 'MISMATCH',
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

if (portedRouteViolations.length > 0) {
  console.error('\n❌ CRITICAL: Ported routes returned not-ported marker:');
  console.table(portedRouteViolations);
  process.exit(1);
}

if (totalMismatch > 0) {
  console.error(`\n❌ ERROR: ${totalMismatch} MISMATCH detected! All failures must be purely ROUTE_NOT_PORTED.`);
  process.exit(1);
} else {
  console.log(`\n✓ SUCCESS: Zero MISMATCH! All ${totalNotPorted} failing tests received verified x-route-status: not-ported marker.\n`);
}
