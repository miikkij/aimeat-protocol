/**
 * @file src/services/app/app-ref.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One rule for how a caller names a hosted app, and one function that turns that name
 *   into the filename the app is stored under.
 *
 *   WHY. An app is stored by its filename (`lifecycle-central.html`), and every person and every AI
 *   names it without the extension (`lifecycle-central`): that is its title, its subdomain and what
 *   it calls itself. Each endpoint then added or removed `.html` in its own way or not at all. The AI
 *   budget (services/ai/app-id.ts) and the tool manifest key (services/app/tools-key.ts) each had a
 *   private copy of the rule; aimeat_app_tools_get and aimeat_app_tool_invoke had none and answered
 *   APP_TOOLS_NOT_FOUND to `lifecycle-central`, while their hint list was cut at twelve names in
 *   alphabetical order and so never named the right one.
 *
 *   THE RULE. A caller may name an app as `name`, `name.html` or `owner/name`. The stored filename is
 *   the first of these that the owner has, published or as a draft: the name exactly as given, then
 *   the name with `.html`, then with `.htm`. Exact first, so an app whose filename has no extension
 *   (or another one) is never shadowed by a same-named `.html` app. A name nothing matches comes back
 *   as given, so the endpoint's own not-found answer still names what the caller sent.
 *
 *   A PUBLISH under a name that resolves updates that app; a new HTML app named without an extension
 *   is stored as `name.html` (publishFilename), like every other app.
 *
 *   WHAT IS SHOWN. appDisplayName() is the name people and AIs read: the filename without `.html` or
 *   `.htm`. Stored keys and records keep the filename; they are not rewritten.
 * @structure appDisplayName · isHtmlAppFile · htmlFilenameOf · appDataMapId · appFilenameCandidates · splitAppRef · resolveAppFilename ·
 *   resolveOwnerAppRef · resolveBindingRef · publishFilename · findAppFilename
 * @usage
 *   const filename = await resolveAppFilename(storage, { ownerGaii }, 'lifecycle-central'); // 'lifecycle-central.html'
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';

const HTML_EXT = /\.html?$/i;

/** The name a person and an AI use for an app: its filename without `.html` or `.htm`. */
export function appDisplayName(filename: string): string {
  return String(filename ?? '').replace(HTML_EXT, '');
}

/** Whether a filename is an HTML app's (`.html` or `.htm`): the kind that gets a subdomain and a page. */
export function isHtmlAppFile(filename: string): boolean {
  return HTML_EXT.test(String(filename ?? ''));
}

/**
 * The HTML file a name stands for when no lookup is possible or wanted (a package component's id,
 * a configured default): the name itself when it already ends in `.html` or `.htm`, otherwise the
 * name with `.html`. Where the owner's apps can be read, resolveAppFilename is the rule.
 */
export function htmlFilenameOf(name: string): string {
  const s = String(name ?? '');
  return HTML_EXT.test(s) ? s : `${s}.html`;
}

/**
 * The id an app's data map, AI posture and agent ties are keyed by: the filename without `.html`
 * (`.htm` is kept, as the data map has always kept it). One spelling for every reader of those keys.
 */
export function appDataMapId(filename: string): string {
  return String(filename ?? '').replace(/\.html$/i, '');
}

/**
 * The filenames a name can stand for, in the order they are tried: the name itself, then with
 * `.html`, then with `.htm`. A name that already ends in `.html` or `.htm` stands only for itself.
 */
export function appFilenameCandidates(name: string): string[] {
  const s = String(name ?? '').trim();
  if (!s) return [];
  if (HTML_EXT.test(s)) return [s];
  return [s, `${s}.html`, `${s}.htm`];
}

/**
 * Split `owner/name` into its two parts. A name with no slash has no owner part. Only the first
 * slash counts, because a filename has none.
 */
export function splitAppRef(ref: string): { owner?: string; name: string } {
  const s = String(ref ?? '').trim();
  const slash = s.indexOf('/');
  if (slash <= 0) return { name: s };
  return { owner: s.slice(0, slash), name: s.slice(slash + 1) };
}

/** The account name a bucket key or an owner name stands for, for comparing an `owner/` prefix. */
function ownerAccount(owner: { ownerGaii: string } | { ownerName: string }): string {
  return localAccountName('ownerGaii' in owner ? owner.ownerGaii : owner.ownerName);
}

/**
 * The filename `ref` names among this owner's apps and drafts. See THE RULE in the header.
 *
 * An `owner/` prefix is dropped when it names this same owner; a prefix naming someone else is kept,
 * so the lookup misses and the caller's not-found answer names the whole reference.
 */
export async function resolveAppFilename(
  storage: Pick<Storage, 'appFilenamesAmong'>,
  owner: { ownerGaii: string } | { ownerName: string },
  ref: string,
): Promise<string> {
  const found = await findAppFilename(storage, owner, ref);
  if (found.filename) return found.filename;
  return found.foreign ? String(ref ?? '').trim() : found.name;
}

/**
 * `owner/name` with the name resolved among that owner's apps: `alice/shop` → `alice/shop.html`. A
 * value with no owner part, an `eco:` name, or a name that matches nothing comes back as given.
 */
export async function resolveOwnerAppRef(storage: Pick<Storage, 'appFilenamesAmong'>, ref: string): Promise<string> {
  const raw = String(ref ?? '').trim();
  if (!raw || raw.startsWith('eco:')) return ref;
  const { owner, name } = splitAppRef(raw);
  if (!owner) return ref;
  const found = await findAppFilename(storage, { ownerName: localAccountName(owner) }, name);
  return found.filename ? `${owner}/${found.filename}` : ref;
}

/**
 * `app:owner/name` (a skill binding, an MCP grantee) with the name resolved: `app:alice/shop` →
 * `app:alice/shop.html`. Any other value comes back as given.
 */
export async function resolveBindingRef(storage: Pick<Storage, 'appFilenamesAmong'>, ref: string): Promise<string> {
  if (typeof ref !== 'string' || !ref.startsWith('app:')) return ref;
  const inner = await resolveOwnerAppRef(storage, ref.slice(4));
  return `app:${inner}`;
}

/**
 * The filename a publish under the name `ref` writes: the owner's existing app or draft when the
 * name resolves to one (so `notes` updates `notes.html` instead of starting a second app beside it),
 * otherwise, for HTML with no extension in the name, the name with `.html`, the form every app has
 * and the one its subdomain is made from. Any other name is kept as given.
 */
export async function publishFilename(
  storage: Pick<Storage, 'appFilenamesAmong'>,
  owner: { ownerGaii: string } | { ownerName: string },
  ref: string,
  mimeType: string | undefined,
): Promise<string> {
  const found = await findAppFilename(storage, owner, ref);
  if (found.filename) return found.filename;
  if (found.foreign) return String(ref ?? '').trim();
  const isHtml = !mimeType || /html/i.test(mimeType);
  return isHtml && found.name && !found.name.includes('.') ? `${found.name}.html` : found.name;
}

/**
 * resolveAppFilename's lookup, with "nothing matched" kept apart from a match: `filename` is the
 * stored filename or null, `name` is the reference without a same-owner prefix, and `foreign` says
 * the prefix named another owner.
 */
export async function findAppFilename(
  storage: Pick<Storage, 'appFilenamesAmong'>,
  owner: { ownerGaii: string } | { ownerName: string },
  ref: string,
): Promise<{ filename: string | null; name: string; foreign: boolean }> {
  const raw = String(ref ?? '').trim();
  const { owner: prefix, name } = splitAppRef(raw);
  if (prefix !== undefined && localAccountName(prefix) !== ownerAccount(owner)) {
    return { filename: null, name, foreign: true };
  }
  const candidates = appFilenameCandidates(name);
  if (candidates.length === 0) return { filename: null, name, foreign: false };
  const present = new Set(await storage.appFilenamesAmong(owner, candidates));
  return { filename: candidates.find(c => present.has(c)) ?? null, name, foreign: false };
}
