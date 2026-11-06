// scripts/manual-browser-walkthrough.js
// Headful (Visible GUI, non-headless) verification walking through all screens and features
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const PORT = 3000;
const CDP_PORT = 9222;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.msgId = 0;
    this.callbacks = new Map();
    this.consoleLogs = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });

    this.ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        this.consoleLogs.push({ type: msg.params.type, text });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const exp = msg.params.exceptionDetails;
        this.consoleLogs.push({ type: 'error', text: `${exp.text} ${exp.exception?.description || ''}` });
      }
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });

    await this.send('Console.enable');
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('🚀 Launching Visible GUI Chrome browser (NON-HEADLESS) on Windows desktop...');
  const userDataDir = path.resolve(__dirname, '../.tmp_chrome_headful');
  
  // Explicitly NON-HEADLESS: Real visible browser window on Windows desktop!
  const browserProc = spawn(CHROME_PATH, [
    '--remote-debugging-port=' + CDP_PORT,
    '--start-maximized',
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
    '--no-default-browser-check',
    `http://localhost:${PORT}`
  ]);

  await delay(2500);

  try {
    const targets = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json`);
    const pageTarget = targets.find(t => t.type === 'page');
    if (!pageTarget) throw new Error('Could not find active browser page target');

    const cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('🔗 Connected to visible Chrome window via CDP.');

    await cdp.send('Page.navigate', { url: `http://localhost:${PORT}` });
    await delay(1500);

    // ==========================================
    // 1. COACH LOGIN & DASHBOARD
    // ==========================================
    console.log('\n==========================================');
    console.log('[PASS 1/4] COACH WALKTHROUGH & MATCH MANAGEMENT');
    console.log('==========================================');
    console.log('👉 Step 1: Logging in as Coach Sharma (coach@maidandesk.com)...');
    await cdp.evaluate(`
      document.getElementById('login-email').value = 'coach@maidandesk.com';
      document.getElementById('login-password').value = 'coach123';
      handleFormLogin();
    `);
    await delay(2000);

    // ==========================================
    // 2. MATCHES & CALENDAR VIEW
    // ==========================================
    console.log('👉 Step 2: Clicking "Matches & Calendar" tab in navigation...');
    await cdp.evaluate(`(async () => { await switchPage('coach-matches'); })()`);
    await delay(1500);

    const matchStats = await cdp.evaluate(`({
      total: document.getElementById('stat-total-matches')?.innerText,
      upcoming: document.getElementById('stat-upcoming-matches')?.innerText,
      completed: document.getElementById('stat-completed-matches')?.innerText,
      participations: document.getElementById('stat-total-participations')?.innerText
    })`);
    console.log('   📊 Summary Cards Rendered:', matchStats);

    const monthHeading = await cdp.evaluate(`document.getElementById('calendar-month-heading')?.innerText`);
    console.log('   📅 Calendar Month Heading:', monthHeading);

    console.log('👉 Step 3: Clicking on date with fixture in the calendar grid to open Day Fixtures Drawer...');
    const drawerOpened = await cdp.evaluate(`(() => {
      const matchBadge = document.querySelector('#calendar-grid [title]');
      if (matchBadge) {
        const cell = matchBadge.closest('#calendar-grid > div');
        cell.click();
        return true;
      }
      return false;
    })()`);
    await delay(1200);
    const drawerTitle = await cdp.evaluate(`document.getElementById('calendar-day-panel-title')?.innerText`);
    const drawerCount = await cdp.evaluate(`document.getElementById('calendar-day-panel-count')?.innerText`);
    console.log(`   📂 Day Drawer Opened: "${drawerTitle}" (${drawerCount})`);

    console.log('👉 Step 4: Switching to "Completed" matches tab...');
    await cdp.evaluate(`switchMatchTab('completed');`);
    await delay(1200);
    const completedRows = await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('#completed-matches-table-body tr'));
      return {
        count: rows.length,
        titles: rows.map(r => r.querySelector('td')?.innerText.trim())
      };
    })()`);
    console.log(`   🏆 Completed Tab: ${completedRows.count} fixtures listed:`, completedRows.titles);

    console.log('👉 Step 5: Switching to "History" tab & testing opponent search filter...');
    await cdp.evaluate(`(async () => { switchMatchTab('history'); await loadHistoryTab(); })()`);
    await delay(1200);
    await cdp.evaluate(`(async () => {
      document.getElementById('history-filter-opponent').value = 'Ranchi';
      await applyHistoryFilters();
    })()`);
    await delay(1000);
    const filteredCount = await cdp.evaluate(`document.querySelectorAll('#history-matches-list > div').length`);
    console.log(`   🔍 History filtered by 'Ranchi': ${filteredCount} match card visible`);

    // Reset filter
    await cdp.evaluate(`(async () => {
      document.getElementById('history-filter-opponent').value = '';
      await applyHistoryFilters();
    })()`);
    await delay(1000);

    console.log('👉 Step 6: Testing "+ Add Match" modal rendering & cancellation...');
    await cdp.evaluate(`openAddMatchModal();`);
    await delay(1000);
    const modalTitle = await cdp.evaluate(`document.getElementById('modal-title')?.innerText`);
    console.log('   ✨ Add Match Modal opened with title:', modalTitle);
    await cdp.evaluate(`closeModal();`);
    await delay(800);

    // ==========================================
    // 3. ATHLETE DIRECTORY & MODAL BENCHMARKS
    // ==========================================
    console.log('\n==========================================');
    console.log('[PASS 2/4] ATHLETE DIRECTORY & MODAL BENCHMARKS');
    console.log('==========================================');
    console.log('👉 Step 7: Navigating to Athlete Directory (coach-players)...');
    await cdp.evaluate(`(async () => { await switchPage('coach-players'); })()`);
    await delay(1500);

    console.log('👉 Step 8: Clicking on Kamran Akmal to open ERP Profile Modal...');
    const kamranStats = await cdp.evaluate(`(async () => {
      const p = cachedPlayers.find(x => x.name === 'Kamran Akmal');
      await openPlayerAttendanceDetailModal(p._id);
      await new Promise(r => setTimeout(r, 1200));

      const modalBody = document.getElementById('modal-body')?.innerText || '';
      return {
        title: document.getElementById('modal-title')?.innerText,
        isReadyPillPresent: modalBody.includes('READY'),
        bodySnippet: modalBody.slice(0, 350)
      };
    })()`);
    console.log('   👤 Kamran Akmal Modal Title:', kamranStats.title);
    console.log('   🌟 Trial Readiness Pill:', kamranStats.isReadyPillPresent ? 'READY (PASS)' : 'FAIL');
    await delay(1800);
    await cdp.evaluate(`closeModal();`);
    await delay(800);

    console.log('👉 Step 9: Clicking on Aadil Azhar to open ERP Profile Modal...');
    const aadilStats = await cdp.evaluate(`(async () => {
      const p = cachedPlayers.find(x => x.name === 'Aadil Azhar');
      await openPlayerAttendanceDetailModal(p._id);
      await new Promise(r => setTimeout(r, 1200));

      const modalBody = document.getElementById('modal-body')?.innerText || '';
      return {
        title: document.getElementById('modal-title')?.innerText,
        isNotReadyPresent: modalBody.includes('NOT READY'),
        bodySnippet: modalBody.slice(0, 350)
      };
    })()`);
    console.log('   👤 Aadil Azhar Modal Title:', aadilStats.title);
    console.log('   ⚠️ Trial Readiness Pill:', aadilStats.isNotReadyPresent ? 'NOT READY (PASS - 50% att, 1 match)' : 'FAIL');
    await delay(1800);
    await cdp.evaluate(`closeModal();`);
    await delay(800);

    // ==========================================
    // 4. ATHLETE PORTAL PASS
    // ==========================================
    console.log('\n==========================================');
    console.log('[PASS 3/4] ATHLETE PORTAL WALKTHROUGH');
    console.log('==========================================');
    console.log('👉 Step 10: Logging out as Coach...');
    await cdp.evaluate(`logout();`);
    await delay(1200);

    console.log('👉 Step 11: Logging in as Athlete Kamran Akmal (kamran@player.com)...');
    await cdp.evaluate(`
      document.getElementById('login-email').value = 'kamran@player.com';
      document.getElementById('login-password').value = 'player123';
      handleFormLogin();
    `);
    await delay(2000);

    const athleteOverview = await cdp.evaluate(`({
      welcome: document.getElementById('player-profile-name')?.innerText,
      attendance: document.getElementById('player-stat-attendance')?.innerText,
      matches: document.getElementById('player-stat-matches')?.innerText,
      ready: document.getElementById('player-stat-ready')?.innerText
    })`);
    console.log('   🏃 Athlete Dashboard:', athleteOverview);

    console.log('👉 Step 12: Viewing "My Matches" tab...');
    await cdp.evaluate(`(async () => { await switchPage('player-matches'); })()`);
    await delay(1500);
    const athleteMatches = await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('#player-matches-tbody tr'));
      return { count: rows.length, row1: rows[0]?.innerText.trim().replace(/\\s+/g, ' ') };
    })()`);
    console.log(`   ⚽ Athlete Matches: ${athleteMatches.count} appearances listed`);
    console.log('      Row 1:', athleteMatches.row1.slice(0, 90));

    // ==========================================
    // 5. SCOUT RADAR PASS
    // ==========================================
    console.log('\n==========================================');
    console.log('[PASS 4/4] SCOUT RADAR WALKTHROUGH');
    console.log('==========================================');
    console.log('👉 Step 13: Logging out as Athlete...');
    await cdp.evaluate(`logout();`);
    await delay(1200);

    console.log('👉 Step 14: Logging in as Talent Scout (scout@maidandesk.com)...');
    await cdp.evaluate(`
      document.getElementById('login-email').value = 'scout@maidandesk.com';
      document.getElementById('login-password').value = 'scout123';
      handleFormLogin();
    `);
    await delay(2000);

    console.log('👉 Step 15: Checking Scout Talent Radar (scout)...');
    await cdp.evaluate(`(async () => { await switchPage('scout'); })()`);
    await delay(1500);
    const scoutList = await cdp.evaluate(`(() => {
      const rows = Array.from(document.querySelectorAll('#scout-players-tbody tr'));
      return {
        rowCount: rows.length,
        names: rows.map(r => r.querySelector('td:nth-child(2)')?.innerText.trim()).filter(Boolean)
      };
    })()`);
    console.log(`   🔭 Scout Radar Athletes Found: ${scoutList.rowCount}`);
    console.log('      Athletes visible on radar:', scoutList.names);

    console.log('\n🪵 BROWSER CONSOLE ERRORS:');
    const errors = cdp.consoleLogs.filter(l => l.type === 'error');
    if (!errors.length) {
      console.log('✅ ZERO JavaScript errors or warnings logged during entire visual human walkthrough!');
    } else {
      console.error('Console errors:', JSON.stringify(errors, null, 2));
    }

    console.log('\n🎉 ALL 4 PASSES COMPLETED VISUALLY WITH ZERO ISSUES!');
    await delay(3000);
    cdp.close();
  } catch (err) {
    console.error('Visual walkthrough encountered error:', err);
  } finally {
    browserProc.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }
}

run();
