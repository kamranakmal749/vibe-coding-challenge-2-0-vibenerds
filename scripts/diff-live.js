// scripts/diff-live.js
// Read-only live differential verification between Express (port 3002) and Next.js (port 3000)
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
require('dotenv').config();

const { spawn } = require('child_process');
const mongoose = require('mongoose');

const expressPort = 3002;
const nextPort = 3000;
const expressBase = `http://localhost:${expressPort}`;
const nextBase = `http://localhost:${nextPort}`;

const rawUri = process.env.MONGODB_URI || '';
const parityUri = rawUri.replace('/academy_dev', '/academy_parity');

const usersToTest = [
  { role: 'admin', username: 'admin', password: 'admin123' },
  { role: 'coach', username: 'coach', password: 'coach123' },
  { role: 'scout', username: 'scout', password: 'scout123' },
  { role: 'player', username: 'md260001', password: 'player123' }
];

const endpointsToTest = [
  '/api/auth/me',
  '/api/players',
  '/api/players/me',
  '/api/sessions',
  '/api/matches',
  '/api/matches/history',
  '/api/matches/calendar?month=2026-11',
  '/api/scout/ready'
];

function deepEqual(a, b, path = '') {
  const diffs = [];
  if (a === b) return diffs;

  if (a === null || b === null || typeof a !== typeof b) {
    diffs.push({ path: path || 'root', expected: a, actual: b });
    return diffs;
  }

  if (typeof a !== 'object') {
    if (a !== b) {
      diffs.push({ path: path || 'root', expected: a, actual: b });
    }
    return diffs;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    diffs.push({ path: path || 'root', expected: a, actual: b });
    return diffs;
  }

  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      diffs.push({ path: `${path}.length`, expected: a.length, actual: b.length });
    }
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffs.push(...deepEqual(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }

  const keysA = Object.keys(a).filter(k => k !== 'token');
  const keysB = Object.keys(b).filter(k => k !== 'token');
  const allKeys = new Set([...keysA, ...keysB]);

  for (const k of allKeys) {
    if (!(k in a)) {
      diffs.push({ path: `${path}.${k}`, expected: undefined, actual: b[k] });
    } else if (!(k in b)) {
      diffs.push({ path: `${path}.${k}`, expected: a[k], actual: undefined });
    } else {
      diffs.push(...deepEqual(a[k], b[k], path ? `${path}.${k}` : k));
    }
  }

  return diffs;
}

async function printDbStats() {
  console.log('===============================================================');
  console.log('DATABASE INSPECTION & DOCUMENT COUNTS');
  console.log('===============================================================');
  
  const conn = await mongoose.createConnection(parityUri).asPromise();
  const dbName = conn.name;
  console.log(`Database Name: ${dbName}`);
  
  const collections = ['users', 'players', 'sessions', 'matches', 'matchparticipations', 'syncstates'];
  console.log('Document Counts:');
  for (const c of collections) {
    try {
      const count = await conn.collection(c).countDocuments();
      console.log(`  - ${c.padEnd(22)}: ${count}`);
    } catch (err) {
      console.log(`  - ${c.padEnd(22)}: (collection not found or 0)`);
    }
  }
  await conn.close();
  console.log('===============================================================\n');
}

function startExpress() {
  return new Promise((resolve, reject) => {
    console.log(`Starting Express backend on PORT=${expressPort} against ${parityUri.split('@')[1]}...`);
    const child = spawn('node', ['legacy/server.js'], {
      env: {
        ...process.env,
        PORT: String(expressPort),
        MONGODB_URI: parityUri,
        NODE_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let started = false;
    child.stdout.on('data', data => {
      const str = data.toString();
      if (str.includes('Maidan Desk running') || str.includes('connection established')) {
        if (!started) {
          started = true;
          // small buffer to ensure MongoDB is ready
          setTimeout(() => resolve(child), 1500);
        }
      }
    });

    child.stderr.on('data', data => {
      // ignore normal logs
    });

    child.on('error', err => reject(err));
    child.on('exit', code => {
      if (!started) reject(new Error(`Express exited prematurely with code ${code}`));
    });

    // fallback timeout
    setTimeout(() => {
      if (!started) {
        started = true;
        resolve(child);
      }
    }, 5000);
  });
}

async function waitForServer(url) {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${url}/api/sync/version`);
      if (res.status === 200) return true;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function run() {
  await printDbStats();

  const expressProcess = await startExpress();

  try {
    const expressReady = await waitForServer(expressBase);
    const nextReady = await waitForServer(nextBase);

    if (!expressReady) throw new Error(`Express server on ${expressBase} failed to become ready`);
    if (!nextReady) throw new Error(`Next.js server on ${nextBase} failed to become ready`);

    console.log(`✓ Both servers ready for comparison:`);
    console.log(`  - Express: ${expressBase}`);
    console.log(`  - Next.js: ${nextBase}\n`);

    let totalChecks = 0;
    let totalMismatches = 0;

    for (const user of usersToTest) {
      console.log(`---------------------------------------------------------------`);
      console.log(`TESTING USER: ${user.username} (Role: ${user.role})`);
      console.log(`---------------------------------------------------------------`);

      // 1. Login on Express
      const expLoginRes = await fetch(`${expressBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, password: user.password })
      });
      const expLoginStatus = expLoginRes.status;
      const expLoginData = await expLoginRes.json();

      // 2. Login on Next.js
      const nextLoginRes = await fetch(`${nextBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, password: user.password })
      });
      const nextLoginStatus = nextLoginRes.status;
      const nextLoginData = await nextLoginRes.json();

      totalChecks++;
      if (expLoginStatus !== nextLoginStatus) {
        console.error(`❌ LOGIN STATUS MISMATCH: Express=${expLoginStatus}, Next=${nextLoginStatus}`);
        totalMismatches++;
      } else {
        const loginDiffs = deepEqual(expLoginData.user, nextLoginData.user);
        if (loginDiffs.length > 0) {
          console.error(`❌ LOGIN USER OBJECT DIFF:`, loginDiffs);
          totalMismatches++;
        } else {
          console.log(`✓ POST /api/auth/login: Status ${expLoginStatus} IDENTICAL`);
        }
      }

      const expToken = expLoginData.token;
      const nextToken = nextLoginData.token;

      // 3. Compare each GET endpoint
      for (const endpoint of endpointsToTest) {
        totalChecks++;
        const expRes = await fetch(`${expressBase}${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${expToken}`,
            'Content-Type': 'application/json'
          }
        });
        const expStatus = expRes.status;
        const expData = await expRes.json().catch(async () => ({ text: await expRes.text() }));

        const nextRes = await fetch(`${nextBase}${endpoint}`, {
          headers: {
            'Authorization': `Bearer ${nextToken}`,
            'Content-Type': 'application/json'
          }
        });
        const nextStatus = nextRes.status;
        const nextData = await nextRes.json().catch(async () => ({ text: await nextRes.text() }));

        const statusMatch = expStatus === nextStatus;
        const bodyDiffs = deepEqual(expData, nextData);

        if (!statusMatch || bodyDiffs.length > 0) {
          console.error(`❌ DIFF: GET ${endpoint}`);
          console.error(`   Express: Status ${expStatus}`);
          console.error(`   Next.js: Status ${nextStatus}`);
          if (bodyDiffs.length > 0) {
            console.error(`   First 5 JSON differences (${bodyDiffs.length} total):`);
            console.error(JSON.stringify(bodyDiffs.slice(0, 5), null, 2));
          }
          totalMismatches++;
        } else {
          console.log(`✓ GET ${endpoint.padEnd(35)}: Status ${expStatus} IDENTICAL (JSON matches exactly)`);
        }
      }
      console.log('');
    }

    console.log('===============================================================');
    console.log(`LIVE DIFFERENTIAL SUMMARY:`);
    console.log(`  Total Checks Executed : ${totalChecks}`);
    console.log(`  Total Mismatches Found: ${totalMismatches}`);
    console.log('===============================================================');

    if (totalMismatches > 0) {
      process.exitCode = 1;
    }
  } finally {
    console.log('\nShutting down Express server on port 3002...');
    expressProcess.kill('SIGINT');
  }
}

run().catch(err => {
  console.error('Fatal error in diff-live:', err);
  process.exit(1);
});

