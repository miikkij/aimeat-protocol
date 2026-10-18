/**
 * @file src/services/exposure/sources-places.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exposure sources for the places a person opens to others: hosted apps, workspace
 *   shares, organisms, boards, the portfolio page and company front pages (plan doc-mvcn6c7e4e5q,
 *   V6.1).
 *
 *   EACH KIND IS DECIDED BY THE RULE THAT SERVES IT, not by a copy of it:
 *
 *   - An app: an access code shuts everyone out who lacks it, so such an app is not counted, and an
 *     app an operator hid is served to nobody. Otherwise the app's own `open_to` (`access` on the
 *     record, read by services/app-access.ts appAccessOf) names who opens it: signed-in or one
 *     organism; for 'anyone' a listed app is public, and a community or unlisted app opens for anyone
 *     holding its address (services/app-visibility.ts: "a link opens the app in all three").
 *     The node's own signed-in setting is applied to every kind by the report.
 *   - A workspace share: what the share routes hand an anonymous visitor, asked of their own
 *     collectors (services/workspace-public-collectors.ts) with the anonymous classification reader,
 *     as services/share-provenance.ts does. An open share is 'link', an account share 'signed-in'.
 *     A password share is not counted: a stranger needs the password too.
 *   - An organism: its visibility, and its member roster when the roster is set public.
 *   - The welcome page while it is switched on, and a company front page while the address serves
 *     something: their own `access` (services/page-access.ts pageAccessLevel) names who opens them.
 *
 *   Who a share or an organism belongs to: an organism counts for the people who hold it
 *   (services/organism-ownership.ts); a workspace share for its workspace's creator and for the
 *   organism's creator, owners and admins, because each of them can close it.
 * @structure appSource · workspaceShareSource · organismSource · boardSource · portfolioSource · companySource
 * @usage import { appSource } from './sources-places.js';
 * @version-history
 *   v1.1.0 — 2026-10-18 — The welcome page and a company front page are counted at the level their
 *     `access` names (signed-in or one organism), not always public (V3.10).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V6.1).
 */
import type { OrganismRecord } from '../../storage/interface.js';
import { appListingOf, type AppRecord } from '../../storage/types/apps.js';
import { appAccessOf } from '../app-access.js';
import { resolveAppUrls } from '../app-urls.js';
import { readShareMetaOf, publicViewerPath } from '../workspace-share.js';
import { createPublicCollectors } from '../workspace-public-collectors.js';
import { readerFor } from '../classification/reader.js';
import { workspaceRegistrations } from '../workspace-meta-read.js';
import { isOrganismOwner } from '../organism-ownership.js';
import { companyAddress } from '../company/company-service.js';
import { listPublishedMembers } from '../portfolio-members.js';
import { portfolioSwitchState } from '../portfolio-config.js';
import { pageAccessLevel } from '../page-access.js';
import {
  type ExposureContext, type ExposureItem, type ExposureLevel, type ExposureSource,
  levelOfVisibility, ownerIdentities,
} from './exposure-types.js';

const enc = encodeURIComponent;

/**
 * The level the app's own `open_to` names (services/app-access.ts appAccessOf), or 'listing' when it
 * is 'anyone' and the listing decides. The node's own signed-in setting is applied by the report.
 */
function appAccessLevel(app: Pick<AppRecord, 'access'>): { level: ExposureLevel; organism_id?: string } | 'listing' {
  const own = appAccessOf(app);
  if (own === 'anyone') return 'listing';
  if (own === 'signed-in') return { level: 'signed-in' };
  return { level: 'organism', organism_id: own.slice('organism:'.length) };
}

export const appSource: ExposureSource = {
  kind: 'app',
  async list(ctx, ownerName, ownerGhii) {
    const { apps } = await ctx.storage.listApps({ ownerGaii: ownerGhii, viewerGhii: ownerGhii, limit: 1000 });
    const seen = new Set<string>();
    const open: Array<{ filename: string; title: string; level: ExposureLevel; organism_id?: string }> = [];
    for (const app of apps) {
      if (seen.has(app.filename)) continue;
      seen.add(app.filename);
      if (app.accessCode || app.operatorHidden) continue;
      const access = appAccessLevel(app);
      const lv = access === 'listing'
        ? { level: (appListingOf(app) === 'listed' ? 'public' : 'link') as ExposureLevel }
        : access;
      const name = (app.manifest as { name?: unknown } | undefined)?.name;
      open.push({ filename: app.filename, title: typeof name === 'string' && name ? name : app.filename, ...lv });
    }
    const urls = await resolveAppUrls(ctx.config, ctx.storage, open.map(a => ({ owner: ownerName, filename: a.filename })));
    return open.map(({ filename, title, ...lv }): ExposureItem => {
      const url = urls[`${ownerName}/${filename}`];
      return {
        kind: 'app', id: filename, title, ...lv, ...(url ? { url } : {}),
        how_to_close: lv.level === 'public'
          ? `Take it off every list with aimeat_app_manage (action "settings", listing "unlisted"), and choose who may open it there: open_to "signed-in" or "organism:<id>", or an access_code (PATCH /v1/apps/${enc(filename)}); aimeat_app_delete removes it.`
          : `Choose who may open it with aimeat_app_manage (action "settings"): open_to "organism:<id>" for one organisation, or an access_code so only people with the code open it (PATCH /v1/apps/${enc(filename)}); aimeat_app_delete removes it.`,
      };
    });
  },
};

/** One organism the person belongs to, with their active role in it. */
interface Belonging { org: OrganismRecord; role: string }

/** The organisms the person is an active member of. Membership rows name the bare account; older ones the GHII. */
function organismsOf(ctx: ExposureContext, ownerName: string, ownerGhii: string): Promise<Belonging[]> {
  return ctx.memo(`orgs:${ownerName}`, async () => {
    const rows = [...await ctx.storage.listMembershipsByGhii(ownerName), ...await ctx.storage.listMembershipsByGhii(ownerGhii)];
    const out: Belonging[] = [];
    const seen = new Set<string>();
    for (const m of rows) {
      if (m.status !== 'active' || seen.has(m.organismId)) continue;
      seen.add(m.organismId);
      const org = await ctx.memo(`org:${m.organismId}`, () => ctx.storage.getOrganism(m.organismId));
      if (org) out.push({ org, role: m.role });
    }
    return out;
  });
}

/** What one workspace's share hands to a visitor, read once per run. Null: nothing is shared, or only behind a password. */
interface Served { level: ExposureLevel; pages: Array<{ type: string; id: string; title: string }> }

function servedByShare(ctx: ExposureContext, orgId: string, ws: string): Promise<Served | null> {
  return ctx.memo(`share:${orgId}/${ws}`, async () => {
    const share = await readShareMetaOf(ctx.storage, ctx.config, orgId, ws);
    if (share.access === 'password') return null;
    const anyOpen = share.public || Object.values(share.spaces).some(Boolean) || Object.values(share.docs).some(Boolean);
    if (!anyOpen) return null;
    // The share routes' own collectors, released to the anonymous reader: what a visitor is handed.
    const C = createPublicCollectors(ctx.storage, ctx.config);
    const anonymous = readerFor({ storage: ctx.storage, config: ctx.config }, null);
    const docs = await (await C.collectPublicDocs(orgId, ws, share)).release(anonymous);
    const records = await (await C.collectPublicRecords(orgId, ws, share)).release(anonymous);
    return {
      level: share.access === 'account' ? 'signed-in' : 'link',
      pages: [
        ...docs.map(d => ({ type: d.type, id: d.id, title: d.title })),
        ...records.map(r => ({ type: r.type, id: r.id, title: `${r.type} ${r.id}` })),
      ],
    };
  });
}

export const workspaceShareSource: ExposureSource = {
  kind: 'workspace_share',
  async list(ctx, ownerName, ownerGhii) {
    const out: ExposureItem[] = [];
    for (const { org, role } of await organismsOf(ctx, ownerName, ownerGhii)) {
      const manager = role === 'creator' || role === 'admin' || isOrganismOwner(org, ownerName);
      const regs = await ctx.memo(`regs:${org.id}`, () => workspaceRegistrations(ctx.storage, org.id));
      for (const [ws, reg] of regs) {
        if (!manager && reg.creator !== ownerName) continue;
        const served = await servedByShare(ctx, org.id, ws);
        if (!served) continue;
        const wsName = reg.entry.name || ws;
        for (const p of served.pages) {
          out.push({
            kind: 'workspace_share', id: `${org.id}/${ws}/${p.type}/${p.id}`,
            title: `${org.name} / ${wsName}: ${p.title}`, level: served.level,
            url: `${ctx.base}${publicViewerPath(org.id, ws, p.type, p.id)}`,
            how_to_close: `Stop sharing it with aimeat_workspace_share (organism_id "${org.id}", ws "${ws}", space "${p.type}", id "${p.id}", shared false), or PUT /v1/organisms/${enc(org.id)}/workspace/share?ws=${enc(ws)} with {"docs":{"${p.type}/${p.id}":false}}.`,
          });
        }
      }
    }
    return out;
  },
};

export const organismSource: ExposureSource = {
  kind: 'organism',
  async list(ctx, ownerName, ownerGhii) {
    const out: ExposureItem[] = [];
    for (const { org } of await organismsOf(ctx, ownerName, ownerGhii)) {
      if (!isOrganismOwner(org, ownerName)) continue;
      if (org.visibility === 'public' || org.visibility === 'listed') {
        out.push({
          kind: 'organism', id: org.id, title: org.name, level: 'public', url: `${ctx.base}/v1/organisms/${enc(org.id)}`,
          how_to_close: `Make it private with aimeat_organism_update and visibility "private" (PUT /v1/organisms/${enc(org.id)} with {"visibility":"private"}).`,
        });
      }
      if (org.memberVisibility === 'public') {
        out.push({
          kind: 'organism', id: `${org.id}#members`, title: `Who belongs to ${org.name}`, level: 'public',
          url: `${ctx.base}/v1/organisms/${enc(org.id)}/members`,
          how_to_close: `Show the member list to signed-in people only with PUT /v1/organisms/${enc(org.id)} and {"member_visibility":"authenticated"}.`,
        });
      }
    }
    return out;
  },
};

export const boardSource: ExposureSource = {
  kind: 'board',
  async list(ctx, ownerName, ownerGhii) {
    const ids = new Set((await ownerIdentities(ctx, ownerName, ownerGhii)).all);
    const boards = await ctx.memo('boards', () => ctx.storage.listBoards());
    const out: ExposureItem[] = [];
    for (const b of boards) {
      if (!ids.has(b.ownerGaii)) continue;
      const lv = levelOfVisibility(b.visibility);
      if (!lv) continue;
      out.push({
        kind: 'board', id: b.id, title: b.name, ...lv, url: `${ctx.base}/v1/boards/${enc(b.id)}/posts`,
        how_to_close: `Close it with PATCH /v1/boards/${enc(b.id)}/visibility and {"visibility":"private"}, or remove it with aimeat_board_delete.`,
      });
    }
    return out;
  },
};

export const portfolioSource: ExposureSource = {
  kind: 'portfolio',
  async list(ctx, ownerName) {
    // The members whose page is switched on, as the member showcase reads them
    // (services/portfolio-members.ts, the same candidates resolvePublishedPortfolio serves from).
    const published = await ctx.memo('portfolios', () => listPublishedMembers(ctx.storage));
    if (!published.some(m => m.username === ownerName)) return [];
    // Who may open it: the page's own `access` (services/page-access.ts), as the portfolio origin reads it.
    const lv = pageAccessLevel((await portfolioSwitchState(ctx.storage, ownerName, ctx.config.nodeId)).access);
    return [{
      kind: 'portfolio', id: ownerName, title: 'Your welcome page', ...lv,
      url: `${ctx.base}/v1/portfolio/${enc(ownerName)}`,
      how_to_close: lv.level === 'public'
        ? 'Choose who may open it with aimeat_portfolio_publish (access "signed-in" or "organism:<id>"), or switch the page off with PUT /v1/portfolio/config and {"enabled":false}.'
        : 'Switch the page off with PUT /v1/portfolio/config and {"enabled":false}, or narrow who may open it with aimeat_portfolio_publish (access "organism:<id>").',
    }];
  },
};

export const companySource: ExposureSource = {
  kind: 'company',
  async list(ctx, _ownerName, ownerGhii) {
    const companies = await ctx.storage.listCompanies({ ownerGhii, limit: 1000 });
    const out: ExposureItem[] = [];
    for (const c of companies) {
      if (c.status !== 'active' || c.frontPage.kind === 'none') continue;
      const url = companyAddress(ctx.config, c);
      out.push({
        kind: 'company', id: c.id, title: c.name, ...pageAccessLevel(c.frontPageAccess), ...(url ? { url } : {}),
        how_to_close: `Choose who may open it with aimeat_company_front_page (access "signed-in" or "organism:<id>"), or stop serving the company's address with kind "none" (PUT /v1/companies/${enc(c.id)}/front-page with {"kind":"none"}).`,
      });
    }
    return out;
  },
};
