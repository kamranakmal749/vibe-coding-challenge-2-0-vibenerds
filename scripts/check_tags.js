const fs = require('fs');
const html = fs.readFileSync('legacy/public/index.html', 'utf8');

// Parse tags with line numbers
const regex = /<\/?([a-zA-Z0-9\-]+)(?:\s+[^>]*)?>/g;
let match;
const stack = [];
const voidElements = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);

while ((match = regex.exec(html)) !== null) {
  const full = match[0];
  const tag = match[1].toLowerCase();
  const index = match.index;
  const line = html.substring(0, index).split('\n').length;

  if (voidElements.has(tag) || full.endsWith('/>')) {
    continue;
  }

  if (!full.startsWith('</')) {
    stack.push({ tag, line, full: full.slice(0, 50) });
  } else {
    let foundIdx = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag === tag) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx === -1) {
      console.log(`Unmatched closing tag: </${tag}> at line ${line}`);
    } else {
      if (foundIdx !== stack.length - 1) {
        console.log(`Tag mismatch at line ${line} for </${tag}>: unclosed tags inside:`, stack.slice(foundIdx + 1).map(s => `<${s.tag}> (L${s.line}: ${s.full})`));
      }
      stack.splice(foundIdx);
    }
  }
}
console.log('Unclosed at EOF:', stack.map(s => `<${s.tag}> (L${s.line}: ${s.full})`));

