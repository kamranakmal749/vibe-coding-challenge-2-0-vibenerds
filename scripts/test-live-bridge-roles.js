// scripts/test-live-bridge-roles.js
// Read-only login and first-page data load verification across all 4 roles
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function testRole(roleName, username, password, firstPageName, firstPageEndpoints) {
  console.log(`\n======================================================`);
  console.log(`ROLE: ${roleName.toUpperCase()} (User: ${username})`);
  console.log(`======================================================`);

  // 1. Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!loginRes.ok) {
    const errText = await loginRes.text();
    console.error(`❌ Login failed (${loginRes.status}):`, errText);
    return false;
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log(`✓ Login Successful! Authenticated as: ${loginData.user.name} [${loginData.user.role}]`);
  console.log(`  Token: ${token.slice(0, 20)}...`);

  // 2. Load first-page endpoints (read-only GETs)
  console.log(`\nLoading First Page: "${firstPageName}"...`);
  let allEndpointsOk = true;
  for (const ep of firstPageEndpoints) {
    const epRes = await fetch(`${baseUrl}${ep}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!epRes.ok) {
      console.error(`  ❌ Failed GET ${ep} -> Status ${epRes.status}`);
      allEndpointsOk = false;
    } else {
      const data = await epRes.json();
      let summary = '';
      if (Array.isArray(data)) {
        summary = `Array(${data.length} items)`;
      } else if (typeof data === 'object' && data !== null) {
        const keys = Object.keys(data).slice(0, 5).join(', ');
        summary = `Object keys: [${keys}]`;
      }
      console.log(`  ✓ GET ${ep} -> Status 200 OK (${summary})`);
    }
  }

  if (allEndpointsOk) {
    console.log(`✓ First page "${firstPageName}" loaded successfully!`);
    return true;
  } else {
    console.error(`❌ First page "${firstPageName}" failed to load!`);
    return false;
  }
}

async function run() {
  console.log(`=== LIVE BRIDGE FIRST-PAGE ROLE VERIFICATION ===`);
  console.log(`Target: ${baseUrl}\n`);

  const results = {};

  // 1. Admin
  results.admin = await testRole(
    'Admin',
    'admin',
    'admin123',
    'Admin Overview',
    ['/api/auth/me', '/api/players', '/api/auth/coaches', '/api/sessions', '/api/matches']
  );

  // 2. Coach
  results.coach = await testRole(
    'Coach',
    'coach',
    'coach123',
    'Coach Players & Dashboard',
    ['/api/auth/me', '/api/players', '/api/sessions', '/api/matches']
  );

  // 3. Scout
  results.scout = await testRole(
    'Scout',
    'scout',
    'scout123',
    'Scout Ready Radar',
    ['/api/auth/me', '/api/scout/ready']
  );

  // 4. Player md260001
  results.player = await testRole(
    'Player',
    'md260001',
    'player123',
    'Player Portal Overview',
    ['/api/auth/me', '/api/players/me']
  );

  console.log(`\n======================================================`);
  console.log(`FINAL RESULTS:`);
  console.log(`======================================================`);
  for (const [r, ok] of Object.entries(results)) {
    console.log(`  ${r.padEnd(10)}: ${ok ? 'PASSED (First page loaded)' : 'FAILED'}`);
  }

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
