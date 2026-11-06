// scripts/record-legacy-baseline.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const parityUri = (process.env.MONGODB_URI || '').replace('/academy_dev', '/academy_parity');
if (!parityUri.includes('academy_parity')) {
  console.error('Safety check failed: URI does not contain academy_parity');
  process.exit(1);
}

async function reseedParityDb() {
  console.log('Dropping and reseeding academy_parity from canonical academy_dev fixtures...');
  const devUri = process.env.MONGODB_URI;
  const devConn = await mongoose.createConnection(devUri).asPromise();
  const parityConn = await mongoose.createConnection(parityUri).asPromise();

  const collections = await devConn.db.listCollections().toArray();
  for (const colInfo of collections) {
    if (colInfo.name.startsWith('system.')) continue;
    const name = colInfo.name;
    const docs = await devConn.db.collection(name).find({}).toArray();
    await parityConn.db.collection(name).deleteMany({});
    if (docs.length > 0) {
      await parityConn.db.collection(name).insertMany(docs);
    }
  }

  await devConn.close();
  await parityConn.close();
  console.log('✅ academy_parity dropped and cleanly reseeded.');
}

async function main() {
  await reseedParityDb();

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
          timeout: 90000
        }
      );
    } catch (err) {
      output = (err.stdout || '') + '\n' + (err.stderr || '');
    }

    // Extract individual tests from output
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
        if (trimmed.startsWith('✖ failing tests:')) continue;
        const testName = failMatch[1].trim();
        const alreadyAdded = perTestResults.some(r => r.file === file && r.test === testName && r.status === 'FAIL');
        if (!alreadyAdded) {
          perTestResults.push({ file, test: testName, status: 'FAIL' });
          fileFail++;
        }
      }
    }

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
}

main().catch(err => {
  console.error('Recording baseline failed:', err);
  process.exit(1);
});


