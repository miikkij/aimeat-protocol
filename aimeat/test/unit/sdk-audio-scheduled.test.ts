/**
 * @file sdk-audio-scheduled.test.ts
 * @description AIMEAT.audio places a note at an exact AudioContext time and into any node or named
 *   bus (play(..., { when, destination })), the master runs through a limiter that can be switched
 *   off, a note scheduled ahead replaces the one before it at its own start rather than when it was
 *   scheduled, and stop() cancels a note that has not started. Band Jam had to port the voices to get
 *   this; apps placing notes on a SharedClock now get it from the library.
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (aimeat-audio 1.2.0, session cc-jouni-audioclock-1022).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type FakeNode = { kind: string; startedAt: number | null; stoppedAt: number | null; out: FakeNode[]; [k: string]: any };
let nodes: FakeNode[] = [];

function param() {
    return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
}
let ctxRef: any = null;
function node(kind: string): FakeNode {
    const n: FakeNode = {
        kind, startedAt: null, stoppedAt: null, out: [], type: '', buffer: null, curve: null, loop: false, context: ctxRef,
        frequency: param(), detune: param(), gain: param(), Q: param(), playbackRate: param(), delayTime: param(),
        threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
        connect(to: FakeNode) { n.out.push(to); return to; }, disconnect() { n.out = []; },
        start(t = 0) { n.startedAt = t; }, stop(t = 0) { n.stoppedAt = t; },
    };
    nodes.push(n);
    return n;
}
class FakeAudioContext {
    state = 'running';
    currentTime = 10;
    sampleRate = 44100;
    destination: FakeNode;
    constructor() { ctxRef = this; this.destination = node('destination'); }
    createOscillator() { return node('oscillator'); }
    createGain() { return node('gain'); }
    createBiquadFilter() { return node('filter'); }
    createBufferSource() { return node('buffer-source'); }
    createWaveShaper() { return node('waveshaper'); }
    createDelay() { return node('delay'); }
    createDynamicsCompressor() { return node('compressor'); }
    createBuffer(_ch: number, len: number) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    decodeAudioData() { return Promise.resolve({ decoded: true }); }
    resume() { return Promise.resolve(); }
}

beforeEach(() => {
    nodes = [];
    vi.resetModules();
    vi.useFakeTimers();
    const g = globalThis as any;
    g.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
    g.location = { origin: 'https://app.test', href: 'https://app.test/', hostname: 'app.test', pathname: '/', search: '', hash: '' };
    g.window = { AudioContext: FakeAudioContext, addEventListener() {}, dispatchEvent() {}, location: g.location };
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function audioLib() {
    await import('../../src/static/sdk-libs/audio/index.js');
    return (globalThis as any).window.AIMEAT.audio;
}
const reaches = (from: FakeNode, to: FakeNode, seen = new Set<FakeNode>()): boolean =>
    from === to || (!seen.has(from) && (seen.add(from), from.out.some(o => reaches(o, to, seen))));

describe('AIMEAT.audio: a note at an exact time, into any node', () => {
    it('play(..., { when }) starts every source of the voice at that time', async () => {
        const audio = await audioLib();
        audio.play('piano', 'C4', { when: 12.5 });
        const sources = nodes.filter(n => n.kind === 'oscillator');
        expect(sources.length).toBeGreaterThan(0);
        expect(sources.every(n => n.startedAt === 12.5)).toBe(true);
    });

    it('a when in the past starts now, not in the past', async () => {
        const audio = await audioLib();
        audio.play('bass', 'C2', { when: 3 });
        expect(nodes.filter(n => n.kind === 'oscillator').every(n => n.startedAt === 10)).toBe(true);
    });

    it('drums and the other voices take when too', async () => {
        const audio = await audioLib();
        for (const [inst, note] of [['drums', 'kick'], ['drums', 'snare'], ['guitar', 'E3'], ['flute', 'A4'], ['synth', 'C4']]) {
            nodes = [];
            audio.play(inst, note, { when: 11 });
            const started = nodes.filter(n => n.startedAt !== null);
            expect(started.length, inst + ' ' + note).toBeGreaterThan(0);
            expect(started.every(n => n.startedAt === 11), inst + ' ' + note).toBe(true);
        }
    });

    it('destination: a named bus or a node of your own, which reaches the speakers through the master', async () => {
        const audio = await audioLib();
        const drums = audio.bus('drums');
        audio.play('drums', 'kick', { destination: 'drums' });
        const ctx = audio.context;
        expect(nodes.some(n => n.out.includes(drums))).toBe(true);
        expect(reaches(drums, ctx.destination)).toBe(true);
        const mine = ctx.createGain();
        audio.play('piano', 'E4', { destination: mine });
        expect(nodes.some(n => n !== mine && n.out.includes(mine))).toBe(true);
        expect(audio.bus('drums')).toBe(drums);
    });

    it('the master runs through a limiter, and master.limiter = false takes it out', async () => {
        const audio = await audioLib();
        audio.play('piano', 'C4');
        const ctx = audio.context;
        const comp = nodes.find(n => n.kind === 'compressor')!;
        expect(comp).toBeTruthy();
        expect(comp.out).toContain(ctx.destination);
        expect(audio.master.limiter).toBe(true);
        const masterGain = nodes.find(n => n.out.includes(comp))!;
        audio.master.limiter = false;
        expect(masterGain.out).toEqual([ctx.destination]);
        audio.master.limiter = true;
        expect(masterGain.out).toEqual([comp]);
    });

    it('now() and timeAt() give the AudioContext clock', async () => {
        const audio = await audioLib();
        expect(audio.now()).toBe(10);
        expect(audio.timeAt(Date.now() + 250)).toBeCloseTo(10.25, 5);
    });
});

describe('AIMEAT.audio: notes scheduled ahead and stop()', () => {
    it('a note scheduled ahead does not cut the same note sounding now until it starts', async () => {
        const audio = await audioLib();
        audio.play('bass', 'C2');
        const first = nodes.filter(n => n.kind === 'oscillator');
        audio.play('bass', 'C2', { when: 11 });
        expect(first.every(n => n.stoppedAt === null || n.stoppedAt > 10.5)).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(first.some(n => n.stoppedAt !== null)).toBe(true);
    });

    it('stop() cancels a note that has not started yet', async () => {
        const audio = await audioLib();
        audio.play('flute', 'A4', { when: 14 });
        const later = nodes.filter(n => n.kind === 'oscillator');
        audio.stop('flute');
        expect(later.some(n => n.stoppedAt !== null)).toBe(true);
        vi.advanceTimersByTime(5000);   // the cancelled note never becomes the active one
        audio.play('flute', 'A4');
        expect(nodes.filter(n => n.kind === 'oscillator').length).toBeGreaterThan(later.length);
    });
});
