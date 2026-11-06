// scripts/reconcile-details.js
const fs = require('fs');
const path = require('path');

const baselinePath = path.resolve(__dirname, '../test/baseline/legacy-express.json');
const data = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

const files = {};
for (const item of data) {
  if (!files[item.file]) {
    files[item.file] = { total: 0, pass: 0, fail: 0, failedTests: [] };
  }
  files[item.file].total++;
  if (item.status === 'PASS') {
    files[item.file].pass++;
  } else {
    files[item.file].fail++;
    files[item.file].failedTests.push({ test: item.test, error: item.error || item.errorLine || '' });
  }
}

console.log('\n=== PER-FILE BASELINE TABLE ===');
console.table(Object.entries(files).map(([file, info]) => ({
  file,
  subtests: info.total,
  pass: info.pass,
  fail: info.fail
})));

let totalPass = 0;
let totalFail = 0;
for (const info of Object.values(files)) {
  totalPass += info.pass;
  totalFail += info.fail;
}
console.log(`TOTAL: ${totalPass + totalFail} tests (${totalPass} PASS, ${totalFail} FAIL)`);

console.log('\n=== FAILING TESTS & ROOT CAUSE REASONS ===');
for (const [file, info] of Object.entries(files)) {
  if (info.fail > 0) {
    console.log(`\n--- ${file} (${info.fail} failing tests) ---`);
    for (const f of info.failedTests) {
      console.log(`  * ${f.test}`);
      if (f.error) console.log(`    Error: ${f.error}`);
    }
  }
}

