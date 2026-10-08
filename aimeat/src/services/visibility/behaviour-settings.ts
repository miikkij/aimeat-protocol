/**
 * @file src/services/visibility/behaviour-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's on-page behaviour settings (AI visibility, layer D), one record
 *   (`signals.behaviour.settings`): the apps that get no behaviour script, and whether the weekly
 *   fixing agent runs. Absent means every app counts and the fixing agent is off.
 *
 *   THE FIXING AGENT IS OFF UNTIL THE OWNER SWITCHES IT ON, because each run spends the owner's AI
 *   credit. Counting is on by default, like the rest of the visibility counts: it keeps aggregates
 *   only, and the owner switches it off per app.
 *
 *   READ ON EVERY APP SERVE AND EVERY BEACON, SO IT IS CACHED for SETTINGS_TTL_MS; a change made on
 *   this process is seen at once.
 * @structure getBehaviourSettings · setBehaviourSettings · cachedBehaviourSettings · nodeWatchesBehaviour ·
 *   behaviourOnFor · BehaviourSettingsError · resetBehaviourSettingsCache (tests)
 * @usage if (await behaviourOnFor(storage, config, ownerGhii, filename)) html += behaviourSnippet(...);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import {
  BEHAVIOUR_SETTINGS_KEY, defaultBehaviourSettings, type BehaviourSettings,
} from '../../models/behaviour-schemas.js';
import { cachedVisibilitySettings } from './visibility-settings.js';

const SETTINGS_TTL_MS = 60_000;
/** An owner's list of switched-off apps is at most this long. */
const MAX_OFF_APPS = 500;

export class BehaviourSettingsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'BehaviourSettingsError';
  }
}

interface Cached { settings: BehaviourSettings; until: number }
const cache = new Map<string, Cached>();

function normalize(value: Partial<BehaviourSettings> | undefined): BehaviourSettings {
  const d = defaultBehaviourSettings();
  return {
    offApps: Array.isArray(value?.offApps) ? value.offApps.filter((a): a is string => typeof a === 'string').slice(0, MAX_OFF_APPS) : d.offApps,
    fixer: value?.fixer === true,
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : '',
  };
}

/** Whether the operator left layer D on for the node. On unless set to false. */
export const nodeWatchesBehaviour = (config: AimeatConfig): boolean =>
  config.behaviourEnabled !== false && config.aiVisibilityEnabled !== false;

export async function getBehaviourSettings(storage: Storage, ownerGhii: string): Promise<BehaviourSettings> {
  const row = await storage.getMemory(ownerGhii, BEHAVIOUR_SETTINGS_KEY);
  return normalize(row?.value as Partial<BehaviourSettings> | undefined);
}

export interface BehaviourSettingsInput {
  /** The app to switch on or off, by filename, with `appEnabled`. */
  app?: string;
  appEnabled?: boolean;
  fixer?: boolean;
}

/** Change the owner's settings. Only the fields given change. */
export async function setBehaviourSettings(
  storage: Storage, ownerGhii: string, input: BehaviourSettingsInput,
): Promise<BehaviourSettings> {
  if ((input.app === undefined) !== (input.appEnabled === undefined)) {
    throw new BehaviourSettingsError('INVALID_INPUT', 'Give app and app_enabled together: the app\'s filename, and true to count it or false to stop.');
  }
  if (input.app !== undefined && !(await storage.getApp(ownerGhii, input.app))) {
    throw new BehaviourSettingsError('NOT_FOUND', `You have no app named ${input.app}.`);
  }
  const row = await storage.getMemory(ownerGhii, BEHAVIOUR_SETTINGS_KEY);
  const existing = normalize(row?.value as Partial<BehaviourSettings> | undefined);
  let offApps = existing.offApps;
  if (input.app !== undefined) {
    offApps = offApps.filter((a) => a !== input.app);
    if (input.appEnabled === false) offApps = [...offApps, input.app].slice(-MAX_OFF_APPS);
  }
  const now = new Date().toISOString();
  const settings: BehaviourSettings = { offApps, fixer: input.fixer ?? existing.fixer, updatedAt: now };
  await storage.setMemory({
    key: BEHAVIOUR_SETTINGS_KEY, ownerGaii: ownerGhii,
    value: settings as unknown as Record<string, unknown>,
    visibility: 'owner', tags: ['signal-visibility'], ttlHours: null,
    version: (row?.version ?? 0) + 1, createdAt: row?.createdAt ?? now, updatedAt: now,
  } as MemoryRecord);
  cache.set(ownerGhii, { settings, until: Date.now() + SETTINGS_TTL_MS });
  return settings;
}

export async function cachedBehaviourSettings(storage: Storage, ownerGhii: string): Promise<BehaviourSettings> {
  const hit = cache.get(ownerGhii);
  if (hit && hit.until > Date.now()) return hit.settings;
  const settings = await getBehaviourSettings(storage, ownerGhii);
  if (cache.size > 10_000) cache.clear();
  cache.set(ownerGhii, { settings, until: Date.now() + SETTINGS_TTL_MS });
  return settings;
}

/**
 * Whether this app's pages carry the behaviour script and its beacons count: the operator's switch,
 * the owner's visibility switch (layer A, which turns every count off), and the app's own switch.
 */
export async function behaviourOnFor(storage: Storage, config: AimeatConfig, ownerGhii: string, filename: string): Promise<boolean> {
  if (!nodeWatchesBehaviour(config)) return false;
  if (!(await cachedVisibilitySettings(storage, ownerGhii)).enabled) return false;
  return !(await cachedBehaviourSettings(storage, ownerGhii)).offApps.includes(filename);
}

/** Test seam. */
export function resetBehaviourSettingsCache(): void {
  cache.clear();
}
