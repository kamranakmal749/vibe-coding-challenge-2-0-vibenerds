// scripts/reproduce-schedule-match.js
const dns = require('dns');
try { dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']); } catch (_) {}
require('dotenv').config();

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

async function testPostMatch(roleName, username, password) {
  console.log(`\nTesting POST /api/matches as ${roleName} (${username})...`);
  
  // 1. Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!loginRes.ok) {
    console.error('Login failed:', loginRes.status, await loginRes.text());
    return;
  }
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log(`✓ Authenticated as ${loginData.user.name} (${loginData.user.role})`);

  // 2. Exact payload from submitCreateMatch in client/public/script.js:
  // let title = `${sport} Championship`;
  // let opponent = 'Jamshedpur FC';
  // let venue = 'Academy Ground';
  // date from date input: e.g. "2026-11-15"
  // time: "16:00"
  // sport: "Football"
  const payload = {
    title: 'Football Championship',
    sport: 'Football',
    date: '2026-11-15',
    time: '16:00',
    opponent: 'Jamshedpur FC',
    venue: 'Academy Ground',
    description: '',
    selectedPlayerIds: null
  };

  console.log('Sending payload:', JSON.stringify(payload, null, 2));

  try {
    const res = await fetch(`${baseUrl}/api/matches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const status = res.status;
    const text = await res.text();
    console.log(`Response Status: ${status}`);
    console.log(`Response Body: ${text}`);
  } catch (err) {
    console.error('Fetch threw exception:', err);
  }
}

async function run() {
  await testPostMatch('Coach', 'coach', 'coach123');
  await testPostMatch('Admin', 'admin', 'admin123');
}

run().catch(console.error);
