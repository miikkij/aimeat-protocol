/**
 * @file src/services/app-scope-allowance-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The record of the scope words an app kept when its node moved to 4.0: where it lives,
 *   its shape, and the reads the grant routes make (routes/app-grants.ts). A leaf, so the grant routes
 *   read it without importing the step and the owner's operations, which reach the app publish path
 *   (services/app-scope-allowance.ts).
 *
 *   ONE MEMORY RECORD PER APP, under the namespace APP_SCOPE_ALLOWANCE_NS, the literal string
 *   `app-scope-allowance`, which carries no `@` and so is no GHII, GAII or GEAI: no principal can
 *   address it through the memory API. The key is appScopeAllowanceKey(owner/filename), the same
 *   collision-free app segment the design spec uses (services/app-record-keys.ts).
 * @structure APP_SCOPE_ALLOWANCE_NS · allowanceAppId · appScopeAllowanceKey · AppScopeAllowance ·
 *   readAppScopeAllowance · appAllowanceWords · withAllowance · writeAppScopeAllowance
 * @usage const asked = withAllowance(requested, await appAllowanceWords(storage, 'alice/notes.html'));
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (ruling decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san).
 */
import type { Storage } from '../storage/interface.js';
import { localAccountName } from '../utils/gaii.js';
import { appKeySegment, equalAppId } from './app-record-keys.js';

/** The namespace the allowance records live under: the node's, not the owner's key budget. */
export const APP_SCOPE_ALLOWANCE_NS = 'app-scope-allowance';
export const APP_SCOPE_ALLOWANCE_SPEC = 'aimeat.app-scope-allowance/1';

/** `owner/filename` with the owner as a bare account name, as every grant and key reads it. */
export function allowanceAppId(target: string): string {
  const slash = target.indexOf('/');
  return slash <= 0 ? target : `${localAccountName(target.slice(0, slash))}/${target.slice(slash + 1)}`;
}

export const appScopeAllowanceKey = (appId: string): string => `appscopeallowance.${appKeySegment(allowanceAppId(appId))}`;

export interface AppScopeAllowance {
  spec: typeof APP_SCOPE_ALLOWANCE_SPEC;
  appId: string;
  /** The words in force. */
  words: string[];
  /** Words the owner took away; nothing adds them back. */
  removed: string[];
  /** Why each word was given: the code that calls the route, and where it is. */
  evidence: Array<{ word: string; source: string; evidence: string }>;
  at: string;
}

/** This app's allowance, or null when it has none. A portfolio target has none. */
export async function readAppScopeAllowance(storage: Storage, target: string): Promise<AppScopeAllowance | null> {
  if (!target.includes('/') || target.startsWith('portfolio:')) return null;
  const appId = allowanceAppId(target);
  const rec = await storage.getMemory(APP_SCOPE_ALLOWANCE_NS, appScopeAllowanceKey(appId));
  const v = rec?.value as AppScopeAllowance | undefined;
  return v && v.spec === APP_SCOPE_ALLOWANCE_SPEC && equalAppId(v.appId, appId) && Array.isArray(v.words) ? v : null;
}

/** The words this app keeps; none when it has no allowance. */
export async function appAllowanceWords(storage: Storage, target: string): Promise<string[]> {
  return (await readAppScopeAllowance(storage, target))?.words ?? [];
}

/** `scopes` and the allowance words it lacks, in that order. */
export function withAllowance(scopes: readonly string[], words: readonly string[]): string[] {
  return [...scopes, ...words.filter(w => !scopes.includes(w))];
}

/** Write the whole record. */
export async function writeAppScopeAllowance(storage: Storage, value: AppScopeAllowance): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: appScopeAllowanceKey(value.appId), ownerGaii: APP_SCOPE_ALLOWANCE_NS, value,
    visibility: 'private', tags: ['app-scope-allowance'],
    // Never swept: an allowance that expired would cut an app the step promised would keep working.
    ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
}
