/**
 * @file app-seo.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ONE answer to "should a search engine index this app", and the derived metadata
 *   that answer unlocks.
 *
 *   Four surfaces ask the question and every one of them has to get the same answer: the
 *   sitemap index decides whether to list the app's host, the app origin's robots.txt decides
 *   between Allow and Disallow, the serving route decides whether to stamp X-Robots-Tag, and the
 *   head injection decides between a noindex meta and a full set of descriptive tags. Four places
 *   is exactly the shape that has already cost this project the same defect three times inside one
 *   MCP tool, so the rule here is narrow and absolute: nothing recomputes this, everything calls
 *   `appSeoIndexable`.
 *
 *   THE DEFAULT IS NO, and that is a decision rather than caution. Publishing an app makes it
 *   public and shareable by link immediately; being findable in a search engine is a separate,
 *   later choice its owner makes on purpose. Reach is not a side effect of pressing publish, and a
 *   node's domain reputation is not something every half-finished experiment gets to spend.
 *
 *   Three parties have a say, in this order. The EXISTING gate comes first, unchanged: a gated app
 *   was never eligible. Then the OPERATOR, who can block one app outright and who chooses via
 *   `apps.seo_mode` whether they are also the one who approves. Then the OWNER, whose switch is the
 *   whole decision in `owner` mode and a request in `review` mode.
 *
 * @structure
 *   - appSeoIndexable(app, config)  — the single decision
 *   - appSeoState(app, config)      — the same decision, as a reason an operator can read
 *   - appSeoMeta(app, config, ...)  — the descriptive metadata, derived or overridden
 * @usage
 *   if (!appSeoIndexable(app, config)) return disallowRobots();
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial. The gate it absorbs from sitemaps.ts is unchanged; everything
 *     after step 1 is new.
 */
import type { AimeatConfig } from '../config.js';
import type { AppSeo, AppSummaryRecord } from '../storage/types/apps.js';

/**
 * Why an app is or is not search-visible, in terms an operator can act on. `appSeoIndexable` is the
 * boolean this collapses to; this exists because "not indexed" has five different causes and an
 * operator staring at a list needs to know which one they are looking at.
 */
export type AppSeoState =
  /** Gated: access-coded or priced. Never eligible, and not the owner's switch to change. */
  | 'gated'
  /** Removed from every public surface by an operator. Search visibility is moot. */
  | 'hidden'
  /** An operator blocked THIS app's search visibility while leaving the app itself alone. */
  | 'blocked'
  /** The owner has not asked for it. The default state of every app. */
  | 'off'
  /** The owner asked and the operator has not answered yet (`apps.seo_mode = review`). */
  | 'pending'
  /** Search-visible. */
  | 'on';

/**
 * The state, with the reasons applied in the order that makes each one meaningful.
 *
 * The order is the point. `gated` before `blocked` because an operator should not be told an app
 * is blocked when it was never eligible; `blocked` before `off` because a blocked app whose owner
 * later switches their own toggle must still read as blocked rather than silently flipping to
 * pending; `pending` last because it only exists in one mode.
 */
export function appSeoState(app: AppSummaryRecord, config: AimeatConfig): AppSeoState {
  // Step 1, unchanged from the gate this replaces (routes/sitemaps.ts). A GATED app publishes no
  // agent-facing documents of its own: its origin answers with the NODE's llms.txt and card, which
  // e2e-app-origin asserts. Advertising its sitemap would send a crawler to a host that refuses to
  // describe the thing we just advertised.
  if (app.accessCode || (app.manifest?.priceMorsels ?? 0) > 0) return 'gated';
  if (app.parked || app.operatorHidden) return 'hidden';
  if (app.operatorSeoBlocked) return 'blocked';

  const seo = app.manifest?.seo;
  if (seo?.index !== true) return 'off';
  if (config.appsSeoMode === 'review' && !seo.approvedBy) return 'pending';
  return 'on';
}

/** The single decision every surface asks. */
export function appSeoIndexable(app: AppSummaryRecord, config: AimeatConfig): boolean {
  // The node-wide switch overrules everything below it: an operator who turned discovery off did
  // not mean "except for the apps". Checked here as well as in the robots header middleware,
  // because the sitemap index and the per-app robots.txt do not pass through that middleware's
  // decision, only its header.
  if (config.seoIndexing === 'off') return false;
  return appSeoState(app, config) === 'on';
}

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 320;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD = 40;

/**
 * Validate what an OWNER may write about their own app's search visibility.
 *
 * The important half is what it refuses. `approvedBy` and `approvedAt` are the operator's answer in
 * review mode, and an owner who could set them would approve themselves — the mode would enforce
 * nothing. They are dropped here rather than rejected, because a client echoing back the object it
 * just read is a normal thing to do and does not deserve a 400. `requestedAt` is stamped by the
 * server for the same reason a timestamp is never taken from a caller.
 *
 * The length caps are not cosmetic. Everything here is rendered into a `<meta>` on a page served
 * from the operator's domain, so a title field with no ceiling is a place to put a paragraph of
 * somebody else's keywords.
 */
export function parseOwnerSeoInput(input: unknown): { seo: Partial<AppSeo> } | { error: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'seo must be an object' };
  }
  const src = input as Record<string, unknown>;
  const seo: Partial<AppSeo> = {};

  if ('index' in src) {
    if (typeof src.index !== 'boolean') return { error: 'seo.index must be a boolean' };
    seo.index = src.index;
    // Server-stamped. In review mode this is the moment an operator's queue gains an entry, so it
    // has to mean "when the node was told", not "when the caller says it was".
    seo.requestedAt = src.index ? new Date().toISOString() : undefined;
    // Switching visibility off retracts an approval with it. Otherwise an app switched off and
    // later on again would come back already approved, skipping the review it now needs.
    if (!src.index) { seo.approvedBy = undefined; seo.approvedAt = undefined; }
  }

  for (const [field, cap] of [['title', MAX_TITLE], ['description', MAX_DESCRIPTION]] as const) {
    if (!(field in src)) continue;
    if (typeof src[field] !== 'string') return { error: `seo.${field} must be a string` };
    const v = (src[field] as string).trim();
    if (v.length > cap) return { error: `seo.${field} must be at most ${cap} characters` };
    // Empty means "go back to deriving it from the app", which is the normal state and has to be
    // reachable after somebody has typed something they no longer want.
    seo[field] = v || undefined;
  }

  if ('keywords' in src) {
    if (!Array.isArray(src.keywords)) return { error: 'seo.keywords must be an array of strings' };
    if (src.keywords.length > MAX_KEYWORDS) return { error: `seo.keywords must have at most ${MAX_KEYWORDS} entries` };
    const cleaned: string[] = [];
    for (const k of src.keywords) {
      if (typeof k !== 'string') return { error: 'seo.keywords must be an array of strings' };
      const v = k.trim();
      if (v.length > MAX_KEYWORD) return { error: `each keyword must be at most ${MAX_KEYWORD} characters` };
      if (v) cleaned.push(v);
    }
    seo.keywords = cleaned.length ? cleaned : undefined;
  }

  if ('image' in src) {
    if (typeof src.image !== 'string') return { error: 'seo.image must be a string' };
    const v = src.image.trim();
    // Absolute https only. A relative path would resolve against the APP's origin, where the owner
    // controls the bytes, and an http one turns a card on an https page into a mixed-content
    // fetch that most unfurlers drop anyway.
    if (v && !/^https:\/\//i.test(v)) return { error: 'seo.image must be an absolute https URL' };
    if (v.length > 500) return { error: 'seo.image must be at most 500 characters' };
    seo.image = v || undefined;
  }

  if ('lang' in src) {
    if (typeof src.lang !== 'string') return { error: 'seo.lang must be a string' };
    const v = src.lang.trim();
    if (v && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v)) {
      return { error: 'seo.lang must be a language tag such as "fi" or "en-GB"' };
    }
    seo.lang = v || undefined;
  }

  if (Object.keys(seo).length === 0) {
    return { error: 'seo must name at least one of: index, title, description, keywords, image, lang' };
  }
  return { seo };
}

/** What to tell the owner, given where their app actually ended up. */
export function seoNote(state: AppSeoState): string {
  switch (state) {
    case 'on':
      return 'This app can now be found in search engines. It has been added to this node\'s sitemap; engines usually take a few days to pick it up.';
    case 'pending':
      return 'Search visibility requested. Whoever runs this node reviews it before the app appears in search engines.';
    case 'blocked':
      return 'Search visibility is switched on, but whoever runs this node has blocked this app from search engines. The app itself still works and can be shared by link.';
    case 'hidden':
      return 'Search visibility is switched on, but the app is hidden, so nothing is findable until it is visible again.';
    case 'gated':
      return 'Search visibility is switched on, but an app behind an access code or a price is never listed in search engines.';
    case 'off':
    default:
      return 'This app will not be found in search engines. It still works and can be shared by link.';
  }
}

/**
 * The absolute URL of the app's own screenshot, or '' when it has none.
 *
 * Costs one owner-scoped metadata query (no bytes), so callers should reach for it only when the
 * app is actually search-visible — which is the minority, and exactly the case where a social card
 * is worth a query. Pointing og:image at the route unconditionally and letting it 404 was the
 * cheaper option and the wrong one: a card with a broken image reads worse than a card with none.
 */
export async function appScreenshotUrl(
  storage: { listStorageFiles(ownerGaii: string): Promise<Array<{ key: string }>> },
  app: AppSummaryRecord,
  baseUrl: string,
): Promise<string> {
  const files = await storage.listStorageFiles(app.ownerGaii);
  const has = files.some((f) => f.key === `apps/screenshots/${app.filename}`);
  if (!has) return '';
  const b = baseUrl.replace(/\/$/, '');
  return `${b}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/screenshot`;
}

/**
 * The languages an app declares for itself, most preferred first, from its own
 * `<meta name="aimeat-locales" content="fi en">`. Empty when it declares none.
 *
 * Read from the bytes rather than from the manifest because that meta tag is what the app-building
 * templates already emit and what the localisation machinery already reads. Only the head is
 * scanned: an app is up to a megabyte of HTML and the tag is always in the first few hundred bytes.
 */
export function appDeclaredLocales(data: Buffer | Uint8Array | string): string[] {
  const head = (typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')).slice(0, 4096);
  const m = /<meta\s+name="aimeat-locales"\s+content="([^"]*)"/i.exec(head);
  if (!m) return [];
  return m[1].split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

/** What the app's head should say about itself, once it is allowed to say anything. */
export interface AppSeoMeta {
  title: string;
  description: string;
  keywords: string[];
  /** Absolute URL of the social image, or '' when the app has no screenshot and set none. */
  image: string;
  /** BCP-47 tag, or '' to leave the document's own `lang` alone. */
  lang: string;
}

/**
 * Derive the app's descriptive metadata: the owner's overrides where they wrote one, and what the
 * app already declares everywhere else.
 *
 * Derivation is not a fallback here, it is the expected path. An owner who wants their app found
 * has already written its name, its description and its tags, and asking them to write a second
 * copy for search engines produces two texts that disagree within a month. The override fields
 * exist for the case where the catalogue wording and the search wording genuinely differ.
 */
export function appSeoMeta(
  app: AppSummaryRecord,
  opts: {
    /** Absolute URL of the app's screenshot, when it has one. */
    screenshotUrl?: string;
    /** Locales the app's own document declares, most preferred first. */
    documentLocales?: string[];
  } = {},
): AppSeoMeta {
  const seo: AppSeo = app.manifest?.seo ?? {};
  const name = seo.title?.trim() || app.manifest?.name?.trim()
    || app.filename.replace(/\.[^.]+$/, '');
  const description = seo.description?.trim() || app.manifest?.description?.trim()
    || `${name} — an application published on AIMEAT by ${app.ownerName}.`;
  const keywords = (seo.keywords?.length ? seo.keywords : app.manifest?.tags ?? [])
    .map((k) => k.trim()).filter(Boolean);
  return {
    title: name,
    description,
    keywords,
    // The screenshot is the app's own picture and every published app can have one, so a card with
    // a real image is the normal case rather than a luxury. Before this, no app had a social card
    // at all while the image sat one unauthenticated route away.
    image: seo.image?.trim() || opts.screenshotUrl || '',
    // The app's own declared locale wins over any guess. Stamping `en` on a Finnish app, which is
    // what happened to every app whose author omitted the attribute, tells a search engine
    // something plainly false about the page.
    lang: seo.lang?.trim() || opts.documentLocales?.[0] || '',
  };
}
