// scripts/diff-matches-errors.js
const fs = require('fs');
const path = require('path');

const expressMatchesFile = path.resolve(__dirname, '../legacy/src/routes/matches.js');
const expressScoutFile = path.resolve(__dirname, '../legacy/src/routes/scout.js');

function extractExpressErrors(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const errors = [];

  const regex = /res\.status\((\d{3})\)\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*\)/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const matchIndex = m.index;
    const lineNum = content.slice(0, matchIndex).split('\n').length;
    // Find closest preceding router.xxx
    const preceding = content.slice(0, matchIndex);
    const routeMatches = [...preceding.matchAll(/router\.(get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/gi)];
    const lastRoute = routeMatches.length > 0 ? routeMatches[routeMatches.length - 1] : null;
    const currentRoute = lastRoute ? `${lastRoute[1].toUpperCase()} ${lastRoute[2]}` : 'MIDDLEWARE/TOP';

    if (parseInt(m[1], 10) >= 400) {
      errors.push({
        file: path.basename(filePath),
        line: lineNum,
        route: currentRoute,
        status: parseInt(m[1], 10),
        error: m[2].trim().replace(/^['"`]|['"`]$/g, '').replace(/\\n/g, ' ')
      });
    }
  }
  return errors;
}

function extractNextErrors(dirPath) {
  const errors = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const content = fs.readFileSync(full, 'utf8');
        const relRoute = full
          .replace(/.*app[\\/]/, '/')
          .replace(/[\\/]route\.ts$/, '')
          .replace(/\\/g, '/');

        // Regex that spans multiple lines to find NextResponse.json({ ... }, { status: ... })
        const regex = /NextResponse\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*,\s*\{\s*status:\s*(\d{3})\s*\}\s*\)/g;
        let m;
        while ((m = regex.exec(content)) !== null) {
          const matchIndex = m.index;
          const lineNum = content.slice(0, matchIndex).split('\n').length;
          errors.push({
            file: path.basename(full),
            route: relRoute,
            line: lineNum,
            status: parseInt(m[2], 10),
            error: m[1].trim().replace(/^['"`]|['"`]$/g, '').replace(/\\n/g, ' ')
          });
        }
      }
    }
  }
  walk(dirPath);
  return errors;
}

const expressMatchesErrors = extractExpressErrors(expressMatchesFile);
const expressScoutErrors = extractExpressErrors(expressScoutFile);
const allExpressErrors = [...expressMatchesErrors, ...expressScoutErrors];

const nextMatchesErrors = extractNextErrors(path.resolve(__dirname, '../client/src/app/api/matches'));
const nextScoutErrors = extractNextErrors(path.resolve(__dirname, '../client/src/app/api/scout'));
const allNextErrors = [...nextMatchesErrors, ...nextScoutErrors];

console.log(`\n=== MATCH & SCOUT ERROR PATH ANALYSIS ===`);
console.log(`Total Express Error Paths: ${allExpressErrors.length}`);
console.log(`Total Next.js Error Paths: ${allNextErrors.length}\n`);

// Group by route and compare
console.log(`--- ROUTE-BY-ROUTE ERROR COMPARISON TABLE ---`);
const table = [];

function normalizeError(str) {
  return str
    .replace(/\$\{[^}]+\}/g, '{VAR}')
    .replace(/\s+/g, ' ')
    .trim();
}

for (const exp of allExpressErrors) {
  const normExp = normalizeError(exp.error);
  // Find matching error in Next.js by status and error string similarity
  const match = allNextErrors.find(n => {
    if (n.status !== exp.status) return false;
    const normNext = normalizeError(n.error);
    return (
      normNext === normExp ||
      normExp.includes(normNext) ||
      normNext.includes(normExp) ||
      (normExp.includes('Scoring is locked') && normNext.includes('Scoring is locked')) ||
      (normExp.includes('unlock') && normNext.includes('unlock'))
    );
  });

  table.push({
    expressRoute: `${exp.route} (L${exp.line})`,
    status: exp.status,
    expressError: exp.error.length > 50 ? exp.error.slice(0, 47) + '...' : exp.error,
    nextError: match ? (match.error.length > 50 ? match.error.slice(0, 47) + '...' : match.error) : 'MISSING',
    parity: match ? 'MATCH' : 'DIFFERENCE'
  });
}

console.table(table);

const diffs = table.filter(t => t.parity !== 'MATCH');
console.log(`\nDifferences Found: ${diffs.length}`);
if (diffs.length > 0) {
  console.log('List of differences:');
  console.log(JSON.stringify(diffs, null, 2));
}
