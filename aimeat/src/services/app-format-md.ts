/**
 * @file src/services/app-format-md.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app answers `?format=md` itself: an action of its owner's own extension returns the
 *   markdown, and the node serves it (Jouni, 2026-10-02: "applikaatio itse hoitaa format=md:n ja se on
 *   application configuationissa joka näkyy appcat:n application detailissa").
 *
 *   WHY. `?format=md` served the stored agent face (`apps.{filename}.agentface`) or, without one, the
 *   app's HTML converted. An app whose content is built in the browser from records converts to its
 *   loading screen, and a stored face goes stale the moment the content changes: the Experience
 *   Center's page read "Ladataan…" for weeks. An agent's request runs no JavaScript, so the answer
 *   has to come from the app's server side, which on AIMEAT is its owner's extension.
 *
 *   THE DECLARATION. `<meta name="aimeat-format-md" content="/v1/ext/<extension>/<action>">` in the
 *   app's head (`ext:<extension>:<action>` is accepted too). publishApp reads it from the bytes on
 *   every publish, refuses one that names an extension the app's owner did not install or an action
 *   it does not have, and stores `manifest.formatMd`. The address form also lands the extension in
 *   the app's dependency map (services/dependency-map.ts), so the catalogue lists it as a need.
 *
 *   THE RUN. buildAppAgentFace (services/agent-face.ts) calls renderAppMarkdown first. The action runs
 *   unattended in the owner's name (runExtensionActionAsSystem: only the owner's own extension, no
 *   wallet, no paywall) with the input `{ format: 'md', app }`, and returns `{ markdown }` (a bare
 *   string is taken too). Anything else, a refusal, a timeout or a result past the 256 KB face cap,
 *   is logged and answers null, and the node serves what it served before: the stored face or the
 *   converted HTML. The caller's per-version cache bounds how often an anonymous GET starts a sandbox.
 * @structure parseFormatMdMeta(html) · formatMdRefusal(storage, ownerName, decl) · renderAppMarkdown(deps, app)
 * @usage const md = await renderAppMarkdown({ storage, config }, app); // string or null
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppRecord } from '../storage/types/apps.js';
import { runExtensionActionAsSystem } from './extension-system-run.js';
import { logger } from '../utils/logger.js';

export interface FormatMdDeclaration { extension: string; action: string }

/** The same cap a stored agent face has (services/agent-face.ts AGENT_FACE_MAX_BYTES). */
const MAX_BYTES = 256 * 1024;
const NAME = /^[a-z0-9][a-z0-9-]{1,126}[a-z0-9]$/;
const ACTION = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * The declaration in the app's head, or null when there is none. A meta that is present and does not
 * read as an extension action is `{ error }`, so the publish can refuse it with the reason.
 */
export function parseFormatMdMeta(html: string): FormatMdDeclaration | { error: string } | null {
  // Comments out first: an app's header comment that MENTIONS the tag (the Experience Center's
  // version history does) is not a declaration, and matched first it read as an empty one.
  const head = html.slice(0, 65536).replace(/<!--[\s\S]*?-->/g, '');
  const m = /<meta\b[^>]*name\s*=\s*["']aimeat-format-md["'][^>]*>/i.exec(head);
  if (!m) return null;
  const content = /content\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1]?.trim() ?? '';
  const parts = /^\/v1\/ext\/([^/\s]+)\/([^/\s?#]+)$/.exec(content) ?? /^ext:([^:\s]+):([^:\s]+)$/.exec(content);
  if (!parts || !NAME.test(parts[1]!) || !ACTION.test(parts[2]!)) {
    return { error: `aimeat-format-md must name an extension action as /v1/ext/<extension>/<action>; it says "${content.slice(0, 120)}"` };
  }
  return { extension: parts[1]!, action: parts[2]! };
}

/** Why the declaration cannot be used for this owner, or null when it can. */
export async function formatMdRefusal(storage: Storage, ownerName: string, decl: FormatMdDeclaration): Promise<string | null> {
  const ext = await storage.getExtension(decl.extension);
  if (!ext) return `the extension "${decl.extension}" is not installed on this node`;
  if (ext.installedBy !== ownerName) return `the extension "${decl.extension}" belongs to another owner; an app answers ?format=md only with its owner's own extension`;
  if (!ext.actions.some(a => a.id === decl.action)) {
    return `the extension "${decl.extension}" has no action "${decl.action}" (it has: ${ext.actions.map(a => a.id).join(', ') || 'none'})`;
  }
  return null;
}

/** The markdown the app's own action returns, or null when it has none to give right now. */
export async function renderAppMarkdown(deps: { storage: Storage; config: AimeatConfig }, app: AppRecord): Promise<string | null> {
  const decl = app.manifest?.formatMd;
  if (!decl) return null;
  const ownerGhii = `${app.ownerName}@${deps.config.nodeId}`;
  try {
    const { result } = await runExtensionActionAsSystem(deps, {
      extensionName: decl.extension, actionId: decl.action,
      input: { format: 'md', app: `${app.ownerName}/${app.filename}` },
      callerGaii: ownerGhii, ownerName: app.ownerName, storageOwnerGhii: ownerGhii,
      logLabel: 'format-md', producerKind: 'extension',
    });
    const md = typeof result === 'string' ? result
      : (result && typeof (result as { markdown?: unknown }).markdown === 'string' ? (result as { markdown: string }).markdown : null);
    if (!md || !md.trim()) {
      logger.warn('format-md: the action returned no markdown', { app: `${app.ownerName}/${app.filename}`, ...decl });
      return null;
    }
    if (Buffer.byteLength(md, 'utf-8') > MAX_BYTES) {
      logger.warn('format-md: the markdown is past the 256 KB cap', { app: `${app.ownerName}/${app.filename}`, bytes: Buffer.byteLength(md, 'utf-8') });
      return null;
    }
    return md;
  } catch (err) {
    logger.warn('format-md: the action failed, serving the stored face or the converted page', { app: `${app.ownerName}/${app.filename}`, ...decl, error: String(err) });
    return null;
  }
}
