const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const runtime = fs.readFileSync('runtime.js', 'utf8');

for (const retired of ['V82 INK PHYSICS FIX', 'V90: obstacle-top wall launch fix', 'V91 COMPLETE: 8 guide bombs']) {
  if (html.includes(retired)) {
    throw new Error(`Retired wrapper ${retired} is still present in index.html.`);
  }
}

if ((runtime.match(/window\.updateBullets=updateCanonicalBullets/g) || []).length !== 1) {
  throw new Error('runtime.js must have exactly one canonical projectile updater assignment.');
}

console.log('canonical runtime audit passed');
