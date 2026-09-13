/**
 * @file sdk-audio-sample-only-fallback.test.ts
 * @description AIMEAT.audio.play() on a sample-only instrument (strings, organ, epiano, trumpet,
 *   guitar-steel, guitar-el) sounds before its bank has loaded. Those six have a sample map and no
 *   synth voice, so until loadSamples() resolved, play() found nothing to play, logged
 *   "Unknown instrument" and stayed silent (appdev pitfall
 *   aimeat-audio-sample-only-instruments-silent-until-loaded, 2026-07-21). It now plays the nearest
 *   built-in voice, says once that the samples are not loaded, and a loaded bank still wins.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type FakeNode = { kind: string; started: boolean; stopped: boolean; [k: string]: any };
let nodes: FakeNode[] = [];

function param() {
    return { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
}
function node(kind: string): FakeNode {
    const n: FakeNode = {
        kind, started: false, stopped: false, type: '', buffer: null, curve: null, loop: false,
        frequency: param(), detune: param(), gain: param(), Q: param(), playbackRate: param(), delayTime: param(),
        connect() {}, disconnect() {},
        start() { n.started = true; }, stop() { n.stopped = true; },
    };
    nodes.push(n);
    return n;
}
class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    sampleRate = 44100;
    destination = node('destination');
    createOscillator() { return node('oscillator'); }
    createGain() { return node('gain'); }
    createBiquadFilter() { return node('filter'); }
    createBufferSource() { return node('buffer-source'); }
    createWaveShaper() { return node('waveshaper'); }
    createDelay() { return node('delay'); }
    createBuffer(_ch: number, len: number) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    decodeAudioData() { return Promise.resolve({ decoded: true }); }
    resume() { return Promise.resolve(); }
}

beforeEach(() => {
    nodes = [];
    vi.resetModules();
    const g = globalThis as any;
    g.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
    g.location = { origin: 'https://app.test', href: 'https://app.test/', hostname: 'app.test', pathname: '/', search: '', hash: '' };
    g.window = { AudioContext: FakeAudioContext, addEventListener() {}, dispatchEvent() {}, location: g.location };
});

afterEach(() => { vi.restoreAllMocks(); });

async function audioLib() {
    await import('../../src/static/sdk-libs/audio/index.js');
    return (globalThis as any).window.AIMEAT.audio;
}

const SAMPLE_ONLY = ['strings', 'organ', 'epiano', 'trumpet', 'guitar-steel', 'guitar-el'];

describe('AIMEAT.audio sample-only instruments before their bank loads', () => {
    for (const name of SAMPLE_ONLY) {
        it(`${name} starts a voice instead of staying silent`, async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const audio = await audioLib();
            audio.play(name, 'C4');
            expect(nodes.some(n => n.started), `${name}: nothing was started`).toBe(true);
            const unknown = warn.mock.calls.some(c => c.join(' ').includes('Unknown instrument'));
            expect(unknown, `${name}: still reported as an unknown instrument`).toBe(false);
        });
    }

    it('says once, not per note, that the samples are not loaded', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const audio = await audioLib();
        audio.play('strings', 'C4');
        audio.play('strings', 'E4');
        audio.play('strings', 'G4');
        const notLoaded = warn.mock.calls.filter(c => c.join(' ').includes('loadSamples'));
        expect(notLoaded).toHaveLength(1);
    });

    it('stop() on the instrument name stops the stand-in voice', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const audio = await audioLib();
        audio.play('organ', 'C4', { duration: 10 });
        const oscs = nodes.filter(n => n.kind === 'oscillator' && n.started);
        expect(oscs.length).toBeGreaterThan(0);
        oscs.forEach(o => { o.stopped = false; });
        audio.stop('organ', 'C4');
        expect(oscs.every(o => o.stopped)).toBe(true);
    });

    it('a truly unknown name is still reported as unknown', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const audio = await audioLib();
        audio.play('kazoo', 'C4');
        expect(warn.mock.calls.some(c => c.join(' ').includes('Unknown instrument'))).toBe(true);
        expect(nodes.some(n => n.started)).toBe(false);
    });

    it('once the bank has loaded, the sample plays and the stand-in does not', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        (globalThis as any).fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
        const audio = await audioLib();
        await audio.loadSamples('strings');
        expect(audio.hasSamples('strings')).toBe(true);
        nodes = [];
        audio.play('strings', 'C4');
        expect(nodes.some(n => n.kind === 'buffer-source' && n.started)).toBe(true);
        expect(nodes.some(n => n.kind === 'oscillator' && n.started)).toBe(false);
    });
});
