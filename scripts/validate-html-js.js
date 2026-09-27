const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [];
const re = /<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi;
let match;
while ((match = re.exec(html))) {
  const code = match[1];
  if (code.trim()) scripts.push({ index: scripts.length + 1, code });
}

if (!scripts.length) throw new Error('No inline scripts found in index.html');

for (const script of scripts) {
  new vm.Script(script.code, { filename: 'index.html#script-' + script.index });
}

console.log('Validated ' + scripts.length + ' inline JavaScript blocks in index.html.');
