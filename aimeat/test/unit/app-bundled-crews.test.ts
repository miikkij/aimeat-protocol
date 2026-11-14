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
 * @structure parseBundledCrews: present · absent · malformed · not-an-array · anywhere in the document ·
 *   decideBundledCrews: the block, the request, neither, a block that cannot be used ·
 *   crewPermissionFindings · crewDefHash, proposedAgentName
 * @usage pnpm test -- app-bundled-crews
 * @version-history
 *   v1.1.0 — 2026-11-11 — decideBundledCrews (a publish reads the page's block), the permissions
 *     hint, the definition hash and the name an approved proposal gives the agent.
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseBundledCrews, decideBundledCrews, crewPermissionFindings } from '../../src/services/app/bundled-crews.js';
import { crewDefHash, deployedAgentName, proposedAgentName } from '../../src/models/crew-def-schemas.js';

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

// A crew-def the publish gate accepts: one task takes {{ctx.prompt}} (CREW above is for the parser only).
const VALID = {
    agent_name: 'shopkeeper',
    agents: [{ role: 'Interviewer', goal: 'Find out what they sell.', tools: ['memory'] }],
    tasks: [{ id: 'interview', description: 'Interview the owner about: {{ctx.prompt}}', expected_output: 'What they said.', agent: 'Interviewer' }],
};
const block = (crews: unknown) => page(`<script type="application/json" id="aimeat-crews">${typeof crews === 'string' ? crews : JSON.stringify(crews)}</script>`);

describe('decideBundledCrews: which crew-defs a version being published carries', () => {
    it('reads the page\'s block when the request states none', () => {
        const out = decideBundledCrews({ requested: undefined, html: block([VALID]) });
        assert.equal(out.agents?.length, 1);
        assert.equal((out.agents?.[0] as { agent_name: string }).agent_name, 'shopkeeper');
        assert.deepEqual(out.findings, []);
    });

    it('answers undefined (carry the previous version forward) with no block and no request', () => {
        assert.deepEqual(decideBundledCrews({ requested: undefined, html: page('') }), { agents: undefined, findings: [] });
        assert.deepEqual(decideBundledCrews({ requested: undefined, html: null }), { agents: undefined, findings: [] });
    });

    it('never throws on a block it cannot use: it carries forward and names the block', () => {
        for (const bad of ['[{ not json', '"shopkeeper"', JSON.stringify([CREW])]) {
            const out = decideBundledCrews({ requested: undefined, html: block(bad) });
            assert.equal(out.agents, undefined, `carried forward for: ${bad.slice(0, 20)}`);
            assert.equal(out.findings.length, 1);
            assert.equal(out.findings[0].pitfall, 'bundled-agent-block');
            assert.equal(out.findings[0].severity, 'warn');
        }
        // The definition with no {{ctx.prompt}} says why.
        assert.match(decideBundledCrews({ requested: undefined, html: block([CREW]) }).findings[0].message, /ctx\.prompt/);
    });

    it('lets the request win, and says so when the page declares something else', () => {
        const other = { ...VALID, agent_name: 'bookkeeper' };
        const same = decideBundledCrews({ requested: [VALID], html: block([VALID]) });
        assert.deepEqual(same.findings, []);
        const differs = decideBundledCrews({ requested: [other], html: block([VALID]) });
        assert.equal((differs.agents?.[0] as { agent_name: string }).agent_name, 'bookkeeper');
        assert.equal(differs.findings.length, 1);
        assert.equal(differs.findings[0].pitfall, 'bundled-agent-block');
        // An explicit empty list clears, whatever the page says.
        assert.deepEqual(decideBundledCrews({ requested: [], html: page('') }).agents, []);
    });
});

describe('crewPermissionFindings: tools named, no permissions asked for', () => {
    it('names an agent whose crew uses a tool beyond memory and declares no scopes', () => {
        const out = crewPermissionFindings([{ ...VALID, agents: [{ role: 'Interviewer', goal: 'g', tools: ['memory', 'web', 'decide:sort-a-message'] }] }]);
        assert.equal(out.length, 1);
        assert.equal(out[0].pitfall, 'bundled-agent-permissions');
        assert.match(out[0].message, /"shopkeeper"/);
        assert.match(out[0].message, /web, decide:sort-a-message/);
        assert.doesNotMatch(out[0].message, /tools memory/);
    });

    it('says nothing for memory alone, for no tools, and when scopes are declared', () => {
        assert.deepEqual(crewPermissionFindings([VALID]), []);
        assert.deepEqual(crewPermissionFindings([{ ...VALID, agents: [{ role: 'Interviewer', goal: 'g' }] }]), []);
        assert.deepEqual(crewPermissionFindings([{ ...VALID, scopes: ['organism:read'], agents: [{ role: 'Interviewer', goal: 'g', tools: ['web'] }] }]), []);
    });
});

describe('the two names and the hash of a bundled agent', () => {
    it('gives equal definitions one hash whatever the key order, and a changed one another', () => {
        const a = { agent_name: 'x', agents: [{ role: 'r', goal: 'g' }], tasks: [] };
        const b = { tasks: [], agents: [{ goal: 'g', role: 'r' }], agent_name: 'x' };
        assert.equal(crewDefHash(a), crewDefHash(b));
        assert.notEqual(crewDefHash(a), crewDefHash({ ...a, agents: [{ role: 'r', goal: 'another goal' }] }));
        assert.match(crewDefHash(a), /^[0-9a-f]{16}$/);
    });

    it('cuts the proposed name at 40 characters, where the deployed name runs to 64', () => {
        const appId = 'alice/a-rather-long-application-name.html';
        const deployed = deployedAgentName('order-composer', appId);
        const proposed = proposedAgentName('order-composer', appId);
        assert.equal(deployed, 'order-composer-alice-a-rather-long-application-name-html');
        assert.equal(proposed, 'order-composer-alice-a-rather-long-appli');
        assert.ok(proposed.length <= 40 && deployed.startsWith(proposed));
        // A short pair is one name.
        assert.equal(proposedAgentName('scout', 'bob/n.html'), deployedAgentName('scout', 'bob/n.html'));
    });
});
