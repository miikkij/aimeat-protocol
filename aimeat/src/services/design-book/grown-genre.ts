/**
 * @file src/services/design-book/grown-genre.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A GENRE THAT GREW OUT OF AN APP. Until 2026-09-20 a genre part could only name one
 *   of the page templates the node ships in its code, so the shelf of genres grew when a developer
 *   committed one and at no other time. A builder that made a page with a look of its own
 *   (`aimeat-register: custom:<name>`) had nowhere to offer it.
 *
 *   THE GENRE IS THE APP, NOT A COPY OF IT. The part's body names the owner's own published app
 *   and nothing else: `{ "app": { "owner", "filename" }, "judgement": { "reach", "why" } }`. The
 *   page a fork starts from is the version of that app its owner said turned out well, read from
 *   the app catalogue when somebody asks. Nothing is stored twice, so nothing goes stale apart
 *   from the app, and the app has an owner.
 *
 *   FOUR THINGS EARN PUBLISHING, and none of them is a person reviewing a queue:
 *   the page says it has a look of its own (`custom:<name>`, so a fork of an existing genre is not
 *   offered back as a new one); its builder judged it general, with the reason; its owner said the
 *   app turned out well (`aimeat_designbook_keep`); and its owner opened it for forking. The last
 *   is the owner's consent and the agent cannot give it: a genre hands the page's whole source to
 *   every builder on the node, and "this turned out well" does not say "give it away".
 *
 *   IT STOPS BEING OFFERED THE MOMENT ANY OF THAT STOPS BEING TRUE. `grownGenrePage` is asked on
 *   every read: an app that was deleted, parked, hidden by the operator, put behind an access code
 *   or closed for forking answers null, and the map, the template doors and the preview drop it
 *   without anybody retiring the part.
 *
 *   ITS PAGE IS NEVER SERVED FROM THE NODE'S OWN ORIGIN. A shipped genre is the node's own HTML;
 *   this one is a stranger's page with script in it, so the preview is a redirect to the app's
 *   own address (routes/designbook.ts) and the bench does not run it. Inside a frame, where the
 *   app's address refuses to stand, the preview is the node's own script-free card of it
 *   (grownGenreFramePage).
 * @structure GrownGenreBody · isGrownGenreBody · validateGrownGenreBody · grownGenrePublishing ·
 *   grownGenrePage · grownGenreFramePage
 * @usage const page = await grownGenrePage(storage, config, body);   // null when it no longer stands
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 *   v1.0.1 — 2026-09-26 — The proposer's account name comes from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-10-24 — grownGenreFramePage: what the preview shows INSIDE A FRAME. The redirect to
 *     the app left the Design Book's gallery tiles empty, because an app answers a frame from another
 *     origin with SAMEORIGIN and frame-ancestors; in a frame the preview is now a page of the node's
 *     own with no script at all: the app's screenshot, its name and a link to open it.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { escapeHtml } from '../../utils/html-escape.js';
import { DesignBookError } from './errors.js';
import { DesignBookReasons } from './reasons.js';

export interface GrownGenreBody {
  app: { owner: string; filename: string };
  judgement: { reach: 'general' | 'special'; why: string };
}

export const GROWN_GENRE_LIMITS = { why: 400, whyMin: 20 } as const;

const OWNER_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const FILENAME_RE = /^[a-z0-9][a-z0-9._-]{0,120}\.html$/i;
const HEAD_BYTES = 8192;

const SHAPE = 'A genre that grew out of an app has the body { "app": { "owner": "<your owner name>", "filename": "<the published app>.html" }, '
  + '"judgement": { "reach": "general" | "special", "why": "<one sentence>" } }.';

export function isGrownGenreBody(body: unknown): body is GrownGenreBody {
  return !!body && typeof body === 'object' && typeof (body as { app?: unknown }).app === 'object' && (body as { app?: unknown }).app !== null;
}

/** The shape only. Whether the app exists and whose it is needs the store (grownGenrePublishing). */
export function validateGrownGenreBody(raw: Record<string, unknown>): GrownGenreBody {
  const app = raw.app as Record<string, unknown> | undefined;
  const owner = typeof app?.owner === 'string' ? app.owner.trim() : '';
  const filename = typeof app?.filename === 'string' ? app.filename.trim() : '';
  if (!OWNER_RE.test(owner) || !FILENAME_RE.test(filename)) throw new DesignBookError('BODY_INVALID', SHAPE, 422);
  const j = raw.judgement as Record<string, unknown> | undefined;
  if (!j || typeof j !== 'object') {
    throw new DesignBookError('BODY_INVALID',
      `${SHAPE} The judgement is YOURS: would a builder making a different kind of app start from this page ("general"), or is the look this app's own ("special")?`, 422);
  }
  if (j.reach !== 'general' && j.reach !== 'special') {
    throw new DesignBookError('BODY_INVALID', 'judgement.reach is "general" (a different kind of app could start from this page) or "special" (the look belongs to this app).', 422);
  }
  const why = typeof j.why === 'string' ? j.why.trim() : '';
  if (why.length < GROWN_GENRE_LIMITS.whyMin || why.length > GROWN_GENRE_LIMITS.why) {
    throw new DesignBookError('BODY_INVALID',
      `judgement.why is one sentence of ${GROWN_GENRE_LIMITS.whyMin} to ${GROWN_GENRE_LIMITS.why} characters: which other apps would start from this page, or why none would.`, 422);
  }
  return { app: { owner, filename }, judgement: { reach: j.reach, why } };
}

const metaOf = (html: string, name: string): string | null =>
  new RegExp(`<meta\\b[^>]{0,200}name\\s*=\\s*["']${name}["'][^>]{0,200}content\\s*=\\s*["']([^"']{0,120})["']`, 'i').exec(html.slice(0, HEAD_BYTES))?.[1]?.trim() || null;

export interface GrownGenrePage {
  owner: string;
  filename: string;
  /** The version its owner said turned out well: the page a fork starts from. */
  version: number;
  html: string;
  /** `custom:<name>` from the page's own head. */
  register: string;
  light: 'follows' | 'fixed';
}

/**
 * The page a grown genre stands on, or null with the reason when it does not stand: the first
 * thing that is no longer true, in words its owner can act on.
 */
export async function grownGenreStanding(
  storage: Storage, config: AimeatConfig, ownerGhii: string, body: GrownGenreBody,
): Promise<{ page: GrownGenrePage; why?: undefined } | { page: null; why: string }> {
  // `ownerGhii` is the part's proposer, the canonical bucket the app and its owner's notes live
  // under (propose refused any other owner's app), never an address composed from the name.
  const { owner, filename } = body.app;
  const name = `"${filename}"`;
  const live = await storage.getApp(ownerGhii, filename);
  if (!live) return { page: null, why: `There is no published app ${name} under ${owner}.` };
  if (live.parked || live.operatorHidden || live.accessCode) {
    return { page: null, why: `${name} is parked, hidden or behind an access code, so nobody else can open it. A genre is a page every builder can look at.` };
  }
  const state = await new DesignBookReasons(storage, config).keptState(ownerGhii, filename);
  if (!state.kept || state.version === null) {
    return { page: null, why: `The owner has not said ${name} turned out well (aimeat_designbook_keep). A finished build is not that.` };
  }
  if (!live.forkable) {
    return { page: null, why: `${name} is not open for forking. A genre hands the page's source to every builder on this node, and that is the owner's to allow: they turn it on for the app (PATCH /v1/apps/${filename} { "forkable": true }, or the app's settings). Ask them; do not decide it for them.` };
  }
  const kept = state.version === live.versionNumber ? live : await storage.getApp(ownerGhii, filename, state.version);
  if (!kept) return { page: null, why: `Version ${state.version} of ${name}, the one its owner kept, is no longer in the catalogue.` };
  const html = kept.data.toString('utf8');
  const register = metaOf(html, 'aimeat-register');
  if (!register || !/^custom:[a-z0-9][a-z0-9-]{1,40}$/i.test(register)) {
    return { page: null, why: `The head of ${name} says its register is ${register ? `"${register}"` : 'nothing'}. A page that grew a look of its own says so (<meta name="aimeat-register" content="custom:<name>">); a fork of an existing genre is that genre, and is not offered back as a new one.` };
  }
  return { page: { owner, filename, version: kept.versionNumber, html, register, light: metaOf(html, 'aimeat-light') === 'follows' ? 'follows' : 'fixed' } };
}

/**
 * The preview of a grown genre when it is shown INSIDE A FRAME (the Design Book's gallery tiles). The
 * app itself cannot stand there: it is a stranger's page with script, never served from this origin,
 * and its own address refuses to be framed by another origin. So the frame gets a page of the node's
 * own that carries no script at all: the app's screenshot filling the frame, its name, and a link to
 * open it. Every value is escaped; the addresses are the node's own (the screenshot route and the
 * app's resolved address).
 */
export function grownGenreFramePage(o: { title: string; summary?: string; appUrl: string; screenshotUrl: string }): string {
  const e = escapeHtml;
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex"><title>' + e(o.title) + '</title><style>'
    + 'html,body{margin:0;height:100%;background:#111;color:#f5f5f5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
    + 'img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}'
    + '.cap{position:fixed;left:0;right:0;bottom:0;padding:18px 24px;background:linear-gradient(transparent,rgba(0,0,0,.85))}'
    + '.cap b{display:block;font-size:22px}.cap span{display:block;opacity:.8;font-size:15px;margin-top:4px}'
    + '.cap a{display:inline-block;margin-top:10px;color:#fff;font-weight:600}'
    + '</style></head><body>'
    + '<img src="' + e(o.screenshotUrl) + '" alt="' + e(o.title) + '">'
    + '<div class="cap"><b>' + e(o.title) + '</b>' + (o.summary ? '<span>' + e(o.summary) + '</span>' : '')
    + '<a href="' + e(o.appUrl) + '" target="_blank" rel="noopener noreferrer">Open the app</a></div>'
    + '</body></html>';
}

export async function grownGenrePage(storage: Storage, config: AimeatConfig, ownerGhii: string, body: GrownGenreBody): Promise<GrownGenrePage | null> {
  return (await grownGenreStanding(storage, config, ownerGhii, body)).page;
}

/**
 * Whether a proposed genre goes straight to the shelf. Refuses outright when the app is somebody
 * else's: a proposal is a reflection on the proposer's own build, never a claim over another's.
 */
export async function grownGenrePublishing(
  storage: Storage, config: AimeatConfig, proposerGhii: string, body: GrownGenreBody,
): Promise<{ earned: boolean; why: string }> {
  if (body.app.owner.toLowerCase() !== localAccountName(proposerGhii).toLowerCase()) {
    throw new DesignBookError('NOT_YOUR_APP', 'A genre is offered by the owner of the app it grew out of. body.app.owner is your own owner name.', 403);
  }
  if (!(await storage.getApp(proposerGhii, body.app.filename))) {
    throw new DesignBookError('APP_NOT_FOUND', `You have no published app "${body.app.filename}". Publish the page first; the genre is that app.`, 404);
  }
  if (body.judgement.reach !== 'general') {
    return { earned: false, why: 'Its builder judged the look special to one app, so it stays proposed: listed, and not offered to other builders as a place to start.' };
  }
  const standing = await grownGenreStanding(storage, config, proposerGhii, body);
  if (!standing.page) return { earned: false, why: `${standing.why} It stays proposed until that changes; propose it again then.` };
  return { earned: true, why: `Published: the page has a look of its own (${standing.page.register}), its builder judged it general, its owner said version ${standing.page.version} turned out well, and its owner opened it for forking. It stops being offered if any of that stops being true.` };
}
