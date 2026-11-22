/**
 * @file src/services/app/organism-wall.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism's own app wall: the apps its members opened to the organism, for its
 *   members, with what each is made of and how much it is used. GET /v1/organisms/:id/apps and the
 *   MCP tool aimeat_organism_apps answer with it.
 *
 *   WHY (Jouni, 2026-11-16). In a Claude + AIMEAT training everyone builds an app in an hour, and an
 *   app opened only to the company's organism showed in no list: the public announcement and the
 *   front page wall take public apps only, and the App Catalog's community list is the whole node.
 *   "Jonkinlainen ilmoitustaulu puuttuu jota voisi katsella ja fiilistellä eri kulmista." The wall
 *   shows opens and activity, never stars or a popularity order: no ranking of people
 *   (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul). A training is an organism
 *   of its own with an invitation link, so "today's training" is this wall of that organism, in the
 *   order the apps were finished (decision-uusi-sis-ntulo-kysymykset-profiilista-ja-koulutus-omana-orga).
 *
 *   WHAT A MEMBER SEES. Every app whose access is `organism:<id>`, latest version, from any owner,
 *   except one its owner made unlisted or the operator hid (the signed-in listing rules,
 *   AppListOptions.viewerGhii with includeCommunity). Per app: the opens since it was published
 *   (the same count the App Catalog shows everyone), the opens today as one number (a day's
 *   rollup, summed over every viewer, so no person who opened it is named), the author's teams,
 *   and the capabilities it is made of: the served libraries and cortexes its source loads and its
 *   extensions (services/dependency-map.ts), by their titles in the reader's language.
 * @structure WALL_LIMIT · WallApp · OrganismWall · organismWall(deps, who, organismId, lang)
 * @usage const out = await organismWall({ storage, config }, { sub, owner }, orgId, 'fi');
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-organisaation-oma-appisein-kollegoiden-apit-n-kyviin-eri-kul).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { organismMemberGate } from '../organism-read/member.js';
import { dependencyIndex } from '../dependency-map.js';
import { getLibraryPackIndex } from '../../data/library-packs.js';
import { queryUsageRollupLive } from '../usage/usage-read.js';
import { listTeamsOf } from '../team/status.js';
import { teamDisplayName } from '../team/record.js';
import { resolveAppUrls } from './urls.js';
import { logger } from '../../utils/logger.js';
import { toLocale } from '../../i18n.js';

/** The most apps one wall lists: a training of a hundred people, with room. */
export const WALL_LIMIT = 300;
/** The most authors whose teams are read for one wall. */
const TEAM_AUTHORS = 200;

export interface WallCapability { id: string; title: string; kind: 'library' | 'cortex' | 'extension' }

export interface WallApp {
  owner: string;
  filename: string;
  name: string;
  description: string;
  icon: string | null;
  url: string | null;
  /** When the latest version was published. */
  published_at: string;
  /** Opens since the app was first published (the App Catalog's count). */
  opens: number;
  /** Opens today (UTC day), summed over every viewer. */
  opens_today: number;
  /** The author's teams, in the reader's language. */
  teams: string[];
  capabilities: WallCapability[];
}

export interface OrganismWall { organism: { id: string; name: string }; apps: WallApp[]; day: string }

export type WallResult =
  | { ok: true; wall: OrganismWall }
  | { ok: false; status: 403 | 404; code: 'ACCESS_DENIED' | 'NOT_FOUND'; message: string };

/**
 * The wall of `organismId` for `who`: `sub` is the resolved principal (resolveIdentity, so an agent
 * attached to the organism reads it too) and `owner` the owner's account name. Refused for a non-member.
 */
export async function organismWall(
  deps: { storage: Storage; config: AimeatConfig },
  who: { sub?: string; owner?: string },
  organismId: string,
  langAsked: string,
): Promise<WallResult> {
  const { storage, config } = deps;
  const lang = toLocale(langAsked);
  const gate = await organismMemberGate(storage, organismId, who);
  if (!gate.ok) {
    return gate.code === 'NOT_FOUND'
      ? { ok: false, status: 404, code: 'NOT_FOUND', message: 'There is no such organism.' }
      : { ok: false, status: 403, code: 'ACCESS_DENIED', message: 'The app list of an organism is for its members.' };
  }
  const viewerGhii = who.owner ? (who.owner.includes('@') ? who.owner : `${who.owner}@${config.nodeId}`) : undefined;
  const { apps } = await storage.listApps({
    access: `organism:${organismId}`, viewerGhii, includeCommunity: true, limit: WALL_LIMIT,
  });
  const day = new Date().toISOString().slice(0, 10);
  if (apps.length === 0) return { ok: true, wall: { organism: { id: organismId, name: gate.organism.name }, apps: [], day } };

  const refs = apps.map(a => ({ ownerGaii: a.ownerGaii, filename: a.filename }));
  const [downloads, index, urls, today] = await Promise.all([
    storage.getAppDownloadsForApps(refs),
    dependencyIndex(storage),
    resolveAppUrls(config, storage, apps.map(a => ({ owner: a.ownerName, filename: a.filename }))),
    opensToday(storage, day, new Set(apps.map(a => `${a.ownerName}/${a.filename}`))),
  ]);

  const titles = new Map(getLibraryPackIndex(lang).map(p => [p.id, p.title]));
  const teamsOf = await authorTeams(storage, [...new Set(apps.map(a => a.ownerName))].slice(0, TEAM_AUTHORS), lang);

  const wall: WallApp[] = apps.map(a => {
    const ref = `${a.ownerName}/${a.filename}`;
    const req = index.byApp.get(ref);
    const capabilities: WallCapability[] = [
      ...(req?.packs ?? []).map(p => ({ id: p.name, title: titles.get(p.name) ?? p.name, kind: 'library' as const })),
      ...(req?.cortex ?? []).map(c => ({ id: c.name, title: titles.get(c.name) ?? c.name, kind: 'cortex' as const })),
      ...(req?.extensions ?? []).map(e => ({ id: e.name, title: e.name, kind: 'extension' as const })),
    ];
    const manifest = a.manifest as { name?: string; description?: string; icon?: string };
    return {
      owner: a.ownerName,
      filename: a.filename,
      name: manifest.name || a.filename,
      description: manifest.description || '',
      icon: typeof manifest.icon === 'string' ? manifest.icon : null,
      url: urls[ref] ?? null,
      published_at: a.createdAt,
      opens: downloads[`${a.ownerGaii} ${a.filename}`] ?? 0,
      opens_today: today.get(ref) ?? 0,
      teams: teamsOf.get(a.ownerName) ?? [],
      capabilities,
    };
  });
  return { ok: true, wall: { organism: { id: organismId, name: gate.organism.name }, apps: wall, day } };
}

/**
 * Opens today per app, from the day rollup of opens by viewer (cut `call.app.visitor`), summed over
 * every viewer and kept only for the apps on this wall. Only the sum leaves this function, so no
 * person who opened an app is named. A failed read answers no counts rather than failing the wall.
 */
async function opensToday(storage: Storage, day: string, apps: Set<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const rows = await queryUsageRollupLive(storage, { cut: 'call.app.visitor', grain: 'day', from: day, to: day, limit: 20_000 }, 'call');
    for (const r of rows) {
      if (r.surface !== 'app' || !apps.has(r.appId)) continue;
      out.set(r.appId, (out.get(r.appId) ?? 0) + (r.calls ?? 0));
    }
  } catch (err) {
    logger.warn('[organism-wall] the opens of today could not be read; the list shows none', { error: String(err) });
  }
  return out;
}

/** Each author's teams (organisms with a team record they are an active member of), by name in `lang`. */
async function authorTeams(storage: Storage, authors: string[], lang: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  await Promise.all(authors.map(async (author) => {
    try {
      const teams = await listTeamsOf(storage, author);
      out.set(author, teams.map(t => teamDisplayName(t.team, lang, t.organism.name)));
    } catch (err) {
      logger.warn('[organism-wall] an author\'s teams could not be read', { author, error: String(err) });
    }
  }));
  return out;
}
