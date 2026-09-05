# The Phaser stub harness

Verifying a module of `src/static/sdk-libs/phaser/` needs no browser and no Phaser: `phaser-stub.mjs` is the one fake scene, so a verification script starts here rather than writing its own.

1. Import from the harness: `import { installGlobals, makeScene, makeStore, makeDom, makeAudioContext } from 'file:///C:/dev/aimeat-protocol/aimeat/test/unit/phaser-stub.mjs';` (plain node on Windows wants a `file:///` URL for an absolute path; a relative path or `pathToFileURL(p).href` does as well).
2. Put the browser in place BEFORE the module: `const restore = installGlobals({ motion: 'auto' });` (the chain tokens → boot → _core/config reads `location`, `document` and `window` at import time).
3. Import the module dynamically, after step 2: `const { fx } = await import('file:///C:/dev/aimeat-protocol/aimeat/src/static/sdk-libs/phaser/fx.js');`
4. Make a scene: `const scene = makeScene({ width: 960, height: 540, gravity: 900 });` and mount the module against it: `const f = fx(scene);`.
5. Drive time by hand: `scene.clock.advance(ms)` fires timers, tweens and camera effects in time order; `scene.step(ms)` is one frame (clock, arcade bodies by velocity, `preupdate`/`update`/`postupdate`); `scene.clock.pending()` is what is still owed.
6. Drive input by hand: `scene.input.keyboard.press('SPACE')` / `release('SPACE')` set `key.isDown` and fire `keydown-SPACE`; `scene.input.tap(x, y)` goes through `pointerdown` and `pointerup` to the interactive object under it.
7. Read what the module asked Phaser to do: `scene.log` holds every call as `{ kind, method, args, target }`, `scene.calls('particles', 'explode')` filters it, `scene.made` / `scene.live('graphics')` / `scene.last('text')` find objects, and each object carries its own `log`, its state (`x`, `alpha`, `depth`, `tint`, `visible`, `destroyed`) and, for graphics, its draw `ops`.
8. Less motion is an attribute: `restore.setMotion('less')` (or `installGlobals({ motion: 'less' })`) is what `reducedMotion()` reads; a burst then becomes the short puff, a bar snaps.
9. The other doors: `makeStore()` is a fake `saves()` handle recording every write in `store.log`; `makeDom()` is a document with `createElement`, bubbling events, `classList`, `dataset` and a working `querySelector`; `makeAudioContext()` records every node and `ctx.advance(seconds)` moves `currentTime` and fires `onended`; `scene.textures.register(key, w, h)` fakes a loaded sheet.
10. Finish with `restore()`. `phaser-stub.test.ts` (`pnpm vitest run test/unit/phaser-stub.test.ts`) is the worked example: fx.js, sprites-actor.js and boss.js mounted through their real import chain.

The limits worth knowing: a tween is linear in time (the ease is recorded, not applied) and sets its properties at every `advance`; a burst's `complete` fires after its longest `lifespan`; colliders run their callbacks on overlapping bodies inside `scene.step()` but nothing is pushed apart; `fx.js` waits on real `setTimeout` for its burst fallback and `juice.js` lets a slow-motion go on real time too, so drive a burst through the clock's `complete` and end a handle with `destroy()` rather than sleeping.
