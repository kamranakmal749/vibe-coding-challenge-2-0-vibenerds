const fs = require('fs');
const path = require('path');

// 1. Map mounts from src/app.js
const appMounts = {
  'auth.js': '/api/auth',
  'players.js': '/api/players',
  'sessions.js': '/api/sessions',
  'matches.js': '/api/matches',
  'scout.js': '/api/scout',
  'sync.js': '/api/sync'
};

// Also check root app.js routes
const rootAppRoutes = [
  { method: 'GET', path: '/api/health', source: 'src/app.js', mounted: true }
];

// 2. Extract routes from src/routes/*.js
const expressRoutes = [...rootAppRoutes];
const routesDir = path.resolve(__dirname, '../src/routes');
const files = fs.readdirSync(routesDir);

for (const file of files) {
  if (!file.endsWith('.js')) continue;
  const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
  const mountBase = appMounts[file];
  const isMounted = Boolean(mountBase);
  const base = mountBase || (file === 'audit.js' ? '/api/audit-logs' : `/api/${file.replace('.js', '')}`);

  const routeRegex = /router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    let subPath = match[2];
    if (subPath === '/') subPath = '';
    const fullPath = (base + subPath).replace(/\/+/g, '/');
    expressRoutes.push({
      method,
      path: fullPath,
      source: `src/routes/${file}`,
      mounted: isMounted
    });
  }
}

// 3. Extract Next.js routes from client/src/app/api
const nextRoutes = [];
const clientApiDir = path.resolve(__dirname, '../client/src/app/api');

function scanNextApi(dir, currentPath = '/api') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      let segment = entry.name;
      // Convert [param] to :param, and ignore catchall
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        continue; // catchall
      } else if (segment.startsWith('[') && segment.endsWith(']')) {
        segment = ':' + segment.slice(1, -1);
      }
      scanNextApi(path.join(dir, entry.name), `${currentPath}/${segment}`);
    } else if (entry.name === 'route.ts' || entry.name === 'route.js') {
      const content = fs.readFileSync(path.join(dir, entry.name), 'utf8');
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      for (const m of methods) {
        // Look for: export async function GET or export function GET
        const exportRegex = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`);
        if (exportRegex.test(content)) {
          nextRoutes.push({
            method: m,
            path: currentPath,
            source: path.relative(path.resolve(__dirname, '..'), path.join(dir, entry.name))
          });
        }
      }
    }
  }
}

scanNextApi(clientApiDir);

// 4. Compare
// Phase assignment map for Express routes
function getPhase(route) {
  if (route.source.includes('auth.js')) return 'Phase 3 (Auth)';
  if (route.source.includes('players.js')) return 'Phase 4A (Players)';
  if (route.source.includes('sessions.js')) return 'Phase 4B (Sessions)';
  if (route.source.includes('matches.js')) return 'Phase 4C (Matches)';
  if (route.source.includes('scout.js')) return 'Phase 4C (Matches/Scout)';
  if (route.source.includes('sync.js')) return 'Phase 4D (Sync)';
  if (route.source.includes('app.js')) return 'Phase 3 (Health)';
  return 'Unassigned';
}

console.log('========================================================================');
console.log('EXPRESS vs NEXT.JS API ROUTE AUDIT');
console.log('========================================================================\n');

const ported = [];
const unported = [];

for (const exp of expressRoutes) {
  // Normalize parameters: Express uses :id, Next can match :id
  const isMatch = nextRoutes.some(nxt => nxt.method === exp.method && nxt.path === exp.path);
  if (isMatch) {
    ported.push(exp);
  } else {
    unported.push({
      ...exp,
      phase: getPhase(exp)
    });
  }
}

console.log(`TOTAL EXPRESS ROUTES FOUND: ${expressRoutes.length} (${expressRoutes.filter(r => r.mounted).length} mounted in app.js, ${expressRoutes.filter(r => !r.mounted).length} unmounted)`);
console.log(`TOTAL NEXT.JS API HANDLERS FOUND: ${nextRoutes.length}\n`);

console.log(`PORTED ROUTES (${ported.length}):`);
console.table(ported.map(r => ({ Method: r.method, Path: r.path, Source: r.source })));

console.log(`\nUNPORTED EXPRESS ROUTES (${unported.length}):`);
console.table(unported.map(r => ({
  Method: r.method,
  Path: r.path,
  Source: r.source,
  Mounted: r.mounted ? 'YES' : 'NO (Unmounted)',
  Phase: r.phase
})));

// Check for any unassigned routes
const unassigned = unported.filter(r => r.phase === 'Unassigned' || !r.mounted);
console.log(`\nROUTES NOT MOUNTED OR NOT ASSIGNED TO A MIGRATION PHASE (${unassigned.length}):`);
if (unassigned.length > 0) {
  console.table(unassigned.map(r => ({
    Method: r.method,
    Path: r.path,
    Source: r.source,
    Mounted: r.mounted ? 'YES' : 'NO',
    Phase: r.phase
  })));
} else {
  console.log('None.');
}

