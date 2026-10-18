/**
 * @file src/routes/upload-skill.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The presigned upload handler for utype 'skill': a skill-directory ZIP, unpacked
 *   through the hardened safeUnzip (traversal, symlink and bomb guards plus the skill-layout
 *   allowlist) and published into the skills registry. Moved out of routes/upload.ts
 *   (max-file-lines), which dispatches to it.
 * @structure SKILL_ZIP_LIMITS · handleSkillUpload(res, config, storage, sub, meta, data)
 * @usage await handleSkillUpload(res, config, storage, verified.sub, verified.meta, data);
 * @version-history
 *   v1.4.0 — 2026-10-18 — On a node that shows its content to signed-in accounts only, a user skill
 *     asked as public is stored at 'members' with the warning PUBLIC_IS_SIGNED_IN_HERE (plan V1.6).
 *   v1.3.0 — 2026-10-18 — A user skill made public asks the publish gate with the uploader's grant:
 *     on an ask it keeps its level and the answer is 202 with `publish_request` (plan doc-mvcn6c7e4e5q, V4).
 *   v1.2.0 — 2026-10-17 — The token's visibility may be `organism:<id>` (plan doc-mvcn6c7e4e5q, V3.9);
 *     a SkillAccessError from the publish (a workspace or an organisation the uploader is not in) is
 *     answered with its status instead of a 500.
 *   v1.1.0 — 2026-10-08 — The token's `ai_provenance` / `ai_provenance_id` are recorded against
 *     SKILL.md (services/skill-provenance.ts); a malformed block is 422, a declaration the uploader
 *     may not make is 403 SCOPE_DENIED before anything is stored (aiprov E12).
 *   v1.0.0 — 2026-10-08 — Moved from routes/upload.ts (max-file-lines); the handler dates from
 *     2026-07-05 (upload.ts v1.2.0).
 */
import type { Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { safeUnzip, ZipSecurityError } from '../services/safe-zip.js';
import { SkillValidationError, isAllowedSkillPath } from '../services/skill-md.js';
import { publishSkill, SkillAccessError, type SkillScope } from '../services/skills.js';
import { parseSkillVisibility } from '../services/skill-audience.js';
import { ProvenanceScopeError } from '../services/ai-provenance.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';
import { skillPublishAsk, fileSkillAsk, closedSkillLevel } from '../services/skill-publish-gate.js';
import { closedNodeWarnings } from '../services/closed-node-level.js';
import { uploadPublishGate } from '../services/publish-requests/upload-gate.js';

/** Skill-directory ZIP layout: SKILL.md (+ scripts/references/assets), optionally inside ONE wrapping dir. */
const SKILL_ZIP_LIMITS = {
    maxFiles: 200,
    maxFileBytes: 5 * 1024 * 1024,     // 5 MB per entry
    maxTotalBytes: 20 * 1024 * 1024,   // 20 MB total decompressed
    maxRatio: 50,
    allowName: (name: string) => {
        const parts = name.split('/');
        const rel = parts.length > 1 ? parts.slice(1).join('/') : name;
        return isAllowedSkillPath(name) || isAllowedSkillPath(rel);
    },
};

export async function handleSkillUpload(
    res: Response, config: AimeatConfig, storage: Storage,
    sub: string, meta: Record<string, unknown>, data: Buffer,
): Promise<void> {
    const ownerName = localAccountName(sub);
    const metaScope = meta.scope as SkillScope;
    const scope: SkillScope = metaScope === 'node' ? 'node' : metaScope === 'workspace' ? 'workspace' : 'user';
    // The token's visibility was checked by the tool that signed it; read it in its stored form.
    const visibility = parseSkillVisibility(meta.visibility) ?? undefined;

    let entries: Map<string, Buffer>;
    try {
        entries = await safeUnzip(data, SKILL_ZIP_LIMITS);
    } catch (err) {
        if (err instanceof ZipSecurityError) {
            logger.warn('Skill upload ZIP rejected', { code: err.code, entry: err.entry, by: sub });
            res.status(422).json({ success: false, error: 'ZIP_REJECTED', message: err.message, code: err.code });
            return;
        }
        throw err;
    }

    // Strip a single wrapping directory when every entry shares it (skill-name/SKILL.md ...).
    const names = [...entries.keys()];
    let wrapper: string | undefined;
    const firstSlash = names[0]?.indexOf('/') ?? -1;
    if (firstSlash > 0) {
        const candidate = names[0].slice(0, firstSlash);
        if (names.every(n => n.startsWith(`${candidate}/`))) wrapper = candidate;
    }
    const files = new Map<string, string | Buffer>();
    for (const [name, content] of entries) {
        files.set(wrapper ? name.slice(wrapper.length + 1) : name, content);
    }

    // How SKILL.md was written, carried in the signed token from the tool call that asked for the
    // URL; recorded as POST /v1/skills records it (aiprov E12).
    const declaration = parseDeclaredProvenanceInput(meta.ai_provenance);
    if (!declaration.ok) {
        res.status(422).json({ success: false, error: 'INVALID_INPUT', message: 'The ai_provenance block does not parse.', violations: declaration.violations });
        return;
    }

    // Making a user skill public asks the node's publish gate, as POST /v1/skills does (plan
    // doc-mvcn6c7e4e5q, V4): the uploader's grant as it is now, since the token carries none.
    const gate = await uploadPublishGate(storage, config.nodeId, sub);
    // Before it, a closed node keeps a user skill asked as public at 'members' (plan V1.6).
    const skillMd = files.get('SKILL.md');
    const closed = await closedSkillLevel({ storage, config }, scope, visibility, ownerName, { skillMd: skillMd === undefined ? undefined : String(skillMd) });
    const ask = skillPublishAsk({ storage, config }, gate, scope, closed.visibility);
    if (ask?.kind === 'refused') {
        res.status(ask.status).json({ success: false, error: ask.code, message: ask.message });
        return;
    }

    try {
        const summary = await publishSkill(storage, config, {
            scope,
            owner: ownerName,
            publisher: sub,
            files,
            visibility: ask ? undefined : closed.visibility,
            expectedName: wrapper,
            ...(scope === 'workspace' ? {
                organismId: meta.organism as string,
                workspaceId: meta.ws as string,
                accessor: { ownerName, sub, gaii: sub },
            } : {}),
            provenance: {
                principal: sub,
                ...(declaration.declared ? { declared: declaration.declared } : {}),
                ...(typeof meta.ai_provenance_id === 'string' && meta.ai_provenance_id ? { declaredId: meta.ai_provenance_id } : {}),
            },
        });
        logger.info(`Skill published via upload: ${summary.ref} v${summary.version}`, { by: sub });
        emitResourceListChanged(sub);
        const asked = ask && gate ? await fileSkillAsk({ storage, config }, gate, ask, summary) : {};
        res.status(asked.publishRequest ? 202 : 200).json({
            success: true, type: 'skill', skill: summary, ai_provenance_id: summary.aiProvenanceId ?? null,
            ...(asked.publishRequest ? { publish_request: asked.publishRequest } : {}),
            ...(asked.warnings ? { warnings: asked.warnings } : closedNodeWarnings(closed.warning)),
        });
    } catch (err) {
        if (err instanceof SkillValidationError) {
            res.status(422).json({ success: false, error: 'SKILL_INVALID', message: err.message, code: err.code });
            return;
        }
        if (err instanceof ProvenanceScopeError) {
            res.status(403).json({ success: false, error: err.code, message: err.message });
            return;
        }
        // A workspace the uploader is not in (403), or an organisation level they may not name (400).
        if (err instanceof SkillAccessError) {
            const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 400;
            res.status(status).json({ success: false, error: err.code, message: err.message });
            return;
        }
        throw err;
    }
}
