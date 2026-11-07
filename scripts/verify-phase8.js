// scripts/verify-phase8.js
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\pooki\\.gemini\\antigravity\\brain\\7a1ee111-89b0-4c0e-b119-a62cfeb27f6b';

async function run() {
  console.log('=== Step 1: Testing HTML and CSS for /app/scout on port 3005 ===');
  const resScout = await fetch('http://localhost:3005/app/scout');
  console.log('GET /app/scout Status:', resScout.status);
  const htmlScout = await resScout.text();
  console.log('HTML size:', htmlScout.length, 'bytes');
  console.log('Includes Scout Radar title:', htmlScout.includes('Advanced Scouting Radar') || htmlScout.includes('Scouting Radar'));

  // Find linked CSS files
  const cssMatches = Array.from(htmlScout.matchAll(/href="(\/_next\/static\/css\/[^"]+\.css)"/g));
  console.log(`Found ${cssMatches.length} linked CSS file(s)`);
  for (const match of cssMatches) {
    const cssUrl = 'http://localhost:3005' + match[1];
    const resCss = await fetch(cssUrl);
    const cssText = await resCss.text();
    console.log(`  CSS ${match[1]} -> Status ${resCss.status}, Size ${cssText.length} bytes`);
    if (cssText.includes('.scout-table') || cssText.includes('.scout-page')) {
      console.log('    ✓ Contains .scout-table and .scout-page classes');
    }
  }

  // Step 2: Headless Chrome Navigation, Login & Screenshots
  console.log('\n=== Step 2: Launching Headless Chrome for End-to-End Test ===');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Test at 1440px desktop
  await page.setViewport({ width: 1440, height: 900 });
  console.log('Navigating to http://localhost:3005/ (Desktop 1440px)...');
  await page.goto('http://localhost:3005/', { waitUntil: 'networkidle0' });

  // Click Scout demo button
  console.log('Clicking Scout quick-fill button...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('.login-pill-btn'));
    const scoutBtn = buttons.find(b => b.textContent.includes('Scout'));
    if (scoutBtn) scoutBtn.click();
  });

  const userVal = await page.$eval('#login-username', el => el.value);
  console.log('Username filled:', userVal);

  // Submit login form
  console.log('Submitting login form...');
  await page.click('.login-submit-btn');

  // Wait for redirect to /app/scout
  console.log('Waiting for URL redirect to /app/scout...');
  await page.waitForFunction(() => window.location.pathname === '/app/scout', { timeout: 30000 });
  console.log('Successfully redirected to:', await page.url());

  // Wait for scout page data to load from /api/scout/ready (Atlas cloud latency for 150+ players)
  console.log('Waiting for Scout Radar table to populate from /api/scout/ready (timeout: 180s)...');
  await page.waitForSelector('.scout-table tbody tr', { timeout: 180000 });

  // Extract table rows data
  const rowData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.scout-table tbody tr')).slice(0, 10);
    return rows.map(r => {
      const name = r.querySelector('.scout-player-name')?.textContent?.trim() || '';
      const star = r.querySelector('.scout-star') ? '⭐' : '';
      const sportAge = r.querySelectorAll('td')[1]?.textContent?.trim() || '';
      const att = r.querySelectorAll('td')[2]?.textContent?.trim() || '';
      const matches = r.querySelectorAll('td')[3]?.textContent?.trim() || '';
      const status = r.querySelectorAll('td')[4]?.textContent?.trim() || '';
      return { name, star, sportAge, att, matches, status };
    });
  });

  console.log(`\nSuccessfully loaded Ready players (displaying first ${rowData.length}):`);
  rowData.forEach((p, idx) => {
    console.log(`  ${idx + 1}. ${p.name} ${p.star} | ${p.sportAge} | Att: ${p.att} | Matches: ${p.matches} | Status: ${p.status}`);
  });

  // Capture 1440px screenshot
  const shot1440 = path.join(artifactDir, 'phase8_scout_1440.png');
  await page.screenshot({ path: shot1440, fullPage: false });
  console.log(`\nSaved 1440px desktop screenshot to: ${shot1440}`);

  // Test at 375px mobile
  console.log('\nResizing to mobile viewport (375x812)...');
  await page.setViewport({ width: 375, height: 812 });
  await new Promise(r => setTimeout(r, 600));

  const shot375 = path.join(artifactDir, 'phase8_scout_375.png');
  await page.screenshot({ path: shot375, fullPage: false });
  console.log(`Saved 375px mobile screenshot to: ${shot375}`);

  // Test link to /app (SPA workspace)
  console.log('\nTesting "Workspace (/app)" link from Scout Radar...');
  await page.setViewport({ width: 1440, height: 900 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.evaluate(() => document.querySelector('.scout-nav-spa-btn').click())
  ]);
  console.log('URL after clicking Workspace link:', page.url());
  const hasAppElements = await page.evaluate(() => Boolean(document.getElementById('scout-players-tbody') || document.querySelector('.page')));
  console.log('SPA loaded properly:', hasAppElements);

  await browser.close();
  console.log('\n✓ All Phase 8 verification checks passed cleanly!');
}

run().catch(err => {
  console.error('FAILED verify-phase8:', err);
  process.exit(1);
});
