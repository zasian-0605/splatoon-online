# Canonical runtime consolidation audit

This audit covers the executable code in `index.html`, `runtime.js`,
`specials.js`, and `online.js`.  The retired V82, V90, and V91 inline scripts
were removed from `index.html`; only short retirement comments remain, so those
wrappers can no longer register assignments at page load.

## Final owners

| Concern | Final implementation | Previous duplicate path removed/isolated |
| --- | --- | --- |
| Projectile update | `runtime.js:updateCanonicalBullets` | V82 projectile wrapper and its second `updateV82` pass |
| Player movement, collision, and wall climbing | `specials.js:movementOverride` plus the collision-aware base movement selected at load | V90/V91 special movement wrappers |
| Persistent special effects | `specials.js:updateCanon` | chained V90/V91/inline `updateOngoingEffects` calls |
| Normal shot transport | `online.js:sendOnlineShot` | direct sender aliases delegate to `sendOnlineGameplay` |
| Sub transport | `online.js:sendOnlineSub` | legacy proxy messages are normalized by `forwardLegacy` |
| Special transport | `online.js:sendOnlineSpecial` | direct WebSocket send in `specials.js` |

`tryShoot` is owned by `runtime.js:canonicalTryShoot`, while its special-mode
dispatch intentionally invokes the `specials.js` handler captured before the
runtime is loaded. `fireSpecial` is owned by `specials.js:fireCanonical`.

## Stage gates and smoke checks

Run these checks **before deleting the next retired block**, and again after
the change.  They are deliberately retained as release gates for each stage:

1. **Projectile consolidation:** normal shot fires once, paints once, expires
   once; verify a sub throw, wall climb, respawn, CPU match, and online match.
2. **Movement consolidation:** walk/squid collision, painted-wall climb and
   wall release work; verify normal shot, sub, respawn, CPU match, and online
   match.
3. **Special effect consolidation:** activate a duration special and confirm
   its timer, damage, and cleanup advance once per frame; verify normal shot,
   sub, wall climb, respawn, CPU match, and online match.
4. **Network consolidation:** send and receive a normal shot, sub, and special
   between two clients; verify wall climb, respawn synchronization, and a CPU
   match remains local-only.

## Static guard

`npm run audit:canonical-runtime` fails if a retired inline script is made
executable again or if the canonical projectile updater is reassigned outside
`runtime.js`.
