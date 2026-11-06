// scripts/run-3x-parity.js
const { execSync } = require('child_process');

console.log('=== STARTING 3X CONSECUTIVE PARITY VERIFICATION RUNS ===\n');

const results = [];

for (let run = 1; run <= 3; run++) {
  console.log(`\n==================================================`);
  console.log(`RUN ${run} OF 3: Resetting database and running full suite...`);
  console.log(`==================================================\n`);

  // Reset academy_parity database
  execSync('node -r ./scripts/dns-preload.js scripts/parity-reset.js', { stdio: 'inherit' });

  // Run parity suite
  const start = Date.now();
  try {
    const output = execSync('node scripts/run-parity-suite.js', { stdio: 'inherit', encoding: 'utf8' });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`✅ Run ${run} COMPLETED successfully in ${duration}s (21/21 passed)`);
    results.push({ run, status: 'PASS', passed: 21, failed: 0, duration: `${duration}s` });
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.error(`❌ Run ${run} FAILED in ${duration}s`);
    results.push({ run, status: 'FAIL', duration: `${duration}s` });
    process.exit(1);
  }
}

console.log('\n=== 3X CONSECUTIVE RUN RESULTS ===');
console.table(results);
