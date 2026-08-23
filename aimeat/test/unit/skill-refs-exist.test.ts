/**
 * @file test/unit/skill-refs-exist.test.ts
 * @description Every node-scope skill a tool description tells the reader to load actually exists.
 *
 *   WHY THIS EXISTS. Two tool descriptions have named `node:hatchery-agent-requests` since July —
 *   aimeat_schedule_create and aimeat_extension_install both say to load it BEFORE building — and
 *   the skill was never in BUILTIN_SKILLS. So every agent that obeyed the instruction got
 *   NOT_FOUND, and then built the thing the instruction was written to prevent. The instruction was
 *   worse than none: it cost a round trip and taught the reader to ignore the next one.
 *
 *   Nothing caught it because both halves were individually valid. The description is prose, the
 *   skill list is data, and no check read one against the other. This does.
 *
 *   SCOPE. Only `node:` refs, because those are the ones this repo can prove. A `user:` or `ws:`
 *   ref points at somebody's own library and is not knowable from here; a description that names
 *   one is making a promise about a specific person's node, which is its own smell but not one a
 *   unit test can settle.
 * @usage pnpm test -- skill-refs-exist
 * @version-history
 *   v1.0.0 — 2026-08-23 — Written after finding the hatchery skill missing while building
 *     TARGET-071's agent side.
 */
import { describe, it, expect } from 'vitest';
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../../src/mcp/catalog/definitions.js';
import { BUILTIN_SKILLS } from '../../src/data/builtin-skills.js';

/** `node:some-skill-name`, as a description would write it. Trailing punctuation is not the name. */
const NODE_REF = /\bnode:([a-z0-9][a-z0-9-]*)\b/g;

describe('a tool description that names a node skill names one that exists', () => {
    const known = new Set(BUILTIN_SKILLS.map(s => s.name));

    /** Every (tool, skill) pair any description asks the reader to load. */
    const referenced: Array<{ tool: string; skill: string }> = [];
    for (const tool of CLI_FALLBACK_TOOL_DEFINITIONS) {
        const text = [tool.description, ...Object.values(tool.input ?? {}).map(f => f.description)]
            .filter(Boolean).join(' ');
        for (const m of text.matchAll(NODE_REF)) {
            referenced.push({ tool: tool.name, skill: m[1]! });
        }
    }

    it('finds the references at all, so a rename cannot make this test vacuously pass', () => {
        // The check above is a regex over prose. If somebody rewrites the descriptions to point at
        // skills a different way, this test would go green by finding nothing at all — which is the
        // failure mode of every scan-based test. One known reference keeps it honest.
        expect(referenced.map(r => r.skill)).toContain('hatchery-agent-requests');
    });

    it('every named node skill is in BUILTIN_SKILLS', () => {
        const missing = referenced.filter(r => !known.has(r.skill));
        expect(missing.map(r => `${r.tool} -> node:${r.skill}`)).toEqual([]);
    });
});
