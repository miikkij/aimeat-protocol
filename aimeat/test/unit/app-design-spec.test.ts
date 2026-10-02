/**
 * @file app-design-spec.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the design spec beside an app: what a write accepts, what the
 *   publish hint says in each of its cases, the stamp, the outline, and the two "Ask your AI"
 *   prompts with the reader of the AI's answer.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-design-spec.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (wish-sovelluksen-design-speksi-sovelluksen-l-helle-settings-contr).
 */
import { describe, it, expect } from 'vitest';
import {
    APP_DESIGN_SPEC_MAX_BYTES, APP_DESIGN_SPEC_TEMPLATE, checkDesignSpecMarkdown, designSpecHint, designSpecStamp,
    isDesignSpecStale, designSpecMeaning, APP_DESIGN_SPEC_SPEC,
} from '../../src/services/app-design-spec.js';
import { buildSpecMcpPrompt, buildSpecPastePrompt, readSpecAnswer } from '../../public/views/profile/apps/design-spec.prompt.js';

describe('checkDesignSpecMarkdown', () => {
    it('refuses what is not a document', () => {
        expect(checkDesignSpecMarkdown(undefined).ok).toBe(false);
        expect(checkDesignSpecMarkdown(42).ok).toBe(false);
        expect(checkDesignSpecMarkdown('  \n ').ok).toBe(false);
    });
    it('normalises line ends and trailing spaces, and ends with one newline', () => {
        const out = checkDesignSpecMarkdown('# A  \r\n\r\nline   \r\n');
        expect(out).toEqual({ ok: true, markdown: '# A\n\nline\n' });
    });
    it('refuses a document over the ceiling and names the ceiling', () => {
        const out = checkDesignSpecMarkdown('x'.repeat(APP_DESIGN_SPEC_MAX_BYTES + 1));
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.message).toContain(String(APP_DESIGN_SPEC_MAX_BYTES));
    });
    it('counts bytes, not characters', () => {
        // Three bytes per character: a document of a third of the ceiling in characters passes, half does not.
        expect(checkDesignSpecMarkdown('ä'.repeat(Math.floor(APP_DESIGN_SPEC_MAX_BYTES / 3))).ok).toBe(true);
        expect(checkDesignSpecMarkdown('ä'.repeat(Math.floor(APP_DESIGN_SPEC_MAX_BYTES / 2))).ok).toBe(false);
    });
});

describe('designSpecHint', () => {
    const stamp = { at: '2026-10-02T00:00:00.000Z', by: 'teemu', version: 2, revision: 1, bytes: 120 };
    it('says nothing on an app one person builds alone with no spec', () => {
        expect(designSpecHint({ stamp: undefined, newVersion: 5, shared: false })).toBeUndefined();
    });
    it('asks a shared app for a spec, naming the action to write it with', () => {
        const hint = designSpecHint({ stamp: undefined, newVersion: 5, shared: true });
        expect(hint).toContain('no design spec');
        expect(hint).toContain('spec_set');
    });
    it('says nothing when the spec is current for the version published', () => {
        expect(designSpecHint({ stamp: { ...stamp, version: 3 }, newVersion: 3, shared: true })).toBeUndefined();
    });
    it('names both versions when the publish moved past the spec, shared or not', () => {
        for (const shared of [true, false]) {
            const hint = designSpecHint({ stamp, newVersion: 3, shared });
            expect(hint).toContain('version 2');
            expect(hint).toContain('version 3');
            expect(hint).toContain('spec_set');
        }
    });
});

describe('the stamp, staleness and the meaning line', () => {
    const spec = {
        spec: APP_DESIGN_SPEC_SPEC, appId: 'teemu/pm.html', markdown: '# Spec\n\nää\n', updatedBy: 'teemu',
        updatedByPrincipal: 'teemu@node', updatedAt: '2026-10-02T00:00:00.000Z', version: 4, revision: 2,
        createdAt: '2026-10-01T00:00:00.000Z',
    };
    it('stamps bytes, not characters, and never the prose', () => {
        const stamp = designSpecStamp(spec)!;
        expect(stamp.bytes).toBe(Buffer.byteLength(spec.markdown, 'utf8'));
        expect(stamp).toEqual({ at: spec.updatedAt, by: 'teemu', version: 4, revision: 2, bytes: stamp.bytes });
        expect(designSpecStamp(null)).toBeUndefined();
    });
    it('is stale only when the app moved past it', () => {
        expect(isDesignSpecStale(spec, 4)).toBe(false);
        expect(isDesignSpecStale(spec, 5)).toBe(true);
        expect(isDesignSpecStale(null, 5)).toBe(false);
    });
    it('tells the reader what to do in each state', () => {
        expect(designSpecMeaning(null, 1)).toContain('template');
        expect(designSpecMeaning(spec, 5)).toContain('version 4');
        expect(designSpecMeaning(spec, 5)).toContain('version 5');
        expect(designSpecMeaning(spec, 4)).toContain('Read it before you change the app');
    });
    it('the outline carries the seven questions a second builder asks', () => {
        for (const h of ['## Purpose', '## Screens', '## Data', '## Rules and decisions', '## AI and agents', '## Open questions', '## Traps']) {
            expect(APP_DESIGN_SPEC_TEMPLATE).toContain(h);
        }
    });
});

describe('the Ask your AI prompts', () => {
    it('the MCP prompt names the tools, the app and the order', () => {
        const p = buildSpecMcpPrompt({ url: 'https://innokas.aimeat.io', owner: 'teemu', filename: 'pm.html', name: 'PM dashboard', present: true, stale: true });
        expect(p).toContain('aimeat_app_manage { action: "spec", owner: "teemu", filename: "pm.html" }');
        expect(p).toContain('action: "spec_set"');
        expect(p).toContain('aimeat_app_get');
        expect(p).toContain('older version');
        expect(buildSpecMcpPrompt({ url: 'u', owner: 'o', filename: 'f', name: 'n', present: false, stale: false })).toContain('Nobody has written it yet');
    });
    it('the paste prompt carries the current document and asks for one fenced block', () => {
        const p = buildSpecPastePrompt({ name: 'PM dashboard', current: '# Spec\n\n## Purpose\nx\n' });
        expect(p).toContain('## Purpose');
        expect(p).toContain('```markdown');
        expect(p).toContain('PM dashboard');
    });
});

describe('readSpecAnswer', () => {
    it('takes the fenced block out of a chatty answer, keeping fences inside the document', () => {
        const answer = 'Here you go:\n\n```markdown\n# Spec\n\n## Data\n\n```js\nAIMEAT.data.get("k")\n```\n\n## Traps\nnone\n```\n\nAnything else?';
        const r = readSpecAnswer(answer);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.markdown.startsWith('# Spec')).toBe(true);
            expect(r.markdown).toContain('```js\nAIMEAT.data.get("k")\n```');
            expect(r.markdown.trim().endsWith('none')).toBe(true);
            expect(r.markdown).not.toContain('Anything else');
        }
    });
    it('takes a bare answer whole, with CRLF normalised', () => {
        const r = readSpecAnswer('# Spec\r\n\r\ntext  \r\n');
        expect(r).toEqual({ ok: true, markdown: '# Spec\n\ntext\n' });
    });
    it('refuses an answer with no document in it', () => {
        expect(readSpecAnswer('')).toEqual({ ok: false, error: 'empty' });
        expect(readSpecAnswer('```markdown\n\n```')).toEqual({ ok: false, error: 'empty' });
    });
});
