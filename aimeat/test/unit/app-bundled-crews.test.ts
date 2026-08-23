/**
 * @file app-bundled-crews.test.ts
 * @description Crew-defs an app bundles in its own HTML — the carrier that lets
 *   `manifest.cortex.agents` survive a PACKAGE install. The registrar builds an app's manifest by
 *   hand (component-registrar.ts, case 'app') and had no `cortex` key at all, so a package whose
 *   app shipped crews installed an app with none, in silence.
 *
 *   WHY THE HTML CARRIES THEM. `PackageComponent` is `{ id, type, label, content, contentHash,
 *   dependencies }` and the ZIP round trip carries exactly `content`, so a new field on the type
 *   would be dropped on export/import. The app's own HTML is already where this node reads a
 *   declaration from (`<meta name="aimeat-ai">`, `<meta name="aimeat-scopes">`), and it is the one
 *   thing every install door and the ZIP all carry unchanged.
 * @structure parseBundledCrews: present · absent · malformed · not-an-array · anywhere in the document
 * @usage pnpm test -- app-bundled-crews
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseBundledCrews } from '../../src/services/app-bundled-crews.js';

const CREW = {
    agent_name: 'shopkeeper',
    readme_md: '# Shopkeeper\n\nAsks what you sell.',
    tags: ['shop'],
    process: 'sequential',
    agents: [{
        role: 'Interviewer',
        goal: 'Find out what they sell.',
        backstory: 'You ask short questions and you wait.',
        allow_delegation: false,
    }],
    tasks: [{
        id: 'interview',
        description: 'Interview the owner.',
        expected_output: 'What they actually said.',
        agent: 'Interviewer',
    }],
};

function page(body: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shop</title>${body}</head><body></body></html>`;
}

describe('parseBundledCrews', () => {
    it('reads the crew-defs an app declares in its own HTML', () => {
        const html = page(`<script type="application/json" id="aimeat-crews">${JSON.stringify([CREW])}</script>`);
        const crews = parseBundledCrews(html);
        assert.ok(crews, 'expected the block to be found');
        assert.equal(crews.length, 1);
        assert.equal((crews[0] as { agent_name: string }).agent_name, 'shopkeeper');
    });

    it('returns null when the app declares nothing', () => {
        assert.equal(parseBundledCrews(page('')), null);
    });

    // A malformed declaration must never be able to stop an install, exactly as a malformed
    // `<meta name="aimeat-ai">` must never stop a publish.
    it('returns null for a block that is not valid JSON', () => {
        assert.equal(parseBundledCrews(page('<script type="application/json" id="aimeat-crews">{not json</script>')), null);
    });

    it('returns null when the block holds something other than an array of objects', () => {
        assert.equal(parseBundledCrews(page('<script type="application/json" id="aimeat-crews">"shopkeeper"</script>')), null);
        assert.equal(parseBundledCrews(page('<script type="application/json" id="aimeat-crews">[1,2,3]</script>')), null);
    });

    it('finds the block wherever it sits in the document, not only in the head', () => {
        const html = '<!DOCTYPE html><html><head></head><body><div>shop</div>'
            + `<script type="application/json" id="aimeat-crews">${JSON.stringify([CREW])}</script></body></html>`;
        const crews = parseBundledCrews(html);
        assert.ok(crews);
        assert.equal(crews.length, 1);
    });
});
