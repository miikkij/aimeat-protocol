/**
 * @file test/unit/scope-vocabulary-parity.test.ts
 * @description The agent scope editor's vocabulary against the scopes the node actually enforces,
 *   in both directions: no enforced scope without a checkbox, no checkbox without enforcement.
 *
 *   Both directions had failed and neither was visible from inside one file. Seventeen scopes the
 *   node gates on — bookkeeping, outgoing email, automations, connected accounts, marketplace
 *   grants — had no row, so an owner could not see them, could not revoke them, and, because `*`
 *   short-circuits every gate, lost all of them at once by unticking one unrelated box. In the
 *   other direction four boxes granted nothing at all: `generator:*` outlived the Generator by
 *   three weeks, and `agent:register` was never read anywhere.
 *
 *   A missing box and a box that lies are the same failure — the owner's question is "what can this
 *   agent do", and both answer it wrongly.
 *
 *   This reads the source rather than a hand-kept list, because a hand-kept list drifts exactly as
 *   the vocabulary did. When it fails, the fix is a row in SCOPE_DOMAINS or an entry in
 *   NOT_AN_AGENT_CHECKBOX below with the reason — never a silent widening of the allowlist.
 * @usage pnpm test -- scope-vocabulary-parity
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial, with the vocabulary repair it was written to hold in place.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCOPE_DOMAINS } from '../../public/views/profile/agents/scope-model.js';

const SRC = join(fileURLToPath(new URL('../../', import.meta.url)), 'src');

function everyTsFile(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) everyTsFile(full, out);
        else if (entry.endsWith('.ts')) out.push(full);
    }
    return out;
}

const SOURCE = everyTsFile(SRC).map(f => readFileSync(f, 'utf8')).join('\n');

/** Every scope string reached through the requireScope family — the load-bearing gates. */
function enforcedScopes(): Set<string> {
    const found = new Set<string>();
    for (const m of SOURCE.matchAll(/requireScope\(\s*'([a-z][a-z-]*:[a-z*-]+)'/g)) found.add(m[1]);
    for (const m of SOURCE.matchAll(/requireRoleOrScope\(\s*'[a-z]+'\s*,\s*'([a-z][a-z-]*:[a-z*-]+)'/g)) found.add(m[1]);
    for (const m of SOURCE.matchAll(/requireAnyScope\(\s*\[([^\]]*)\]/g)) {
        for (const s of m[1].matchAll(/'([a-z][a-z-]*:[a-z*-]+)'/g)) found.add(s[1]);
    }
    found.delete('*');
    return found;
}

const editorScopes = new Set<string>(
    SCOPE_DOMAINS.flatMap((d: { key: string; permissions: string[] }) =>
        d.permissions.map(p => `${d.key}:${p}`)),
);

/**
 * Enforced, but deliberately not a row in the AGENT editor. Every entry needs a reason that says
 * whose tick it would be, because "it is enforced somewhere" is not the same question as "does
 * ticking this change what THIS agent can do".
 */
const NOT_AN_AGENT_CHECKBOX: Record<string, string> = {
    'contract:spend': 'app sessions only — appSpendRefusal returns null for any non-app principal (services/metered-access.ts)',
    'events:emit': "ecosystem apps only — requireRole('ecosystem') runs first (routes/ecosystem-events.ts)",
    'organism:write': "agents pass by ROLE via requireRoleOrScope('agent', …), so the tick binds only apps and eco apps",
    'organism:invite': 'agent-relevant only for join CODES; the email-invite routes admit any agent by role',
    'knowledge:read': 'live-update notifications only — no knowledge route is scope-gated',
};

describe('every enforced scope has a checkbox', () => {
    it('nothing the node gates on is invisible to the owner', () => {
        const missing = [...enforcedScopes()]
            .filter(s => !editorScopes.has(s) && !(s in NOT_AN_AGENT_CHECKBOX))
            .sort();
        expect(missing).toEqual([]);
    });

    it('the exemption list is honest — every entry is a real scope somewhere', () => {
        // Deliberately NOT enforcedScopes(): contract:spend is gated by a hand-written comparison
        // in services/metered-access.ts rather than requireScope, and that is precisely the kind of
        // scope this list exists to account for. The bar is that the string is real — an exemption
        // for a scope nothing reads would quietly license removing a checkbox that mattered.
        for (const scope of Object.keys(NOT_AN_AGENT_CHECKBOX)) {
            expect(SOURCE.includes(`'${scope}'`), `${scope} is exempted but appears nowhere in src/`).toBe(true);
        }
    });

    it('an exempted scope is not ALSO a checkbox — that would be a box binding someone else', () => {
        for (const scope of Object.keys(NOT_AN_AGENT_CHECKBOX)) {
            if (scope === 'organism:invite') continue;   // half-covered, see the reason above
            expect(editorScopes.has(scope), `${scope} is both exempted and offered`).toBe(false);
        }
    });
});

describe('every checkbox does something', () => {
    // Read anywhere at all — a requireScope gate, a manual comparison, an MCP tool scope. The bar
    // is deliberately low: this catches the box that outlived its feature, not the subtle cases.
    it('no scope in the editor is unknown to the whole of src/', () => {
        const dead = [...editorScopes].filter(s => !SOURCE.includes(`'${s}'`)).sort();
        expect(dead).toEqual([]);
    });

    it('the removed ones stay removed', () => {
        for (const gone of ['generator:read', 'generator:write', 'generator:execute',
            'agent:register', 'task:manage']) {
            expect(editorScopes.has(gone), `${gone} is dead and must not be offered`).toBe(false);
        }
    });
});

describe('every checkbox has a sentence in both languages', () => {
    // A row labelled by the shared permission word ("Write") told an owner nothing: the same word
    // sat on the row that saves a note and the row that books an accounting entry.
    const locales = ['en', 'fi'].map(lang => ({
        lang,
        text: JSON.parse(readFileSync(
            join(fileURLToPath(new URL('../../', import.meta.url)), 'locales', `${lang}.json`), 'utf8'),
        ).profile.agents.scopeUi.scopeText,
    }));

    for (const { lang, text } of locales) {
        it(`${lang}: one per scope, none empty`, () => {
            const missing: string[] = [];
            for (const scope of editorScopes) {
                const [domain, perm] = scope.split(/:(.*)/);
                const sentence = text?.[domain]?.[perm];
                if (!sentence || sentence.length < 10) missing.push(scope);
            }
            expect(missing.sort()).toEqual([]);
        });
    }

    it('the two languages describe the same scopes', () => {
        const [en, fi] = locales;
        const flat = (t: Record<string, Record<string, string>>) =>
            Object.entries(t).flatMap(([d, perms]) => Object.keys(perms).map(p => `${d}:${p}`)).sort();
        expect(flat(fi.text)).toEqual(flat(en.text));
    });
});
