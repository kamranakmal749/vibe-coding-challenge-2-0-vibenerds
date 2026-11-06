// scripts/run-parity-suite.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
if (!parityUri.includes('academy_parity')) {
  console.error('Safety check failed: URI does not contain academy_parity');
  process.exit(1);
}

const parityDir = path.resolve(__dirname, '../test/parity');
const files = fs.readdirSync(parityDir).filter(f => f.endsWith('.parity.test.js'));

console.log(`\n=== Running Full Parity Suite (${files.length} files) ===`);

let totalPass = 0;
let totalFail = 0;
const perFile = [];

for (const file of files) {
  const filePath = path.join(parityDir, file);
  process.stdout.write(`Running ${file}... `);
  try {
    const output = execSync(
      `node -r ./scripts/dns-preload.js --test --test-force-exit "${filePath}"`,
      {
        env: { ...process.env, MONGODB_URI: parityUri },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 240000
      }
    );
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 0;
    totalPass += pass;
    totalFail += fail;
    console.log(`PASS (${pass}/${pass + fail})`);
    perFile.push({ file, pass, fail, status: 'PASS' });
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    const passMatch = output.match(/ℹ pass (\d+)/);
    const failMatch = output.match(/ℹ fail (\d+)/);
    const pass = passMatch ? parseInt(passMatch[1], 10) : 0;
    const fail = failMatch ? parseInt(failMatch[1], 10) : 1;
    totalPass += pass;
    totalFail += fail;
    console.log(`FAIL (${pass}/${pass + fail})`);
    perFile.push({ file, pass, fail, status: 'FAIL', output });
  }
}

console.log(`\nParity Suite Summary: ${totalPass} passed, ${totalFail} failed (Total: ${totalPass + totalFail})`);
if (totalFail > 0) {
  process.exit(1);
}
