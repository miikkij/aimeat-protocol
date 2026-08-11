/**
 * @file test/unit/agent-scope-model.test.ts
 * @description The agent scope editor's round trip: a stored scope array expands into checkboxes
 *   and collapses back, and nothing may be lost in between.
 *
 *   This exists because something was. `memory:write-reserved` is granted by the server on the
 *   EXACT string — `*` deliberately does not carry it, because "Full access" is one click and
 *   nobody clicking it is deciding that an agent may point their decrypted AI key at a URL of its
 *   choosing. The editor did not know that: it expanded `*` into every box, so the row showed as
 *   already granted, and it collapsed a fully-ticked editor back to `['*']`, so ticking it saved
 *   nothing. The grant looked permanently on and was permanently off, and production proved it —
 *   an agent shown both ticks was refused the write.
 *
 *   Neither half is visible in a screenshot, which is why the property is asserted here.
 * @usage pnpm test -- agent-scope-model
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial, with the fix that made the grant reachable.
 */
import { describe, it, expect } from 'vitest';
import {
    NOT_IN_WILDCARD, SCOPE_DOMAINS, SCOPE_TEMPLATES,
    wildcardScopes, bulkScopes, expandScopes, collapseScopes, detectTemplate, unknownScopes,
} from '../../public/views/profile/agents/scope-model.js';

const RESERVED = 'memory:write-reserved';
const everyScope = () => SCOPE_DOMAINS.flatMap((d: { key: string; permissions: string[] }) =>
    d.permissions.map(p => `${d.key}:${p}`));

describe('the wildcard covers everything except the scopes that cost their own tick', () => {
    it('excludes exactly NOT_IN_WILDCARD, and that list is not empty', () => {
        expect(NOT_IN_WILDCARD).toContain(RESERVED);
        const wild = wildcardScopes();
        for (const s of everyScope()) {
            expect(wild.has(s)).toBe(!NOT_IN_WILDCARD.includes(s));
        }
    });

    it('a domain "all" header does not reach the out-of-wildcard row', () => {
        const memory = SCOPE_DOMAINS.find((d: { key: string }) => d.key === 'memory')!;
        expect(bulkScopes(memory)).toContain('memory:write-as-owner');
        expect(bulkScopes(memory)).not.toContain(RESERVED);
    });
});

describe('expand', () => {
    it("a '*' agent does NOT show the reserved row as granted", () => {
        expect(expandScopes(['*']).has(RESERVED)).toBe(false);
    });

    it('the wildcard plus EVERY out-of-wildcard word shows every box', () => {
        // There are five more of these since 2026-08-11 — the seller's payment account, the
        // beneficiary verification, an agent's permission list, the sharing groups and a board's
        // roster. Each costs its own tick precisely so it cannot ride along with Full access, so
        // the list is read from NOT_IN_WILDCARD rather than naming the reserved key alone.
        const set = expandScopes(['*', ...NOT_IN_WILDCARD]);
        for (const s of everyScope()) expect(set.has(s)).toBe(true);
    });

    it("['*', reserved] alone leaves the OTHER out-of-wildcard boxes unticked", () => {
        const set = expandScopes(['*', RESERVED]);
        expect(set.has(RESERVED)).toBe(true);
        for (const s of NOT_IN_WILDCARD) {
            if (s === RESERVED) continue;
            expect(set.has(s), `${s} must not ride along with the wildcard`).toBe(false);
        }
    });

    it('a domain wildcard carries no more than the global one', () => {
        const set = expandScopes(['memory:*']);
        expect(set.has('memory:write-as-owner')).toBe(true);
        expect(set.has(RESERVED)).toBe(false);
    });
});

describe('collapse', () => {
    it('everything ticked keeps the reserved scope spelled out beside the wildcard', () => {
        const saved = collapseScopes(new Set(everyScope()));
        expect(saved).toContain('*');
        expect(saved).toContain(RESERVED);
    });

    it('everything except the reserved row is a plain wildcard', () => {
        expect(collapseScopes(wildcardScopes())).toEqual(['*']);
    });

    it('a partial set stays explicit', () => {
        const saved = collapseScopes(new Set(['memory:read', 'memory:write-as-owner']));
        expect(saved.sort()).toEqual(['memory:read', 'memory:write-as-owner']);
        expect(saved).not.toContain('*');
    });

    it('an empty set is never saved as nothing', () => {
        expect(collapseScopes(new Set())).toEqual(['catalogue:read']);
    });
});

describe('the round trip loses nothing', () => {
    // The actual defect: open the dialog, change nothing, press Save — and the grant is gone.
    for (const stored of [
        ['*'],
        ['*', RESERVED],
        ['memory:read', 'memory:write'],
        ['memory:read', 'memory:write-as-owner', RESERVED],
        SCOPE_TEMPLATES.readonly,
        SCOPE_TEMPLATES.standard,
    ]) {
        it(`open → save is a no-op for ${JSON.stringify(stored)}`, () => {
            const saved = collapseScopes(expandScopes(stored), stored);
            expect(new Set(saved)).toEqual(new Set(stored));
        });
    }

    it('is stable on a second pass', () => {
        const once = collapseScopes(expandScopes(['*', RESERVED]), ['*', RESERVED]);
        expect(collapseScopes(expandScopes(once), once)).toEqual(once);
    });

    it('an empty grant is not reported as full access', () => {
        expect(detectTemplate([])).toBe('custom');
        expect(detectTemplate(null)).toBe('full');   // absent = the legacy "everything" default
    });
});

describe('a scope with no checkbox is carried, never dropped', () => {
    // The editor's vocabulary is always behind the node's. Dropping what it does not recognise
    // turns "I opened the dialog to look" into a silent revocation, and the owner is never told
    // which scope went. `zzz:` is deliberately a domain no editor will ever have.
    const FOREIGN = 'zzz:something';
    const FOREIGN_WILDCARD = 'zzz:*';

    it('lists them so the owner can see what they cannot otherwise reach', () => {
        expect(unknownScopes(['memory:read', FOREIGN])).toEqual([FOREIGN]);
        expect(unknownScopes(['*', 'memory:read'])).toEqual([]);
        expect(unknownScopes(['memory:*'])).toEqual([]);
    });

    it('survives open → save alongside a wildcard', () => {
        const saved = collapseScopes(expandScopes(['*', FOREIGN]), ['*', FOREIGN]);
        expect(saved).toContain('*');
        expect(saved).toContain(FOREIGN);
    });

    it('survives open → save on its own', () => {
        expect(collapseScopes(expandScopes([FOREIGN]), [FOREIGN])).toEqual([FOREIGN]);
    });

    it('an unknown DOMAIN wildcard is not swallowed into catalogue:read', () => {
        const saved = collapseScopes(expandScopes([FOREIGN_WILDCARD]), [FOREIGN_WILDCARD]);
        expect(saved).toEqual([FOREIGN_WILDCARD]);
        expect(saved).not.toContain('catalogue:read');
    });

    it('a mixed set keeps both halves', () => {
        const stored = ['memory:read', FOREIGN_WILDCARD];
        const saved = collapseScopes(expandScopes(stored), stored);
        expect(new Set(saved)).toEqual(new Set(stored));
    });

    it('a malformed entry is kept rather than becoming invisible', () => {
        for (const junk of [' memory:read', 'Memory:Read', 'bogus']) {
            expect(collapseScopes(expandScopes([junk]), [junk])).toEqual([junk]);
            expect(unknownScopes([junk])).toEqual([junk]);
        }
    });
});

describe('a domain wildcard is not rewritten into a snapshot', () => {
    it("['memory:*'] round-trips when the domain was left alone", () => {
        expect(collapseScopes(expandScopes(['memory:*']), ['memory:*'])).toEqual(['memory:*']);
    });

    it('but becomes explicit once the owner changes that domain', () => {
        const checked = expandScopes(['memory:*']);
        checked.delete('memory:delete');
        const saved = collapseScopes(checked, ['memory:*']);
        expect(saved).not.toContain('memory:*');
        expect(saved).toContain('memory:read');
        expect(saved).not.toContain('memory:delete');
    });

    it('is not conjured for an agent that never had it', () => {
        const stored = ['memory:read', 'memory:write', 'memory:delete', 'memory:write-as-owner'];
        expect(collapseScopes(expandScopes(stored), stored)).not.toContain('memory:*');
    });
});

describe('the template shown reflects what would be saved', () => {
    it("a full editor with the extra tick still reads as 'full'", () => {
        expect(detectTemplate(collapseScopes(new Set(everyScope())))).toBe('full');
    });

    it("a full editor without it also reads as 'full'", () => {
        expect(detectTemplate(collapseScopes(wildcardScopes()))).toBe('full');
    });

    it('the presets keep their names through the round trip', () => {
        expect(detectTemplate(collapseScopes(expandScopes(SCOPE_TEMPLATES.readonly)))).toBe('readonly');
        expect(detectTemplate(collapseScopes(expandScopes(SCOPE_TEMPLATES.standard)))).toBe('standard');
    });
});
