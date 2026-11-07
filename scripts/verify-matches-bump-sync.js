// scripts/verify-matches-bump-sync.js
// Automated source parser comparing broadcastServerSync in Express vs bumpSync in Next.js
const fs = require('fs');
const path = require('path');

const expressMatchesFile = path.resolve(__dirname, '../legacy/src/routes/matches.js');
const expressContent = fs.readFileSync(expressMatchesFile, 'utf8');

// Parse all route handlers and their broadcastServerSync calls from Express source
function parseExpressSyncCalls(content) {
  const routes = [];
  const routeRegex = /router\.(post|patch|put|delete)\(['"`]([^'"`]+)['"`],[\s\S]*?(?=(?:router\.(?:post|patch|put|delete|get)|module\.exports|$))/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    const handlerBody = match[0];
    const syncMatch = handlerBody.match(/broadcastServerSync\(\s*\{[\s\S]*?\}\s*\)/);
    routes.push({
      method,
      route: `/api/matches${routePath === '/' ? '' : routePath}`,
      syncCall: syncMatch ? syncMatch[0].replace(/\s+/g, ' ').trim() : 'None (omitted in Express)'
    });
  }
  return routes;
}

// Map of Express routes to Next.js route file paths
const nextRouteMap = [
  { method: 'POST', route: '/api/matches', file: 'client/src/app/api/matches/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id', file: 'client/src/app/api/matches/[id]/route.ts' },
  { method: 'DELETE', route: '/api/matches/:id', file: 'client/src/app/api/matches/[id]/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id/cancel', file: 'client/src/app/api/matches/[id]/cancel/route.ts' },
  { method: 'PUT', route: '/api/matches/:id/selected-players', file: 'client/src/app/api/matches/[id]/selected-players/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id/participation/:playerId', file: 'client/src/app/api/matches/[id]/participation/[playerId]/route.ts' },
  { method: 'POST', route: '/api/matches/:id/save-all', file: 'client/src/app/api/matches/[id]/save-all/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id/complete', file: 'client/src/app/api/matches/[id]/complete/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id/reopen-for-edit', file: 'client/src/app/api/matches/[id]/reopen-for-edit/route.ts' },
  { method: 'PATCH', route: '/api/matches/:id/edit-scores', file: 'client/src/app/api/matches/[id]/edit-scores/route.ts' },
  { method: 'PUT', route: '/api/matches/:id/entries', file: 'client/src/app/api/matches/[id]/entries/route.ts' }
];

const expressRoutes = parseExpressSyncCalls(expressContent);

const table = [];
for (const nr of nextRouteMap) {
  // Find matching Express route dynamically parsed from src/routes/matches.js
  const exp = expressRoutes.find(r => r.method === nr.method && r.route === nr.route);
  const expressSync = exp ? exp.syncCall : 'Not found';

  // Parse Next.js source dynamically from disk
  const nextFilePath = path.resolve(__dirname, '..', nr.file);
  let nextSync = 'None (omitted for parity)';
  if (fs.existsSync(nextFilePath)) {
    const nextContent = fs.readFileSync(nextFilePath, 'utf8');
    // Extract method handler block
    const methodRegex = new RegExp(`export\\s+async\\s+function\\s+${nr.method}\\b[\\s\\S]*?(?=(?:export\\s+async\\s+function|$))`);
    const handlerMatch = nextContent.match(methodRegex);
    const bodyToSearch = handlerMatch ? handlerMatch[0] : nextContent;
    const nextMatch = bodyToSearch.match(/await\s+bumpSync\([^)]+\)/);
    if (nextMatch) {
      nextSync = nextMatch[0].replace(/\s+/g, ' ').trim();
    }
  }

  table.push({
    method: nr.method,
    route: nr.route,
    expressBroadcastServerSync: expressSync,
    nextBumpSync: nextSync
  });
}

console.log('=== MATCH MUTATIONS: EXPRESS broadcastServerSync vs NEXT.JS bumpSync ===\n');
console.table(table);

console.log('\nNaming reconciliation:');
console.log('- Express uses `broadcastServerSync(event)` which emits to SSE and in-memory version counter.');
console.log('- Next.js uses `bumpSync(event)` which atomically updates MongoDB SyncState doc ("global") via findOneAndUpdate({_id: "global"}, {$inc: {version: 1}}).');
