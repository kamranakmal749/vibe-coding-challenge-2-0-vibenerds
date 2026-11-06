// scripts/list-next-only-errors.js
const fs = require('fs');
const path = require('path');

const expressMatchesFile = path.resolve(__dirname, '../src/routes/matches.js');
const expressScoutFile = path.resolve(__dirname, '../src/routes/scout.js');

function extractExpressErrors(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const errors = [];
  const regex = /res\.status\((\d{3})\)\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*\)/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    const matchIndex = m.index;
    const lineNum = content.slice(0, matchIndex).split('\n').length;
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
        const relRoute = full.replace(/.*app[\\/]/, '/').replace(/[\\/]route\.ts$/, '').replace(/\\/g, '/');
        const regex = /NextResponse\.json\(\s*\{[\s\S]*?error:\s*([`'"][^`'"]+[`'"]|err\.message|[^,}]+)[\s\S]*?\}\s*,\s*\{\s*status:\s*(\d{3})\s*\}\s*\)/g;
        let m;
        while ((m = regex.exec(content)) !== null) {
          const matchIndex = m.index;
          const lineNum = content.slice(0, matchIndex).split('\n').length;
          errors.push({
            file: path.basename(full),
            relPath: full.replace(/.*client[\\/]/, ''),
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

const expressErrors = [...extractExpressErrors(expressMatchesFile), ...extractExpressErrors(expressScoutFile)];
const nextErrors = [
  ...extractNextErrors(path.resolve(__dirname, '../client/src/app/api/matches')),
  ...extractNextErrors(path.resolve(__dirname, '../client/src/app/api/scout'))
];

function normalize(s) {
  return s.replace(/\$\{[^}]+\}/g, '{VAR}').replace(/\s+/g, ' ').trim();
}

// Track matched Next.js errors
const matchedNextIndices = new Set();
for (const exp of expressErrors) {
  const normExp = normalize(exp.error);
  const idx = nextErrors.findIndex((n, i) => {
    if (matchedNextIndices.has(i)) return false;
    if (n.status !== exp.status) return false;
    const normNext = normalize(n.error);
    return (
      normNext === normExp ||
      normExp.includes(normNext) ||
      normNext.includes(normExp) ||
      (normExp.includes('Scoring is locked') && normNext.includes('Scoring is locked')) ||
      (normExp.includes('unlock') && normNext.includes('unlock'))
    );
  });
  if (idx !== -1) {
    matchedNextIndices.add(idx);
  }
}

const nextOnly = nextErrors.filter((_, i) => !matchedNextIndices.has(i));
console.log('Total Next.js only error paths in Matches & Scout:', nextOnly.length);
console.table(nextOnly.map(n => ({
  file: n.file,
  route: n.route,
  line: n.line,
  status: n.status,
  error: n.error
})));
