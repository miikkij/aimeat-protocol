/**
 * @file skills.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the skills registry (dedicated system — NOT knowledge packages).
 *   Five tools: publish (inline SKILL.md or presigned skill-dir ZIP upload), list (library /
 *   linked / mine views — the "which scopes am I working with, what can I load" surface), get
 *   (resolve one skill with bodies), link / unlink (attach a skill ref to a same-owner agent).
 *   All storage access + access control delegates to services/skills.ts (resolveSkillRef is
 *   the single choke point).
 * @structure
 *   - registerSkillsTools() — registers the 5 aimeat_skill_* tools on an McpServer instance
 * @usage
 *   import { registerSkillsTools } from './skills.js';
 *   registerSkillsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
 * @version-history
 *   2026-10-08 — aimeat_skill_publish takes ai_provenance and ai_provenance_id, inline and in the ZIP
 *     upload's token, and answers with the record SKILL.md carries (aiprov E12).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-10-06 — skill_list, skill_link and skill_unlink take the catalog's schema too.
 *   v1.4.0 -- 2026-10-06 -- aimeat_skill_list view=linked asks memory:read, as its route does (secaudit
 *     2026-10 follow-up, A4).
 *   v1.3.0 -- 2026-09-29 -- TARGET-082 V4: the skill accessor carries the agent's ContentReader
 *     (readerForAgent), so the registry filters user and workspace skills through it.
 *   v1.2.1 -- 2026-09-26 -- The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.2.0 -- 2026-09-24 -- SECURITY (audit A8-1): node-scope publishing and visibility, which put a
 *     skill into every member's library, ask the operator question of the agent through
 *     services/operator-principal.ts, so they take operator:admin. It was read off the owner record,
 *     so every agent of an operator holding memory:write carried it.
 *   v1.1.0 -- 2026-09-03 -- aimeat_skill_update: visibility without a republish, the same door as
 *     PATCH /v1/skills/:name.
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry tools (node + user scopes).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII, localAccountName } from '../utils/gaii.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/operator-principal.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { generateUploadToken } from '../services/upload-token.js';
import {
  publishSkill, listSkills, listSkillLibrary, resolveSkillRef,
  getAgentSkillLinks, linkSkillToAgent, unlinkSkillFromAgent, setSkillVisibility,
  listSkillsByBinding, type SkillAccessor, type SkillScope,
} from '../services/skills.js';
import { readerForAgent } from '../services/classification/reader.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { toolError } from './tool-error.js';
import { toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';

export function registerSkillsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
    /** This session's granted scopes: the node-scope operator question is asked of them. */
    scopes: readonly string[] = [],
): void {
    const agentGaii = getAgentGaii();
    const parsed = parseGAII(agentGaii);
    const ownerName = parsed ? localAccountName(agentGaii) : null;

    // Node scope is the operator's, asked of THIS AGENT: an operator account's agent holding
    // operator:admin (services/operator-principal.ts), never the owner record alone.
    const accessor = async (): Promise<SkillAccessor> => ({
        ownerName,
        isOperator: (await resolveOperatorAgentName(storage, agentGaii, scopes)) !== null,
        sub: agentGaii,
        gaii: agentGaii,
        reader: readerForAgent({ storage, config }, agentGaii, scopes),
    });

    const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    const ok = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

    // ── aimeat_skill_publish ──
    mcp.tool(
        'aimeat_skill_publish',
        descriptionFor('aimeat_skill_publish'),
        zodShapeFor('aimeat_skill_publish'),
        annotationsFor('aimeat_skill_publish'),
        async ({ skill_md, files, scope, visibility, organism_id, workspace_id, ai_provenance, ai_provenance_id }) => {
            if (!ownerName) return err('Could not resolve the calling agent\'s owner');
            const acc = await accessor();
            const targetScope: SkillScope = scope === 'node' ? 'node' : scope === 'workspace' ? 'workspace' : 'user';
            if (targetScope === 'node' && !acc.isOperator) {
                return err(`Node-scope skills are operator-managed. ${OPERATOR_AGENT_REFUSAL}`);
            }
            if (targetScope === 'workspace' && (!organism_id || !workspace_id)) {
                return err('Workspace scope requires organism_id and workspace_id');
            }

            // Upload mode: no inline content -> presigned URL for a skill-dir ZIP.
            if (!skill_md) {
                const token = await generateUploadToken({
                    sub: agentGaii,
                    utype: 'skill',
                    meta: {
                        scope: targetScope,
                        ...(visibility ? { visibility } : {}),
                        ...(targetScope === 'workspace' ? { organism: organism_id, ws: workspace_id } : {}),
                        // How SKILL.md in the ZIP was written; routes/upload-skill.ts records it (aiprov E12).
                        ...(ai_provenance ? { ai_provenance } : {}),
                        ...(ai_provenance_id ? { ai_provenance_id } : {}),
                    },
                    maxBytes: 20 * 1024 * 1024,
                    contentType: 'application/zip',
                });
                return ok({
                    mode: 'upload',
                    upload_url: `${config.baseUrl}/v1/upload/${token}`,
                    method: 'PUT',
                    content_type: 'application/zip',
                    max_bytes: 20 * 1024 * 1024,
                    expires_in_seconds: 3600,
                    instructions: 'PUT a ZIP of the skill directory (SKILL.md at the root or inside a single wrapping directory; optional scripts/, references/, assets/). The response returns the published skill.',
                });
            }

            try {
                const fileMap = new Map<string, string>([['SKILL.md', skill_md]]);
                for (const [path, content] of Object.entries(files ?? {})) fileMap.set(path, content);
                const summary = await publishSkill(storage, config, {
                    scope: targetScope,
                    owner: ownerName,
                    publisher: agentGaii,
                    files: fileMap,
                    visibility,
                    ...(targetScope === 'workspace' ? { organismId: organism_id, workspaceId: workspace_id, accessor: acc } : {}),
                    // How SKILL.md was written, recorded as on POST /v1/skills (aiprov E12).
                    provenance: {
                        principal: agentGaii, scopes,
                        ...(ai_provenance ? { declared: toDeclaredProvenance(ai_provenance) } : {}),
                        ...(ai_provenance_id ? { declaredId: ai_provenance_id } : {}),
                    },
                });
                // routes/skills.ts emits this on publish, link and unlink. A skill is an agent's
                // operating guide, so the owner's skills view showing the old set is the wrong
                // answer to "what does this agent know how to do".
                emitChange('skills');
                emitResourceListChanged(agentGaii);
                return ok({ published: true, skill: summary, ...(await writeProvenanceEcho(storage, config, summary.aiProvenanceId)) });
            } catch (e) {
                return err(`Skill publish failed: ${(e as Error).message}`);
            }
        },
    );

    // ── aimeat_skill_list ──
    mcp.tool(
        'aimeat_skill_list',
        descriptionFor('aimeat_skill_list'),
        zodShapeFor('aimeat_skill_list'),
        annotationsFor('aimeat_skill_list'),
        async ({ view, agent_name, organism_id, workspace_id, binding }) => {
            if (!ownerName) return err('Could not resolve the calling agent\'s owner');
            const acc = await accessor();
            if (binding) {
                const skills = await listSkillsByBinding(storage, config, binding, acc);
                return ok({ binding, skills });
            }
            const mode = view ?? 'library';
            if (mode === 'linked') {
                // The word GET /v1/agents/:name/skills/links asks; the other views ask none, as their
                // route does (secaudit 2026-10 follow-up, A4).
                if (!scopeIsCovered(scopes, 'memory:read')) return toolError('SCOPE_DENIED', 'view=linked needs the memory:read permission, as GET /v1/agents/:name/skills/links does.');
                const agentName = agent_name ?? parsed!.agent;
                const links = await getAgentSkillLinks(storage, config, ownerName, agentName);
                return ok({ view: 'linked', agent: agentName, links });
            }
            if (mode === 'mine') {
                const skills = await listSkills(storage, config, 'user', acc, ownerName);
                return ok({ view: 'mine', skills });
            }
            if (mode === 'workspace') {
                if (!organism_id || !workspace_id) return err('view=workspace requires organism_id and workspace_id');
                const skills = await listSkills(storage, config, 'workspace', acc, undefined, { org: organism_id, ws: workspace_id });
                return ok({ view: 'workspace', organism_id, workspace_id, skills });
            }
            const library = await listSkillLibrary(storage, config, acc);
            return ok({ view: 'library', library });
        },
    );

    // ── aimeat_skill_get ──
    mcp.tool(
        'aimeat_skill_get',
        descriptionFor('aimeat_skill_get'),
        zodShapeFor('aimeat_skill_get'),
        annotationsFor('aimeat_skill_get'),
        async ({ ref, name, manifest_only }) => {
            const acc = await accessor();
            const candidates: string[] = [];
            if (ref) candidates.push(ref);
            else if (name) {
                if (ownerName) candidates.push(`user:${ownerName}/${name}`);
                candidates.push(`node:${name}`);
            } else {
                return err('Provide ref or name');
            }
            let lastError = 'Skill not found';
            for (const candidate of candidates) {
                try {
                    const skill = await resolveSkillRef(storage, config, candidate, acc, { manifestOnly: manifest_only ?? false });
                    return ok({ skill });
                } catch (e) {
                    lastError = (e as Error).message;
                }
            }
            return err(lastError);
        },
    );

    // ── aimeat_skill_link ──
    mcp.tool(
        'aimeat_skill_link',
        descriptionFor('aimeat_skill_link'),
        zodShapeFor('aimeat_skill_link'),
        annotationsFor('aimeat_skill_link'),
        async ({ ref, agent_name }) => {
            if (!ownerName || !parsed) return err('Could not resolve the calling agent\'s owner');
            const agentName = agent_name ?? parsed.agent;
            const targetGaii = `${agentName}#${ownerName}@${config.nodeId}`;
            const target = await storage.getAgent(targetGaii);
            if (!target) return err(`No agent "${agentName}" under owner ${ownerName}`);
            try {
                const links = await linkSkillToAgent(storage, config, ownerName, agentName, ref, agentGaii, await accessor());
                emitChange('skills');
                emitResourceListChanged(agentGaii);
                return ok({ agent: agentName, links });
            } catch (e) {
                return err(`Link failed: ${(e as Error).message}`);
            }
        },
    );

    // ── aimeat_skill_unlink ──
    mcp.tool(
        'aimeat_skill_unlink',
        descriptionFor('aimeat_skill_unlink'),
        zodShapeFor('aimeat_skill_unlink'),
        annotationsFor('aimeat_skill_unlink'),
        async ({ ref, agent_name }) => {
            if (!ownerName || !parsed) return err('Could not resolve the calling agent\'s owner');
            const agentName = agent_name ?? parsed.agent;
            const links = await unlinkSkillFromAgent(storage, config, ownerName, agentName, ref);
            emitChange('skills');
            emitResourceListChanged(agentGaii);
            return ok({ agent: agentName, links });
        },
    );

    // ── aimeat_skill_update: visibility without a republish (the same door as PATCH /v1/skills/:name) ──
    mcp.tool(
        'aimeat_skill_update',
        descriptionFor('aimeat_skill_update'),
        zodShapeFor('aimeat_skill_update'),
        annotationsFor('aimeat_skill_update'),
        async ({ name, visibility, scope }) => {
            if (!ownerName) return err('Could not resolve the calling agent\'s owner');
            const acc = await accessor();
            const targetScope = scope === 'node' ? 'node' : 'user';
            if (targetScope === 'node' && !acc.isOperator) {
                return err(`Node-scope skills are operator-managed. ${OPERATOR_AGENT_REFUSAL}`);
            }
            const summary = await setSkillVisibility(storage, config, targetScope, name, visibility, targetScope === 'user' ? ownerName : undefined);
            if (!summary) return err(`Skill not found: ${name}`);
            emitChange('skills');
            return ok({ updated: true, skill: summary });
        },
    );
}
