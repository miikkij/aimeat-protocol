/**
 * @file record-files.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A file linked from a workspace record opens to that workspace's members. A record's
 *   value may carry the owner-addressed address of a stored file, `/v1/pub/<owner>/<key>` (an
 *   extension's attachment field, a link an agent wrote). The file stays at its upload visibility,
 *   usually private, so every reader of the record but the uploader got 403 on the link. Jouni ruled
 *   on 2026-10-30: "jos se on työtilassa niin silloin se saa näkyä työtilalaisille" (a file in the
 *   workspace may be seen by the workspace's members). So once a record has been written or published
 *   into a workspace, each file it links that the WRITER controls is bound to that workspace.
 *
 *   Three rules, each against a way this could widen too much:
 *   - Only the writer's own files. The writer is the session principal. A person's session opens their
 *     own files and those of their agents (the owner holds everything their agents hold); an agent, an
 *     app or an ecosystem app opens only files stored under its own identity. A scoped agent must not
 *     open its owner's private file by linking it, because it would then read it as a member
 *     (.claude/rules/security.md, the owner sees their agents' data, ONE DIRECTION).
 *   - Never narrower. 'private' and 'owner' become 'workspace'; 'workspace' gains this workspace
 *     beside the ones it has; 'members', 'group', 'organism:*' and 'public' stay as they are, because
 *     rebinding them would take readers away. A document's embedded images follow the same two rules
 *     through bindFileToWorkspace (Jouni, 2026-10-30: "korjaa samalla tavalla kuin liitteet").
 *   - After the write. The callers call this once every refusal has passed and the value has landed,
 *     the same order doc-images.ts scopeDocImagesToWorkspace keeps (refuse before you write).
 * @structure
 *   - pubFileRefsIn(value) — every distinct /v1/pub/<owner>/<key> the value's strings carry.
 *   - bindFileToWorkspace(storage, writer, owner, key, workspaceRef) — the rule for one file.
 *   - scopeRecordFilesToWorkspace(storage, value, writer, workspaceRef) — bind the writer's own files.
 * @usage
 *   import { scopeRecordFilesToWorkspace } from '../services/record-files.js';
 *   await scopeRecordFilesToWorkspace(storage, value, { principal, ownerName, ownerGhii }, `${orgId}/${ws}`);
 * @version-history
 *   v1.1.0 — 2026-10-30 — bindFileToWorkspace: the one-file rule, which doc-images.ts now uses too.
 *   v1.0.0 — 2026-10-30 — Initial (wish-ty-tilan-tietueeseen-liitetty-yksityinen-tiedosto-aukeaa-ty-).
 */
import type { Storage } from '../storage/interface.js';
import { normalizeWorkspaceRefs } from '../utils/workspace-ref.js';
import { logger } from '../utils/logger.js';
import { localAccountName } from '../utils/gaii.js';

/** `/v1/pub/<owner>/<key>`, relative or behind an origin. The key ends at whitespace, a quote, a
 *  bracket, or the query or fragment of a versioned_url. */
const PUB_URL_RE = /\/v1\/pub\/([^/\s"'<>()[\]?#]+)\/([^\s"'<>()[\]?#]+)/g;

/** How far into a value the scan goes, so a large record costs a bounded walk. */
const MAX_DEPTH = 8;
const MAX_STRINGS = 5000;

/** Visibilities a binding replaces. Every other one already reaches at least as far, or reaches a
 *  different audience that a rebinding would take away. */
const WIDENABLE = new Set(['private', 'owner']);

function decodeSegments(path: string): string {
  return path.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
}

/** Every distinct file the value's strings link with /v1/pub, as { owner, key }. */
export function pubFileRefsIn(value: unknown): Array<{ owner: string; key: string }> {
  const found = new Map<string, { owner: string; key: string }>();
  let seen = 0;
  const visit = (v: unknown, depth: number): void => {
    if (seen >= MAX_STRINGS || depth > MAX_DEPTH) return;
    if (typeof v === 'string') {
      seen++;
      if (!v.includes('/v1/pub/')) return;
      PUB_URL_RE.lastIndex = 0;
      for (const m of v.matchAll(PUB_URL_RE)) {
        // A malformed %-escape stays as written, names no stored file, and is passed over below.
        const owner = decodeSegments(m[1]);
        const key = decodeSegments(m[2]);
        found.set(`${owner}\n${key}`, { owner, key });
      }
      return;
    }
    if (Array.isArray(v)) { for (const x of v) visit(x, depth + 1); return; }
    if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
  };
  visit(value, 0);
  return [...found.values()];
}

/** Who wrote the value: the session principal, and the person it acts for. */
export interface RecordFileWriter { principal: string; ownerName: string; ownerGhii: string }

/** May this writer open this owner's file? Its own always; a person's session also their agents'. */
function writerControls(writer: RecordFileWriter, fileOwner: string): boolean {
  if (fileOwner === writer.principal) return true;
  // Only the person's own session is the person. An agent, an app grant or an ecosystem app acts in
  // their name and is still not them.
  return writer.principal === writer.ownerGhii && localAccountName(fileOwner) === writer.ownerName;
}

/**
 * Bind one stored file to `workspaceRef` (`<orgId>/<ws>`) when the writer controls it, never narrowing
 * it. The one rule for a file a workspace value links, whether a record links it or a document embeds
 * it as an image (doc-images.ts). Best-effort and total: it never throws, and a file it cannot bind
 * stays as it was.
 */
export async function bindFileToWorkspace(
  storage: Storage, writer: RecordFileWriter, owner: string, key: string, workspaceRef: string,
): Promise<void> {
  if (!workspaceRef || !writer.principal || !writerControls(writer, owner)) return;
  try {
    // The metadata only: a linked zip can be large, and only its visibility is read here.
    const file = await storage.getStorageFileMeta(owner, key);
    if (!file) return;
    let merged: string;
    if (file.visibility === 'workspace') {
      const current = (file.workspaceRef ?? '').split(/\s+/).filter(Boolean);
      if (current.includes(workspaceRef)) return;
      merged = normalizeWorkspaceRefs([...current, workspaceRef], undefined);
    } else if (WIDENABLE.has(file.visibility)) {
      merged = workspaceRef;
    } else {
      return;
    }
    await storage.updateFileVisibility(owner, key, 'workspace', merged);
  } catch (err) {
    logger.warn('bindFileToWorkspace: a linked file was not bound to the workspace', { owner, key, workspaceRef, error: String(err) });
  }
}

/**
 * Bind every file the value links that the writer controls to `workspaceRef`, so the workspace's
 * members can read it.
 */
export async function scopeRecordFilesToWorkspace(
  storage: Storage, value: unknown, writer: RecordFileWriter, workspaceRef: string,
): Promise<void> {
  for (const { owner, key } of pubFileRefsIn(value)) await bindFileToWorkspace(storage, writer, owner, key, workspaceRef);
}
