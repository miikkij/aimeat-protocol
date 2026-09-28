/**
 * @file roles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AI roles (wish-tekoalyn-roolit, brief-tekoalyn-roolit, Jouni 2026-09-28). A CAPABILITY
 *   says what a model does (text, image, speech …); a ROLE says what it is used for. A role names the
 *   capabilities it needs and, for each one, its own ordered list of providers and models. The owner
 *   makes their roles; an app declares the roles it needs in its meta; the owner (or their AI, which
 *   proposes while the owner confirms) binds an app's role to one of theirs. Until then the app's role
 *   does not run: nobody's app gets an AI configuration without that step.
 *
 *   ONE RECORD, `ai.roles.owner`: the owner's roles and the bindings, read together because the page
 *   and the capabilities answer always show them together (a memory value is a record). When a role or
 *   a binding was last used is `ai.roles.used`, written at most once a day per entry, so a call does
 *   not rewrite the owner's settings and an edit cannot race a call. Both under the reserved `ai.roles.`
 *   prefix: an app that could write them could route the owner's key wherever it liked.
 *
 *   TWO BUILT-IN ROLES, `reasoning` and `execution`, which were fixed model roles before (the crews'
 *   modelRole). While the owner has not set one, it shows the legacy setting it replaces
 *   (openrouter.settings reasoningModel / executionModel) on the provider that setting used, so the
 *   old model stays visible and in use.
 *
 *   The model policy still binds a role's models, the owner's routing rules still apply, and a role's
 *   own `local` and `maxCostPerCallUsd` only tighten them.
 * @structure
 *   ROLES_KEY · ROLES_USED_KEY · OwnerRole · RoleBinding · RolesRecord · readRoles · rolesWithLegacy ·
 *   normaliseRolesInput · setRoles · resolveRole · noteRoleUsed · bindingKey
 * @version-history
 *   v1.1.0 — 2026-09-28 — A binding the owner's role cannot meet (a capability the app's role needs and
 *     the role has no provider for) is refused; a binding set to null also dismisses the app's request.
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { Storage } from '../../storage/interface.js';
import { upsertPrivateRecord } from '../private-record.js';
import { emitChange } from '../event-bus.js';
import { mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../operator-confirm.js';
import { isObj } from '../ai-provider-common.js';
import { logger } from '../../utils/logger.js';
import { AiCompletionError } from './errors.js';
import type { AiCapability } from './types.js';
import type { AiProvider } from './providers.js';
import type { AppAiRole } from '../app-ai-roles.js';
import { appAiMetaOf } from './policy-store.js';

export const ROLES_KEY = 'ai.roles.owner';
export const ROLES_USED_KEY = 'ai.roles.used';

const CAPABILITIES: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
export const ROLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_ROLES = 50;
const MAX_BINDINGS = 200;
const MAX_ENTRIES = 5;
const MODEL_RE = /^[\w./:@+-]{1,200}$/;
export const BUILT_IN_ROLES = ['reasoning', 'execution'] as const;

/** One place in a role's order for a capability: a provider of the owner's, and optionally its model. */
export interface RoleEntry { provider: string; model?: string }

export interface OwnerRole {
  id: string;
  title: string;
  /** What the role is for, in the owner's words. */
  purpose?: string;
  /** For each capability the role needs, the providers (and models) to try, in order. */
  capabilities: Partial<Record<AiCapability, RoleEntry[]>>;
  /** Only providers on this machine. */
  local?: boolean;
  /** A ceiling per call for this role, tighter than the owner's rule. Null: the rule's own. */
  maxCostPerCallUsd?: number | null;
  builtIn?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** An app's declared role, bound by the owner to one of their roles. */
export interface RoleBinding { role: string; boundAt: string }

export interface RolesRecord {
  version: 1;
  roles: Record<string, OwnerRole>;
  /** `<owner>/<file>.html#<role name>` → the owner's role. */
  bindings: Record<string, RoleBinding>;
  updatedAt?: string;
}

/** The key a binding is stored under: the app's address and its role's name. */
export const bindingKey = (app: string, name: string): string => `${app}#${name}`;

function readEntries(v: unknown): RoleEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).map((e) => ({
    provider: String(e.provider ?? ''),
    ...(typeof e.model === 'string' && e.model ? { model: e.model } : {}),
  })).filter((e) => e.provider).slice(0, MAX_ENTRIES);
}

function readRole(id: string, v: unknown): OwnerRole | null {
  if (!isObj(v) || !ROLE_ID_RE.test(id)) return null;
  const capabilities: OwnerRole['capabilities'] = {};
  if (isObj(v.capabilities)) for (const c of CAPABILITIES) if (v.capabilities[c] !== undefined) capabilities[c] = readEntries(v.capabilities[c]);
  return {
    id,
    title: typeof v.title === 'string' && v.title.trim() ? v.title.trim().slice(0, 80) : id,
    ...(typeof v.purpose === 'string' && v.purpose.trim() ? { purpose: v.purpose.trim().slice(0, 500) } : {}),
    capabilities,
    ...(v.local === true ? { local: true } : {}),
    ...(typeof v.maxCostPerCallUsd === 'number' && v.maxCostPerCallUsd >= 0 ? { maxCostPerCallUsd: v.maxCostPerCallUsd } : {}),
    ...((BUILT_IN_ROLES as readonly string[]).includes(id) ? { builtIn: true } : {}),
    ...(typeof v.createdAt === 'string' ? { createdAt: v.createdAt } : {}),
    ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}),
  };
}

/** The owner's roles and bindings as stored, read leniently: what does not read is left out. */
export async function readRoles(storage: Storage, gaii: string): Promise<RolesRecord> {
  const rec = await storage.getMemory(gaii, ROLES_KEY);
  const v = isObj(rec?.value) ? rec.value : {};
  const roles: Record<string, OwnerRole> = {};
  if (isObj(v.roles)) for (const [id, r] of Object.entries(v.roles)) { const role = readRole(id, r); if (role) roles[id] = role; }
  const bindings: Record<string, RoleBinding> = {};
  if (isObj(v.bindings)) {
    for (const [k, b] of Object.entries(v.bindings)) {
      if (isObj(b) && typeof b.role === 'string') bindings[k] = { role: b.role, boundAt: typeof b.boundAt === 'string' ? b.boundAt : '' };
    }
  }
  return { version: 1, roles, bindings, ...(typeof v.updatedAt === 'string' ? { updatedAt: v.updatedAt } : {}) };
}

/**
 * The roles with the two built-in ones always present. A built-in role the owner has not set shows
 * the legacy setting it replaces, on the provider that setting used: the owner's migrated provider,
 * or the node's own when they have none.
 */
export function rolesWithLegacy(
  record: RolesRecord, prefs: Record<string, unknown>, providers: { owner: AiProvider[]; node: AiProvider[] },
): Record<string, OwnerRole & { legacy?: boolean }> {
  const out: Record<string, OwnerRole & { legacy?: boolean }> = { ...record.roles };
  const legacyProvider = providers.owner.find((p) => p.legacy) ?? providers.node.find((p) => p.source === 'node');
  const legacyField = { reasoning: 'reasoningModel', execution: 'executionModel' } as const;
  for (const id of BUILT_IN_ROLES) {
    if (out[id]?.capabilities.text?.length) continue;
    const model = typeof prefs[legacyField[id]] === 'string' && (prefs[legacyField[id]] as string).trim() ? (prefs[legacyField[id]] as string).trim() : undefined;
    const base: OwnerRole = out[id] ?? { id, title: id === 'reasoning' ? 'Reasoning' : 'Execution', capabilities: {}, builtIn: true };
    out[id] = model && legacyProvider
      ? { ...base, builtIn: true, capabilities: { ...base.capabilities, text: [{ provider: legacyProvider.id, model }] }, legacy: true }
      : { ...base, builtIn: true };
  }
  return out;
}

export interface RolesInput {
  /** A role by id: the whole role, or null to remove it. */
  roles?: Record<string, unknown>;
  /** `<app>#<role name>` → one of the owner's role ids, or null to unbind. */
  bindings?: Record<string, string | null>;
}

interface CheckedRolesInput { roles?: Record<string, OwnerRole | null>; bindings?: Record<string, string | null> }

/**
 * Check a change against the providers this owner can use. Every problem at once, so an AI fixing
 * its call gets them all in one answer.
 */
export function normaliseRolesInput(input: unknown, knownProviders: ReadonlySet<string>, current: RolesRecord): { value: CheckedRolesInput } | { problems: string[] } {
  const problems: string[] = [];
  if (!isObj(input)) return { problems: ['roles: an object with roles, bindings or both.'] };
  const out: CheckedRolesInput = {};
  if (input.roles !== undefined) {
    if (!isObj(input.roles)) problems.push('roles: { "<role id>": { title, purpose, capabilities, local, maxCostPerCallUsd } or null }.');
    else {
      out.roles = {};
      for (const [id, raw] of Object.entries(input.roles)) {
        if (!ROLE_ID_RE.test(id)) { problems.push(`roles.${id}: an id is lower-case letters, digits and '-', 1 to 40 characters.`); continue; }
        if (raw === null) {
          if ((BUILT_IN_ROLES as readonly string[]).includes(id)) problems.push(`roles.${id}: a built-in role cannot be removed; empty its capabilities instead.`);
          else out.roles[id] = null;
          continue;
        }
        if (!isObj(raw)) { problems.push(`roles.${id}: an object or null.`); continue; }
        if (raw.capabilities !== undefined && !isObj(raw.capabilities)) { problems.push(`roles.${id}.capabilities: { "<capability>": [{ provider, model? }, ...] }.`); continue; }
        for (const [cap, list] of Object.entries(raw.capabilities ?? {})) {
          if (!(CAPABILITIES as readonly string[]).includes(cap)) { problems.push(`roles.${id}.capabilities.${cap}: not a capability. Known: ${CAPABILITIES.join(', ')}.`); continue; }
          if (!Array.isArray(list) || list.length > MAX_ENTRIES) { problems.push(`roles.${id}.capabilities.${cap}: a list of up to ${MAX_ENTRIES} { provider, model? }, first is tried first.`); continue; }
          list.forEach((e, i) => {
            if (!isObj(e) || typeof e.provider !== 'string') { problems.push(`roles.${id}.capabilities.${cap}[${i}]: { provider, model? }.`); return; }
            if (!knownProviders.has(e.provider)) problems.push(`roles.${id}.capabilities.${cap}[${i}].provider: ${e.provider} is not a provider you can use. Known: ${[...knownProviders].join(', ') || 'none yet'}.`);
            if (e.model !== undefined && (typeof e.model !== 'string' || !MODEL_RE.test(e.model))) problems.push(`roles.${id}.capabilities.${cap}[${i}].model: the model id as the provider names it.`);
          });
          const providersListed = list.filter(isObj).map((e) => e.provider);
          if (new Set(providersListed).size !== providersListed.length) problems.push(`roles.${id}.capabilities.${cap}: a provider is listed twice; each provider has one place in the order.`);
        }
        if (raw.maxCostPerCallUsd !== undefined && raw.maxCostPerCallUsd !== null && (typeof raw.maxCostPerCallUsd !== 'number' || !(raw.maxCostPerCallUsd >= 0 && raw.maxCostPerCallUsd <= 100))) {
          problems.push(`roles.${id}.maxCostPerCallUsd: US dollars from 0 to 100, or null.`);
        }
        const role = readRole(id, raw);
        if (role) out.roles[id] = role;
      }
      const ids = new Set([...Object.keys(current.roles), ...Object.keys(out.roles)].filter((id) => out.roles![id] !== null));
      if (ids.size > MAX_ROLES) problems.push(`roles: at most ${MAX_ROLES} roles.`);
    }
  }
  if (input.bindings !== undefined) {
    if (!isObj(input.bindings)) problems.push('bindings: { "<owner>/<file>.html#<role name>": "<your role id>" or null }.');
    else {
      out.bindings = {};
      const roleIds = new Set([...BUILT_IN_ROLES, ...Object.keys(current.roles), ...Object.keys(out.roles ?? {}).filter((id) => out.roles![id] !== null)]);
      for (const [k, target] of Object.entries(input.bindings)) {
        if (!/^[^#\s]{1,300}#[a-z0-9][a-z0-9-]{0,39}$/.test(k)) { problems.push(`bindings.${k}: the app's address, '#', and the role name the app declares (for example alice/recipes.html#summarizer).`); continue; }
        if (target !== null && (typeof target !== 'string' || !roleIds.has(target))) { problems.push(`bindings.${k}: one of your role ids (${[...roleIds].join(', ')}), or null to unbind.`); continue; }
        out.bindings[k] = target as string | null;
      }
      if (Object.keys({ ...current.bindings, ...out.bindings }).length > MAX_BINDINGS) problems.push(`bindings: at most ${MAX_BINDINGS}.`);
    }
  }
  if (out.roles === undefined && out.bindings === undefined) problems.push('roles: give roles, bindings or both.');
  return problems.length ? { problems } : { value: out };
}

async function writeRoles(storage: Storage, gaii: string, change: CheckedRolesInput): Promise<RolesRecord> {
  const current = await readRoles(storage, gaii);
  const at = new Date().toISOString();
  const roles = { ...current.roles };
  for (const [id, role] of Object.entries(change.roles ?? {})) {
    if (role === null) {
      delete roles[id];
      // A binding to a removed role no longer runs; it goes with the role.
      for (const [k, b] of Object.entries(current.bindings)) if (b.role === id) delete current.bindings[k];
    } else {
      roles[id] = { ...role, createdAt: current.roles[id]?.createdAt ?? at, updatedAt: at };
    }
  }
  const bindings = { ...current.bindings };
  const dismissed: string[] = [];
  for (const [k, target] of Object.entries(change.bindings ?? {})) {
    // Null unbinds, and dismisses the app's request for the role: the owner has seen it and said no,
    // or the app is gone. A later call from the app asks again.
    if (target === null) { delete bindings[k]; dismissed.push(k); }
    else bindings[k] = { role: target, boundAt: at };
  }
  const record: RolesRecord = { version: 1, roles, bindings, updatedAt: at };
  await upsertPrivateRecord(storage, gaii, ROLES_KEY, record, ['ai', 'roles']);
  const answered = [...dismissed, ...Object.keys(change.bindings ?? {}).filter((k) => change.bindings![k] !== null)];
  if (answered.length) {
    const rec = await storage.getMemory(gaii, ROLES_REQUESTS_KEY);
    if (isObj(rec?.value) && answered.some((k) => k in (rec.value as object))) {
      const requests = { ...rec.value };
      for (const k of answered) delete requests[k];
      await upsertPrivateRecord(storage, gaii, ROLES_REQUESTS_KEY, requests, ['ai', 'roles']);
    }
  }
  emitChange('ai-providers', gaii);
  return readRoles(storage, gaii);
}

/**
 * A binding the owner's role cannot meet: the app's role needs a capability the owner's role has no
 * provider for. Refused when the binding is made, rather than found by the app's first call. A model
 * too small for the app's context is shown on the AI page and passed over in the call (roles-fit.ts).
 */
async function unmetBindings(storage: Storage, gaii: string, change: CheckedRolesInput, current: RolesRecord): Promise<string[]> {
  const problems: string[] = [];
  const roles: Record<string, OwnerRole | null> = { ...current.roles, ...(change.roles ?? {}) };
  for (const [k, target] of Object.entries(change.bindings ?? {})) {
    if (target === null) continue;
    const app = k.slice(0, k.lastIndexOf('#'));
    const name = k.slice(k.lastIndexOf('#') + 1);
    const need = (await appAiMetaOf(storage, gaii, app))?.roles?.find((d) => d.name === name);
    if (!need) continue;
    const role = roles[target];
    const missing = need.capabilities.filter((c) => !role?.capabilities[c]?.length);
    if (missing.length) {
      problems.push(`bindings.${k}: the app's role needs ${missing.join(', ')}, and your role '${target}' has no provider for ${missing.length > 1 ? 'them' : 'it'}. Add ${missing.length > 1 ? 'them' : 'it'} to the role first, or connect another role.`);
    }
  }
  return problems;
}

export type RolesActor = { kind: 'owner' } | { kind: 'agent'; principal: string; confirmToken?: string };
export type RolesSetResult =
  | { mode: 'applied'; roles: RolesRecord }
  | { mode: 'proposal'; current: RolesRecord; proposed: CheckedRolesInput; confirm_token: string; expires_in_seconds: number; instructions: string };

const ROLES_ACTION = 'ai_roles';

/**
 * Change the roles or the bindings. The owner in person writes at once; an agent proposes, shows the
 * owner, and applies with the token bound to the exact change within ten minutes (routing.ts setRouting).
 * Binding an app's role is how the owner approves what that app may run.
 */
export async function setRoles(
  storage: Storage, gaii: string, input: unknown, knownProviders: ReadonlySet<string>, actor: RolesActor,
): Promise<RolesSetResult> {
  const current = await readRoles(storage, gaii);
  const r = normaliseRolesInput(input, knownProviders, current);
  if ('problems' in r) throw new AiCompletionError('AI_ROLES_INVALID', 400, `The roles were not saved: ${r.problems.join(' ')}`, { problems: r.problems });
  const unmet = await unmetBindings(storage, gaii, r.value, current);
  if (unmet.length) throw new AiCompletionError('AI_ROLES_INVALID', 400, `The roles were not saved: ${unmet.join(' ')}`, { problems: unmet });
  if (actor.kind === 'owner') return { mode: 'applied', roles: await writeRoles(storage, gaii, r.value) };
  if (!actor.confirmToken) {
    return {
      mode: 'proposal', current, proposed: r.value,
      confirm_token: await mintConfirmToken(actor.principal, ROLES_ACTION, r.value),
      expires_in_seconds: 600,
      instructions: 'Show this change to the owner. To apply EXACTLY this change, call again with the same roles plus confirm_token. Any change invalidates the token.',
    };
  }
  try {
    await verifyConfirmToken(actor.confirmToken, actor.principal, ROLES_ACTION, r.value);
  } catch (e) {
    if (e instanceof ConfirmTokenError) throw new AiCompletionError(e.code, 403, e.message);
    throw e;
  }
  return { mode: 'applied', roles: await writeRoles(storage, gaii, r.value) };
}

/** What a call's role resolves to: the owner's role, and the app's declaration when an app asked. */
export interface ResolvedRole {
  role: OwnerRole;
  /** The app's declared role, when the call came from an app. */
  declared?: AppAiRole;
  /** `<app>#<name>`, when the call came from an app. */
  binding?: string;
}

/**
 * The role a call names. An app's call names a role it declared, which runs only when the owner bound
 * it to one of theirs; anyone else names one of the owner's own role ids. Refuses with the fix when the
 * role is not there, not bound, or does not serve the capability.
 */
export function resolveRole(args: {
  name: string; capability: AiCapability; roles: Record<string, OwnerRole>; record: RolesRecord;
  app?: { address: string; declared: AppAiRole[] };
}): ResolvedRole {
  const { name, capability, roles, record, app } = args;
  const listRoles = { description: 'List your AI roles', method: 'GET', url: '/v1/ai/roles' };
  if (app) {
    const declared = app.declared.find((d) => d.name === name);
    if (!declared) {
      throw new AiCompletionError('AI_ROLE_NOT_DECLARED', 400,
        `This app does not declare an AI role '${name}'. An app declares its roles in its aimeat-ai meta (role.${name}=text), and the owner then binds each one.`,
        { role: name, app: app.address, declared: app.declared.map((d) => d.name) });
    }
    const key = bindingKey(app.address, name);
    const bound = record.bindings[key];
    const role = bound ? roles[bound.role] : undefined;
    if (!role) {
      throw new AiCompletionError('AI_ROLE_NOT_BOUND', 409,
        `The owner has not connected this app's AI role '${name}' to one of their roles yet, so it does not run. `
        + 'The owner connects it on the AI page, or their AI proposes it with aimeat_ai_role_set and the owner confirms.',
        { role: name, app: app.address, binding: key, needs: declared, fix: `Connect '${name}' to one of your roles on the AI page.`, next: listRoles });
    }
    assertServes(role, capability, listRoles);
    return { role, declared, binding: key };
  }
  const role = roles[name];
  if (!role) {
    throw new AiCompletionError('AI_ROLE_UNKNOWN', 400, `You have no AI role '${name}'. Your roles: ${Object.keys(roles).join(', ') || 'none yet'}.`, { role: name, next: listRoles });
  }
  assertServes(role, capability, listRoles);
  return { role };
}

function assertServes(role: OwnerRole, capability: AiCapability, next: Record<string, string>): void {
  if (!role.capabilities[capability]?.length) {
    throw new AiCompletionError('AI_ROLE_LACKS_CAPABILITY', 400,
      `The role '${role.title}' has no provider for ${capability}. Add one to the role on the AI page, or call without the role.`,
      { role: role.id, capability, fix: `Add a provider for ${capability} to the role '${role.title}'.`, next });
  }
}

/** Last write per entry this process made, so a busy role writes `ai.roles.used` at most once a day. */
const lastNoted = new Map<string, number>();
const DAY_MS = 86_400_000;

/**
 * Note that a role (and an app's binding) was used, for the page's "last used" and for cleaning away
 * what nobody uses. At most once a day per entry and never in the way of the call: a failure is logged.
 */
export function noteRoleUsed(storage: Storage, gaii: string, ids: string[]): void {
  const now = Date.now();
  const due = ids.filter((id) => now - (lastNoted.get(`${gaii}|${id}`) ?? 0) > DAY_MS);
  if (!due.length) return;
  for (const id of due) lastNoted.set(`${gaii}|${id}`, now);
  if (lastNoted.size > 10_000) lastNoted.clear();
  void (async () => {
    const rec = await storage.getMemory(gaii, ROLES_USED_KEY);
    const used = isObj(rec?.value) ? { ...rec.value } : {};
    const at = new Date(now).toISOString();
    for (const id of due) used[id] = at;
    await upsertPrivateRecord(storage, gaii, ROLES_USED_KEY, used, ['ai', 'roles']);
  })().catch((err) => logger.warn('[ai] could not note a role as used', { gaii, error: String(err) }));
}

export const ROLES_REQUESTS_KEY = 'ai.roles.requests';

/**
 * Note that an app asked for a role the owner has not bound, so the AI page can show the request
 * with what the app needs. At most once a day per binding, never in the way of the refusal.
 */
export function noteRoleRequest(storage: Storage, gaii: string, binding: string, needs: AppAiRole): void {
  const now = Date.now();
  const k = `${gaii}|request|${binding}`;
  if (now - (lastNoted.get(k) ?? 0) <= DAY_MS) return;
  lastNoted.set(k, now);
  void (async () => {
    const rec = await storage.getMemory(gaii, ROLES_REQUESTS_KEY);
    const requests = isObj(rec?.value) ? { ...rec.value } : {};
    // A bounded list: the newest hundred requests.
    const entries = Object.entries({ ...requests, [binding]: { at: new Date(now).toISOString(), needs } })
      .sort((a, b) => String((b[1] as { at?: string }).at ?? '').localeCompare(String((a[1] as { at?: string }).at ?? ''))).slice(0, 100);
    await upsertPrivateRecord(storage, gaii, ROLES_REQUESTS_KEY, Object.fromEntries(entries), ['ai', 'roles']);
  })().catch((err) => logger.warn('[ai] could not note a role request', { gaii, error: String(err) }));
}

/** The requests apps made for roles the owner has not bound: binding key → when and what it needs. */
export async function readRoleRequests(storage: Storage, gaii: string): Promise<Record<string, { at: string; needs: AppAiRole }>> {
  const rec = await storage.getMemory(gaii, ROLES_REQUESTS_KEY);
  const out: Record<string, { at: string; needs: AppAiRole }> = {};
  if (isObj(rec?.value)) {
    for (const [k, v] of Object.entries(rec.value)) {
      if (isObj(v) && typeof v.at === 'string' && isObj(v.needs) && typeof v.needs.name === 'string') out[k] = { at: v.at, needs: v.needs as unknown as AppAiRole };
    }
  }
  return out;
}

/** When each role and binding was last used. */
export async function readRolesUsed(storage: Storage, gaii: string): Promise<Record<string, string>> {
  const rec = await storage.getMemory(gaii, ROLES_USED_KEY);
  const out: Record<string, string> = {};
  if (isObj(rec?.value)) for (const [k, v] of Object.entries(rec.value)) if (typeof v === 'string') out[k] = v;
  return out;
}
