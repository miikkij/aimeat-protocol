/**
 * @file src/services/app-roadmap.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What has been done to this app and what people wish would be, in one record beside
 *   it.
 *
 *   WHY IT CANNOT BE DERIVED. The version history says a version appeared. The audit log says which
 *   settings were touched. Neither says WHY, and neither carries a wish. On an app one person builds
 *   that gap is an inconvenience; on an app two people build it is the only channel between them,
 *   because they share no session, no chat and no calendar. Somebody publishes a version and the
 *   other one finds out that something changed and never what.
 *
 *   BESIDE THE APP, NOT INSIDE IT. Same reasoning as the data map, and the same shape: the text is
 *   prose, prose does not fit in a `meta` attribute, and it is corrected after the fact by whoever
 *   notices. The manifest carries a stamp so a listing can say "last written at version 12" without
 *   loading the entries.
 *
 *   TWO HALVES, TWO AUDIENCES. `done` is a changelog and it sells the app, so it is public. `wanted`
 *   is what is missing, which is a builder's conversation rather than a shop window, so it goes to
 *   the owner and the people building with them unless the owner opens it. Anybody who can see the
 *   app may LEAVE a wish; whether it stays is the owner's call, because a wish list nobody prunes is
 *   a wish list nobody reads.
 * @structure
 *   - AppRoadmap / AppRoadmapEntry / APP_ROADMAP_SPEC — the record
 *   - appRoadmapKey / readAppRoadmap / writeAppRoadmap — storage
 *   - addRoadmapEntry / removeRoadmapEntry / setWantedVisibility — the changes
 *   - publicRoadmap / roadmapStamp — what a reader outside the build sees, and the manifest's copy
 * @usage
 *   const road = await readAppRoadmap(storage, ownerGhii, appId);
 *   await addRoadmapEntry(storage, { ownerGhii, appId, state: 'done', what: 'The login pill fits a phone.', by, version });
 * @version-history
 *   v1.0.0 — 2026-09-08 — Initial. Phase 5 of the shared-app work.
 */
import type { Storage } from '../storage/interface.js';
import { randomUUID } from 'node:crypto';
import { appKeySegment, readAppRecord, equalAppId } from './app-record-keys.js';

export const APP_ROADMAP_SPEC = 'aimeat.approadmap/1' as const;

/** Separate capacity for each half: wishes cannot evict the changelog. */
export const APP_ROADMAP_MAX = 300;

/** The platform's own namespace, so the record is not writable through the memory API. */
const NS_ROADMAP = 'app-roadmap';

export interface AppRoadmapEntry {
  /** Short, stable, and unique within one app. */
  id: string;
  /** `done` is a changelog line. `wanted` is somebody asking for something. */
  state: 'done' | 'wanted';
  /** One sentence in a person's own words. This is the whole value of the record. */
  what: string;
  /** The account that wrote it. */
  by: string;
  at: string;
  /** For a `done` line: the published version it landed in. */
  version?: number;
}

export interface AppRoadmap {
  spec: typeof APP_ROADMAP_SPEC;
  appId: string;
  entries: AppRoadmapEntry[];
  /**
   * Who sees the wishes. `developers` (the default) means the owner and whoever holds a development
   * right; `everyone` opens them to anybody who can see the app. The done half is public either way.
   */
  wantedVisibility: 'developers' | 'everyone';
  updatedAt: string;
}

/** What a listing carries, so it never has to load the entries to say when this was last written. */
export interface AppRoadmapStamp {
  at: string;
  /** The app version the last `done` line was written against. */
  version: number;
  done: number;
  wanted: number;
}

export const appRoadmapKey = (appId: string) =>
  `approadmap.${appKeySegment(appId)}`;

/** This app's roadmap, or null when nobody has written one. Null is a real answer. */
export async function readAppRoadmap(storage: Storage, appId: string): Promise<AppRoadmap | null> {
  const rec = await readAppRecord(storage, NS_ROADMAP, appRoadmapKey(appId), appId);
  const v = rec?.value as AppRoadmap | undefined;
  if (!v || v.spec !== APP_ROADMAP_SPEC || !equalAppId(v.appId, appId)) return null;
  return v;
}

/** Retry the change against the current record; never acknowledge a lost update. */
async function changeRoadmap(storage: Storage, appId: string, change: (road: AppRoadmap) => void): Promise<AppRoadmap> {
  if (!storage.createMemoryIfAbsent || !storage.setMemoryIfVersion) throw new Error('Roadmap writes require atomic storage.');
  for (let attempt = 0; attempt < 40; attempt++) {
    const existing = await readAppRecord(storage, NS_ROADMAP, appRoadmapKey(appId), appId);
    const road = existing ? structuredClone(existing.value as AppRoadmap) : emptyRoadmap(appId);
    change(road);
    road.updatedAt = new Date().toISOString();
    const record = {
      key: appRoadmapKey(appId), ownerGaii: NS_ROADMAP, value: road,
      visibility: 'private' as const, tags: ['app-roadmap'], ttlHours: null,
      version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? road.updatedAt, updatedAt: road.updatedAt,
    };
    const saved = existing
      ? await storage.setMemoryIfVersion(record, existing.version)
      : await storage.createMemoryIfAbsent(record);
    if (saved) return road;
  }
  throw new Error('Roadmap changed repeatedly. Retry this operation.');
}

/** A fresh, empty roadmap for an app that has none yet. */
function emptyRoadmap(appId: string): AppRoadmap {
  return {
    spec: APP_ROADMAP_SPEC, appId, entries: [],
    wantedVisibility: 'developers', updatedAt: new Date().toISOString(),
  };
}

const nextId = () => randomUUID();

/**
 * Add a line. Returns the whole roadmap, because that is what a caller renders next.
 *
 * The cap drops the OLDEST `done` lines and never a wish: a changelog is worth less the further back
 * it goes, and a wish that scrolled off is a request somebody made that nobody will ever see again.
 */
export async function addRoadmapEntry(
  storage: Storage,
  input: { appId: string; state: AppRoadmapEntry['state']; what: string; by: string; version?: number },
): Promise<AppRoadmap> {
  const entry: AppRoadmapEntry = {
    id: nextId(), state: input.state, what: input.what.trim().slice(0, 600),
    by: input.by, at: new Date().toISOString(),
    ...(typeof input.version === 'number' ? { version: input.version } : {}),
  };
  if (entry.what.length < 3) throw new Error('A roadmap entry needs at least three characters.');
  return changeRoadmap(storage, input.appId, road => {
    if (entry.state === 'wanted' && road.entries.filter(e => e.state === 'wanted').length >= APP_ROADMAP_MAX) {
      throw Object.assign(new Error('The wish list is full. Withdraw or complete an existing wish first.'), { status: 409 });
    }
    const entries = [entry, ...road.entries];
    let done = 0;
    road.entries = entries.filter(e => e.state === 'wanted' || ++done <= APP_ROADMAP_MAX);
  });
}

/** Take one line off. Returns whether there was one. */
export async function removeRoadmapEntry(storage: Storage, appId: string, entryId: string): Promise<boolean> {
  let removed = false;
  await changeRoadmap(storage, appId, road => {
    removed = road.entries.some(e => e.id === entryId);
    road.entries = road.entries.filter(e => e.id !== entryId);
  });
  return removed;
}

/** Open the wishes to everybody, or close them again. */
export async function setWantedVisibility(
  storage: Storage, appId: string, visibility: AppRoadmap['wantedVisibility'],
): Promise<AppRoadmap> {
  return changeRoadmap(storage, appId, road => { road.wantedVisibility = visibility; });
}

/**
 * What somebody outside the build sees.
 *
 * The done half always; the wanted half only when the owner opened it. Stripped on the way OUT
 * rather than stored twice, because the record is the owner's own and a second copy is a second
 * thing to keep true.
 */
export function publicRoadmap(road: AppRoadmap | null): AppRoadmap | null {
  if (!road) return null;
  if (road.wantedVisibility === 'everyone') return road;
  return { ...road, entries: road.entries.filter(e => e.state === 'done') };
}

/** The manifest's copy: enough for a listing, never the prose. */
export function roadmapStamp(road: AppRoadmap | null): AppRoadmapStamp | undefined {
  if (!road) return undefined;
  const done = road.entries.filter(e => e.state === 'done');
  return {
    at: road.updatedAt,
    version: done[0]?.version ?? 0,
    done: done.length,
    wanted: road.entries.length - done.length,
  };
}

/**
 * Did this publish say what it changed?
 *
 * A WARNING on your own app and a REFUSAL on somebody else's, and the split is the whole decision.
 * Decision D2 says not to fail a publish over a practice whose only beneficiary is the publisher —
 * a publish that fails is a publish that gets worked around, and the app then ships with less care
 * rather than more. That reasoning holds exactly as long as the person who loses by the omission is
 * the person who made it. On a shared app it is somebody else, who has no other way to learn what
 * happened to the thing they are also building.
 *
 * The line travels in the publish call itself, so satisfying this costs no extra round trip. A gate
 * that costs one is a gate that gets worked around, and then we are back in D2.
 */
export function roadmapGate(input: { line: string | undefined; shared: boolean }):
  | { ok: true; line: string }
  | { ok: true; line: null; warning: string }
  | { ok: false; message: string } {
  const line = typeof input.line === 'string' ? input.line.trim() : '';
  if (line && line.length < 3) return { ok: false, message: 'The roadmap line needs at least three characters.' };
  if (line) return { ok: true, line };
  if (input.shared) {
    return {
      ok: false,
      message: 'This app is built by more than one person, so a publish says what changed. '
        + 'Send `roadmap` with one sentence in your own words: the people building it with you have no other way to find out.',
    };
  }
  return {
    ok: true, line: null,
    warning: 'No roadmap line was carried, so this version is not on the app\'s roadmap. '
      + 'Send `roadmap` with one sentence next time; on an app somebody else helps build, it is required.',
  };
}
