const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const online = fs.readFileSync(path.join(root, 'online-runtime.js'), 'utf8');

function capture(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error('Could not read ' + label);
  return match[1];
}
function literal(source, pattern, label) {
  return Function('return ' + capture(source, pattern, label))();
}
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

const weapons = literal(html, /const weaponList = (\[[\s\S]*?\n\]);/, 'current client weapon list');
if (weapons.length !== 3) throw new Error('Expected exactly 3 playable client weapons');
const ids = weapons.map(w => w.id).sort((a,b) => a-b);
if (ids.join(',') !== '0,1,2') throw new Error('Client weapon IDs must be exactly 0,1,2');

const balance = literal(html, /const balance = (\{[\s\S]*?\n  \});/, 'client balance rules');
for (const weapon of weapons) Object.assign(weapon, balance[weapon.name] || {});

const loadoutMap = literal(html, /const loadoutMap=(\{[\s\S]*?\n  \});/, 'client loadout map');
for (const weapon of weapons) {
  const loadout = loadoutMap[weapon.name];
  if (loadout) {
    weapon.sub = loadout[0] === 'trap' ? 'inkMine' : loadout[0];
    weapon.special = loadout[1];
  }
}

const serverWeapons = literal(server, /const SERVER_WEAPONS=(\{[\s\S]*?\n\});/, 'server weapons');
const serverCosts = literal(server, /const SERVER_WEAPON_INK_COST=(\[[\s\S]*?\n\]);/, 'server weapon ink costs');
const serverSubs = literal(server, /const SERVER_SUB_BY_WEAPON=(\{[\s\S]*?\n\});/, 'server sub loadouts');
const serverSpecials = literal(server, /const SERVER_SPECIAL_BY_WEAPON=(\{[\s\S]*?\n\});/, 'server special loadouts');

if (Object.keys(serverWeapons).map(Number).sort((a,b)=>a-b).join(',') !== '0,1,2') {
  throw new Error('Server weapon IDs must be exactly 0,1,2');
}
if (serverCosts.length !== 3) throw new Error('Server weapon ink-cost table must contain exactly 3 entries');

const expected = [
  {id:0,name:'スプラシューター',category:'shooter',damage:32,rate:95,range:32,speed:34,inkCost:1.0,sub:'splatBomb',special:'ウルトラショット'},
  {id:1,name:'バケットスロッシャー',category:'slosher',damage:68,rate:500,range:25,speed:19,explosionRadius:2.4,inkCost:4.8,sub:'fizzyBomb',special:'ナイスダマ'},
  {id:2,name:'スプラマニューバー',category:'maneuver',damage:28,rate:55,range:30,speed:38,inkCost:.75,sub:'splatBomb',special:'カニタンク'}
];

for (const expectedWeapon of expected) {
  const client = weapons.find(w => w.id === expectedWeapon.id);
  const serverRule = serverWeapons[expectedWeapon.id];
  if (!client || !serverRule) throw new Error('Missing weapon ' + expectedWeapon.id);
  equal('weapon '+expectedWeapon.id+' name', client.name, expectedWeapon.name);
  equal('weapon '+expectedWeapon.id+' category', client.category, expectedWeapon.category);
  equal('weapon '+expectedWeapon.id+' damage', client.damage, expectedWeapon.damage);
  equal('weapon '+expectedWeapon.id+' rate', client.rate, expectedWeapon.rate);
  equal('weapon '+expectedWeapon.id+' range', client.range, expectedWeapon.range);
  equal('weapon '+expectedWeapon.id+' speed', client.speed, expectedWeapon.speed);
  equal('weapon '+expectedWeapon.id+' ink cost', client.inkCost, expectedWeapon.inkCost);
  equal('weapon '+expectedWeapon.id+' sub', client.sub, expectedWeapon.sub);
  equal('weapon '+expectedWeapon.id+' special', client.special, expectedWeapon.special);

  if (client.name === 'バケットスロッシャー') equal('bucket explosion', client.explosionRadius, expectedWeapon.explosionRadius);
  equal('server weapon category '+expectedWeapon.id, serverRule.cat, expectedWeapon.category);
  equal('server damage '+expectedWeapon.id, serverRule.damage, expectedWeapon.damage);
  equal('server rate '+expectedWeapon.id, serverRule.rate, expectedWeapon.rate);
  equal('server range '+expectedWeapon.id, serverRule.range, expectedWeapon.range);
  equal('server speed '+expectedWeapon.id, serverRule.speed, expectedWeapon.speed);
  if (expectedWeapon.explosionRadius != null) equal('server explosion '+expectedWeapon.id, serverRule.explosion, expectedWeapon.explosionRadius);
  equal('server ink cost '+expectedWeapon.id, serverCosts[expectedWeapon.id], expectedWeapon.inkCost);
  equal('server sub '+expectedWeapon.id, serverSubs[expectedWeapon.id], expectedWeapon.sub);
  equal('server special '+expectedWeapon.id, serverSpecials[expectedWeapon.id], expectedWeapon.special);
}

if (/name:"スプラローラー"/.test(capture(html, /const weaponList = (\[[\s\S]*?\n\]);/, 'current client weapon list')) ||
    /name:"スプラチャージャー"/.test(capture(html, /const weaponList = (\[[\s\S]*?\n\]);/, 'current client weapon list'))) {
  throw new Error('Removed roller/charger are still in the playable roster');
}

const aiBlock = capture(html, /const choices=\[([\s\S]*?)\n    \];/, 'AI weapon choices');
const aiChoices = [...aiBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
if (aiChoices.join('|') !== 'スプラシューター|バケットスロッシャー|スプラマニューバー') {
  throw new Error('AI weapon pool does not match the 3 playable weapons');
}

if (!/Math\.max\(0,Math\.min\(2,Math\.floor\(weapon\)\)\):0/.test(online)) {
  throw new Error('Online client weapon ID clamp is not 0..2');
}

const outfitBlock = capture(html, /const outfitList = \[([\s\S]*?)\n\];/, 'client outfit list');
const patterns = [...outfitBlock.matchAll(/pattern:"([^"]+)"/g)].map(m => m[1]);
const outfitSaver = literal(server, /const SERVER_OUTFIT_INK_SAVER=(\[[\s\S]*?\n\]);/, 'server outfit ink saver');
const outfitRegen = literal(server, /const SERVER_OUTFIT_INK_REGEN=(\[[\s\S]*?\n\]);/, 'server outfit ink regen');
if (patterns.length !== 50 || outfitSaver.length !== 50 || outfitRegen.length !== 50) {
  throw new Error('Expected 50 outfit ink modifiers');
}
patterns.forEach((pattern, id) => {
  const saver = pattern === 'shirt' ? .84 : pattern === 'hoodie' ? .92 : pattern === 'armor' ? 1.08 : 1;
  const regen = pattern === 'shirt' ? 1.12 : pattern === 'hoodie' ? 1.04 : 1;
  equal('outfit ' + id + ' ink saver', outfitSaver[id], saver);
  equal('outfit ' + id + ' ink regen', outfitRegen[id], regen);
});

if (!/Math\.max\(0, Math\.min\(2, Math\.floor\(Number\(c\.weapon\)\)\)\)/.test(server)) {
  throw new Error('Server config weapon clamp is not 0..2');
}
if (!/Math\.max\(0, Math\.min\(2, Math\.floor\(Number\(m\.weaponId\)\)\)\)/.test(server)) {
  throw new Error('Server joinQueue weapon clamp is not 0..2');
}

console.log('Validated the current 3-weapon client/server contract, online weapon-ID bounds, sub/special mappings, and 50 outfit modifiers.');
