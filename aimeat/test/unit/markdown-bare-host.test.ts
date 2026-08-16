/**
 * @file test/unit/markdown-bare-host.test.ts
 * @description A bare host in an answer becomes a link, and a token that merely looks like one does
 *   not. The second half is the point: this rule runs over every message the chat renders, so a
 *   false positive turns ordinary prose into a field of links.
 * @usage pnpm test -- markdown-bare-host
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial, with the agent's app listing as the case that asked for it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The component imports preact and htm from absolute browser paths, so the two pure functions are
// read out of the source and evaluated on their own. It keeps the test honest about WHICH code it
// covers: the matcher, not a copy of the regex written here.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../public/components/Markdown.js'), 'utf-8');
const start = src.indexOf('const LINKABLE_SUFFIX');
const end = src.indexOf('// ── Inline parsing');
const matchBareHost = new Function(`${src.slice(start, end)}; return matchBareHost;`)() as
    (text: string, i: number) => string | null;

const host = (s: string) => matchBareHost(s, 0);

describe('an address a person could open becomes a link', () => {
    it('links the app addresses an agent lists', () => {
        expect(host('laake.apps.aimeat.io')).toBe('laake.apps.aimeat.io');
        expect(host('nimipaivat.apps.aimeat.io')).toBe('nimipaivat.apps.aimeat.io');
        expect(host('aimeat.io')).toBe('aimeat.io');
        expect(host('experience-center.apps.aimeat.io')).toBe('experience-center.apps.aimeat.io');
    });

    it('leaves a trailing full stop out of the address', () => {
        expect(host('aimeat.io.')).toBe('aimeat.io');
    });
});

describe('and a token that only looks like one stays text', () => {
    it('a filename is not an address', () => {
        expect(host('package.json')).toBeNull();
        expect(host('index.html')).toBeNull();
        expect(host('chat.css')).toBeNull();
        expect(host('SKILL.md')).toBeNull();
    });

    it('a dotted identifier is not an address', () => {
        expect(host('Array.prototype')).toBeNull();
        expect(host('aimeat_app_list.total')).toBeNull();
        expect(host('config.nodeId')).toBeNull();
    });

    it('a bare word, a version and a number are not addresses', () => {
        expect(host('hello')).toBeNull();
        expect(host('1.0.5')).toBeNull();
        expect(host('v2.0.1')).toBeNull();
    });
});
