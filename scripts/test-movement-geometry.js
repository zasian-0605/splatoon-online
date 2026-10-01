const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('runtime.js', 'utf8');
const support = source.match(/const PLAYER_STEP_HEIGHT[\s\S]*?window\.getSupportHeight=supportHeight;/)?.[0];
const movement = source.match(/\/\* ---------- one movement[\s\S]*?window\.tryMoveWithCollision=canonicalMoveWithCollision;/)?.[0];
assert(support && movement, 'Canonical support and movement implementations must be present.');

const context = {
  console,
  window: {},
  collidableBlocks: [],
  n: (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  marketPointInPolygon: () => true,
  clampStageXY: (x, z) => ({ x, z })
};
vm.createContext(context);
vm.runInContext(`${support}\n${movement}`, context);

const block = { minX: 0, maxX: 4, minY: 0, maxY: 3, minZ: 0, maxZ: 4, climbable: true,
  mesh: { visible: true }, paintTeam: null, paintLevel: 0,
  __v108Marks: [{ team: 'A', face: 'minX', x: 0, y: .6, z: 2, r: 2 }] };
context.collidableBlocks.push({ minX: -10, maxX: 10, minY: -.1, maxY: 0, minZ: -10, maxZ: 10, mesh: { visible: true } }, block);

assert.equal(context.supportHeight(2, 2, 3.06), 3, 'upper floor must remain selected while standing on it');
assert.equal(context.supportHeight(-5, -5, 0), 0, 'lower floor must remain selected below the platform');

const fighter = { team: 'A', pos: { x: -.45, y: .2, z: 2 } };
assert.equal(context.canonicalMoveWithCollision(fighter, { x: 2, z: 0 }, .05, true), true, 'painted wall must start a climb');
assert(fighter.pos.y > .2, 'wall climb must raise the fighter');
for (let i = 0; i < 8; i++) context.canonicalMoveWithCollision(fighter, { x: 0, z: 0 }, .05, true);
assert(fighter.pos.y >= 3.05 && fighter.pos.x > 0, 'top-out must place the fighter on the upper floor');

console.log('canonical movement geometry passed');
