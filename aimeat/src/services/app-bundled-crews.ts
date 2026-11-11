/**
 * @file src/services/app-bundled-crews.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The crew-defs an app bundles inside its own HTML, so `manifest.cortex.agents`
 *   survives a PACKAGE install.
 *
 *   WHAT WAS BROKEN. Bundling itself works and is in production (NOSTE ships two crews on its app
 *   record). The PACKAGE door dropped them: `component-registrar.ts` builds an installed app's
 *   manifest by hand as `{ name, description, version, category, tags, authorDisplay, usesCortex }`
 *   with no `cortex` key at all, so a package whose app shipped crews installed an app with none —
 *   in silence, which is the part that cost the time.
 *
 *   WHY THE HTML IS THE CARRIER. The publish route takes crew-defs as a request field, and a
 *   package has no request: it has components. `PackageComponent` is `{ id, type, label, content,
 *   contentHash, dependencies }`, and `package-zip.ts` carries exactly `content` per component, so a
 *   new field on the type would be dropped by export/import and the same silence would come back by
 *   another road. The app's own HTML is already where this node reads a declaration FROM
 *   (`<meta name="aimeat-ai">` in app-ai-posture.ts, `<meta name="aimeat-scopes">` in
 *   app-agent-surface.ts), and it is the one thing every door and the ZIP carry unchanged.
 *
 *   A `<meta>` cannot hold an array of objects, so the block is a JSON script tag. Reading it is
 *   deliberately forgiving: a malformed declaration returns null rather than throwing, because it
 *   must never be able to fail an install — the same rule `parseAiPosture` follows for a publish.
 *   Validation against the crew-def contract stays where it already is (`validateCortexAgents`), so
 *   this file decides only "is there a block and is it shaped like a list of crew-defs".
 *
 *   ONE DECLARATION FOR EVERY PUBLISH (2026-11-11). Until then a publish read only the request's
 *   `cortex.agents` field and a package read only this block, so an app that carried one of the two
 *   lost its agents on the other path. decideBundledCrews() is asked by every publish: the request
 *   field wins when it is given, the page's block is the declaration when it is not, and with
 *   neither the previous version's agents carry forward as before. A block that cannot be read or
 *   does not validate never refuses the publish; it is named in the publish hints.
 * @structure MAX_CREWS_BYTES · CREWS_BLOCK_RE · parseBundledCrews(html) · decideBundledCrews(input) ·
 *   crewPermissionFindings(agents)
 * @usage
 *   import { parseBundledCrews } from './app-bundled-crews.js';
 *   const crews = parseBundledCrews(appHtml);   // null when the app declares none
 *   const { agents, findings } = decideBundledCrews({ requested, html });
 * @version-history
 *   v1.1.0 — 2026-11-11 — decideBundledCrews(): a publish reads the page's block too, and says when
 *     the block cannot be used or differs from the request. crewPermissionFindings(): a definition
 *     that names tools and asks for no permissions is named in the publish hints.
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070): the carrier that lets a package ship agents.
 */
import { logger } from '../utils/logger.js';
import { validateCortexAgents, crewDefHash } from '../models/crew-def-schemas.js';
import type { AppArtifactFinding } from './app-artifact-lint.js';

/** The curated pitfall that says how an app declares its agents (data/appdev-pitfalls.ts). */
const BLOCK_PITFALL = 'bundled-agent-block';
/** The curated pitfall that says which permissions a bundled agent gets (data/appdev-pitfalls.ts). */
const PERMISSIONS_PITFALL = 'bundled-agent-permissions';

const finding = (pitfall: string, message: string): AppArtifactFinding => ({
    pitfall, severity: 'warn', message, url: `/v1/appdev/pitfalls/${pitfall}`,
});

/**
 * Largest crews block read. An app is capped at 5 MB and a crew-def is prose, so 256 kB is far
 * above any real declaration; the cap exists so a pathological app cannot make every install parse
 * megabytes. Over it, the block is ignored the same way a malformed one is.
 */
const MAX_CREWS_BYTES = 256 * 1024;

/**
 * `<script type="application/json" id="aimeat-crews"> … </script>`, attributes in any order.
 * Scanned over the whole document rather than the head, because this block is content-sized and an
 * author will reasonably put it at the end of the body next to the rest of their JSON.
 */
const CREWS_BLOCK_RE = /<script\b[^>]*\bid\s*=\s*["']aimeat-crews["'][^>]*>([\s\S]*?)<\/script\s*>/i;

/**
 * The crew-defs an app declares in its own HTML, or null when it declares none or the declaration
 * is unreadable.
 *
 * Never throws. The shape check is only "a non-empty array of plain objects" — whether each entry
 * is a VALID crew-def is `validateCortexAgents`'s job, and duplicating that here would be a second
 * definition of the same contract.
 */
export function parseBundledCrews(html: string): Record<string, unknown>[] | null {
    const m = CREWS_BLOCK_RE.exec(html);
    if (!m) return null;

    const body = m[1].trim();
    if (!body) return null;
    if (Buffer.byteLength(body, 'utf-8') > MAX_CREWS_BYTES) {
        logger.warn('app-bundled-crews: crews block over the size cap — ignored', {
            bytes: Buffer.byteLength(body, 'utf-8'), cap: MAX_CREWS_BYTES,
        });
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch (err) {
        // An unreadable declaration must not be able to fail an install, so it reads as "none
        // declared". Logged rather than swallowed: the author needs to be able to find out why
        // their crews did not travel.
        logger.warn('app-bundled-crews: crews block is not valid JSON — treated as no crews', {
            error: String(err),
        });
        return null;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const allObjects = parsed.every(
        (c) => typeof c === 'object' && c !== null && !Array.isArray(c),
    );
    if (!allObjects) {
        logger.warn('app-bundled-crews: crews block is not a list of objects — treated as no crews');
        return null;
    }

    return parsed as Record<string, unknown>[];
}

/** The crew runtime's own memory tool needs only what every proposal already carries (data/crew-runtime-scopes.ts). */
const TOOLS_COVERED_BY_RUNTIME_SCOPES = new Set(['memory']);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * A definition whose crew names tools and which asks for no permissions. An agent approved from it
 * holds the crew runtime's memory:read and memory:write and nothing else, so a tool that calls the
 * node for anything else is refused on its first use. Measured on a production node on 2026-11-11:
 * none of the five bundled agents there declared `scopes`, and two of them named ten tools between them.
 */
export function crewPermissionFindings(agents: readonly Record<string, unknown>[]): AppArtifactFinding[] {
    const out: AppArtifactFinding[] = [];
    for (const def of agents) {
        if (strings(def.scopes).length > 0) continue;
        const members = Array.isArray(def.agents) ? def.agents as Array<{ tools?: unknown } | null> : [];
        const tools = [...new Set(members.flatMap(m => strings(m?.tools)))]
            .filter(t => !TOOLS_COVERED_BY_RUNTIME_SCOPES.has(t.split(':')[0]));
        if (tools.length === 0) continue;
        out.push(finding(PERMISSIONS_PITFALL,
            `The agent "${String(def.agent_name ?? '')}" names the tools ${tools.join(', ')} and asks for no permissions. `
            + 'An agent approved from it holds memory:read and memory:write only, so a tool that calls the node for anything else is refused. '
            + 'Add "scopes": ["..."] beside agent_name with the permissions those tools need; the owner sees the list before approving.'));
    }
    return out;
}

/**
 * Which crew-defs a version being published carries, and what to tell its publisher.
 *
 * `agents` undefined means neither the request nor the page states any, so the previous version's
 * carry forward (send `[]` in the request to clear them). `requested` is the request's validated
 * `cortex.agents`; `html` is the page, or null for a bundle that is not HTML.
 */
export function decideBundledCrews(input: {
    requested: Record<string, unknown>[] | undefined; html: string | null;
}): { agents: Record<string, unknown>[] | undefined; findings: AppArtifactFinding[] } {
    const hasBlock = input.html !== null && CREWS_BLOCK_RE.test(input.html);
    const block = hasBlock ? parseBundledCrews(input.html as string) : null;
    const checked = block ? validateCortexAgents(block) : null;
    const hashes = (list: readonly unknown[]) => JSON.stringify(list.map(crewDefHash).sort());

    if (input.requested !== undefined) {
        const findings = crewPermissionFindings(input.requested);
        // Only a block that validates is compared, and the request is read through the same schema
        // first: the schema fills defaults, and a list stored by an earlier version of it (a draft's
        // carried agents) would otherwise differ from the same definitions read today.
        const asked = validateCortexAgents(input.requested);
        if (checked?.ok && hashes(checked.agents) !== hashes(asked.ok ? asked.agents : input.requested)) {
            findings.push(finding(BLOCK_PITFALL,
                'The request\'s cortex.agents and the page\'s aimeat-crews block declare different agents. The request was used for this version. '
                + 'A package made from this app reads only the block, so keep the two the same, or leave cortex.agents out and let the block declare them.'));
        }
        return { agents: input.requested, findings };
    }

    if (!hasBlock) return { agents: undefined, findings: [] };
    if (!block) {
        return {
            agents: undefined,
            findings: [finding(BLOCK_PITFALL,
                'The page has an aimeat-crews block that could not be read: it is empty, not valid JSON, not a list of objects, or over 256 kB. '
                + 'This version keeps the agents of the previous one. Fix the block and publish again.')],
        };
    }
    if (!checked || !checked.ok) {
        return {
            agents: undefined,
            findings: [finding(BLOCK_PITFALL,
                `The page's aimeat-crews block does not validate, so this version keeps the agents of the previous one: ${(checked?.errors ?? []).join('; ')}`)],
        };
    }
    const agents = checked.agents as unknown as Record<string, unknown>[];
    return { agents, findings: crewPermissionFindings(agents) };
}
