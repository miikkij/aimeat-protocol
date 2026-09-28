/**
 * @file roles-view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What GET /v1/ai/roles and aimeat_ai_roles show (services/ai/roles.ts): the owner's roles
 *   with when each was last used, and the AI roles apps declare, each with the owner's binding (or
 *   none yet) and whether the app has already asked for it. The apps are the owner's own that declare
 *   roles, the ones they have bound, and the ones that asked for an unbound role.
 * @structure aiRolesView · appRolesView · knownRoleProviders
 * @version-history
 *   v1.2.0 — 2026-09-28 — appRolesView: an app sees only its own roles, not the owner's roles nor
 *     other apps' bindings (it had seen them all through GET /v1/ai/roles).
 *   v1.1.0 — 2026-09-28 — The lifecycle and the fit: an app no longer published is `gone`; a role or a
 *     binding not used for STALE_DAYS is `stale`; a bound app role whose owner role misses a capability
 *     or has a model too small for its context carries `fit` (roles-fit.ts).
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { providersForOwner } from './provider-store.js';
import { appAiMetaOf } from './policy-store.js';
import { readRoles, rolesWithLegacy, readRolesUsed, readRoleRequests, bindingKey, type OwnerRole } from './roles.js';
import type { AppAiRole } from '../app-ai-roles.js';
import { roleFit, type RoleFit } from './roles-fit.js';

export interface AppRoleView extends AppAiRole {
  /** `<app>#<name>`: the key a binding is stored under. */
  binding: string;
  /** The owner's role it runs as, or null while it does not run. */
  boundTo: string | null;
  lastUsedAt?: string;
  /** When the app last asked for it while it was unbound. */
  requestedAt?: string;
  /** Where the owner's role does not meet the need (roles-fit.ts), when it is bound. */
  fit?: RoleFit;
  /** Bound and not used for STALE_DAYS. */
  stale?: boolean;
}

export interface AiRolesView {
  roles: Array<OwnerRole & { legacy?: boolean; lastUsedAt?: string; stale?: boolean }>;
  /** `gone`: the app is no longer published, so its bindings and requests can be removed. */
  apps: Array<{ app: string; gone?: boolean; roles: AppRoleView[] }>;
}

/** A role or a binding not used for this long is marked, so the owner can clean it away. */
export const STALE_DAYS = 90;
const olderThan = (iso: string | undefined, days: number): boolean => !!iso && Date.now() - Date.parse(iso) > days * 86_400_000;

export async function aiRolesView(storage: Storage, config: AimeatConfig, gaii: string): Promise<AiRolesView> {
  // Each read inside an async function, so a storage that throws before returning a promise rejects
  // this call rather than leaving a sibling's rejection unhandled (as provider-store.ts does).
  const [record, used, requests, providers, prefsRec] = await Promise.all([
    readRoles(storage, gaii), readRolesUsed(storage, gaii), readRoleRequests(storage, gaii),
    providersForOwner(storage, config, gaii), (async () => storage.getMemory(gaii, 'openrouter.settings'))(),
  ]);
  const prefs = (prefsRec?.value as Record<string, unknown>) ?? {};
  const allRoles = rolesWithLegacy(record, prefs, providers);
  const allProviders = [...providers.owner, ...providers.node];
  const roles = Object.values(allRoles)
    .sort((a, b) => Number(!!b.builtIn) - Number(!!a.builtIn) || a.id.localeCompare(b.id))
    .map((r) => ({
      ...r, ...(used[r.id] ? { lastUsedAt: used[r.id] } : {}),
      ...(!r.builtIn && olderThan(used[r.id] ?? r.createdAt, STALE_DAYS) ? { stale: true } : {}),
    }));

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
      const bound = record.bindings[key];
      const role = bound ? allRoles[bound.role] : undefined;
      const fit = role ? roleFit(r, role, allProviders) : undefined;
      return {
        ...r, binding: key, boundTo: bound?.role ?? null,
        ...(used[key] ? { lastUsedAt: used[key] } : {}),
        ...(requests[key] && !bound ? { requestedAt: requests[key].at } : {}),
        ...(fit && (fit.missing.length || fit.small.length) ? { fit } : {}),
        ...(bound && olderThan(used[key] ?? bound.boundAt, STALE_DAYS) ? { stale: true } : {}),
      };
    });
    if (list.length) apps.push({ app, ...(await appExists(storage, app) ? {} : { gone: true }), roles: list });
  }
  return { roles, apps };
}

/**
 * Whether the app at `<owner>/<file>.html` is still published, read fresh: appAiMetaOf keeps an app's
 * meta for a minute, and a removed app should show as removed when the owner looks.
 */
async function appExists(storage: Storage, app: string): Promise<boolean> {
  const slash = app.indexOf('/');
  if (slash <= 0) return false;
  try {
    return !!(await storage.getAppByOwnerName(app.slice(0, slash), app.slice(slash + 1)));
  } catch (err) {
    logger.warn('[ai] could not read an app for its AI roles', { app, error: String(err) });
    return true;
  }
}

/**
 * The view an app gets: its own declared roles and their bindings, and nothing about the owner's other
 * apps or the owner's roles. An app holds `ai:use` on the owner's account, which does not make the
 * owner's configuration for every other app its business.
 */
export function appRolesView(view: AiRolesView, app: string): AiRolesView {
  return { roles: [], apps: view.apps.filter((a) => a.app === app) };
}

/** The provider ids a role may name: every provider the owner can use. */
export async function knownRoleProviders(storage: Storage, config: AimeatConfig, gaii: string): Promise<Set<string>> {
  const { owner, node } = await providersForOwner(storage, config, gaii);
  return new Set([...owner, ...node].map((p) => p.id));
}
