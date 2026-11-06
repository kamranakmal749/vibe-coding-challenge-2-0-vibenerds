// scripts/extract-legacy-errors.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const baseline = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../test/baseline/legacy-express.json'), 'utf8'));
const failing = baseline.filter(t => t.status === 'FAIL');
console.log('Total failing tests in baseline:', failing.length);

const groupedByFile = {};
for (const item of failing) {
  groupedByFile[item.file] = groupedByFile[item.file] || [];
  groupedByFile[item.file].push(item.test);
}

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
const errorMap = [];

for (const [file, tests] of Object.entries(groupedByFile)) {
  const filePath = path.resolve(__dirname, '../test', file);
  let output = '';
  try {
    output = execSync(`node -r ./scripts/dns-preload.js --test --test-force-exit "${filePath}"`, {
      env: { ...process.env, MONGODB_URI: parityUri },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000
    });
  } catch (err) {
    output = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const lines = output.split('\n');
  for (const t of tests) {
    let firstError = '';
    // Look for test failure block in node --test output
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(t) && (lines[i].includes('✖') || lines[i].includes('not ok'))) {
        for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
          const l = lines[j].trim();
          if (l.startsWith('AssertionError') || l.startsWith('Error:') || l.startsWith('MongoServerError:') || l.startsWith('TypeError:')) {
            firstError = l;
            break;
          }
          if (l.includes('expected') || l.includes('status:') || l.includes('actual:')) {
            firstError = l;
            break;
          }
        }
        if (firstError) break;
      }
    }
    if (!firstError) {
      firstError = 'Assertion failure or prerequisite fixture mismatch';
    }
    errorMap.push({ file, test: t, error: firstError });
  }
}

const outPath = path.resolve(__dirname, '../test/baseline/legacy_failures_with_errors.json');
fs.writeFileSync(outPath, JSON.stringify(errorMap, null, 2), 'utf8');
console.log(`Saved ${errorMap.length} failure error records to ${outPath}`);

