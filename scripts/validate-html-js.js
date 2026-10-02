const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [];
const inlineRe = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = inlineRe.exec(html))) {
  const code = match[1];
  if (code.trim()) scripts.push({ type: 'inline', index: scripts.length + 1, code });
}

const externalRe = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi;
while ((match = externalRe.exec(html))) {
  const src = match[1];
  if (/^https?:\/\//i.test(src)) {
    console.log('Skipping remote script: ' + src);
    continue;
  }
  const localSrc = src.split(/[?#]/,1)[0];
  const file = require('path').resolve(process.cwd(), localSrc.replace(/^\/+/, ''));
  const code = fs.readFileSync(file, 'utf8');
  scripts.push({ type: 'external', index: scripts.length + 1, src, code });
}

if (!scripts.length) throw new Error('No JavaScript blocks found in index.html');
for (const script of scripts) {
  new vm.Script(script.code, {
    filename: script.type === 'external' ? script.src : 'index.html#script-' + script.index
  });
}
console.log('Validated ' + scripts.length + ' JavaScript blocks (inline + local external) in index.html.');
