// scripts/audit-client-imports.js
const fs = require('fs');
const path = require('path');

const clientRoot = path.resolve(__dirname, '../client');
const issues = [];

function checkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      checkDir(full);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // match require(...) or import ... from '...' or import('...')
        const regexes = [
          /import\s+.*?from\s+['"]([^'"]+)['"]/,
          /import\s*\(['"]([^'"]+)['"]\)/,
          /require\s*\(['"]([^'"]+)['"]\)/
        ];
        for (const r of regexes) {
          const m = line.match(r);
          if (m) {
            const importPath = m[1];
            if (importPath.startsWith('.')) {
              const resolved = path.resolve(path.dirname(full), importPath);
              if (!resolved.startsWith(clientRoot)) {
                issues.push({
                  file: path.relative(clientRoot, full).replace(/\\/g, '/'),
                  line: idx + 1,
                  importPath,
                  resolvedPath: resolved.replace(/\\/g, '/')
                });
              }
            } else if (importPath.startsWith('/') || importPath.includes('src/') || importPath.includes('scripts/')) {
              // check if it refers to repo root outside client
              if (!importPath.startsWith('@/') && !importPath.startsWith('next/') && !importPath.startsWith('react')) {
                issues.push({
                  file: path.relative(clientRoot, full).replace(/\\/g, '/'),
                  line: idx + 1,
                  importPath,
                  resolvedPath: 'SUSPICIOUS_PATH'
                });
              }
            }
          }
        }
      });
    }
  }
}

checkDir(clientRoot);

console.log('=== CLIENT IMPORT AUDIT (OUTSIDE ROOT DIRECTORY) ===\n');
console.log(`Audited directory: ${clientRoot}`);
console.log(`Total files inspected in client/ (excluding node_modules & .next).\n`);

if (issues.length === 0) {
  console.log('✓ Zero imports or requires reach outside client/ !');
} else {
  console.log(`Found ${issues.length} imports reaching outside client/:`);
  console.table(issues);
}

