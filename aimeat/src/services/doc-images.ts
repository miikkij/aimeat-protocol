/**
 * @file doc-images.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Save-time normalization of embedded image URLs in workspace documents. A document's
 *   markdown may embed images as `![alt](/v1/storage/<key>)` or `![alt](/v1/memory/files/<key>)` — raw,
 *   owner-less paths that only load for the file's owner (the GET carries no owner + needs the caller's
 *   token), so they render broken for every OTHER viewer of a shared document. The loadable form is the
 *   owner-addressed `/v1/pub/<owner_gaii>/<key>` (the DocumentView blob-fetches it with the viewer's
 *   token; `#`/`@` in the GAII are %-encoded). This module is the backend safety net: it resolves each
 *   embedded file's real owner across the writer's own agents, scopes owner-controlled files to the
 *   document's WORKSPACE (visibility:'workspace' → only that workspace's members can read — NOT the public
 *   internet), and rewrites the URL to the `/v1/pub` form. So a doc's images load for its workspace
 *   members whatever client authored it, without ever being exposed to the open web.
 * @structure
 *   - normalizeDocImageUrls(storage, config, markdown, ownerName, workspaceRef?) — rewrite one body.
 *   - normalizeDocValueImages(storage, config, value, ownerName, workspaceRef?) — rewrite the `.markdown`
 *     of a doc value object (no-op for records / values without a string markdown field).
 * @usage
 *   import { normalizeDocValueImages } from '../services/doc-images.js';
 *   const v = await normalizeDocValueImages(storage, config, draft.value, ownerName, `${orgId}/${ws}`);
 * @version-history
 *   v1.1.0 — 2026-09-13 — An embed URL's query and fragment are dropped before the key is read, so a
 *     versioned_url (?v=) pasted into a document is scoped like its unversioned twin.
 *   v1.0.0 — 2026-07-11 — Extracted so the MCP write, MCP publish, and REST publish paths share one
 *     image-URL normalizer. Embedded images are scoped to the doc's workspace (members-only), never made
 *     public — mirrors the frontend applyImageVisibilityUrls + the authed workspace-file-tier design.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { normalizeWorkspaceRefs } from '../utils/workspace-ref.js';
import { logger } from '../utils/logger.js';

/** Matches an image embed whose URL is one of the three owner/storage forms. Groups: (1) `![alt](`,
 *  (2) the URL, (3) `)`. Kept in step with the frontend STORAGE_IMG_RE, broadened to also catch the
 *  `/v1/memory/files/` form (which the frontend regex omits). */
const DOC_IMG_RE = /(!\[[^\]]*\]\()(\/v1\/(?:storage\/|memory\/files\/|pub\/[^/)\s]+\/)[^\s)]+)(\))/g;

/** Bare owner name of any identity: `agent#owner@node` → `owner`, `owner@node` → `owner`. */
function bareOwnerOf(gaii: string): string {
  const afterHash = gaii.includes('#') ? gaii.split('#')[1] : gaii;
  return afterHash.split('@')[0];
}

/** Per-segment decode of a URL key path back to the stored key (keys can contain slashes). */
function decodeKey(k: string): string {
  return k.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } }).join('/');
}

/** Per-segment encode — keeps slashes literal for the /v1/pub wildcard route (keys like a/b/c.png). */
function encodeKeyPath(k: string): string {
  return k.split('/').map(encodeURIComponent).join('/');
}

/** Build the owner-addressed embed URL for a stored file (relative path). The DocumentView blob-fetches
 *  it with the viewer's token, so a workspace-scoped file loads for members; `#`/`@` in the GAII are
 *  %-encoded and slashes in the key stay literal for the /v1/pub wildcard route. */
export function pubEmbedUrl(ownerGaii: string, key: string): string {
  return `/v1/pub/${encodeURIComponent(ownerGaii)}/${encodeKeyPath(key)}`;
}

/** Ready-to-paste markdown image embed for a stored file (alt defaults to the key's basename). */
export function pubEmbedMarkdown(ownerGaii: string, key: string): string {
  return `![${key.split('/').pop() ?? key}](${pubEmbedUrl(ownerGaii, key)})`;
}

/** Parse an embed URL into { key, ownerInUrl? }, or null if it isn't a recognised storage form. */
function parseEmbedUrl(rawUrl: string): { key: string; ownerInUrl?: string } | null {
  // An upload answer's versioned_url carries ?v=<write>; the query is not part of the key, and read
  // into it the image would load but never be scoped to the document's workspace.
  const url = rawUrl.split(/[?#]/)[0];
  let m: RegExpMatchArray | null;
  if ((m = url.match(/^\/v1\/storage\/(.+)$/))) return { key: decodeKey(m[1]) };
  if ((m = url.match(/^\/v1\/memory\/files\/(.+)$/))) return { key: decodeKey(m[1]) };
  if ((m = url.match(/^\/v1\/pub\/([^/]+)\/(.+)$/))) return { ownerInUrl: decodeURIComponent(m[1]), key: decodeKey(m[2]) };
  return null;
}

/** Resolve one embed URL to its loadable `/v1/pub/<owner>/<key>` form. Finds the file's real owner among
 *  the writer's own identities (GHII + agents), scopes an owner-controlled file to the document's
 *  workspace (members-only — never public), and rewrites. Returns the URL UNCHANGED when the file can't
 *  be found under the writer's owner (a missing file, or someone else's file we must not touch) — a
 *  broken embed is never "fixed" to point somewhere wrong. */
async function resolveEmbedUrl(
  storage: Storage, url: string, ownerName: string, candidates: string[], workspaceRef: string | undefined,
): Promise<string> {
  const parsed = parseEmbedUrl(url);
  if (!parsed) return url;
  const { key, ownerInUrl } = parsed;
  // Prefer the owner already named in a /v1/pub URL (idempotent re-normalization), then the writer's own.
  const tryOwners = ownerInUrl ? [ownerInUrl, ...candidates.filter(c => c !== ownerInUrl)] : candidates;
  for (const owner of tryOwners) {
    const file = await storage.getStorageFile(owner, key).catch(err => { logger.warn('resolveEmbedUrl: continuing after a suppressed failure', { error: String(err) }); return null; });
    if (!file) continue;
    // Scope files under the writer's OWN owner to the doc's workspace so members (and only members) can
    // load them — never flip a third party's file, and never expose to the public internet.
    if (workspaceRef && bareOwnerOf(owner) === ownerName) {
      // Union the doc's workspace ref into any existing workspace refs (a file embedded in several
      // workspaces stays readable in all of them). Skip the write when nothing would change.
      const merged = normalizeWorkspaceRefs(
        [file.visibility === 'workspace' ? (file.workspaceRef ?? '') : '', workspaceRef], undefined);
      const unchanged = file.visibility === 'workspace' && (file.workspaceRef ?? '') === merged;
      if (!unchanged && merged) {
        await storage.updateFileVisibility(owner, key, 'workspace', merged).catch(err => { logger.warn('resolveEmbedUrl: best-effort', { error: String(err) }); });
      }
    }
    return `/v1/pub/${encodeURIComponent(owner)}/${encodeKeyPath(key)}`;
  }
  return url; // unresolved → leave as-is (renders broken but points nowhere new)
}

/**
 * Rewrite every embedded storage-image URL in a markdown body to the owner-addressed `/v1/pub` form,
 * scoping the writer's own embedded images to the document's workspace so its members can load them.
 * Best-effort and total: it never throws and returns the input unchanged when there is nothing to do.
 * `workspaceRef` is the doc's `<orgId>/<ws>`; when omitted, URLs are still normalised but visibility is
 * left untouched (organism-level docs have no workspace to scope to).
 */
export async function normalizeDocImageUrls(
  storage: Storage, config: AimeatConfig, markdown: string, ownerName: string, workspaceRef?: string,
): Promise<string> {
  if (typeof markdown !== 'string' || !markdown.includes('/v1/')) return markdown;
  DOC_IMG_RE.lastIndex = 0;
  const urls = [...new Set([...markdown.matchAll(DOC_IMG_RE)].map(m => m[2]))];
  if (!urls.length) return markdown;

  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName).catch(err => { logger.warn('normalizeDocImageUrls: continuing after a suppressed failure', { error: String(err) }); return []; });
  const candidates = [ownerGhii, ...agents.map(a => a.gaii)];

  const rewrites = new Map<string, string>();
  for (const url of urls) {
    try { rewrites.set(url, await resolveEmbedUrl(storage, url, ownerName, candidates, workspaceRef)); }
    catch (err) {
      // Leaving the original URL means the image quietly does not render for members; say so.
      logger.warn('doc image URL could not be resolved, keeping the original', { url, error: String(err) });
      rewrites.set(url, url);
    }
  }
  return markdown.replace(DOC_IMG_RE, (_full, pre, url, post) => `${pre}${rewrites.get(url) ?? url}${post}`);
}

/**
 * Normalize the embedded images of a document VALUE object (shape `{ id, title, markdown }`). Returns a
 * shallow-cloned value with a rewritten `markdown` when it changed, else the original value unchanged —
 * so records spaces and any value without a string `markdown` field pass through untouched.
 */
export async function normalizeDocValueImages(
  storage: Storage, config: AimeatConfig, value: unknown, ownerName: string, workspaceRef?: string,
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const md = (value as Record<string, unknown>).markdown;
  if (typeof md !== 'string') return value;
  const normalized = await normalizeDocImageUrls(storage, config, md, ownerName, workspaceRef);
  return normalized === md ? value : { ...(value as Record<string, unknown>), markdown: normalized };
}

/**
 * The VISIBILITY half on its own, for a caller that has to rewrite the URLs before it knows whether
 * the write will happen at all.
 *
 * REFUSE BEFORE YOU WRITE. Opening a file to a workspace's members is a write, and passing
 * `workspaceRef` to the functions above performs it as a side effect of rewriting a URL. The
 * workspace draft door did that inside its planning loop, so a batch whose second item failed the
 * schema — or the whole write failing the archived check or the size limit — had already made the
 * FIRST item's embedded files readable by every member, and then wrote nothing. Found by the AI
 * triage of 2026-09-13.
 *
 * So the two halves separate: normalise with no `workspaceRef` while planning (the rewritten URL is
 * identical either way — resolveEmbedUrl returns the same `/v1/pub` form), and call this once every
 * refusal has passed. Best-effort and total, like its neighbours: a file that cannot be scoped
 * leaves the document rendering for its writer and not for members, which is the old behaviour of a
 * failed update and not a new one.
 */
export async function scopeDocImagesToWorkspace(
  storage: Storage, config: AimeatConfig, value: unknown, ownerName: string, workspaceRef: string,
): Promise<void> {
  if (!workspaceRef || !value || typeof value !== 'object' || Array.isArray(value)) return;
  const md = (value as Record<string, unknown>).markdown;
  if (typeof md !== 'string' || !md.includes('/v1/')) return;
  DOC_IMG_RE.lastIndex = 0;
  const urls = [...new Set([...md.matchAll(DOC_IMG_RE)].map(m => m[2]))];
  if (!urls.length) return;

  const ownerGhii = `${ownerName}@${config.nodeId}`;
  const agents = await storage.getAgentsByOwner(ownerName).catch(err => { logger.warn('scopeDocImagesToWorkspace: continuing after a suppressed failure', { error: String(err) }); return []; });
  const candidates = [ownerGhii, ...agents.map(a => a.gaii)];
  for (const url of urls) {
    // The URL it returns is discarded: the caller already holds the normalised markdown, and this
    // pass exists for the updateFileVisibility inside.
    await resolveEmbedUrl(storage, url, ownerName, candidates, workspaceRef)
      .catch(err => { logger.warn('scopeDocImagesToWorkspace: best-effort', { url, error: String(err) }); return url; });
  }
}
