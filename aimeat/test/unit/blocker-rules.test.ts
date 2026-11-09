/**
 * @file test/unit/blocker-rules.test.ts
 * @description Proof that scripts/lib/blocker-rules.ts, which `pnpm check:blocked-names` runs, finds
 *   a first-party address a content blocker blocks and leaves the rules that cannot reach one. The
 *   rules are written inline, so the test needs no network; the first case is the rule that took
 *   the admin page down on 2026-11-09.
 * @usage pnpm test -- blocker-rules
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { blockingRule, parseRules, resourceType } from '../../scripts/lib/blocker-rules.js';

const HOST = 'aimeat.io';
const at = (path: string) => `https://${HOST}${path}?v=0123456789`;
const blocked = (list: string, path: string) => blockingRule(at(path), resourceType(path), parseRules(list), HOST)?.text ?? null;

describe('blocker-rules', () => {
    it('finds the EasyPrivacy rule that blocked /components/Fingerprint.js, in any letter case', () => {
        const list = '! comment\n/fingerprint.js^$domain=~github.com\n';
        expect(blocked(list, '/components/Fingerprint.js')).toBe('/fingerprint.js^$domain=~github.com');
        expect(blocked(list, '/components/TextPrint.js')).toBeNull();
    });

    it('honours match-case', () => {
        expect(blocked('/Fingerprint.js$match-case', '/components/fingerprint.js')).toBeNull();
        expect(blocked('/Fingerprint.js$match-case', '/components/Fingerprint.js')).not.toBeNull();
    });

    it('skips a rule that only blocks third-party requests or other sites', () => {
        expect(blocked('/textprint.js$third-party', '/components/TextPrint.js')).toBeNull();
        expect(blocked('/textprint.js$domain=example.com', '/components/TextPrint.js')).toBeNull();
        expect(blocked('/textprint.js$domain=aimeat.io', '/components/TextPrint.js')).not.toBeNull();
        expect(blocked('/textprint.js$domain=~aimeat.io', '/components/TextPrint.js')).toBeNull();
    });

    it('honours resource types', () => {
        expect(blocked('/ads/cbr.js$script', '/ads/cbr.js')).not.toBeNull();
        expect(blocked('/ads/banner.$image', '/ads/banner.js')).toBeNull();
        expect(blocked('/ads/footer.$~xmlhttprequest', '/ads/footer.json')).toBeNull();
        expect(blocked('/ads/footer.$~xmlhttprequest', '/ads/footer.js')).not.toBeNull();
    });

    it('reads anchors, wildcards and regular expressions', () => {
        expect(blocked('||aimeat.io/components/', '/components/A.js')).not.toBeNull();
        expect(blocked('|https://aimeat.io/lib/', '/lib/x.js')).not.toBeNull();
        expect(blocked('/track*.js', '/js/tracker-ui.js')).not.toBeNull();
        expect(blocked('/\\/beacon[0-9]\\.js/', '/js/beacon2.js')).not.toBeNull();
    });

    it('ignores cosmetic, exception and non-blocking rules', () => {
        const list = '##.textprint\n@@/textprint.js\n/textprint.js$removeparam=v\n';
        expect(blocked(list, '/components/TextPrint.js')).toBeNull();
    });
});
