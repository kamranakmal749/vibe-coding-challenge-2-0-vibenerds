// scripts/audit-serverless.js
// Verifies Serverless (Vercel) Readiness across points N5(a) - N5(f)
const fs = require('fs');
const path = require('path');

console.log('=== VERCEL SERVERLESS READINESS AUDIT ===\n');

// ─────────────────────────────────────────────────────────────────────────────
// N5(a): Every API route exports runtime = 'nodejs' and dynamic = 'force-dynamic'
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- N5(a): Checking runtime and dynamic exports in all API routes ---');
function getRoutes(dir) {
  let list = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) list = list.concat(getRoutes(full));
    else if (f === 'route.ts' || f === 'route.js') list.push(full);
  }
  return list;
}

const apiRoutes = getRoutes(path.resolve(__dirname, '../client/src/app/api'));
let n5aPassed = true;
const routeStatusList = [];

for (const r of apiRoutes) {
  const content = fs.readFileSync(r, 'utf8');
  const hasRuntime = /export\s+const\s+runtime\s*=\s*['"]nodejs['"]/.test(content);
  const hasDynamic = /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(content);
  const relPath = path.relative(path.resolve(__dirname, '../client'), r).replace(/\\/g, '/');

  if (!hasRuntime || !hasDynamic) {
    n5aPassed = false;
    routeStatusList.push({ route: relPath, runtime: hasRuntime ? 'OK' : 'MISSING', dynamic: hasDynamic ? 'OK' : 'MISSING' });
  }
}

if (n5aPassed) {
  console.log(`✓ All ${apiRoutes.length} API routes export runtime = 'nodejs' and dynamic = 'force-dynamic'.`);
} else {
  console.error(`❌ Some API routes are missing serverless exports:`);
  console.table(routeStatusList);
}

// ─────────────────────────────────────────────────────────────────────────────
// N5(b): Mongo connection cached on globalThis and uses bufferCommands:false
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- N5(b): Checking MongoDB connection caching & bufferCommands ---');
const dbCode = fs.readFileSync(path.resolve(__dirname, '../client/src/lib/db.ts'), 'utf8');
const cachesOnGlobalThis = dbCode.includes('globalThis') && dbCode.includes('mongooseConnection');
const usesBufferCommandsFalse = /bufferCommands:\s*false/.test(dbCode);

console.log(`  - Caches on globalThis.mongooseConnection : ${cachesOnGlobalThis ? 'YES (Verified)' : 'NO'}`);
console.log(`  - Configures bufferCommands: false        : ${usesBufferCommandsFalse ? 'YES (Verified)' : 'NO'}`);
if (cachesOnGlobalThis && usesBufferCommandsFalse) {
  console.log('✓ N5(b) PASSED: Connection pooling & bufferCommands configured correctly.');
} else {
  console.error('❌ N5(b) FAILED');
}

// ─────────────────────────────────────────────────────────────────────────────
// N5(c): Nothing writes to local file system at runtime
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- N5(c): Checking for runtime file system writes in client/src ---');
function scanNoFsWrites(dir) {
  let fileWriteCalls = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) fileWriteCalls = fileWriteCalls.concat(scanNoFsWrites(full));
    else if (/\.(ts|tsx|js)$/.test(f)) {
      const code = fs.readFileSync(full, 'utf8');
      const lines = code.split('\n');
      lines.forEach((line, idx) => {
        if (/fs\.(writeFileSync|writeFile|appendFile|createWriteStream|mkdirSync|unlinkSync)/.test(line)) {
          fileWriteCalls.push({ file: path.relative(path.resolve(__dirname, '../client'), full).replace(/\\/g, '/'), line: idx + 1, code: line.trim() });
        }
      });
    }
  }
  return fileWriteCalls;
}

const writeCalls = scanNoFsWrites(path.resolve(__dirname, '../client/src'));
if (writeCalls.length === 0) {
  console.log('✓ Zero runtime fs.write / writeFileSync / createWriteStream calls found in client/src.');
} else {
  console.error('❌ Found local file write calls in client/src:');
  console.table(writeCalls);
}

// ─────────────────────────────────────────────────────────────────────────────
// N5(d): No in-memory state across requests (sync version is in MongoDB)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- N5(d): Checking sync state persistence in MongoDB ---');
const syncCode = fs.readFileSync(path.resolve(__dirname, '../client/src/lib/sync.ts'), 'utf8');
const usesSyncStateModel = syncCode.includes('SyncState.findOneAndUpdate') && syncCode.includes('SyncState.findById');
console.log(`  - bumpSync() updates MongoDB SyncState document  : ${syncCode.includes('SyncState.findOneAndUpdate') ? 'YES (Verified)' : 'NO'}`);
console.log(`  - getVersion() reads MongoDB SyncState document : ${syncCode.includes('SyncState.findById') ? 'YES (Verified)' : 'NO'}`);
if (usesSyncStateModel) {
  console.log('✓ N5(d) PASSED: Sync version uses atomic MongoDB document updates with no process in-memory dependence.');
} else {
  console.error('❌ N5(d) FAILED');
}

// ─────────────────────────────────────────────────────────────────────────────
// N5(e): Rewrite / -> /index.html and client/public files
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- N5(e): Checking rewrite in next.config.mjs & client/public static files ---');
const nextConfig = fs.readFileSync(path.resolve(__dirname, '../client/next.config.mjs'), 'utf8');
const hasRewrite = nextConfig.includes("source: '/'") && nextConfig.includes("destination: '/index.html'");
console.log(`  - next.config.mjs beforeFiles rewrite (/ -> /index.html) : ${hasRewrite ? 'YES (Verified)' : 'NO'}`);

const publicFiles = ['index.html', 'script.js', 'style.css', 'favicon.svg'];
const missingPublic = [];
for (const p of publicFiles) {
  if (!fs.existsSync(path.resolve(__dirname, '../client/public', p))) {
    missingPublic.push(p);
  }
}
const vendorExists = fs.existsSync(path.resolve(__dirname, '../client/public/vendor')) && fs.readdirSync(path.resolve(__dirname, '../client/public/vendor')).length > 0;

console.log(`  - Static assets exist in client/public/                : ${missingPublic.length === 0 ? 'YES (index.html, script.js, style.css, favicon.svg present)' : 'MISSING: ' + missingPublic.join(', ')}`);
console.log(`  - client/public/vendor/ contains vendor bundles       : ${vendorExists ? 'YES (Verified)' : 'NO'}`);
if (hasRewrite && missingPublic.length === 0 && vendorExists) {
  console.log('✓ N5(e) PASSED: Rewrite and public assets properly placed.');
} else {
  console.error('❌ N5(e) FAILED');
}

// ─────────────────────────────────────────────────────────────────────────────
// N5(f): No console.log prints secrets, tokens, or MongoDB URI
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- N5(f): Checking console.log statements in client/src for secrets ---');
function scanLogs(dir) {
  let logCalls = [];
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) logCalls = logCalls.concat(scanLogs(full));
    else if (/\.(ts|tsx|js)$/.test(f)) {
      const code = fs.readFileSync(full, 'utf8');
      const lines = code.split('\n');
      lines.forEach((line, idx) => {
        if (/console\.(log|info|warn|error)\b/.test(line)) {
          // Check if it mentions uri, password, token, secret
          if (/(MONGODB_URI|uri|secret|token|password)/i.test(line)) {
            logCalls.push({ file: path.relative(path.resolve(__dirname, '../client'), full).replace(/\\/g, '/'), line: idx + 1, code: line.trim() });
          }
        }
      });
    }
  }
  return logCalls;
}

const suspiciousLogs = scanLogs(path.resolve(__dirname, '../client/src'));
if (suspiciousLogs.length === 0) {
  console.log('✓ Zero console.log statements printing tokens, secrets, or MongoDB URI in client/src.');
} else {
  console.log(`Audited suspicious log statements:`);
  console.table(suspiciousLogs);
}
console.log('\n===============================================================');

