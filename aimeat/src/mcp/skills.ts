/**
 * @file skills.ts
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
 *   registerSkillsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 -- 2026-07-05 -- Initial: Phase 2a registry tools (node + user scopes).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { emitChange } from '../services/event-bus.js';
import { generateUploadToken } from '../services/upload-token.js';
import {
  publishSkill, listSkills, listSkillLibrary, resolveSkillRef,
  getAgentSkillLinks, linkSkillToAgent, unlinkSkillFromAgent,
  listSkillsByBinding, type SkillAccessor, type SkillScope,
} from '../services/skills.js';

export function registerSkillsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();
    const parsed = parseGAII(agentGaii);
    const ownerName = parsed?.owner ?? null;

    const accessor = async (): Promise<SkillAccessor> => {
        const owner = ownerName ? await storage.getOwner(ownerName) : null;
        return {
            ownerName,
            isOperator: owner?.roles?.includes('operator') ?? false,
            sub: agentGaii,
            gaii: agentGaii,
        };
    };

    const err = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
    const ok = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

    // ── aimeat_skill_publish ──
    mcp.tool(
        'aimeat_skill_publish',
        descriptionFor('aimeat_skill_publish'),
        {
            skill_md: z.string().optional().describe('The SKILL.md content (YAML frontmatter + markdown body). Omit to receive a presigned upload URL for a skill-directory ZIP instead.'),
            files: z.record(z.string(), z.string()).optional().describe('Additional files as relative-path -> content (scripts/, references/, assets/). Only with skill_md.'),
            scope: z.enum(['user', 'node', 'workspace']).optional().describe('Registry scope (default user). node is operator-only; workspace requires organism_id + workspace_id and organism membership.'),
            visibility: z.enum(['owner', 'members', 'public']).optional().describe('Registry visibility (node/user scopes). Defaults: user->owner, node->members. public = federated. Workspace skills are always workspace-visible.'),
            organism_id: z.string().optional().describe('Workspace scope: the organism id.'),
            workspace_id: z.string().optional().describe('Workspace scope: the workspace id.'),
        },
        annotationsFor('aimeat_skill_publish'),
        async ({ skill_md, files, scope, visibility, organism_id, workspace_id }) => {
            if (!ownerName) return err('Could not resolve the calling agent\'s owner');
            const acc = await accessor();
            const targetScope: SkillScope = scope === 'node' ? 'node' : scope === 'workspace' ? 'workspace' : 'user';
            if (targetScope === 'node' && !acc.isOperator) {
                return err('Node-scope skills are operator-managed — your owner is not an operator on this node');
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
                });
                // routes/skills.ts emits this on publish, link and unlink. A skill is an agent's
                // operating guide, so the owner's skills view showing the old set is the wrong
                // answer to "what does this agent know how to do".
                emitChange('skills');
                emitResourceListChanged(agentGaii);
                return ok({ published: true, skill: summary });
            } catch (e) {
                return err(`Skill publish failed: ${(e as Error).message}`);
            }
        },
    );

    // ── aimeat_skill_list ──
    mcp.tool(
        'aimeat_skill_list',
        descriptionFor('aimeat_skill_list'),
        {
            view: z.enum(['library', 'linked', 'mine', 'workspace']).optional().describe('library (default): everything you can load, grouped by scope (node + user + workspace memberships). linked: skills attached to an agent. mine: your owner\'s user-scope registry only. workspace: one workspace\'s skills (requires organism_id + workspace_id).'),
            agent_name: z.string().optional().describe('For view=linked: which same-owner agent (default: yourself).'),
            organism_id: z.string().optional().describe('For view=workspace: the organism id.'),
            workspace_id: z.string().optional().describe('For view=workspace: the workspace id.'),
            binding: z.string().optional().describe('Filter to skills bound to one app: app:{owner}/{filename}. Overrides view.'),
        },
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
        {
            ref: z.string().optional().describe('Full skill ref: node:{name} or user:{owner}/{name}.'),
            name: z.string().optional().describe('Bare skill name — resolved against your own registry first, then the node library. Ignored when ref is given.'),
            manifest_only: z.boolean().optional().describe('Return only the manifest (no file bodies).'),
        },
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
        {
            ref: z.string().describe('Skill ref to attach: node:{name} or user:{owner}/{name}.'),
            agent_name: z.string().optional().describe('Which same-owner agent to attach to (default: yourself).'),
        },
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
        {
            ref: z.string().describe('Skill ref to detach.'),
            agent_name: z.string().optional().describe('Which same-owner agent to detach from (default: yourself).'),
        },
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
}
