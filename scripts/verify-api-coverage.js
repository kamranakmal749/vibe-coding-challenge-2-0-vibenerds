// scripts/verify-api-coverage.js
// Scans client/public/script.js for all /api/... endpoints and maps them to Next.js route files
const fs = require('fs');
const path = require('path');

const scriptPath = path.resolve(__dirname, '../client/public/script.js');
const scriptContent = fs.readFileSync(scriptPath, 'utf8');

// List of all route files in client/src/app/api
function getNextRouteFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getNextRouteFiles(fullPath));
    } else if (file === 'route.ts' || file === 'route.js') {
      results.push(fullPath);
    }
  }
  return results;
}

const apiDir = path.resolve(__dirname, '../client/src/app/api');
const nextRouteFiles = getNextRouteFiles(apiDir);

// Build map of Next.js route patterns and supported methods
const routes = nextRouteFiles.map(filePath => {
  const rel = path.relative(apiDir, path.dirname(filePath)).replace(/\\/g, '/');
  const routePattern = '/api' + (rel ? '/' + rel : '');
  const content = fs.readFileSync(filePath, 'utf8');
  const methods = [];
  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(m => {
    if (new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(content)) {
      methods.push(m);
    }
  });
  return {
    routePattern,
    filePath,
    methods
  };
});

// Helper to match an actual URL from script.js to a Next.js route pattern
function findMatchingRoute(apiPath, method) {
  // Normalize template expressions: e.g. /api/matches/${id} -> /api/matches/[id]
  for (const r of routes) {
    // Convert [param] to regex
    const regexStr = '^' + r.routePattern.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[([^\]]+)\]/g, '[^/]+') + '$';
    const regex = new RegExp(regexStr);
    if (regex.test(apiPath)) {
      if (r.methods.includes(method)) {
        return { match: r, status: 'MATCHED' };
      }
      return { match: r, status: `METHOD_NOT_ALLOWED (Route has [${r.methods.join(', ')}], called with ${method})` };
    }
  }
  // Check catch-all
  const catchall = routes.find(r => r.routePattern.includes('[...catchall]'));
  if (catchall) {
    return { match: catchall, status: 'CATCHALL_FALLBACK' };
  }
  return { match: null, status: 'NO_HANDLER' };
}

// Find all fetch/api calls in script.js
const lines = scriptContent.split('\n');
const callSites = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const apiMatch = line.match(/\b(?:fetch|api)\s*\(\s*[`'"](\/api\/[^`'"]+)[`'"]/);
  if (apiMatch) {
    let url = apiMatch[1];
    // Strip query parameters
    const cleanUrl = url.split('?')[0];

    // Determine HTTP method
    const surrounding = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
    let method = 'GET';
    const mMatch = surrounding.match(/method:\s*['"](POST|PUT|PATCH|DELETE|GET)['"]/i);
    if (mMatch) {
      method = mMatch[1].toUpperCase();
    }

    callSites.push({
      line: i + 1,
      rawUrl: url,
      cleanUrl,
      method
    });
  }
}

console.log('=== CLIENT SCRIPT.JS API COVERAGE VERIFICATION ===\n');
console.log(`Evaluated ${callSites.length} API call sites in client/public/script.js.\n`);

const summaryTable = [];
let unhandledCount = 0;

for (const call of callSites) {
  // Normalize variable interpolations: e.g. /api/matches/${matchId}/save-all -> /api/matches/xxx/save-all
  const normalizedForMatching = call.cleanUrl.replace(/\$\{[^}]+\}/g, 'SAMPLE_ID');
  const res = findMatchingRoute(normalizedForMatching, call.method);

  const routeRelPath = res.match ? path.relative(path.resolve(__dirname, '..'), res.match.filePath).replace(/\\/g, '/') : 'NONE';

  if (res.status !== 'MATCHED') {
    unhandledCount++;
  }

  summaryTable.push({
    line: call.line,
    method: call.method,
    clientEndpoint: call.cleanUrl,
    nextRouteFile: routeRelPath,
    status: res.status
  });
}

console.table(summaryTable);

console.log(`\nTotal Unhandled / Missing Route Calls: ${unhandledCount}`);
if (unhandledCount > 0) {
  console.error('\n❌ Found unhandled calls:');
  console.error(summaryTable.filter(s => s.status !== 'MATCHED'));
  process.exit(1);
} else {
  console.log('✓ All client API calls map 1:1 to dedicated Next.js route handlers with matching HTTP methods!');
}
