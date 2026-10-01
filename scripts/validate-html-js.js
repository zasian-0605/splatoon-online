const fs = require('fs');
const vm = require('vm');
const path = require('path');

function validate(code, filename){
  new vm.Script(code, { filename });
}

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [];
const inlineRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = inlineRe.exec(html))) {
  const code = match[1];
  if (code.trim()) scripts.push({ index: scripts.length + 1, code });
}
if (!scripts.length) throw new Error('No inline scripts found in index.html');
for (const script of scripts) {
  validate(script.code, 'index.html#script-' + script.index);
}

const external = [];
const srcRe = /<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*><\/script>/gi;
while ((match = srcRe.exec(html))) {
  const src = match[1].split('?')[0];
  if (!src.startsWith('/') || src.startsWith('/node_modules/')) continue;
  const file = path.resolve('.', src.replace(/^\/+/, ''));
  if (!fs.existsSync(file)) throw new Error('Missing external script: ' + src);
  external.push({ src, file });
}
for (const item of external) {
  validate(fs.readFileSync(item.file, 'utf8'), item.src);
}

console.log('Validated ' + scripts.length + ' inline JavaScript blocks and ' + external.length + ' local external JavaScript files.');
