/**
 * @file test/unit/atelier-springs.test.ts
 * @description The live spring (atelier/springs.js) on the stub browser with motion ON: a value
 *   lands exactly on its target and stops asking for frames, a retarget mid-flight keeps the
 *   speed it had instead of starting over, the house hand overshoots by at most a few percent,
 *   and in the edge pair the edge in the direction of travel leads, which is what stretches the
 *   ink toward where it is going.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-springs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (atelier 0.55.0, the ten motion parts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: any;
let springs: any;

beforeAll(async () => {
  restore = installGlobals({ motion: 'auto' });
  springs = await import('../../src/static/sdk-libs/atelier/springs.js');
});
afterAll(() => restore());

const HOUSE = { stiffness: 170, damping: 20, mass: 1 };

/** Run the pure integrator for `seconds` and report the path. */
function path(target: number, seconds: number, feel = HOUSE, v0 = 0) {
  let s = { x: 0, v: v0 };
  const xs: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    s = springs.stepSpring(s, target, feel, 1 / 60);
    xs.push(s.x);
  }
  return xs;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('stepSpring, the integrator', () => {
  it('arrives at the target and stays there', () => {
    const xs = path(100, 2);
    expect(Math.abs(xs[xs.length - 1] - 100)).toBeLessThan(0.05);
  });

  it('overshoots by at most a few percent on the house hand', () => {
    const peak = Math.max(...path(100, 2));
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThan(104);
  });

  it('does not overshoot at all when the damping is critical or more', () => {
    const peak = Math.max(...path(100, 3, { stiffness: 170, damping: 30, mass: 1 }));
    expect(peak).toBeLessThanOrEqual(100.0001);
  });

  it('a stiffer spring gets further in the same time', () => {
    const slow = path(100, 0.1)[5];
    const fast = path(100, 0.1, { stiffness: 408, damping: 31, mass: 1 })[5];
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('liveSpring', () => {
  it('lands exactly on the target, then reports once with zero speed and stops', async () => {
    const seen: Array<[number, number]> = [];
    const s = springs.liveSpring((x: number, v: number) => seen.push([x, v]), { value: 0, stiffness: 600, damping: 50, mass: 1 });
    s.set(50);
    expect(s.moving()).toBe(true);
    for (let i = 0; i < 100 && s.moving(); i++) await wait(10);
    expect(s.moving()).toBe(false);
    expect(seen[seen.length - 1]).toEqual([50, 0]);
    const count = seen.length;
    await wait(40);
    expect(seen.length).toBe(count); // no frames at rest
  });

  it('a new target mid-flight keeps the speed it had rather than starting from rest', async () => {
    const s = springs.liveSpring(() => {}, { value: 0, stiffness: 170, damping: 20, mass: 1 });
    s.set(100);
    await wait(40);
    const v = s.velocity();
    expect(v).toBeGreaterThan(0);
    s.set(-100);
    expect(s.velocity()).toBe(v);
    s.destroy();
  });

  it('jump() lands at once with zero speed', () => {
    const seen: number[] = [];
    const s = springs.liveSpring((x: number) => seen.push(x), { value: 0 });
    s.jump(12);
    expect(seen).toEqual([12]);
    expect(s.moving()).toBe(false);
  });
});

describe('edgePair, the ink under the hand', () => {
  it('moving forward, the end edge leads and the box stretches on the way', async () => {
    let drawn: [number, number] = [0, 40];
    const pair = springs.edgePair((a: number, b: number) => { drawn = [a, b]; }, { start: 0, end: 40, stiffness: 170, damping: 20, mass: 1 });
    pair.set(200, 240);
    await wait(50);
    const [a, b] = drawn;
    expect(b - 40).toBeGreaterThan(a); // the end edge has travelled further than the start edge
    expect(b - a).toBeGreaterThan(40); // so the box is wider than at rest
    for (let i = 0; i < 200 && pair.moving(); i++) await wait(10);
    expect(pair.edges()[0]).toBeCloseTo(200, 1);
    expect(pair.edges()[1]).toBeCloseTo(240, 1);
  });

  it('moving backward, the start edge leads', async () => {
    let drawn: [number, number] = [200, 240];
    const pair = springs.edgePair((a: number, b: number) => { drawn = [a, b]; }, { start: 200, end: 240, stiffness: 170, damping: 20, mass: 1 });
    pair.set(0, 40);
    await wait(50);
    const [a, b] = drawn;
    expect(200 - a).toBeGreaterThan(240 - b);
    pair.destroy();
  });
});
