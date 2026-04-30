/**
 * @file audio-speech.spec.ts
 * @description Playwright browser tests for AIMEAT audio and speech libraries.
 * @version-history
 *   v1.0.0 — 2026-04-30 — Initial implementation
 */
import { test, expect } from '@playwright/test';

async function loadHarness(page: any) {
    await page.goto('/v1/libs/test-harness');
    await page.waitForFunction(() => (window as any).__ready === true, null, { timeout: 10_000 });
}

// ═══════════════════════════════════════════════════════
// Audio Library
// ═══════════════════════════════════════════════════════

test.describe('Audio Library', () => {
    test('AIMEAT.audio loads on test harness', async ({ page }) => {
        await loadHarness(page);
        const hasAudio = await page.evaluate(() => typeof (window as any).AIMEAT.audio);
        expect(hasAudio).toBe('object');
    });

    test('AIMEAT.audio.instruments lists built-in instruments', async ({ page }) => {
        await loadHarness(page);
        const instruments = await page.evaluate(() => (window as any).AIMEAT.audio.instruments);
        expect(instruments).toContain('piano');
        expect(instruments).toContain('guitar');
        expect(instruments).toContain('bass');
        expect(instruments).toContain('drums');
        expect(instruments).toContain('flute');
        expect(instruments).toContain('synth');
    });

    test('AIMEAT.audio.play does not throw for valid instrument', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const error = await page.evaluate(() => {
            try {
                (window as any).AIMEAT.audio.play('piano', 'C4');
                return null;
            } catch (e: any) { return e.message; }
        });
        expect(error).toBeNull();
    });

    test('AIMEAT.audio.master has volume and mute', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            a.play('piano', 'C4');
            a.master.volume = 0.5;
            const vol = a.master.volume;
            a.master.mute = true;
            const muted = a.master.mute;
            a.master.mute = false;
            return { vol: Math.abs(vol - 0.5) < 0.01, muted };
        });
        expect(result.vol).toBe(true);
        expect(result.muted).toBe(true);
    });

    test('AIMEAT.audio.synth creates a custom instrument', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            const s = a.synth({
                name: 'test-synth',
                oscillators: [{ wave: 'sine' }],
                envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 },
            });
            return {
                hasPlay: typeof s.play === 'function',
                hasStop: typeof s.stop === 'function',
                name: s.name,
                inList: a.instruments.includes('test-synth'),
            };
        });
        expect(result.hasPlay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.name).toBe('test-synth');
        expect(result.inList).toBe(true);
    });

    test('AIMEAT.audio.soundboard has load/play/stop methods', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const sb = (window as any).AIMEAT.audio.soundboard;
            return {
                hasLoad: typeof sb.load === 'function',
                hasPlay: typeof sb.play === 'function',
                hasStop: typeof sb.stop === 'function',
                hasLoadAll: typeof sb.loadAll === 'function',
            };
        });
        expect(result.hasLoad).toBe(true);
        expect(result.hasPlay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.hasLoadAll).toBe(true);
    });

    test('AIMEAT.audio.loadSamples and hasSamples work', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            return {
                hasLoadSamples: typeof a.loadSamples === 'function',
                hasHasSamples: typeof a.hasSamples === 'function',
                beforeLoad: a.hasSamples('piano'),
            };
        });
        expect(result.hasLoadSamples).toBe(true);
        expect(result.hasHasSamples).toBe(true);
        expect(result.beforeLoad).toBe(false);
    });

    test('AIMEAT.audio.connectRealtime is a function', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const a = (window as any).AIMEAT.audio;
            return {
                hasConnect: typeof a.connectRealtime === 'function',
                hasDisconnect: typeof a.disconnectRealtime === 'function',
            };
        });
        expect(result.hasConnect).toBe(true);
        expect(result.hasDisconnect).toBe(true);
    });

    test('all drum hits play without errors', async ({ page }) => {
        await loadHarness(page);
        await page.click('h1');
        const result = await page.evaluate(() => {
            const hits = ['kick', 'snare', 'hihat', 'hihat-open', 'crash', 'ride', 'tom-high', 'tom-mid', 'tom-low', 'clap', 'cowbell'];
            const errors: string[] = [];
            hits.forEach(h => {
                try { (window as any).AIMEAT.audio.play('drums', h); }
                catch (e: any) { errors.push(h + ': ' + e.message); }
            });
            return errors;
        });
        expect(result).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════
// Speech Library
// ═══════════════════════════════════════════════════════

test.describe('Speech Library', () => {
    test('AIMEAT.speech loads on test harness', async ({ page }) => {
        await loadHarness(page);
        const hasSpeech = await page.evaluate(() => typeof (window as any).AIMEAT.speech);
        expect(hasSpeech).toBe('object');
    });

    test('AIMEAT.speech has all expected methods', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const s = (window as any).AIMEAT.speech;
            return {
                hasSay: typeof s.say === 'function',
                hasStop: typeof s.stop === 'function',
                hasVoices: typeof s.voices === 'function',
                hasListen: typeof s.listen === 'function',
                hasStopListening: typeof s.stopListening === 'function',
                hasUse: typeof s.use === 'function',
                hasOn: typeof s.on === 'function',
                hasOff: typeof s.off === 'function',
            };
        });
        expect(result.hasSay).toBe(true);
        expect(result.hasStop).toBe(true);
        expect(result.hasVoices).toBe(true);
        expect(result.hasListen).toBe(true);
        expect(result.hasStopListening).toBe(true);
        expect(result.hasUse).toBe(true);
        expect(result.hasOn).toBe(true);
        expect(result.hasOff).toBe(true);
    });

    test('AIMEAT.speech.supported returns capability object', async ({ page }) => {
        await loadHarness(page);
        const result = await page.evaluate(() => {
            const s = (window as any).AIMEAT.speech;
            return {
                hasTts: typeof s.supported.tts === 'boolean',
                hasStt: typeof s.supported.stt === 'boolean',
            };
        });
        expect(result.hasTts).toBe(true);
        expect(result.hasStt).toBe(true);
    });

    test('AIMEAT.speech.speaking is false initially', async ({ page }) => {
        await loadHarness(page);
        const speaking = await page.evaluate(() => (window as any).AIMEAT.speech.speaking);
        expect(speaking).toBe(false);
    });

    test('AIMEAT.speech.listening is false initially', async ({ page }) => {
        await loadHarness(page);
        const listening = await page.evaluate(() => (window as any).AIMEAT.speech.listening);
        expect(listening).toBe(false);
    });
});
