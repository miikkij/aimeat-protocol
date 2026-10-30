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
 *   embedded file's real owner across the writer's own agents and rewrites the URL to the `/v1/pub`
 *   form; after the write, it binds the images the writer controls to the document's WORKSPACE
 *   (visibility:'workspace' → only that workspace's members can read — NOT the public internet), by the
 *   rule record-files.ts keeps for every linked file. So a doc's images load for its workspace members
 *   whatever client authored it, without ever being exposed to the open web.
 * @structure
 *   - normalizeDocImageUrls(storage, config, markdown, ownerName) — rewrite one body.
 *   - normalizeDocValueImages(storage, config, value, ownerName) — rewrite the `.markdown` of a doc
 *     value object (no-op for records / values without a string markdown field).
 *   - scopeDocImagesToWorkspace(storage, config, value, writer, workspaceRef) — bind, after the write.
 * @usage
 *   import { normalizeDocValueImages, scopeDocImagesToWorkspace } from '../services/doc-images.js';
 *   const v = await normalizeDocValueImages(storage, config, draft.value, ownerName);
 *   // ...every refusal, then the write...
 *   await scopeDocImagesToWorkspace(storage, config, v, { principal, ownerName, ownerGhii }, `${orgId}/${ws}`);
 * @version-history
 *   v1.2.0 — 2026-10-30 — An embedded image is bound through record-files.ts bindFileToWorkspace: only
 *     the writer's own images (a person's: their own and their agents'), and a public, members, group
 *     or organism image is never narrowed (Jouni, 2026-10-30). Rewriting a URL changes no visibility
 *     any more; the workspaceRef parameter of the two normalize functions is gone.
 *   v1.1.1 — 2026-09-26 — bareOwnerOf takes the account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-09-13 — An embed URL's query and fragment are dropped before the key is read, so a
 *     versioned_url (?v=) pasted into a document is scoped like its unversioned twin.
 *   v1.0.0 — 2026-07-11 — Extracted so the MCP write, MCP publish, and REST publish paths share one
 *     image-URL normalizer. Embedded images are scoped to the doc's workspace (members-only), never made
 *     public — mirrors the frontend applyImageVisibilityUrls + the authed workspace-file-tier design.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';
import { bindFileToWorkspace, type RecordFileWriter } from './record-files.js';

/** Matches an image embed whose URL is one of the three owner/storage forms. Groups: (1) `![alt](`,
 *  (2) the URL, (3) `)`. Kept in step with the frontend STORAGE_IMG_RE, broadened to also catch the
 *  `/v1/memory/files/` form (which the frontend regex omits). */
const DOC_IMG_RE = /(!\[[^\]]*\]\()(\/v1\/(?:storage\/|memory\/files\/|pub\/[^/)\s]+\/)[^\s)]+)(\))/g;

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

/** Find the stored file one embed URL names: the owner named in a /v1/pub URL first (idempotent
 *  re-normalization), then the writer's own identities (GHII + agents). Null when it is not there (a
 *  missing file, or someone else's file under a raw path). */
async function locateEmbed(
  storage: Storage, url: string, candidates: string[],
): Promise<{ owner: string; key: string } | null> {
  const parsed = parseEmbedUrl(url);
  if (!parsed) return null;
  const { key, ownerInUrl } = parsed;
  const tryOwners = ownerInUrl ? [ownerInUrl, ...candidates.filter(c => c !== ownerInUrl)] : candidates;
  for (const owner of tryOwners) {
    const file = await storage.getStorageFile(owner, key).catch(err => { logger.warn('locateEmbed: continuing after a suppressed failure', { error: String(err) }); return null; });
    if (file) return { owner, key };
  }
  return null;
}

/** Resolve one embed URL to its loadable `/v1/pub/<owner>/<key>` form. Returns the URL UNCHANGED when
 *  the file can't be found — a broken embed is never "fixed" to point somewhere wrong. Changes no
 *  file's visibility; that is scopeDocImagesToWorkspace's job, after the write. */
async function resolveEmbedUrl(storage: Storage, url: string, candidates: string[]): Promise<string> {
  const found = await locateEmbed(storage, url, candidates);
  return found ? `/v1/pub/${encodeURIComponent(found.owner)}/${encodeKeyPath(found.key)}` : url;
}

/** The writer's own identities, where a raw /v1/storage/<key> embed is looked for. */
async function ownerIdentities(storage: Storage, config: AimeatConfig, ownerName: string): Promise<string[]> {
  const agents = await storage.getAgentsByOwner(ownerName).catch(err => { logger.warn('doc-images: continuing after a suppressed failure', { error: String(err) }); return []; });
  return [`${ownerName}@${config.nodeId}`, ...agents.map(a => a.gaii)];
}

/**
 * Rewrite every embedded storage-image URL in a markdown body to the owner-addressed `/v1/pub` form.
 * Best-effort and total: it never throws and returns the input unchanged when there is nothing to do.
 * Visibility is left untouched; scopeDocImagesToWorkspace opens the images once the write has landed.
 */
export async function normalizeDocImageUrls(
  storage: Storage, config: AimeatConfig, markdown: string, ownerName: string,
): Promise<string> {
  if (typeof markdown !== 'string' || !markdown.includes('/v1/')) return markdown;
  DOC_IMG_RE.lastIndex = 0;
  const urls = [...new Set([...markdown.matchAll(DOC_IMG_RE)].map(m => m[2]))];
  if (!urls.length) return markdown;

  const candidates = await ownerIdentities(storage, config, ownerName);

  const rewrites = new Map<string, string>();
  for (const url of urls) {
    try { rewrites.set(url, await resolveEmbedUrl(storage, url, candidates)); }
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
  storage: Storage, config: AimeatConfig, value: unknown, ownerName: string,
): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const md = (value as Record<string, unknown>).markdown;
  if (typeof md !== 'string') return value;
  const normalized = await normalizeDocImageUrls(storage, config, md, ownerName);
  return normalized === md ? value : { ...(value as Record<string, unknown>), markdown: normalized };
}

/**
 * The VISIBILITY half on its own, for a caller that has to rewrite the URLs before it knows whether
 * the write will happen at all.
 *
 * REFUSE BEFORE YOU WRITE. Opening a file to a workspace's members is a write. The workspace draft
 * door once did it inside its planning loop, as a side effect of rewriting a URL, so a batch whose
 * second item failed the schema — or the whole write failing the archived check or the size limit —
 * had already made the FIRST item's embedded files readable by every member, and then wrote nothing.
 * Found by the AI triage of 2026-09-13. So rewriting changes no visibility, and the caller calls this
 * once every refusal has passed and the value has landed.
 *
 * WHOSE IMAGE, AND NEVER NARROWER (Jouni, 2026-10-30: "korjaa samalla tavalla kuin liitteet"). Each
 * image goes through record-files.ts bindFileToWorkspace, the rule a record's linked files follow: a
 * person's session opens their own and their agents' images, an agent, app or ecosystem app only its
 * own, and a public, members, group or organism image keeps its reach. Until then any identity of the
 * owner opened any of the owner's images, so an agent writing a document opened its owner's private
 * image to the workspace, and a public image was narrowed to the members.
 *
 * Best-effort and total: an image that cannot be bound leaves the document rendering for its writer
 * and not for members, which is the old behaviour of a failed update and not a new one.
 */
export async function scopeDocImagesToWorkspace(
  storage: Storage, config: AimeatConfig, value: unknown, writer: RecordFileWriter, workspaceRef: string,
): Promise<void> {
  if (!workspaceRef || !value || typeof value !== 'object' || Array.isArray(value)) return;
  const md = (value as Record<string, unknown>).markdown;
  if (typeof md !== 'string' || !md.includes('/v1/')) return;
  DOC_IMG_RE.lastIndex = 0;
  const urls = [...new Set([...md.matchAll(DOC_IMG_RE)].map(m => m[2]))];
  if (!urls.length) return;

  const candidates = await ownerIdentities(storage, config, writer.ownerName);
  for (const url of urls) {
    const found = await locateEmbed(storage, url, candidates);
    if (found) await bindFileToWorkspace(storage, writer, found.owner, found.key, workspaceRef);
  }
}
