/**
 * @file test/unit/phaser-stub.test.ts
 * @description Proves the shared Phaser stub harness (phaser-stub.mjs) by mounting three real
 *   modules of src/static/sdk-libs/phaser/ against it through their real import chain
 *   (tokens → boot → _core/config, atelier/dom): fx.js explodes a burst once and the burst dies on
 *   the clock; sprites-actor.js jumps on the press edge of a key and lands once; boss.js runs a
 *   two-step pattern in order on the clock, with the fx and juice it makes for itself. A few
 *   checks on the harness's own doors (clock, input, store, dom, audio) sit at the end.
 * @usage cd aimeat && pnpm vitest run test/unit/phaser-stub.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { installGlobals, makeScene, makeStore, makeDom, makeAudioContext } from './phaser-stub.mjs';

const LIB = '../../src/static/sdk-libs/phaser/';

let restore: () => void;
let fx: any;
let actor: any;
let spriteSheet: any;
let boss: any;

beforeAll(async () => {
  // The globals go in first: the import chain reads location, document and window at load time.
  restore = installGlobals();
  ({ fx } = await import(LIB + 'fx.js'));
  ({ actor } = await import(LIB + 'sprites-actor.js'));
  ({ spriteSheet } = await import(LIB + 'sprites.js'));
  ({ boss } = await import(LIB + 'boss.js'));
});

afterAll(() => restore());

describe('fx.js against the harness', () => {
  it('a burst explodes once at the burst depth and dies on the clock', () => {
    const scene = makeScene();
    const f = fx(scene);                              // no theme given: look(scene) walks canvas → parent → getComputedStyle
    const e = f.at(100, 200, 'explosion', { count: 9 });
    expect(e.kind).toBe('particles');
    expect(e.x).toBe(100);
    expect(e.y).toBe(200);
    expect(e.exploded).toEqual([[9, undefined, undefined]]);
    expect(e.config.emitting).toBe(false);
    expect(e.depth).toBe(850);
    expect(scene.calls('particles', 'explode').length).toBe(1);
    expect(scene.textures.exists(e.texture.key)).toBe(true);
    expect(e.destroyed).toBe(false);
    scene.clock.advance(e.config.lifespan.max - 1);
    expect(e.destroyed).toBe(false);
    scene.clock.advance(1);
    expect(e.destroyed).toBe(true);
    expect(e.scene).toBeUndefined();
    expect(scene.live('particles').length).toBe(0);
    f.destroy();
  });

  it('weather sits camera-fixed under the HUD and the scene shutdown takes it down', () => {
    const scene = makeScene();
    const f = fx(scene);
    const rain = f.weather('rain', { wind: 120 });
    expect(rain.emitter.scrollFactorX).toBe(0);
    expect(rain.emitter.depth).toBe(800);
    expect(rain.emitter.emitting).toBe(true);
    expect(scene.scale.listenerCount('resize')).toBe(1);
    scene.scale.resize(400, 300);
    expect(rain.emitter.config.emitZone.source.w).toBe(400 + 96 + Math.min(400, 288));
    scene.events.emit('shutdown');
    expect(rain.emitter).toBeNull();
    expect(scene.live('particles').length).toBe(0);
    expect(scene.scale.listenerCount('resize')).toBe(0);
  });
});

describe('sprites-actor.js against the harness', () => {
  it('an actor jumps on the press edge of a key and lands once', () => {
    const scene = makeScene();
    const sheet = spriteSheet(scene, { kind: 'hero' });
    expect(sheet.frames).toBe(14);
    expect(scene.textures.get('hero').frames.size).toBe(15);   // 14 cells + __BASE
    const a = actor(scene, { key: 'hero', x: 10, y: 20 });
    const seen: string[] = [];
    a.on('state', (n: string) => seen.push(n));
    a.on('land', () => seen.push('LAND'));
    const jump = scene.input.keyboard.addKey('SPACE');
    const body = a.sprite.body;
    body.blocked.down = true;
    a.update({});
    expect(a.state).toBe('idle');
    expect(a.sprite.playing).toBe('hero-idle');

    scene.input.keyboard.press('SPACE');
    a.update({ jump: jump.isDown });
    expect(body.velocity.y).toBe(-420);
    expect(a.state).toBe('jump');
    expect(a.sprite.playing).toBe('hero-jump');

    body.blocked.down = false;
    body.velocity.y = -100;
    a.update({ jump: jump.isDown });                  // still held: no second launch
    expect(body.velocity.y).toBe(-100);

    scene.input.keyboard.release('SPACE');
    body.velocity.y = 60;
    a.update({ jump: jump.isDown });
    expect(a.state).toBe('fall');

    body.blocked.down = true;
    body.velocity.y = 0;
    a.update({ jump: jump.isDown });
    a.update({ jump: jump.isDown });
    expect(a.state).toBe('idle');
    expect(seen).toEqual(['jump', 'fall', 'LAND', 'idle']);
    expect(scene.events.listenerCount('shutdown')).toBe(1);
  });

  it('a hit flashes in the theme err colour and the stun ends on the clock', () => {
    const scene = makeScene();
    spriteSheet(scene, { kind: 'hero' });
    const a = actor(scene, { key: 'hero', x: 10, y: 20 });
    a.sprite.body.blocked.down = true;
    expect(a.hit({ from: { x: 30, y: 20 } })).toBe(true);
    expect(a.sprite.tint).toBe(0xb3261e);              // boot.js NO_KIT.err: no stylesheet in the stub
    expect(a.sprite.tintMode).toBe(1);                 // Phaser.TintModes.FILL off window.Phaser
    expect(a.sprite.body.velocity.x).toBe(-(220 * 0.8));
    expect(scene.clock.liveTweens().length).toBe(1);   // the blink
    scene.clock.advance(90);
    expect(a.sprite.isTinted).toBe(false);
    scene.clock.advance(200);
    expect(a.state).toBe('idle');
    a.destroy();
    expect(scene.clock.pending()).toBe(0);
    expect(a.sprite.destroyed).toBe(true);
  });
});

describe('boss.js against the harness', () => {
  it('a two-step pattern runs in order on the clock, with the fx and juice the boss makes itself', () => {
    const scene = makeScene();
    const sprite = scene.physics.add.sprite(480, 120, 'boss');
    sprite.setDisplaySize(40, 40);
    const log: Array<[string, number, any?]> = [];
    const fires: any[] = [];
    const b = boss(scene, {
      actor: sprite, health: 100, name: 'Warden', target: { x: 480, y: 400 },
      patterns: { p: [{ wait: 100 }, { move: { x: 200, y: 120, ms: 200 } }, { telegraph: { ms: 150, kind: 'ring' } }, { fire: { kind: 'spread', count: 5, spread: 60 } }] },
      phases: [{ at: 1, name: 'one', patterns: ['p'], loop: false }],
      onFire: (o: any, angles: number[]) => fires.push({ t: scene.clock.now, kind: o.kind, angles }),
    });
    b.on('pattern', (n: string) => log.push(['pattern', scene.clock.now, n]));
    b.on('telegraph', (p: any) => log.push(['telegraph', scene.clock.now, p.kind]));
    b.on('fire', () => log.push(['fire', scene.clock.now]));
    b.start();
    expect(b.phase()).toBe('one');
    expect(b.running()).toBe(true);
    scene.clock.advance(100);
    expect(sprite.x).toBe(480);                        // the wait is over, the move has not begun to land
    scene.clock.advance(100);
    expect(sprite.x).toBe(340);                        // halfway through the 200 ms move
    expect(sprite.body.moves).toBe(false);             // the tween holds the body
    scene.clock.advance(100);
    expect(sprite.x).toBe(200);
    expect(sprite.body.moves).toBe(true);
    expect(log).toEqual([['pattern', 0, 'p'], ['telegraph', 300, 'ring']]);
    const ring = scene.live('graphics', (g: any) => g.ops.some((op: any[]) => op[0] === 'strokeCircle'));
    expect(ring.length).toBe(1);
    scene.clock.advance(150);
    expect(fires.length).toBe(1);
    expect(fires[0].t).toBe(450);
    expect(fires[0].angles.length).toBe(5);
    expect(log[2]).toEqual(['fire', 450]);
    expect(ring[0].destroyed).toBe(true);
    expect(b.running()).toBe(false);
    b.destroy();
    expect(scene.clock.pending()).toBe(0);
    expect(scene.events.listenerCount('shutdown')).toBe(0);   // the boss, its fx and its juice all left
  });

  it('zero runs the defeat once, through fx explosions and a juice slow-motion, on the clock', () => {
    const scene = makeScene();
    const sprite = scene.physics.add.sprite(300, 200, 'boss');
    const b = boss(scene, { actor: sprite, health: 50, patterns: { p: [{ wait: 100 }] } });
    let defeats = 0;
    b.on('defeat', () => { defeats += 1; });
    b.start();
    expect(b.damage(1000)).toBe(0);
    expect(defeats).toBe(0);
    scene.clock.runAll(10000);
    expect(scene.calls('particles', 'explode').length).toBe(3);
    expect(defeats).toBe(1);
    expect(sprite.visible).toBe(false);
    expect(scene.clock.timeScale).toBe(0.35);          // juice lets the slow-motion go on REAL time, so it is still holding
    expect(b.damage(5)).toBe(0);
    b.destroy();                                       // cancels juice's real timeout and puts the clocks back
    expect(scene.clock.timeScale).toBe(1);
  });
});

describe('the harness on its own', () => {
  it('runs timers and tweens in time order, with yoyo and repeat, and honours pause', () => {
    const scene = makeScene();
    const order: string[] = [];
    const box = { alpha: 1, x: 0 };
    scene.time.delayedCall(50, () => order.push('t50'));
    const tw = scene.tweens.add({ targets: box, alpha: 0.5, duration: 20, yoyo: true, repeat: 1, onComplete: () => order.push('tween') });
    scene.time.addEvent({ delay: 30, callback: () => order.push('loop'), loop: true });
    scene.tweens.add({ targets: box, x: 100, duration: 100 });
    scene.clock.advance(10);
    expect(box.alpha).toBe(0.75);
    expect(box.x).toBe(10);
    tw.pause();
    scene.clock.advance(60);
    expect(order).toEqual(['loop', 't50', 'loop']);
    tw.resume();                                       // 70 ms of the tween's 80 are left: it completes at 140
    scene.clock.advance(70);
    expect(order).toEqual(['loop', 't50', 'loop', 'loop', 'loop', 'tween']);
    expect(box.alpha).toBe(1);
    expect(box.x).toBe(100);
    expect(scene.clock.liveTimers().length).toBe(1);   // the loop
  });

  it('a tap reaches the interactive object under it and the plain pointer events', () => {
    const scene = makeScene();
    const seen: string[] = [];
    const r = scene.add.rectangle(100, 100, 40, 40, 0x000000).setInteractive();
    r.on('pointerdown', () => seen.push('rect'));
    scene.input.on('pointerdown', (p: any) => seen.push('input:' + p.x));
    scene.input.on('gameobjectup', (_p: any, g: any) => seen.push('up:' + g.kind));
    scene.input.tap(110, 105);
    scene.input.tap(300, 300);
    expect(seen).toEqual(['rect', 'input:110', 'up:rectangle', 'input:300']);
  });

  it('the store records writes and tells its listeners; the dom answers a selector; audio time advances', () => {
    const store = makeStore({ best: 3 });
    const heard: any[] = [];
    store.onChange((s: any) => heard.push(s.best));
    store.set({ best: 9 });
    expect(store.log[0]).toEqual({ op: 'set', keys: ['best'], patch: { best: 9 } });
    expect(heard).toEqual([9]);
    expect(store.levels.unlock('l2')).toBe(true);
    expect(store.levels.isUnlocked('l2')).toBe(true);

    const { document } = makeDom();
    const panel = document.createElement('div');
    panel.className = 'ak-panel';
    const button = document.createElement('button');
    button.textContent = 'Go';
    button.dataset.act = 'go';
    panel.appendChild(button);
    document.body.appendChild(panel);
    let clicks = 0;
    panel.addEventListener('click', (e: any) => { clicks += 1; expect(e.target).toBe(button); });
    button.click();
    expect(clicks).toBe(1);
    expect(document.querySelector('.ak-panel > button[data-act="go"]')).toBe(button);
    expect(document.querySelector('#nothing')).toBeNull();

    const ctx = makeAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(440, 0);
    let ended = 0;
    osc.onended = () => { ended += 1; };
    osc.start(0);
    osc.stop(0.5);
    ctx.advance(0.4);
    expect(ended).toBe(0);
    ctx.advance(0.1);
    expect(ended).toBe(1);
    expect(gain.target).toBe(ctx.destination);
    expect(osc.frequency.calls[0]).toMatchObject({ m: 'setValueAtTime', v: 440 });
  });
});
