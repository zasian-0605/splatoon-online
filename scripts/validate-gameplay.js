const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function capture(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error('Could not read ' + label);
  return match[1];
}

function literal(source, pattern, label) {
  return Function('return ' + capture(source, pattern, label))();
}

const weapons = Function('return [' + capture(html, /const weaponList = \[([\s\S]*?)\n\];/, 'base client weapons') + ']')();
weapons.push(...Function('return [' + capture(html, /weaponList\.push\(([\s\S]*?)\n  \);/, 'client wipers') + ']')());

const balance = literal(html, /const balance = (\{[\s\S]*?\n  \});/, 'client balance rules');
for (const weapon of weapons) Object.assign(weapon, balance[weapon.name] || {});

const categoryCosts = { shooter: .95, blaster: 2.6, charger: 9, roller: 4.5, maneuver: .75, slosher: 5, wiper: 7 };
for (const weapon of weapons) {
  if (weapon.inkCost == null) weapon.inkCost = categoryCosts[weapon.category] || 1.2;
}

weapons.push(...Function('return [' + capture(html, /const addedWeapons=\[([\s\S]*?)\n  \];/, 'expanded client weapons') + ']')());
const tune = literal(html, /const tune=(\{[\s\S]*?\n  \});/, 'final client weapon tuning');
for (const weapon of weapons) Object.assign(weapon, tune[weapon.name] || {});

const loadouts = literal(html, /const loadoutMap=(\{[\s\S]*?\n  \});/, 'client sub loadouts');
const canonicalSub = value => ({ trap: 'inkMine', tactic: 'pointSensor', robotBomb: 'autobomb' })[value] || value;
for (const weapon of weapons) {
  const loadout = loadouts[weapon.name];
  if (loadout) weapon.sub = canonicalSub(loadout[0]);
  else weapon.sub = canonicalSub(weapon.sub);
}

const serverWeapons = literal(server, /const SERVER_WEAPONS=(\{[\s\S]*?\n\});/, 'server weapons');
const serverCosts = Function('return [' + capture(server, /const SERVER_WEAPON_INK_COST=\[([\s\S]*?)\n\];/, 'server ink costs') + ']')();
const serverSubsByWeapon = literal(server, /const SERVER_SUB_BY_WEAPON=(\{[\s\S]*?\n\});/, 'server sub loadouts');
const serverSubs = literal(server, /const SERVER_SUBS=(\{[\s\S]*?\n\});/, 'server sub rules');
const serverSubCosts = literal(server, /const SERVER_SUB_INK_COST=(\{[\s\S]*?\n\});/, 'server sub ink costs');
const clientSubDefs = literal(html, /Object\.assign\(subDefs,(\{[\s\S]*?\n  \})\);/, 'client sub rules');

function equal(label, actual, expected) {
  if (actual === undefined || expected === undefined || actual === null || expected === null) {
    if (actual !== expected) throw new Error(label + ': client=' + actual + ', server=' + expected);
    return;
  }
  if (typeof actual === 'number' || typeof expected === 'number') {
    if (Math.abs(Number(actual) - Number(expected)) > .001) {
      throw new Error(label + ': client=' + actual + ', server=' + expected);
    }
  } else if (actual !== expected) {
    throw new Error(label + ': client=' + actual + ', server=' + expected);
  }
}

if (weapons.length !== 45 || Object.keys(serverWeapons).length !== 45 || serverCosts.length !== 45) {
  throw new Error('Expected 45 client and server weapons with 45 ink costs');
}

for (let id = 0; id < weapons.length; id++) {
  const client = weapons.find(weapon => weapon.id === id);
  const serverRule = serverWeapons[id];
  if (!client || !serverRule) throw new Error('Missing weapon id ' + id);
  for (const [clientKey, serverKey] of [
    ['category', 'cat'], ['damage', 'damage'], ['rate', 'rate'], ['range', 'range'], ['speed', 'speed'],
    ['explosionRadius', 'explosion'], ['splashDamage', 'splash'], ['tapDamage', 'tap'], ['fullDamage', 'full'],
    ['flickDamage', 'flickDamage'], ['flickRange', 'flickRange']
  ]) {
    if ((clientKey === 'rate' && client.rate === undefined) || (clientKey === 'speed' && ['roller', 'wiper'].includes(client.category)) || (clientKey === 'explosionRadius' && client.explosionRadius === undefined) || (clientKey === 'splashDamage' && client.splashDamage === undefined) || (clientKey === 'tapDamage' && client.tapDamage === undefined) || (clientKey === 'fullDamage' && client.fullDamage === undefined && client.category !== 'wiper')) continue;
    const value = clientKey === 'damage' ? (client.category === 'wiper' ? client.slashDamage : (client.damage ?? client.swingDamage ?? client.slashDamage))
      : clientKey === 'fullDamage' && client.category === 'wiper' ? client.chargedDamage
      : clientKey === 'rate' ? client.rate
      : clientKey === 'range' ? (client.category === 'roller' ? (client.swingRange ?? serverRule.range) : client.category === 'wiper' ? (client.slashRange ?? serverRule.range) : (client.range ?? 30))
      : clientKey === 'speed' ? (client.speed ?? client.speedShot ?? (client.category === 'roller' ? undefined : 35))
      : client[clientKey];
    equal('weapon ' + id + ' ' + clientKey, value, serverRule[serverKey]);
  }
  equal('weapon ' + id + ' ink cost', client.inkCost, serverCosts[id]);
  equal('weapon ' + id + ' sub', client.sub, serverSubsByWeapon[id]);
  if (!serverSubs[serverSubsByWeapon[id]]) throw new Error('Missing server sub behavior for weapon ' + id);
  const clientSub = clientSubDefs[client.sub];
  if (!clientSub) throw new Error('Missing client sub behavior for weapon ' + id + ': ' + client.sub);
  equal('weapon ' + id + ' sub ink cost', clientSub.inkCost, serverSubCosts[client.sub]);
}

const outfitBlock = capture(html, /const outfitList = \[([\s\S]*?)\n\];/, 'client outfit list');
const patterns = [...outfitBlock.matchAll(/pattern:"([^"]+)"/g)].map(match => match[1]);
const outfitSaver = Function('return [' + capture(server, /const SERVER_OUTFIT_INK_SAVER=\[([\s\S]*?)\n\];/, 'server outfit ink saver') + ']')();
const outfitRegen = Function('return [' + capture(server, /const SERVER_OUTFIT_INK_REGEN=\[([\s\S]*?)\n\];/, 'server outfit ink regen') + ']')();
if (patterns.length !== 50 || outfitSaver.length !== 50 || outfitRegen.length !== 50) {
  throw new Error('Expected 50 outfit ink modifiers');
}
patterns.forEach((pattern, id) => {
  const saver = pattern === 'shirt' ? .84 : pattern === 'hoodie' ? .92 : pattern === 'armor' ? 1.08 : 1;
  const regen = pattern === 'shirt' ? 1.12 : pattern === 'hoodie' ? 1.04 : 1;
  equal('outfit ' + id + ' ink saver', outfitSaver[id], saver);
  equal('outfit ' + id + ' ink regen', outfitRegen[id], regen);
});

console.log('Validated 45 client/server weapon stats, sub loadouts and ink costs, plus 50 outfit ink modifiers.');
