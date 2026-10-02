/**
 * @file test/unit/atelier-board.test.ts
 * @description The Atelier kit's board over a stub AIMEAT.viewport: the keyed reconcile (add,
 *   move, remove, re-render on rev), the chrome and its action buttons, selection, the pointer
 *   claim for a head, a grip and a body in each mode, the ring geometry and a drop into a ring,
 *   the Move/Use switch, the keyboard nudge, the sample state, and the static layout when the
 *   viewport library is absent.
 * @version-history
 *   v1.0.0 - 2026-10-02 - Initial (wish-origami-atelieriin-ja-laudan-osat-kitin-lohkoiksi-ja-design-).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installGlobals } from './phaser-stub.mjs';

let restore: () => void;
let kit: any;
let vpOpts: any;
let vpCalls: Array<{ op: string; args: any }>;

function all(root: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => { out.push(n); for (const c of n.children || []) walk(c); };
  walk(root);
  return out;
}
const part = (root: any, name: string) => all(root).filter((n) => n.attrs && n.attrs['data-ak-part'] === name);
const frameEl = (root: any, id: string) => all(root).find((n) => n.attrs && n.attrs['data-ak-part'] === 'frame' && n.attrs['data-ak-id'] === id);

/** A viewport stub that records what the board asks of it and hands back a world element. */
function stubViewport() {
  (window as any).AIMEAT = {
    viewport: {
      create(host: any, opts: any) {
        vpOpts = opts;
        const world = document.createElement('div');
        host.appendChild(world);
        let cam = opts.initial || { x: 0, y: 0, k: 1 };
        let mode = opts.mode || 'navigate';
        return {
          host, world,
          cam: () => ({ ...cam }),
          scale: () => cam.k,
          setCamera: (c: any, animated: boolean) => { vpCalls.push({ op: 'setCamera', args: { c, animated } }); cam = { ...c }; opts.onCameraChange && opts.onCameraChange(cam); },
          fit: (animated: boolean) => { vpCalls.push({ op: 'fit', args: animated }); },
          centerOn: (rect: any, animated: boolean) => { vpCalls.push({ op: 'centerOn', args: { rect, animated } }); },
          clientToWorld: (x: number, y: number) => ({ x, y }),
          worldToClient: (x: number, y: number) => ({ x, y }),
          setMode: (m: string) => { vpCalls.push({ op: 'setMode', args: m }); mode = m; },
          getMode: () => mode,
          refreshCaptures: () => { vpCalls.push({ op: 'refreshCaptures', args: null }); },
          destroy: () => { vpCalls.push({ op: 'destroy', args: null }); },
        };
      },
    },
  };
}

const frames = () => [
  { id: 'a', x: 0, y: 0, w: 400, h: 200, title: 'Contacts', kind: 'table', rev: 1 },
  { id: 'b', x: 500, y: 0, w: 300, h: 200, title: 'Per month', kind: 'chart', rev: 1 },
  { id: 'c', x: 0, y: 400, w: 300, h: 150, title: 'Note', kind: 'note', live: true, rev: 1 },
];

beforeAll(async () => {
  restore = installGlobals({ motion: 'less' });
  kit = await import('../../src/static/sdk-libs/atelier/board.js');
});
afterAll(() => restore());

beforeEach(() => {
  vpOpts = null;
  vpCalls = [];
  stubViewport();
});

describe('board', () => {
  it('lays the frames out where they are without the viewport library, and says what is missing', () => {
    (window as any).AIMEAT = {};
    const host = document.createElement('div');
    const b = kit.board({ target: host, frames: frames(), render: (f: any, body: any) => { body.textContent = f.title; } });
    expect(b.el.className).toContain('ak-board--static');
    expect(part(b.el, 'note').length).toBe(1);
    expect(part(b.el, 'tools').length).toBe(0);
    const a = frameEl(b.el, 'a');
    expect(a.style.left).toBe('0px');
    expect(a.style.width).toBe('400px');
    expect(a.style.height).toBe('200px');
    expect(part(a, 'body')[0].textContent).toBe('Contacts');
    expect(part(a, 'kind')[0].textContent).toBe('table');
    expect(frameEl(b.el, 'c').attrs['data-ak-live']).toBe('');
    b.destroy();
  });

  it('creates the viewport with the capture selector, the mode and the camera, and offers Move/Use', () => {
    const host = document.createElement('div');
    const b = kit.board({ target: host, frames: frames(), camera: { x: 10, y: 20, k: 0.5 }, mode: 'use' });
    expect(vpOpts.captureSelector).toBe('[data-ak-frame]:not([data-ak-live])');
    expect(vpOpts.mode).toBe('interact');
    expect(vpCalls.some((c) => c.op === 'setCamera')).toBe(true);
    expect(b.el.style.getPropertyValue('--ak-board-inv')).toBe('2');
    expect(b.el.className).toContain('ak-board--far');
    const tools = part(b.el, 'tool');
    expect(tools.length).toBe(2);
    expect(tools[1].attrs['aria-pressed']).toBe('true');
    tools[0].click();
    expect(vpCalls.filter((c) => c.op === 'setMode').pop()!.args).toBe('navigate');
    expect(tools[0].attrs['aria-pressed']).toBe('true');
    expect(b.mode()).toBe('move');
    b.destroy();
    expect(vpCalls.some((c) => c.op === 'destroy')).toBe(true);
  });

  it('shows the designed empty state on a bare board and takes it away when a frame arrives', () => {
    const host = document.createElement('div');
    const b = kit.board({ target: host, frames: [] });
    expect(part(b.el, 'empty').length).toBe(1);
    b.set({ frames: frames().slice(0, 1) });
    expect(part(b.el, 'empty').length).toBe(0);
    b.set({ frames: [] });
    expect(part(b.el, 'empty').length).toBe(1);
  });

  it('keeps a frame element across a move, re-renders only on rev, and removes what left', () => {
    const host = document.createElement('div');
    const rendered: string[] = [];
    const b = kit.board({ target: host, frames: frames(), render: (f: any) => { rendered.push(f.id + ':' + f.rev); } });
    expect(rendered).toEqual(['a:1', 'b:1', 'c:1']);
    const before = frameEl(b.el, 'a');
    const moved = frames().map((f) => (f.id === 'a' ? { ...f, x: 120, y: 80 } : f));
    b.set({ frames: moved });
    expect(frameEl(b.el, 'a')).toBe(before);
    expect(before.style.left).toBe('120px');
    expect(before.style.top).toBe('80px');
    expect(rendered.length).toBe(3);
    const bumped = moved.map((f) => (f.id === 'b' ? { ...f, rev: 2, title: 'Per week' } : f));
    b.set({ frames: bumped });
    expect(rendered).toEqual(['a:1', 'b:1', 'c:1', 'b:2']);
    expect(part(frameEl(b.el, 'b'), 'title')[0].textContent).toBe('Per week');
    b.set({ frames: bumped.filter((f) => f.id !== 'c') });
    expect(frameEl(b.el, 'c')).toBeUndefined();
    expect(part(b.el, 'frame').length).toBe(2);
  });

  it('draws the action buttons the app declares and reports a press with the frame', () => {
    const host = document.createElement('div');
    const pressed: Array<[string, string]> = [];
    const b = kit.board({
      target: host, frames: frames(),
      actions: [
        { id: 'remove', glyph: '✗', label: 'Remove' },
        { id: 'fold', glyph: '⑂', label: 'Fold', when: (f: any) => f.kind !== 'note' },
        { id: 'live', glyph: '⊙', label: 'Use it', pressed: (f: any) => !!f.live },
      ],
      onAction: (id: string, f: any) => { pressed.push([id, f.id]); },
    });
    const actsA = part(frameEl(b.el, 'a'), 'act');
    expect(actsA.map((n) => n.attrs['data-ak-act'])).toEqual(['remove', 'fold', 'live']);
    expect(part(frameEl(b.el, 'c'), 'act').map((n) => n.attrs['data-ak-act'])).toEqual(['remove', 'live']);
    expect(part(frameEl(b.el, 'c'), 'act')[1].attrs['aria-pressed']).toBe('true');
    actsA[0].click();
    expect(pressed).toEqual([['remove', 'a']]);
  });

  it('selects on a head click, marks the frame and tells the app', () => {
    const host = document.createElement('div');
    const picked: any[] = [];
    const b = kit.board({ target: host, frames: frames(), onSelect: (f: any) => picked.push(f ? f.id : null) });
    part(frameEl(b.el, 'b'), 'head')[0].click();
    expect(b.selected()).toBe('b');
    expect(frameEl(b.el, 'b').attrs['aria-current']).toBe('true');
    expect(frameEl(b.el, 'b').className).toContain('ak-board__frame--selected');
    b.select(null);
    expect(picked).toEqual(['b', null]);
  });

  it('claims the pointer for a head and moves the frame, reporting the rectangle at the end', () => {
    const host = document.createElement('div');
    const moves: any[] = [];
    const b = kit.board({ target: host, frames: frames(), onMove: (f: any, r: any) => moves.push({ id: f.id, ...r }) });
    const head = part(frameEl(b.el, 'a'), 'head')[0];
    const handle = vpOpts.onClaimPointer({ target: head });
    expect(handle).toBeTruthy();
    handle.onMove(30, 20);
    expect(frameEl(b.el, 'a').style.left).toBe('30px');
    handle.onEnd(true);
    expect(moves).toEqual([{ id: 'a', x: 30, y: 20, w: 400, h: 200 }]);
    expect(b.selected()).toBe('a');
  });

  it('resizes from the grip with a floor, and lets a button inside a frame keep its press', () => {
    const host = document.createElement('div');
    const moves: any[] = [];
    const b = kit.board({ target: host, frames: frames(), onMove: (f: any, r: any) => moves.push(r) });
    const grip = part(frameEl(b.el, 'a'), 'grip')[0];
    const h = vpOpts.onClaimPointer({ target: grip });
    h.onMove(-500, 40);
    expect(frameEl(b.el, 'a').style.width).toBe('160px');
    expect(frameEl(b.el, 'a').style.height).toBe('240px');
    h.onEnd(true);
    expect(moves[0]).toEqual({ x: 0, y: 0, w: 160, h: 240 });
    const button = document.createElement('button');
    part(frameEl(b.el, 'a'), 'body')[0].appendChild(button);
    const swallowed = vpOpts.onClaimPointer({ target: button });
    expect(swallowed).toBeTruthy();
    swallowed.onMove(50, 50);
    expect(frameEl(b.el, 'a').style.width).toBe('160px');
  });

  it('moves a frame from its body in Move mode, and leaves the body to its content in Use mode or when live', () => {
    const host = document.createElement('div');
    const b = kit.board({ target: host, frames: frames() });
    const bodyA = part(frameEl(b.el, 'a'), 'body')[0];
    const h = vpOpts.onClaimPointer({ target: bodyA });
    h.onMove(10, 10);
    expect(frameEl(b.el, 'a').style.left).toBe('10px');
    const bodyC = part(frameEl(b.el, 'c'), 'body')[0];
    const live = vpOpts.onClaimPointer({ target: bodyC });
    live.onMove(10, 10);
    expect(frameEl(b.el, 'c').style.left).toBe('0px');
    b.setMode('use');
    const inUse = vpOpts.onClaimPointer({ target: bodyA });
    inUse.onMove(10, 10);
    expect(frameEl(b.el, 'a').style.left).toBe('10px');
    expect(vpOpts.onClaimPointer({ target: b.el })).toBeNull();
  });

  it('draws a ring around its members and offers a frame dropped inside it', () => {
    const host = document.createElement('div');
    const drops: any[] = [];
    const b = kit.board({
      target: host, frames: frames(),
      rings: [{ id: 'r1', title: 'Who is coming', members: ['a', 'b'] }],
      onDrop: (f: any, ring: any) => drops.push([f.id, ring.id]),
    });
    const ring = part(b.el, 'ring')[0];
    expect(ring).toBeTruthy();
    expect(part(ring, 'ringName')[0].textContent).toBe('Who is coming');
    const r = parseFloat(ring.style.width) / 2;
    expect(r).toBeGreaterThan(400);
    expect(frameEl(b.el, 'a').className).toContain('ak-board__frame--member');
    // c starts inside the circle (centroid geometry reaches it): a nudge asks nothing
    const head = part(frameEl(b.el, 'c'), 'head')[0];
    const nudge = vpOpts.onClaimPointer({ target: head });
    nudge.onMove(10, 10);
    nudge.onEnd(true);
    expect(drops).toEqual([]);
    // moved out and back in, it is new ground: asked once
    b.set({ frames: frames().map((f) => (f.id === 'c' ? { ...f, x: 0, y: 2400 } : f)) });
    const h = vpOpts.onClaimPointer({ target: part(frameEl(b.el, 'c'), 'head')[0] });
    h.onMove(250, -2300);
    h.onEnd(true);
    expect(drops).toEqual([['c', 'r1']]);
    b.set({ rings: [] });
    expect(part(b.el, 'ring').length).toBe(0);
  });

  it('centres an anchored ring on its anchor, tows the frames the app names, and asks only on entering new ground', () => {
    const host = document.createElement('div');
    const drops: any[] = [];
    const moves: string[] = [];
    const b = kit.board({
      target: host,
      frames: frames().map((f) => (f.id === 'c' ? { ...f, x: 4000, y: 4000 } : f))
        .concat([{ id: 'p', x: 1000, y: 1000, w: 200, h: 100, kind: 'request', title: 'Panel', rev: 1 }]),
      rings: [{ id: 'r1', title: 'Mine', anchor: 'p', members: ['p', 'a'] }],
      tow: (f: any) => (f.kind === 'request' ? ['a'] : []),
      onDrop: (f: any, ring: any) => drops.push([f.id, ring.id]),
      onMove: (f: any) => moves.push(f.id),
    });
    const ring = part(b.el, 'ring')[0];
    const r = parseFloat(ring.style.width) / 2;
    // centred on the panel (1100, 1050), wide enough to reach frame a's far corner
    expect(Math.round(parseFloat(ring.style.left) + r)).toBe(1100);
    expect(r).toBeGreaterThan(1400);
    // dragging the panel tows a
    const h = vpOpts.onClaimPointer({ target: part(frameEl(b.el, 'p'), 'head')[0] });
    h.onMove(100, 0);
    expect(frameEl(b.el, 'a').style.left).toBe('100px');
    h.onEnd(true);
    expect(moves).toEqual(['p', 'a']);
    // b was inside the ring already (within reach of its geometry): nudging it asks nothing
    const hb = vpOpts.onClaimPointer({ target: part(frameEl(b.el, 'b'), 'head')[0] });
    hb.onMove(5, 5);
    hb.onEnd(true);
    expect(drops).toEqual([]);
    // c starts far outside: moving it inside asks once
    const hc = vpOpts.onClaimPointer({ target: part(frameEl(b.el, 'c'), 'head')[0] });
    hc.onMove(-3000, -3000);
    hc.onEnd(true);
    expect(drops).toEqual([['c', 'r1']]);
    // selecting the anchor lights the ring; a frame that leaves the ring loses the member mark
    b.select('p');
    expect(part(b.el, 'ring')[0].className).toContain('ak-board__ring--selected');
    expect(frameEl(b.el, 'a').className).toContain('ak-board__frame--member');
    b.set({ rings: [{ id: 'r1', title: 'Mine', anchor: 'p', members: ['p'] }] });
    expect(frameEl(b.el, 'a').className).not.toContain('ak-board__frame--member');
    // centerOn takes a rectangle as well as an id, and set({ camera, animate: false }) jumps
    b.centerOn({ x: 0, y: 0, w: 100, h: 100 });
    b.set({ camera: { x: 1, y: 2, k: 1 }, animate: false });
    const tail = vpCalls.slice(-2);
    expect(tail[0]).toEqual({ op: 'centerOn', args: { rect: { x: 0, y: 0, w: 100, h: 100 }, animated: true } });
    expect(tail[1].op).toBe('setCamera');
    expect(tail[1].args.animated).toBe(false);
  });

  it('writes its own words, not its keys: the tools, the kind chip and the empty state', () => {
    const host = document.createElement('div');
    const b = kit.board({ target: host, frames: frames() });
    expect(part(b.el, 'tool').map((n: any) => n.textContent)).toEqual(['Move', 'Use']);
    expect(part(frameEl(b.el, 'a'), 'kind')[0].textContent).toBe('table');
    b.set({ frames: [] });
    expect(part(b.el, 'empty')[0].textContent).toContain('Nothing on the board yet.');
  });

  it('nudges the selected frame with the arrow keys and clears the selection on Escape', () => {
    const host = document.createElement('div');
    const moves: any[] = [];
    const b = kit.board({ target: host, frames: frames(), onMove: (f: any, r: any) => moves.push([f.id, r.x, r.y]) });
    b.select('b');
    b.el.dispatchEvent({ type: 'keydown', key: 'ArrowRight', shiftKey: true, target: b.el, preventDefault() {} });
    b.el.dispatchEvent({ type: 'keydown', key: 'ArrowUp', target: b.el, preventDefault() {} });
    expect(moves).toEqual([['b', 550, 0], ['b', 550, -10]]);
    b.el.dispatchEvent({ type: 'keydown', key: 'Escape', target: b.el, preventDefault() {} });
    expect(b.selected()).toBe(null);
  });

  it('draws the sample state, marked as such, and changes nothing', () => {
    const host = document.createElement('div');
    const b = kit.board({ target: host, sample: true, render: () => { throw new Error('the sample never calls render'); } });
    expect(part(b.el, 'frame').length).toBe(3);
    expect(part(b.el, 'ring').length).toBe(1);
    expect(all(b.el).some((n) => n.attrs && n.attrs.class === 'ak-board__sample')).toBe(true);
  });
});
