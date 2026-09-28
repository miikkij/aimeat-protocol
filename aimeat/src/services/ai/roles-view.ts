/**
 * @file roles-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GET /v1/ai/roles and aimeat_ai_roles show (services/ai/roles.ts): the owner's roles
 *   with when each was last used, and the AI roles apps declare, each with the owner's binding (or
 *   none yet) and whether the app has already asked for it. The apps are the owner's own that declare
 *   roles, the ones they have bound, and the ones that asked for an unbound role.
 * @structure aiRolesView · knownRoleProviders
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { providersForOwner } from './provider-store.js';
import { appAiMetaOf } from './policy-store.js';
import { readRoles, rolesWithLegacy, readRolesUsed, readRoleRequests, bindingKey, type OwnerRole } from './roles.js';
import type { AppAiRole } from '../app-ai-roles.js';

export interface AppRoleView extends AppAiRole {
  /** `<app>#<name>`: the key a binding is stored under. */
  binding: string;
  /** The owner's role it runs as, or null while it does not run. */
  boundTo: string | null;
  lastUsedAt?: string;
  /** When the app last asked for it while it was unbound. */
  requestedAt?: string;
}

export interface AiRolesView {
  roles: Array<OwnerRole & { legacy?: boolean; lastUsedAt?: string }>;
  apps: Array<{ app: string; roles: AppRoleView[] }>;
}

export async function aiRolesView(storage: Storage, config: AimeatConfig, gaii: string): Promise<AiRolesView> {
  // Each read inside an async function, so a storage that throws before returning a promise rejects
  // this call rather than leaving a sibling's rejection unhandled (as provider-store.ts does).
  const [record, used, requests, providers, prefsRec] = await Promise.all([
    readRoles(storage, gaii), readRolesUsed(storage, gaii), readRoleRequests(storage, gaii),
    providersForOwner(storage, config, gaii), (async () => storage.getMemory(gaii, 'openrouter.settings'))(),
  ]);
  const prefs = (prefsRec?.value as Record<string, unknown>) ?? {};
  const roles = Object.values(rolesWithLegacy(record, prefs, providers))
    .sort((a, b) => Number(!!b.builtIn) - Number(!!a.builtIn) || a.id.localeCompare(b.id))
    .map((r) => ({ ...r, ...(used[r.id] ? { lastUsedAt: used[r.id] } : {}) }));

  // Which apps: the owner's own that declare roles, the ones with a binding, the ones that asked.
  const addresses = new Set<string>();
  try {
    const { apps } = await storage.listApps({ ownerGaii: gaii, viewerGhii: gaii, limit: 1000 });
    for (const a of apps) if (a.manifest?.aiPosture?.roles?.length) addresses.add(`${a.ownerName}/${a.filename}`);
  } catch (err) {
    logger.warn('[ai] could not list the owner\'s apps for their AI roles', { gaii, error: String(err) });
  }
  for (const k of [...Object.keys(record.bindings), ...Object.keys(requests)]) addresses.add(k.slice(0, k.lastIndexOf('#')));

  const apps: AiRolesView['apps'] = [];
  for (const app of [...addresses].sort()) {
    const meta = await appAiMetaOf(storage, gaii, app);
    const declared = new Map<string, AppAiRole>((meta?.roles ?? []).map((r) => [r.name, r]));
    // A binding or a request whose app no longer declares the role still shows, so it can be removed.
    for (const k of [...Object.keys(record.bindings), ...Object.keys(requests)]) {
      const name = k.slice(k.lastIndexOf('#') + 1);
      if (k.startsWith(`${app}#`) && !declared.has(name)) declared.set(name, requests[k]?.needs ?? { name, capabilities: [] });
    }
    const list = [...declared.values()].map((r) => {
      const key = bindingKey(app, r.name);
      return {
        ...r, binding: key, boundTo: record.bindings[key]?.role ?? null,
        ...(used[key] ? { lastUsedAt: used[key] } : {}),
        ...(requests[key] && !record.bindings[key] ? { requestedAt: requests[key].at } : {}),
      };
    });
    if (list.length) apps.push({ app, roles: list });
  }
  return { roles, apps };
}

/** The provider ids a role may name: every provider the owner can use. */
export async function knownRoleProviders(storage: Storage, config: AimeatConfig, gaii: string): Promise<Set<string>> {
  const { owner, node } = await providersForOwner(storage, config, gaii);
  return new Set([...owner, ...node].map((p) => p.id));
}
