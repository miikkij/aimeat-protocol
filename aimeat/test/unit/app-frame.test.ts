/**
 * @file app-frame.test.ts
 * @description The isolated frame's pieces that need no node (audit A7-1): which mode a node is in,
 *   the sandbox the app's bytes carry, the page script's iframe carrying the same flags, and where
 *   the frame support script lands in an app's markup.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-frame.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-25 — Initial (audit A7-1: apps on shared nodes without an app origin).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appCsp, APP_FRAME_SANDBOX } from '../../src/utils/app-csp.js';
import { appIsolationMode, resetAppIsolationCache } from '../../src/services/app-isolation.js';
import { FRAME_HOST_CSP } from '../../src/routes/apps/inline-frame.js';
import { appFrameShimSource, withFrameShim } from '../../src/utils/app-frame-assets.js';
import { stripServedMarks } from '../../src/services/app-serve-marks-strip.js';

const STATIC = join(process.cwd(), 'src', 'static');
const owners = (...names: string[]) => ({ listOwners: async () => names.map(name => ({ name })) }) as any;
const noAppOrigin = { appOriginEnabled: false, appHost: '', baseUrl: 'http://localhost:40600' } as any;

function sandboxOf(csp: string): string[] | null {
    const d = csp.split(';').map(s => s.trim()).find(s => s === 'sandbox' || s.startsWith('sandbox '));
    return d ? d.split(/\s+/).slice(1) : null;
}

describe('which way a node keeps apps apart', () => {
    beforeEach(() => resetAppIsolationCache());

    it('a node with an app origin gives every app its own address, whoever has an account', async () => {
        const config = { appOriginEnabled: true, appHost: 'apps.example.com' } as any;
        expect(await appIsolationMode(config, owners('a', 'b', 'c'))).toBe('app-origin');
    });
    it('one person and no app origin: apps run on the node\'s own address, as before', async () => {
        expect(await appIsolationMode(noAppOrigin, owners('a'))).toBe('shared-origin');
    });
    it('the shared anonymous identity publishes nothing, so it is not a second person', async () => {
        expect(await appIsolationMode(noAppOrigin, owners('a', 'anonymous'))).toBe('shared-origin');
    });
    it('two people and no app origin: every app runs in the isolated frame', async () => {
        expect(await appIsolationMode(noAppOrigin, owners('a', 'b'))).toBe('isolated-frame');
    });
    it('a flag without a host is no app origin', async () => {
        expect(await appIsolationMode({ ...noAppOrigin, appOriginEnabled: true }, owners('a', 'b'))).toBe('isolated-frame');
    });
    it('an account list that cannot be read isolates', async () => {
        const broken = { listOwners: async () => { throw new Error('down'); } } as any;
        expect(await appIsolationMode(noAppOrigin, broken)).toBe('isolated-frame');
    });
});

describe('the sandbox the app\'s bytes carry', () => {
    it('lets the app run and never gives it the node\'s origin', () => {
        const sb = sandboxOf(appCsp('http://localhost:40600', '', { sandboxed: true }));
        expect(sb).toContain('allow-scripts');
        expect(sb).not.toContain('allow-same-origin');
        expect(APP_FRAME_SANDBOX).not.toContain('allow-same-origin');
    });
    it('names the node beside \'self\' for its own scripts, and is framed by the node only', () => {
        const csp = appCsp('http://aimeat.lan:40050', '', { sandboxed: true });
        expect(csp).toMatch(/script-src 'self' http:\/\/aimeat\.lan:40050 /);
        expect(csp).toMatch(/frame-ancestors 'self' http:\/\/aimeat\.lan:40050$/);
    });
    it('leaves the policy of every other app exactly as it was', () => {
        expect(sandboxOf(appCsp())).toBeNull();
        expect(sandboxOf(appCsp('https://aimeat.io'))).toBeNull();
        expect(appCsp()).toMatch(/^default-src 'none'; script-src 'self' 'unsafe-inline'/);
    });
    it('the page script builds its iframe with exactly the same flags', () => {
        const script = readFileSync(join(STATIC, 'app-frame.js'), 'utf-8');
        const m = /var SANDBOX = ([\s\S]*?);\n/.exec(script);
        expect(m).not.toBeNull();
        const flags = m![1].split('+').map(part => part.trim().replace(/^'|'$/g, '')).join('').trim().split(/\s+/);
        expect(flags).toEqual([...APP_FRAME_SANDBOX]);
    });
});

describe('the page that holds the frame', () => {
    it('runs only the node\'s own script and is framed only by the node', () => {
        const directives = FRAME_HOST_CSP.split(';').map(s => s.trim());
        expect(directives).toContain("script-src 'self'");
        expect(directives).toContain("frame-ancestors 'self'");
        const html = readFileSync(join(STATIC, 'app-frame.html'), 'utf-8');
        expect(html).toContain('<script src="/app-frame.js" defer></script>');
        expect(html).not.toMatch(/<script>(?!\s*<\/script>)/);
    });
});

describe('the frame support script', () => {
    const shim = appFrameShimSource()!;

    it('is served without its header, and cannot close the tag it is put in', () => {
        expect(shim).toBeTruthy();
        expect(shim.startsWith('(function')).toBe(true);
        expect(shim.toLowerCase()).not.toContain('</script');
    });
    it('goes right after <head>, in front of the app\'s own first script', () => {
        const out = withFrameShim('<!DOCTYPE html><html><head><script>app()</script></head><body></body></html>').toString('utf-8');
        expect(out.indexOf('__AIMEAT_FRAME__')).toBeGreaterThan(out.indexOf('<head>'));
        expect(out.indexOf('__AIMEAT_FRAME__')).toBeLessThan(out.indexOf('app()'));
    });
    it('finds its place in markup with no head, and in a bare fragment', () => {
        const noHead = withFrameShim('<!doctype html><html lang="fi"><script>app()</script></html>').toString('utf-8');
        expect(noHead.indexOf('<html lang="fi">')).toBeLessThan(noHead.indexOf('__AIMEAT_FRAME__'));
        expect(noHead.indexOf('__AIMEAT_FRAME__')).toBeLessThan(noHead.indexOf('app()'));
        const bare = withFrameShim('<script>app()</script>').toString('utf-8');
        expect(bare.startsWith('<script data-aimeat-frame-support>(function')).toBe(true);
    });
    it('is not fooled by a <header> element', () => {
        const out = withFrameShim('<html><header>x</header><head></head></html>').toString('utf-8');
        expect(out.indexOf('__AIMEAT_FRAME__')).toBeGreaterThan(out.indexOf('<head>'));
    });
    it('is a serve mark: a copy of the app as the frame got it is stored as the source', () => {
        const source = '<!DOCTYPE html><html><head><title>t</title></head><body><script>app()</script></body></html>';
        const { data, removed } = stripServedMarks(withFrameShim(source));
        expect(data.toString('utf-8')).toBe(source);
        expect(removed.map(r => r.mark)).toEqual(['frame-support']);
    });
});
