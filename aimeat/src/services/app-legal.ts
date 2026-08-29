/**
 * @file src/services/app-legal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's own legal pages: terms, privacy notice, imprint, refunds, accessibility
 *   statement, cookies, support. The app answers for what it does — a shop for its sales, an app
 *   that handles personal data for that data — and not the platform, so the pages are the app's,
 *   written by its owner, served on the app's own origin (`/terms`, `/privacy`, …) and on the apex,
 *   linked from the app's head, and named in its llms.txt.
 *
 *   THE KINDS, and where each comes from (searched 2026-08-29, sources in the Development notes):
 *     terms          the contract with the person using the app; every app store asks for it
 *     privacy        GDPR Art. 13 notice; Apple and Google require a public URL for every app
 *     imprint        who is behind this: e-commerce directive Art. 5, DSA Art. 30(7) for a seller
 *     refunds        the 14-day withdrawal right and refunds (consumer rights directive)
 *     accessibility  the statement the European Accessibility Act asks of e-commerce services
 *     cookies        what the app keeps in the browser beyond what running needs (ePrivacy)
 *     support        the contact the app stores require (Apple support URL, Google privacy contact)
 *
 *   THREE FORMATS. Markdown is rendered here through utils/markdown-lite.ts, which escapes every
 *   character it did not produce. HTML is served AS THE OWNER WROTE IT, under the same CSP and on
 *   the same origin as the app itself — the app is already the owner's arbitrary HTML, so a legal
 *   page in the same place adds no reach it did not have. A URL redirects: many owners already
 *   keep a policy somewhere, and the stores accept a link.
 *
 *   ONE IMPLEMENTATION. PATCH /v1/apps/:filename and the MCP tool call applyOwnerLegalUpdate();
 *   the serve routes call renderLegalPage(). Every change lands in the app's audit log
 *   (services/app-audit.ts) with the kind, the format, the size and a hash of the content, so the
 *   owner can show what the page said on a given day without the log carrying the page.
 * @structure
 *   - LEGAL_KIND_INFO — the kinds, their paths, link relations and the reason each exists
 *   - parseLegalInput / appLegalState / legalReadiness
 *   - applyOwnerLegalUpdate (both doors) / ownerAppLegal (the agent-shaped entry)
 *   - legalLinksFor — the head links and the llms.txt lines
 *   - renderLegalPage — what a reader gets at /terms and friends
 * @usage
 *   const out = await applyOwnerLegalUpdate(storage, { ownerGaii, filename }, { legal: body.legal, actor });
 * @version-history
 *   v1.1.0 — 2026-08-29 — Money decides a shop (appSellsForMoney, the tools document's currency
 *     prices), never morsels; a page set here mints an AI-provenance record through
 *     provenanceForWrite() and the served page carries its marks and label.
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { createHash } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { AppManifest, AppLegalKind, AppLegalDoc, AppSummaryRecord, AppRecord } from '../storage/types/apps.js';
import { APP_LEGAL_KINDS } from '../storage/types/apps.js';
import { resolveAppOwnerScope } from './app-lifecycle.js';
import { emitChange } from './event-bus.js';
import { recordAppAudit } from './app-audit.js';
import { renderMarkdownLite } from '../utils/markdown-lite.js';
import { appDisplayName } from './app-agent-surfaces.js';
import { AppToolsDocSchema } from '../models/app-tool-schemas.js';
import { provenanceForWrite, ProvenanceScopeError, type DeclaredProvenance } from './ai-provenance.js';
import { logger } from '../utils/logger.js';

export const LEGAL_CONTENT_MAX = 200_000;
export const LEGAL_URL_MAX = 2048;

export interface LegalKindInfo {
  /** The path on the app's origin, and after the app's apex address. */
  path: string;
  /** A registered link relation for the head, where one exists. */
  rel?: 'terms-of-service' | 'privacy-policy' | 'help';
  title: string;
  /** Why this page exists, for the owner deciding whether to write it. */
  why: string;
}

export const LEGAL_KIND_INFO: Record<AppLegalKind, LegalKindInfo> = {
  terms: {
    path: '/terms', rel: 'terms-of-service', title: 'Terms of use',
    why: 'The contract between the app and the person using it. Every app store asks for it; a shop or a paid tool cannot do without it.',
  },
  privacy: {
    path: '/privacy', rel: 'privacy-policy', title: 'Privacy notice',
    why: 'What personal data the app handles, why, for how long, who else sees it and how to reach whoever answers for it (GDPR Art. 13). Apple and Google require a public URL for every app.',
  },
  imprint: {
    path: '/imprint', title: 'Imprint',
    why: 'Who is behind this app: name, address, contact, trade register where there is one (e-commerce directive Art. 5; DSA Art. 30(7) for anyone selling on a marketplace).',
  },
  refunds: {
    path: '/refunds', title: 'Refunds and withdrawal',
    why: 'The 14-day right of withdrawal and how a refund works (consumer rights directive), for an app that sells anything.',
  },
  accessibility: {
    path: '/accessibility', title: 'Accessibility statement',
    why: 'How the app meets accessibility requirements. The European Accessibility Act has asked this of e-commerce services since June 2025.',
  },
  cookies: {
    path: '/cookies', title: 'Cookies and browser storage',
    why: 'What the app keeps in the browser and why (ePrivacy), when it keeps anything beyond what running requires.',
  },
  support: {
    path: '/support', rel: 'help', title: 'Support',
    why: 'How to reach whoever answers for the app. Apple requires a support URL; Google a privacy contact.',
  },
};

const FORMATS = new Set<AppLegalDoc['format']>(['markdown', 'html', 'url']);

export function isLegalKind(k: string): k is AppLegalKind {
  return (APP_LEGAL_KINDS as readonly string[]).includes(k);
}

/**
 * `{ [kind]: { format, content } | null }`. A kind set to null is removed; an unknown kind, an
 * unknown format, an empty or oversized document, or a URL that is not https is refused by name.
 */
export function parseLegalInput(
  input: unknown, actor: string,
): { legal: Partial<Record<AppLegalKind, AppLegalDoc | null>> } | { error: string } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { error: 'legal must be an object mapping a kind (terms, privacy, imprint, refunds, accessibility, cookies, support) to { format, content } or null' };
  }
  const legal: Partial<Record<AppLegalKind, AppLegalDoc | null>> = {};
  const now = new Date().toISOString();
  for (const [kind, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isLegalKind(kind)) return { error: `legal.${kind} is not a kind of legal page (${APP_LEGAL_KINDS.join(', ')})` };
    if (raw === null) { legal[kind] = null; continue; }
    if (typeof raw !== 'object' || Array.isArray(raw)) return { error: `legal.${kind} must be { format, content } or null` };
    const { format, content, remove } = raw as { format?: unknown; content?: unknown; remove?: unknown };
    // `{ remove: true }` is the same act as null, for a door whose fields all travel together
    // (the connector and CLI tools forward every declared parameter, so the removal flag rides
    // inside the kind object rather than replacing it).
    if (remove === true) { legal[kind] = null; continue; }
    if (typeof format !== 'string' || !FORMATS.has(format as AppLegalDoc['format'])) {
      return { error: `legal.${kind}.format must be one of markdown, html, url` };
    }
    if (typeof content !== 'string') return { error: `legal.${kind}.content must be a string` };
    const text = format === 'url' ? content.trim() : content.replace(/\r\n?/g, '\n');
    if (!text.trim()) return { error: `legal.${kind}.content is empty; send null to remove the page` };
    if (format === 'url') {
      if (text.length > LEGAL_URL_MAX || !/^https:\/\/[^\s]+$/i.test(text)) {
        return { error: `legal.${kind}.content must be an absolute https URL when format is url` };
      }
    } else if (Buffer.byteLength(text, 'utf8') > LEGAL_CONTENT_MAX) {
      return { error: `legal.${kind}.content is over ${Math.round(LEGAL_CONTENT_MAX / 1000)} kB` };
    }
    legal[kind] = { format: format as AppLegalDoc['format'], content: text, updatedAt: now, updatedBy: actor };
  }
  return { legal };
}

export interface LegalDocState {
  format: AppLegalDoc['format'];
  updatedAt: string;
  updatedBy: string;
  /** Bytes of the document, or of the URL. */
  size: number;
  /** The URL, when the page lives elsewhere. */
  url?: string;
  /** The AI-provenance record minted for this text, when the node minted one. */
  aiProvenanceId?: string;
}

export type AppLegalState = Partial<Record<AppLegalKind, LegalDocState>>;

/** The pages an app has, without their content: what a listing and a response carry. */
export function appLegalState(app: Pick<AppSummaryRecord, 'manifest'>): AppLegalState {
  const out: AppLegalState = {};
  for (const kind of APP_LEGAL_KINDS) {
    const d = app.manifest?.legal?.[kind];
    if (!d) continue;
    out[kind] = {
      format: d.format, updatedAt: d.updatedAt, updatedBy: d.updatedBy,
      size: Buffer.byteLength(d.content, 'utf8'),
      ...(d.format === 'url' ? { url: d.content } : {}),
      ...(d.aiProvenanceId ? { aiProvenanceId: d.aiProvenanceId } : {}),
    };
  }
  return out;
}

/** The manifest with legal content stripped, for anyone who is not the owner. */
export function stripLegalContent(manifest: AppManifest): AppManifest {
  if (!manifest.legal) return manifest;
  const legal: Partial<Record<AppLegalKind, AppLegalDoc>> = {};
  for (const [kind, d] of Object.entries(manifest.legal) as Array<[AppLegalKind, AppLegalDoc]>) {
    legal[kind] = { ...d, content: d.format === 'url' ? d.content : '' };
  }
  return { ...manifest, legal };
}

export interface LegalReadiness {
  /** The kinds this app should have, given what it is. */
  recommended: AppLegalKind[];
  /** Of those, the ones it does not have yet. */
  missing: AppLegalKind[];
  /** Why the recommendation is what it is, one line. */
  reason: string;
}

/**
 * Does this app take MONEY for anything: a tool priced in a currency in its tools document
 * (`apps.<filename>.tools`, the record aimeat_app_tools_publish writes). Morsels are not money —
 * they pace what agents push into the store and buy nothing — so a morsel price, an app-store
 * licence bought with morsels, or a morsel-priced tool never makes an app a shop. Consumer law,
 * the DSA's trader duties and the EAA's e-commerce rule attach to money changing hands.
 */
export async function appSellsForMoney(storage: Storage, app: Pick<AppRecord, 'ownerGaii' | 'filename'>): Promise<boolean> {
  try {
    const rec = await storage.getMemory(app.ownerGaii, `apps.${app.filename}.tools`);
    if (!rec) return false;
    const parsed = AppToolsDocSchema.safeParse(rec.value);
    if (!parsed.success) return false;
    return parsed.data.tools.some((t) => (t.priceMoney?.amount ?? 0) > 0
      || (Array.isArray((t as { pricesMoney?: Array<{ amount: number }> }).pricesMoney)
        && (t as { pricesMoney?: Array<{ amount: number }> }).pricesMoney!.some((p) => p.amount > 0)));
  } catch (err) {
    // A failed read answers "not a shop" and says so in the log: the readiness this feeds is a
    // recommendation, and refusing the whole details view over it would hide more than it protects.
    logger.warn('app-legal: could not read the tools document, treating the app as not selling', { filename: app.filename, error: String(err) });
    return false;
  }
}

/**
 * Which pages an app ought to have. Every published app: terms and privacy. An app that takes
 * money (appSellsForMoney): also who is selling, how to withdraw, the accessibility statement the
 * EAA asks of e-commerce, and a support contact. Recommended, never blocked: the owner decides,
 * the details view shows what is missing, and a chip on the app's masthead says so.
 */
export function legalReadiness(app: Pick<AppSummaryRecord, 'manifest'>, opts?: { sellsForMoney?: boolean }): LegalReadiness {
  const m = app.manifest;
  const sells = opts?.sellsForMoney === true;
  const recommended: AppLegalKind[] = sells
    ? ['terms', 'privacy', 'imprint', 'refunds', 'accessibility', 'support']
    : ['terms', 'privacy'];
  const have = new Set(Object.keys(m?.legal ?? {}));
  return {
    recommended,
    missing: recommended.filter(k => !have.has(k)),
    reason: sells
      ? 'This app sells something, so it answers for the sale: who is selling, on what terms, how to withdraw, how the data is handled, and how the shop can be used by everyone.'
      : 'A published app answers for its own terms and for the personal data it handles.',
  };
}

export interface LegalUpdateInput {
  legal: unknown;
  /** The principal making the change: the owner's GHII, or an agent's GAII acting for them. */
  actor: { ghii: string };
  /** What the caller said about how the text was made (the same block every publish door takes). */
  declared?: DeclaredProvenance;
  /** A provenance record the caller already holds and wants attached instead. */
  declaredId?: string;
}

export type LegalUpdateResult =
  | { state: AppLegalState; readiness: LegalReadiness; note: string }
  | { error: string; status: 400 | 403 | 404; details?: unknown };

function shortHash(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The write, the provenance record, the audit entries and the note, for both doors.
 *
 * A legal page is text a person reads, so it goes through the same provenanceForWrite() every
 * published app and memory record goes through (decided 2026-08-29): a page an AI drafted carries
 * the record, and the served page carries the marks and, where the law asks, the visible label —
 * lifted the way it is lifted everywhere else, by a named reviewer on the app. Refused, never
 * silently downgraded, when the caller declares provenance it may not declare.
 */
export async function applyOwnerLegalUpdate(
  storage: Storage,
  config: AimeatConfig,
  target: { ownerGaii: string; filename: string },
  input: LegalUpdateInput,
): Promise<LegalUpdateResult> {
  const parsed = parseLegalInput(input.legal, input.actor.ghii);
  if ('error' in parsed) return { error: parsed.error, status: 400 };
  if (!Object.keys(parsed.legal).length) return { error: 'legal names no page to set or remove', status: 400 };

  const app = await storage.getApp(target.ownerGaii, target.filename);
  if (!app) return { error: `App "${target.filename}" not found in your uploads`, status: 404 };

  const notes: string[] = [];
  const patch: Partial<Record<AppLegalKind, AppLegalDoc | null>> = {};
  for (const [kind, doc] of Object.entries(parsed.legal) as Array<[AppLegalKind, AppLegalDoc | null]>) {
    const before = app.manifest?.legal?.[kind];
    const title = LEGAL_KIND_INFO[kind].title;
    if (doc === null) {
      if (!before) continue;
      patch[kind] = null;
      notes.push(`${title} removed; the page no longer answers.`);
      continue;
    }
    if (before && before.format === doc.format && before.content === doc.content) continue;
    // A link is not text anybody wrote here; the page it points to carries its own marks.
    if (doc.format !== 'url') {
      try {
        const id = await provenanceForWrite(storage, {
          principal: input.actor.ghii,
          content: doc.content,
          declaredId: input.declaredId,
          declared: input.declared,
          pipeline: 'app.legal',
          surface: { visibility: 'public', humanAudience: true, mediaKind: 'text' },
          labelPolicy: config.aiLabelPublic,
          nodeId: config.nodeId,
          baseUrl: config.baseUrl,
          enabled: config.aiProvenance,
        });
        if (id) doc.aiProvenanceId = id;
      } catch (err) {
        if (err instanceof ProvenanceScopeError) {
          return { error: err.message, status: 403, details: { held_scopes: err.heldScopes } };
        }
        throw err;
      }
    }
    patch[kind] = doc;
    notes.push(doc.format === 'url'
      ? `${title} now points to ${doc.content}.`
      : `${title} ${before ? 'updated' : 'published'} (${doc.format}, ${Math.max(1, Math.round(Buffer.byteLength(doc.content, 'utf8') / 1000))} kB) at ${LEGAL_KIND_INFO[kind].path} on the app's origin.`);
  }

  if (Object.keys(patch).length) {
    await storage.updateAppMeta(target.ownerGaii, target.filename, { legal: patch });
    for (const [kind, doc] of Object.entries(patch) as Array<[AppLegalKind, AppLegalDoc | null]>) {
      await recordAppAudit(storage, {
        ownerGhii: target.ownerGaii, filename: target.filename, by: input.actor.ghii,
        action: doc ? 'legal.set' : 'legal.cleared',
        detail: doc
          ? {
              kind, format: doc.format, size: Buffer.byteLength(doc.content, 'utf8'), sha256: shortHash(doc.content),
              ...(doc.aiProvenanceId ? { provenance: doc.aiProvenanceId } : {}),
            }
          : { kind },
      });
    }
    emitChange('apps');
  }

  const after = await storage.getApp(target.ownerGaii, target.filename);
  if (!after) return { error: 'The app was not found after the update', status: 404 };
  if (!notes.length) notes.push('Nothing changed: the pages already read as you sent them.');
  const sellsForMoney = await appSellsForMoney(storage, after);
  return { state: appLegalState(after), readiness: legalReadiness(after, { sellsForMoney }), note: notes.join(' ') };
}

/**
 * The agent-shaped entry: the caller's own identity and an app name. Naming no page reports the
 * state and what is still missing.
 */
export async function ownerAppLegal(
  storage: Storage,
  config: AimeatConfig,
  args: {
    callerGaii: string; filename: string; legal?: Record<string, unknown>;
    declared?: DeclaredProvenance; declaredId?: string;
  },
): Promise<{ state: AppLegalState; readiness: LegalReadiness; note?: string } | { error: string }> {
  const scope = await resolveAppOwnerScope(storage, config, args.callerGaii);
  if (!scope) return { error: 'This connection is not acting for an owner, so it has no app catalogue to change.' };
  const app = await storage.getApp(scope.ownerGhii, args.filename);
  if (!app) return { error: `No app named "${args.filename}" in your catalogue.` };
  if (!args.legal || Object.keys(args.legal).length === 0) {
    return { state: appLegalState(app), readiness: legalReadiness(app, { sellsForMoney: await appSellsForMoney(storage, app) }) };
  }
  const out = await applyOwnerLegalUpdate(storage, config, { ownerGaii: scope.ownerGhii, filename: args.filename },
    { legal: args.legal, actor: { ghii: args.callerGaii }, declared: args.declared, declaredId: args.declaredId });
  if ('error' in out) return { error: out.error };
  return out;
}

export interface LegalLink {
  kind: AppLegalKind;
  rel?: LegalKindInfo['rel'];
  title: string;
  href: string;
}

/** The pages this app has, as links on the given base (an app origin or the apex app address). */
export function legalLinksFor(app: Pick<AppSummaryRecord, 'manifest'>, base: string): LegalLink[] {
  const b = base.replace(/\/$/, '');
  const out: LegalLink[] = [];
  for (const kind of APP_LEGAL_KINDS) {
    const d = app.manifest?.legal?.[kind];
    if (!d) continue;
    const info = LEGAL_KIND_INFO[kind];
    out.push({ kind, rel: info.rel, title: info.title, href: d.format === 'url' ? d.content : `${b}${info.path}` });
  }
  return out;
}

/** The apex address of a kind's page, for a node with no app origin. */
export function apexLegalBase(baseUrl: string, app: Pick<AppRecord, 'ownerName' | 'filename'>): string {
  return `${baseUrl.replace(/\/$/, '')}/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}/legal`;
}

export type RenderedLegalPage = { redirect: string } | { html: string };

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * What a reader gets. HTML is the owner's document verbatim; markdown becomes a plain page that
 * says whose page it is and that the app, not the platform, answers for it; a URL redirects.
 */
export function renderLegalPage(
  app: AppRecord, kind: AppLegalKind, doc: AppLegalDoc, ctx: { baseUrl: string; locale?: string },
): RenderedLegalPage {
  if (doc.format === 'url') return { redirect: doc.content };
  if (doc.format === 'html') return { html: doc.content };
  const info = LEGAL_KIND_INFO[kind];
  const appName = appDisplayName(app);
  const who = app.manifest?.authorship?.name ?? app.ownerName;
  const updated = doc.updatedAt.split('T')[0];
  const base = ctx.baseUrl.replace(/\/$/, '');
  const html = `<!DOCTYPE html>
<html lang="${esc(ctx.locale ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(info.title)} · ${esc(appName)}</title>
<meta name="robots" content="noindex">
<style>
:root{--ink:#1A1A2E;--paper:#FAFAF8;--dim:#6B7280;--accent:#E8564A;--rule:#E5E7EB}
@media (prefers-color-scheme:dark){:root{--ink:#EDEEF2;--paper:#14151A;--dim:#A4A9B6;--accent:#FF6F62;--rule:#33363F}}
html{background:var(--paper);color:var(--ink)}
body{margin:0;font:400 1.02rem/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:48px 24px 72px}
.crumb{font:600 .72rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:0 0 14px}
h1{font-size:2.2rem;line-height:1;letter-spacing:-.02em;margin:0 0 8px}
.meta{color:var(--dim);font-size:.9rem;margin:0 0 28px;padding-bottom:22px;border-bottom:3px solid var(--ink)}
h2{font-size:1.35rem;margin:36px 0 10px}h3{font-size:1.1rem;margin:28px 0 8px}
p,li{max-width:70ch}a{color:inherit;text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:3px}
blockquote{margin:0;padding:0 0 0 18px;border-left:3px solid var(--rule);color:var(--dim)}
pre{overflow:auto;padding:14px 16px;border:2px solid var(--ink);background:transparent}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace}hr{border:0;border-top:1px solid var(--rule);margin:32px 0}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--rule);color:var(--dim);font-size:.88rem}
footer a{text-decoration:none;border-bottom:2px solid var(--ink);color:var(--ink)}
</style>
</head>
<body>
<main>
<p class="crumb">${esc(appName)}</p>
<h1>${esc(info.title)}</h1>
<p class="meta">Published by ${esc(who)} for the app "${esc(appName)}". Updated ${esc(updated)}.</p>
${renderMarkdownLite(doc.content)}
<footer>This page is written and published by the app's owner, ${esc(who)}, who answers for the app and for what this page says. The node it runs on, <a href="${esc(base)}/">${esc(base.replace(/^https?:\/\//, ''))}</a>, has its own <a href="${esc(base)}/v1/terms">terms</a> and <a href="${esc(base)}/v1/privacy">privacy notice</a>, which cover the node and not this app.</footer>
</main>
</body>
</html>
`;
  return { html };
}
