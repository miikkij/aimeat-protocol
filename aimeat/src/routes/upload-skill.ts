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
import { publishSkill, type SkillScope } from '../services/skills.js';
import { ProvenanceScopeError } from '../services/ai-provenance.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { localAccountName } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { emitResourceListChanged } from '../mcp/index.js';

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
    const visibility = meta.visibility as 'owner' | 'members' | 'public' | undefined;

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

    try {
        const summary = await publishSkill(storage, config, {
            scope,
            owner: ownerName,
            publisher: sub,
            files,
            visibility,
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
        res.json({ success: true, type: 'skill', skill: summary, ai_provenance_id: summary.aiProvenanceId ?? null });
    } catch (err) {
        if (err instanceof SkillValidationError) {
            res.status(422).json({ success: false, error: 'SKILL_INVALID', message: err.message, code: err.code });
            return;
        }
        if (err instanceof ProvenanceScopeError) {
            res.status(403).json({ success: false, error: err.code, message: err.message });
            return;
        }
        throw err;
    }
}
