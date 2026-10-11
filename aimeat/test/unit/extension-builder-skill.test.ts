/**
 * @file test/unit/extension-builder-skill.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `aimeat-extension-builder` built-in skill ships with every node, names only `ctx`
 *   members the sandbox gives, and never teaches a morsel as a price.
 *
 *   WHY. The skill existed only as an operator-published copy on aimeat.io, so no other node had it,
 *   and that copy priced an action with `commercial.payMorsels`. Three repository guides taught
 *   `ctx.api`, `ctx.task` and `ctx.log()` as a function, none of which the sandbox has. The ctx
 *   members are read from services/extension-ctx-contract.ts (the ExtensionCtx interface) plus the
 *   two pure helpers the guest prelude adds, `hash` and `now`.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-builder-skill.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (docs audit phase 2).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';

const CONTRACT = readFileSync(join(import.meta.dirname, '../../src/services/extension-ctx-contract.ts'), 'utf-8');

/** The top-level members of ExtensionCtx, as declared at four-space indent inside the interface. */
function ctxMembers(): Set<string> {
    const body = CONTRACT.slice(CONTRACT.indexOf('export interface ExtensionCtx {'));
    const end = body.indexOf('\n}\n');
    const members = new Set<string>(['hash', 'now']);
    for (const m of body.slice(0, end).matchAll(/^ {4}([a-zA-Z]+)\??[:(]/gm)) members.add(m[1]!);
    return members;
}

describe('aimeat-extension-builder built-in skill', () => {
    const skill = BUILTIN_SKILLS.find(s => s.name === 'aimeat-extension-builder');

    it('ships with every node, public', () => {
        expect(skill, 'not in BUILTIN_SKILLS').toBeDefined();
        expect(skill!.visibility).toBe('public');
    });

    it('names only ctx members the sandbox gives', () => {
        const members = ctxMembers();
        expect(members.has('memory') && members.has('fetch') && members.has('log')).toBe(true);
        const named = [...skill!.skillMd.matchAll(/ctx\.([a-zA-Z]+)/g)].map(m => m[1]!);
        // ctx.api and ctx.task appear only to say they do not exist.
        const unknown = [...new Set(named)].filter(n => !members.has(n) && n !== 'api' && n !== 'task');
        expect(unknown).toEqual([]);
        expect(skill!.skillMd).toMatch(/There is no `ctx\.api` and no `ctx\.task`/);
        expect(skill!.skillMd).not.toMatch(/ctx\.log\(/);
    });

    it('declares pacing as tollMorsels and a price in money, and names payMorsels only as refused', () => {
        const md = skill!.skillMd;
        expect(md).toMatch(/tollMorsels: 2/);
        expect(md).toMatch(/payMoney: \{ amount: 50000, currency: EUR \}/);
        for (const line of md.split('\n').filter(l => l.includes('payMorsels'))) {
            expect(line + ' ' + md.slice(md.indexOf(line), md.indexOf(line) + 300)).toMatch(/MORSEL_PRICE_REMOVED|refused/);
        }
        expect(md).not.toMatch(/payMorsels: \d/);
    });
});
