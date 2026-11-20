/**
 * @file src/services/app/app-ref-inputs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The input fields that name a hosted app, per MCP tool, and the helpers that turn each
 *   field's value into the stored filename before the tool's own code reads it.
 *
 *   WHY A TABLE. Forty-odd tool parameters name an app, in five shapes: a filename with the owner in
 *   another field or the caller, `owner/filename`, `app:owner/filename`, a list, or a key inside an
 *   object. Each handler compared the value exactly, so `notes` missed `notes.html` in all of them.
 *   One table read by one wrapper (mcp/app-ref-input.ts) puts the rule (services/app/app-ref.ts) in
 *   front of every one of them, and a new tool that names an app adds a row here instead of a lookup
 *   of its own. The REST routes whose body or query names an app call the same helpers after their
 *   authentication; the routes that name an app in the path are rewritten by middleware/app-ref-path.ts.
 *
 *   WHAT IS LEFT AS GIVEN. A value that names no app of that owner (the endpoint answers its own
 *   not-found, or keeps a label that was never an app), an `eco:` ecosystem app name, and a value
 *   prefixed with another owner than the one the field is read for.
 * @structure AppRefCtx · refFilename · refNewFilename · refOwnerFilename · refBinding · refOwnerFilenameKeys ·
 *   APP_REF_INPUTS · appRefCtxFor · normalizeAppRefInput
 * @usage await normalizeAppRefInput('aimeat_app_get', input, { storage, callerOwner });
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-sovelluksen-nimi-ilman-html-p-tett-kaikkialla).
 */
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { findAppFilename, publishFilename, resolveBindingRef, resolveOwnerAppRef } from './app-ref.js';
import { logger } from '../../utils/logger.js';

/** What the helpers need: the storage and the account name of the caller's owner. */
export interface AppRefCtx {
  storage: Pick<Storage, 'appFilenamesAmong' | 'getMemory'>;
  /** The caller's owner account name, the owner of a field that names no owner of its own. */
  callerOwner: string;
  /** The node id, for reading a tool manifest under the owner's GHII. */
  nodeId: string;
}

type Input = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The owner a field is read for: the named owner field, else the caller's own. */
function ownerOf(input: Input, ownerField: string | undefined, ctx: AppRefCtx): string {
  const named = ownerField ? str(input[ownerField]) : undefined;
  return localAccountName(named ?? ctx.callerOwner);
}

/** A filename of `owner`, resolved; anything that names no app comes back as given. */
export async function refFilename(ctx: AppRefCtx, owner: string, value: unknown): Promise<unknown> {
  const v = str(value);
  if (!v || v.startsWith('eco:')) return value;
  const found = await findAppFilename(ctx.storage, { ownerName: owner }, v);
  return found.filename ?? value;
}

/** A filename that may name a new app: the existing one, else `.html` added for HTML. */
export async function refNewFilename(ctx: AppRefCtx, owner: string, value: unknown, mimeType?: unknown): Promise<unknown> {
  const v = str(value);
  if (!v || v.includes('/')) return value;
  return publishFilename(ctx.storage, { ownerName: owner }, v, typeof mimeType === 'string' ? mimeType : undefined);
}

/** `owner/filename`, with the filename resolved for that owner. A value of another shape stays. */
export async function refOwnerFilename(ctx: AppRefCtx, value: unknown): Promise<unknown> {
  const v = str(value);
  if (!v) return value;
  const resolved = await resolveOwnerAppRef(ctx.storage, v);
  return resolved === v ? value : resolved;
}

/** `app:owner/filename` (a skill binding, an MCP grantee), with the filename resolved. */
export async function refBinding(ctx: AppRefCtx, value: unknown): Promise<unknown> {
  const v = str(value);
  if (!v) return value;
  const resolved = await resolveBindingRef(ctx.storage, v);
  return resolved === v ? value : resolved;
}

/** An object whose keys are `owner/filename` (optionally `#suffix`), with each key resolved. */
export async function refOwnerFilenameKeys(ctx: AppRefCtx, value: unknown): Promise<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const hash = key.indexOf('#');
    const head = hash >= 0 ? key.slice(0, hash) : key;
    const tail = hash >= 0 ? key.slice(hash) : '';
    const resolved = await refOwnerFilename(ctx, head);
    out[typeof resolved === 'string' ? `${resolved}${tail}` : key] = v;
  }
  return out;
}

async function setField(input: Input, field: string, next: (v: unknown) => Promise<unknown>): Promise<void> {
  if (input[field] === undefined) return;
  input[field] = await next(input[field]);
}

async function eachIn(input: Input, field: string, next: (v: unknown) => Promise<unknown>): Promise<void> {
  const list = input[field];
  if (!Array.isArray(list)) return;
  input[field] = await Promise.all(list.map(next));
}

/** A filename field whose owner is `ownerField` or the caller. */
const fname = (field: string, ownerField?: string) => (input: Input, ctx: AppRefCtx) =>
  setField(input, field, v => refFilename(ctx, ownerOf(input, ownerField, ctx), v));
/** A filename field that may name a new app. */
const newName = (field: string, ownerField?: string, mimeField?: string) => (input: Input, ctx: AppRefCtx) =>
  setField(input, field, v => refNewFilename(ctx, ownerOf(input, ownerField, ctx), v, mimeField ? input[mimeField] : undefined));
const ownerRef = (field: string) => (input: Input, ctx: AppRefCtx) => setField(input, field, v => refOwnerFilename(ctx, v));
const binding = (field: string) => (input: Input, ctx: AppRefCtx) => setField(input, field, v => refBinding(ctx, v));

type Step = (input: Input, ctx: AppRefCtx) => Promise<void>;
const all = (...steps: Step[]): Step => async (input, ctx) => { for (const s of steps) await s(input, ctx); };

/**
 * Every MCP tool input field that names a hosted app. The key is the tool name; the value rewrites
 * the input in place. A field naming an ecosystem app, an AI-budget app id or a file that is not an
 * app has no row here (services/ai/app-id.ts canonicalises the AI-budget id on its own).
 */
export const APP_REF_INPUTS: Readonly<Record<string, Step>> = {
  aimeat_app_get: fname('filename', 'owner'),
  aimeat_app_delete: fname('filename'),
  aimeat_app_fork: all(fname('filename', 'owner'), newName('new_filename')),
  aimeat_app_draft_save: newName('filename', 'owner', 'mime_type'),
  aimeat_app_draft_write: newName('filename', 'owner'),
  aimeat_app_draft_seed: all(newName('filename', 'owner'), fname('from_filename', 'owner')),
  aimeat_app_draft_publish: fname('filename', 'owner'),
  aimeat_app_draft_discard: fname('filename', 'owner'),
  aimeat_app_draft_replace: fname('filename', 'owner'),
  aimeat_app_draft_read: fname('filename', 'owner'),
  // subdomain_set's `target` resolves where both doors store it (services/subdomain/sites.ts).
  aimeat_app_manage: fname('filename', 'owner'),
  // aimeat_checkout_open's items resolve where both doors price them (commerce/sellable-resolvers.ts).
  aimeat_exchange_accept: ownerRef('app_id'),
  aimeat_exchange_need_post: ownerRef('app_id'),
  aimeat_datamap_get: ownerRef('app'),
  aimeat_datamap_set: ownerRef('app'),
  aimeat_app_agent_tie: ownerRef('app'),
  aimeat_app_agent_untie: ownerRef('app'),
  aimeat_app_internet_opening_get: fname('app'),
  aimeat_app_internet_open: fname('app'),
  aimeat_app_internet_close: fname('app', 'owner'),
  aimeat_admin_internet_opening_decide: fname('app', 'owner'),
  aimeat_visibility_behaviour: fname('app'),
  aimeat_visibility_behaviour_set: fname('app'),
  aimeat_visibility_behaviour_fix: fname('app'),
  aimeat_admin_app_party_registrations: fname('app', 'owner'),
  // aimeat_compliance_register_* resolve in the access check both doors share (services/compliance/docs-access.ts).
  aimeat_designbook_keep: fname('filename'),
  aimeat_designbook_adopt: fname('filename'),
  aimeat_designbook_propose: async (input, ctx) => {
    const part = input.part;
    if (!part || typeof part !== 'object') return;
    const p = part as Input;
    if (p.app && typeof p.app === 'object') await fname('filename')(p.app as Input, ctx);
    await fname('from_app')(p, ctx);
  },
  // aimeat_company_front_page resolves where both doors check it (services/company/company-service.ts).
  aimeat_package_compose: (input, ctx) => eachIn(input, 'apps', v => refFilename(ctx, ctx.callerOwner, v)),
  aimeat_package_compose_set: async (input, ctx) => {
    const before = Array.isArray(input.apps) ? [...input.apps] : [];
    await eachIn(input, 'apps', v => refFilename(ctx, ctx.callerOwner, v));
    const after = Array.isArray(input.apps) ? input.apps : [];
    const d = input.defaults;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const renamed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
        const i = before.indexOf(k);
        const key = i >= 0 && typeof after[i] === 'string' ? after[i] as string : String(await refFilename(ctx, ctx.callerOwner, k));
        renamed[key] = v;
      }
      input.defaults = renamed;
    }
  },
  aimeat_workspace_update: (input, ctx) => eachIn(input, 'apps', async (a) => {
    if (!a || typeof a !== 'object') return a;
    const app = a as Input;
    const owner = str(app.owner);
    return owner ? { ...app, filename: await refFilename(ctx, localAccountName(owner), app.filename) } : a;
  }),
  // aimeat_app_template_propose resolves in proposeTemplate, which both doors call (services/app/template-proposals.ts).
  // aimeat_skill_list's `binding` resolves where both doors list by it (services/skills.ts).
  aimeat_mcp_grant_set: binding('grantee'),
  aimeat_mcp_grant_revoke: binding('grantee'),
  aimeat_overview: async (input, ctx) => {
    const focus = str(input.focus);
    const m = focus ? /^(app|tools):(.+)$/.exec(focus) : null;
    if (!m) return;
    input.focus = `${m[1]}:${String(await refFilename(ctx, ctx.callerOwner, m[2]))}`;
  },
  aimeat_access_request: async (input, ctx) => {
    if (input.kind === 'app') await ownerRef('ref')(input, ctx);
  },
  aimeat_iam_define: ownerRef('app_id'),
  aimeat_ai_policy_set: async (input, ctx) => {
    const policy = input.policy;
    if (policy && typeof policy === 'object' && (policy as Input).apps !== undefined) {
      (policy as Input).apps = await refOwnerFilenameKeys(ctx, (policy as Input).apps);
    }
  },
  aimeat_ai_gen_rules_set: async (input, ctx) => {
    const rules = input.gen_rules;
    const list = rules && typeof rules === 'object' ? (rules as Input).exceptions : undefined;
    if (!Array.isArray(list)) return;
    (rules as Input).exceptions = await Promise.all(list.map(async (e) => {
      if (!e || typeof e !== 'object' || typeof (e as Input).app !== 'string') return e;
      return { ...(e as Input), app: await refOwnerFilename(ctx, (e as Input).app) };
    }));
  },
  aimeat_ai_role_set: async (input, ctx) => {
    if (input.bindings !== undefined) input.bindings = await refOwnerFilenameKeys(ctx, input.bindings);
  },
};

/**
 * The context a REST route builds after its authentication: the caller's owner is the account the
 * session acts for (`req.auth.owner`), the same account an MCP session's principal names.
 */
export function appRefCtxFor(storage: AppRefCtx['storage'], nodeId: string, callerOwner: string | undefined): AppRefCtx {
  return { storage, nodeId, callerOwner: localAccountName(callerOwner ?? '') };
}

/**
 * Rewrite `input` in place for `tool`, when the table has a row for it. Never throws: a lookup that
 * fails leaves the input as the caller sent it, and the tool answers as it would have.
 */
export async function normalizeAppRefInput(tool: string, input: unknown, ctx: AppRefCtx): Promise<void> {
  const step = APP_REF_INPUTS[tool];
  if (!step || !input || typeof input !== 'object') return;
  try {
    await step(input as Input, ctx);
  } catch (err) {
    logger.warn('app reference in tool input not resolved; the tool reads the input as sent', { tool, error: String(err) });
  }
}
