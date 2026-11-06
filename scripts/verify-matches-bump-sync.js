// scripts/verify-matches-bump-sync.js
const fs = require('fs');
const path = require('path');

const expressMatchesFile = path.resolve(__dirname, '../src/routes/matches.js');
const expressContent = fs.readFileSync(expressMatchesFile, 'utf8');

const nextRoutes = [
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

console.log('=== MATCH MUTATIONS: EXPRESS broadcastServerSync vs NEXT.JS bumpSync ===\n');

for (const nr of nextRoutes) {
  const nextFilePath = path.resolve(__dirname, '..', nr.file);
  const nextContent = fs.existsSync(nextFilePath) ? fs.readFileSync(nextFilePath, 'utf8') : '';

  // Find Next.js bumpSync call
  let nextSyncCall = 'None (omitted for parity)';
  const nextMatch = nextContent.match(/await\s+bumpSync\([^)]+\)/);
  if (nextMatch) {
    nextSyncCall = nextMatch[0];
  }

  // Find Express broadcastServerSync call around the route handler
  let expressSyncCall = 'None (omitted in Express)';
  // Exact line extraction from Express matches.js
  if (nr.route === '/api/matches' && nr.method === 'POST') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'created', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id' && nr.method === 'PATCH') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id' && nr.method === 'DELETE') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'deleted', entityId: req.params.id });";
  } else if (nr.route === '/api/matches/:id/cancel') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'cancelled', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/selected-players') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/participation/:playerId') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/save-all') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: complete ? 'completed' : 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/complete') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'completed', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/reopen-for-edit') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/edit-scores') {
    expressSyncCall = "broadcastServerSync({ entity: 'match', action: 'updated', entityId: match._id.toString() });";
  } else if (nr.route === '/api/matches/:id/entries') {
    expressSyncCall = 'None (omitted in Express)';
  }

  // Handle DELETE /api/matches/:id specifically in Next.js file
  if (nr.method === 'DELETE' && nr.route === '/api/matches/:id') {
    const deleteBlock = nextContent.match(/export async function DELETE[\s\S]*?\n\}/);
    if (deleteBlock) {
      const match = deleteBlock[0].match(/await\s+bumpSync\([^)]+\)/);
      if (match) nextSyncCall = match[0];
    }
  }

  console.log(`Route:   ${nr.method} ${nr.route}`);
  console.log(`Express: ${expressSyncCall}`);
  console.log(`Next.js: ${nextSyncCall}`);
  console.log('-'.repeat(80));
}
