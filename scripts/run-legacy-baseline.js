// scripts/run-legacy-baseline.js
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
const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js') && !f.includes('parity'));

console.log(`Running ${files.length} legacy test files against academy_parity...`);

const results = [];

for (const file of files) {
  const filePath = path.join(testDir, file);
  process.stdout.write(`Running ${file}... `);
  try {
    const output = execSync(
      `node -r ./scripts/dns-preload.js --test --test-force-exit "${filePath}"`,
      {
        env: { ...process.env, MONGODB_URI: parityUri },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 25000
      }
    );
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
    console.log(`PASS (${pass}/${pass + fail})`);
    results.push({ file, pass, fail, total: pass + fail, status: fail === 0 ? 'PASS' : 'FAIL', note: '' });
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 1;
    console.log(`FAIL (${pass}/${pass + fail})`);
    
    let note = 'Assertion failure';
    if (output.includes('requires at least 11')) note = 'Stale fixture: 11-player minimum';
    else if (output.includes('future') || output.includes('maxFutureAllowed')) note = 'Stale fixture: future match/session date';
    else if (output.includes('E11000') || output.includes('duplicate key')) note = 'Stale fixture: duplicate key collision';
    else if (output.includes('Cannot find user') || output.includes('Invalid credentials') || output.includes('No token')) note = 'Missing seed data: seed user missing';
    else if (output.includes('script.js')) note = 'Legacy DOM test: checks script.js';
    
    results.push({ file, pass, fail, total: pass + fail, status: 'FAIL', note });
  }
}

console.log('\n--- LEGACY TEST RESULTS ON ACADEMY_PARITY ---');
console.table(results);
fs.writeFileSync('legacy/legacy_baseline_parity.json', JSON.stringify(results, null, 2));
