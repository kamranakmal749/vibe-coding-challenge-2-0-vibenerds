// scripts/strict-j4-diff.js
// Strict 1:1 error comparison between Express and Next.js for Matches & Scout
const fs = require('fs');
const path = require('path');

const expressMatchesPath = path.resolve(__dirname, '../legacy/src/routes/matches.js');
const expressScoutPath = path.resolve(__dirname, '../legacy/src/routes/scout.js');

// Map of Express route handlers to Next.js handler files
const routeMapping = [
  {
    name: 'GET /check-eligibility',
    expressFile: expressMatchesPath,
    expressStartLine: 153,
    expressEndLine: 244,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/check-eligibility/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'GET /:id/eligible-players',
    expressFile: expressMatchesPath,
    expressStartLine: 245,
    expressEndLine: 313,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/eligible-players/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'PUT /:id/selected-players',
    expressFile: expressMatchesPath,
    expressStartLine: 314,
    expressEndLine: 408,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/selected-players/route.ts'),
    nextMethod: 'PUT'
  },
  {
    name: 'GET /:id/participation',
    expressFile: expressMatchesPath,
    expressStartLine: 410,
    expressEndLine: 452,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/participation/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'PATCH /:id/participation/:playerId',
    expressFile: expressMatchesPath,
    expressStartLine: 453,
    expressEndLine: 561,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/participation/[playerId]/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'PATCH /:id/complete',
    expressFile: expressMatchesPath,
    expressStartLine: 563,
    expressEndLine: 640,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/complete/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'POST /:id/save-all',
    expressFile: expressMatchesPath,
    expressStartLine: 641,
    expressEndLine: 838,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/save-all/route.ts'),
    nextMethod: 'POST'
  },
  {
    name: 'POST / (create match)',
    expressFile: expressMatchesPath,
    expressStartLine: 839,
    expressEndLine: 983,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/route.ts'),
    nextMethod: 'POST'
  },
  {
    name: 'PUT /:id/entries',
    expressFile: expressMatchesPath,
    expressStartLine: 984,
    expressEndLine: 1133,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/entries/route.ts'),
    nextMethod: 'PUT'
  },
  {
    name: 'PATCH /:id/reopen-for-edit',
    expressFile: expressMatchesPath,
    expressStartLine: 1134,
    expressEndLine: 1158,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/reopen-for-edit/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'PATCH /:id/edit-scores',
    expressFile: expressMatchesPath,
    expressStartLine: 1159,
    expressEndLine: 1236,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/edit-scores/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'GET /history',
    expressFile: expressMatchesPath,
    expressStartLine: 1335,
    expressEndLine: 1355,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/history/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'GET /calendar',
    expressFile: expressMatchesPath,
    expressStartLine: 1356,
    expressEndLine: 1401,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/calendar/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'GET / (list matches)',
    expressFile: expressMatchesPath,
    expressStartLine: 1402,
    expressEndLine: 1549,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'GET /:id',
    expressFile: expressMatchesPath,
    expressStartLine: 1550,
    expressEndLine: 1620,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/route.ts'),
    nextMethod: 'GET'
  },
  {
    name: 'PATCH /:id',
    expressFile: expressMatchesPath,
    expressStartLine: 1621,
    expressEndLine: 1667,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'PATCH /:id/cancel',
    expressFile: expressMatchesPath,
    expressStartLine: 1668,
    expressEndLine: 1690,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/cancel/route.ts'),
    nextMethod: 'PATCH'
  },
  {
    name: 'DELETE /:id',
    expressFile: expressMatchesPath,
    expressStartLine: 1691,
    expressEndLine: 1722,
    nextFile: path.resolve(__dirname, '../client/src/app/api/matches/[id]/route.ts'),
    nextMethod: 'DELETE'
  },
  {
    name: 'GET /ready',
    expressFile: expressScoutPath,
    expressStartLine: 1,
    expressEndLine: 40,
    nextFile: path.resolve(__dirname, '../client/src/app/api/scout/ready/route.ts'),
    nextMethod: 'GET'
  }
];

function extractErrorsFromBlock(code, isNext = false) {
  const errors = [];
  const lines = code.split('\n');

  if (!isNext) {
    const regex = /res\.status\((\d{3})\)\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*\)/g;
    let m;
    while ((m = regex.exec(code)) !== null) {
      const lineNum = code.slice(0, m.index).split('\n').length;
      errors.push({
        line: lineNum,
        status: parseInt(m[1], 10),
        error: m[2].trim().replace(/^['"`]|['"`]$/g, '').replace(/\\n/g, ' ')
      });
    }
  } else {
    const regex = /NextResponse\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*,\s*\{\s*status:\s*(\d{3})\s*\}\s*\)/g;
    let m;
    while ((m = regex.exec(code)) !== null) {
      const lineNum = code.slice(0, m.index).split('\n').length;
      errors.push({
        line: lineNum,
        status: parseInt(m[2], 10),
        error: m[1].trim().replace(/^['"`]|['"`]$/g, '').replace(/\\n/g, ' ')
      });
    }
  }
  return errors;
}

const comparisonTable = [];
let totalDifferences = 0;

for (const r of routeMapping) {
  const expCodeAll = fs.readFileSync(r.expressFile, 'utf8').split('\n');
  const expBlock = expCodeAll.slice(r.expressStartLine - 1, r.expressEndLine).join('\n');
  const expErrors = extractErrorsFromBlock(expBlock, false);

  const nextCode = fs.readFileSync(r.nextFile, 'utf8');
  // If multiple methods in same file, isolate method block
  const methodRegex = new RegExp(`export\\s+async\\s+function\\s+${r.nextMethod}\\b[\\s\\S]*?(?=(?:export\\s+async\\s+function|$))`);
  const methodMatch = nextCode.match(methodRegex);
  const nextBlock = methodMatch ? methodMatch[0] : nextCode;
  const nextErrors = extractErrorsFromBlock(nextBlock, true);

  for (const exp of expErrors) {
    // Find matching Next error in this specific route block
    const matchingNext = nextErrors.find(n => n.status === exp.status && (
      n.error === exp.error ||
      // account for variable naming differences if any
      n.error.replace(/\$\{[^}]+\}/g, '{V}') === exp.error.replace(/\$\{[^}]+\}/g, '{V}')
    ));

    const isExactMatch = matchingNext && matchingNext.error === exp.error;
    if (!isExactMatch) totalDifferences++;

    comparisonTable.push({
      route: r.name,
      status: exp.status,
      expressError: exp.error,
      nextError: matchingNext ? matchingNext.error : 'MISSING',
      parity: isExactMatch ? 'EXACT_MATCH' : (matchingNext ? 'TEMPLATE_VAR_DIFF' : 'MISMATCH')
    });
  }
}

console.log('=== STRICT 1:1 ERROR COMPARISON: EXPRESS vs NEXT.JS ===\n');
console.log(`Evaluated ${comparisonTable.length} Express error paths across 19 route handlers.\n`);
console.table(comparisonTable);

console.log(`\nTotal Differences Found: ${totalDifferences}`);
if (totalDifferences > 0) {
  const diffs = comparisonTable.filter(c => c.parity !== 'EXACT_MATCH');
  console.log('\nDifferences List:');
  console.log(JSON.stringify(diffs, null, 2));
}

