/**
 * @file src/services/app-scope-allowance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The scope words an app keeps from 3.x: per app, the words its code was shown to need
 *   for a route the 4.0.0 gates check (services/app-scope-needs.ts) and its sign-in did not ask for,
 *   recorded once at the node's first start as 4.0.x (ruling
 *   decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san: what worked on 3.x keeps
 *   working, and nobody edits sixty apps by hand).
 *
 *   ONE MEMORY RECORD PER APP, under the node's own namespace APP_SCOPE_ALLOWANCE_NS and the key
 *   appScopeAllowanceKey(owner/filename), like the design spec (services/app-design-spec.ts). It
 *   holds the words, the words the owner took away, and the evidence for each word.
 *
 *   WHAT IT DOES TO A GRANT. The words count as declared by the app (services/app-grant-scopes.ts
 *   narrowToDeclared is called with them, routes/app-grants.ts): a refresh or a silent sign-in no
 *   longer trims them, and the sign-in asks for them beside the app's own declaration. The step that
 *   records an allowance also writes its words onto every live grant of the app, so each grant has
 *   them from its next token.
 *
 *   ONLY APPS THAT EXISTED. An app published for the first time after the step has no allowance; the
 *   publish answer warns about each word its code needs and does not declare
 *   (services/app-artifact-lint.ts). An app that had one keeps it when it is published again, until
 *   the owner takes a word away; once the app declares a word itself, the allowance word changes
 *   nothing.
 *
 *   THE OWNER TAKES A WORD AWAY with aimeat_app_manage { action: "scope_allowance_remove" } or
 *   DELETE /v1/apps/:owner/:filename/scope-allowance?words=...: the word leaves the allowance and
 *   every live grant of the app (unless a grant's own holder added it by hand), and it is kept in
 *   `removed`, so nothing puts it back.
 * @structure (re-exported from app-scope-allowance-store.ts: APP_SCOPE_ALLOWANCE_NS · appScopeAllowanceKey ·
 *   AppScopeAllowance · readAppScopeAllowance · appAllowanceWords · withAllowance) · keepWorkingAppsOnce ·
 *   readScopeAllowanceFor · removeScopeAllowanceFor
 * @usage
 *   const words = await appAllowanceWords(storage, 'alice/notes.html');
 *   const asked = withAllowance(requested, words);
 * @version-history
 *   v1.3.0 — 2026-10-21 — keepWorkingAppsOnce takes `rules`: only a word that a call found by one of
 *     those rules needs (services/app-on-done-keep-migration.ts gives ext:invoke for an AI job's
 *     on_done and not for an undeclared extension call).
 *   v1.2.0 — 2026-10-20 — keepWorkingAppsOnce takes `only` and a change-log reason, and adds to an app
 *     that already has an allowance the words it lacks, never one its owner removed
 *     (services/app-storage-read-keep-migration.ts).
 *   v1.1.0 — 2026-10-18 — keepWorkingAppsOnce writes each grant's words on the list that was read
 *     (services/scope-list-swap.ts), so a refresh or an owner's edit meanwhile is kept (check:atomic-writes).
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { localAccountName, resolveIdentity } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { equalAppId } from './app-record-keys.js';
import { resolveAppTarget } from './app-dev-grant.js';
import { changeScopeList } from './scope-list-swap.js';
import { recordAppAudit } from './app-audit.js';
import { resolveCortexLib } from './component-versions.js';
import { cortexLibRefs, undeclaredScopeNeeds } from './app-scope-needs.js';
import { heldOwnerAdded } from './app-grant-scopes.js';
import { emitChange } from './event-bus.js';
import { done, refuse, type AppOpCaller, type AppOpOutcome } from './app-op-outcome.js';
import {
  APP_SCOPE_ALLOWANCE_SPEC, allowanceAppId, readAppScopeAllowance, writeAppScopeAllowance as writeAllowance,
} from './app-scope-allowance-store.js';

// The record, its key and the reads the grant routes make live in the leaf app-scope-allowance-store.ts.
export {
  APP_SCOPE_ALLOWANCE_NS, appScopeAllowanceKey, readAppScopeAllowance, appAllowanceWords, withAllowance,
  type AppScopeAllowance,
} from './app-scope-allowance-store.js';
const SPEC = APP_SCOPE_ALLOWANCE_SPEC;
const appIdOf = allowanceAppId;

/** The live grants of one app (any holder). */
async function liveGrantsOf(storage: Storage, appId: string) {
  return (await storage.listAppGrants()).filter(g => !g.revoked && equalAppId(appIdOf(g.app), appId));
}

/** One app the step gave an allowance. */
export interface KeptApp { appId: string; owner: string; name: string; words: string[]; grants: number }

export interface KeepWorkingAppsOptions {
  /** Only these words; every word the code needs when omitted. */
  only?: readonly string[];
  /** The reason written in the app's change log. */
  reason?: string;
  /** Only a word some call found by one of these rules needs (ScopeNeed.rule), not the same word for another call. */
  rules?: readonly string[];
}

/**
 * For every app published before `cutoff` whose code needs a word its sign-in does not ask for:
 * record the allowance, put the words on its live grants, and note it in the app's own change log.
 * An app that already has an allowance gets only the words it lacks, and never a word its owner
 * removed. The callers (services/rest-scope-keep-working-migration.ts and
 * services/app-storage-read-keep-migration.ts) decide that this runs once.
 */
export async function keepWorkingAppsOnce(
  storage: Storage, config: Pick<AimeatConfig, 'nodeId'>, cutoff: number, opts: KeepWorkingAppsOptions = {},
): Promise<KeptApp[]> {
  const reason = opts.reason ?? 'kept working from 3.x: its code calls routes that 4.0.0 checks';
  const kept: KeptApp[] = [];
  const libCache = new Map<string, string | null>();
  const libText = async (name: string, file: string): Promise<string | null> => {
    const key = `${name}/${file}`;
    if (!libCache.has(key)) {
      const found = await resolveCortexLib(storage, name, file).catch((err: unknown) => {
        // The lib's calls are then not read; the app's own code still is.
        logger.warn('app scope allowance: a cortex lib could not be read', { lib: key, error: String(err) });
        return null;
      });
      libCache.set(key, found && found.ok ? found.content : null);
    }
    return libCache.get(key) ?? null;
  };
  for (let offset = 0; ; ) {
    const { apps, total } = await storage.listAppsWithContent({ adminView: true, limit: 200, offset, sort: 'newest' });
    for (const app of apps) {
      if (!/html/i.test(app.mimeType ?? '') && !/\.html?$/i.test(app.filename)) continue;
      const created = Date.parse(app.createdAt);
      if (!Number.isNaN(created) && created >= cutoff) continue;
      const appId = `${app.ownerName}/${app.filename}`;
      const had = await readAppScopeAllowance(storage, appId);
      const html = Buffer.isBuffer(app.data) ? app.data.toString('utf8') : String(app.data ?? '');
      const libs: Array<{ source: string; text: string }> = [];
      for (const ref of cortexLibRefs(html)) {
        const text = await libText(ref.name, ref.file);
        if (text !== null) libs.push({ source: ref.path, text });
      }
      const needs = undeclaredScopeNeeds(html, libs);
      const ruled = (n: { rule?: string }) => !opts.rules || (n.rule !== undefined && opts.rules.includes(n.rule));
      const missing = needs.missing.filter(w =>
        (!opts.only || opts.only.includes(w)) && !had?.words.includes(w) && !had?.removed.includes(w)
        && needs.needs.some(n => n.word === w && ruled(n)));
      if (!missing.length) continue;
      const evidence = (opts.rules ? needs.needs.filter(ruled) : needs.evidence).filter(e => missing.includes(e.word))
        .map(e => ({ word: e.word, source: e.source, evidence: e.evidence.slice(0, 240) }));
      await writeAllowance(storage, {
        spec: SPEC, appId, words: [...(had?.words ?? []), ...missing], removed: had?.removed ?? [],
        evidence: [...(had?.evidence ?? []), ...evidence],
        at: new Date().toISOString(),
      });
      let grants = 0;
      for (const grant of await liveGrantsOf(storage, appId)) {
        // Written on the list that was read, so a refresh or the owner's edit meanwhile is kept.
        const changed = await changeScopeList(storage, { kind: 'app-grant', id: grant.grantId }, grant.scopes, held => {
          const add = missing.filter(w => !held.includes(w));
          return add.length ? [...held, ...add] : null;
        });
        if (changed) grants++;
      }
      await recordAppAudit(storage, {
        ownerGhii: app.ownerGaii, filename: app.filename, by: `system@${config.nodeId}`, action: 'scope_allowance.kept',
        detail: { words: missing.join(', '), grants, reason },
      });
      kept.push({ appId, owner: app.ownerName, name: app.manifest?.name || app.filename, words: missing, grants });
    }
    offset += apps.length;
    if (!apps.length || offset >= total) break;
  }
  if (kept.length) emitChange('apps');
  return kept;
}

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;

/** The app this call names, in a bucket the caller may build in, or the refusal. */
async function allowanceTarget(storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: { owner: string; filename: string }) {
  if (!FILENAME_RE.test(ref.filename)) return refuse(400, 'INVALID_INPUT', 'Invalid filename.');
  const t = await resolveAppTarget(storage, config, {
    callerOwner: localAccountName(caller.owner), requestedOwner: ref.owner === 'me' ? '' : ref.owner,
    filename: ref.filename, act: 'draft',
  });
  if (!t.ok) return refuse(t.status, t.code, t.message);
  const app = await storage.getAppByOwnerName(t.ownerName, ref.filename);
  if (!app) return refuse(404, 'NOT_FOUND', 'No such app.');
  return { ok: true as const, app, appId: `${app.ownerName}/${app.filename}`, delegated: !!t.delegated };
}

const MEANING = 'These are permissions the app kept when this server moved to 4.0: its code calls routes that '
  + '4.0 checks, and its aimeat-scopes declaration does not name them. Every person signed in to the app '
  + 'keeps them. Remove a word you do not want the app to have; declaring the word in the app makes this '
  + 'list unnecessary.';

/** GET .../scope-allowance: the words the app keeps, the ones taken away, and why each was given. */
export async function readScopeAllowanceFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: { owner: string; filename: string },
): Promise<AppOpOutcome> {
  const found = await allowanceTarget(storage, config, caller, ref);
  if (!found.ok) return found;
  const a = await readAppScopeAllowance(storage, found.appId);
  return done({ app: found.appId, words: a?.words ?? [], removed: a?.removed ?? [], evidence: a?.evidence ?? [], at: a?.at ?? null, meaning: a ? MEANING : 'This app keeps no permissions from the move to 4.0.' });
}

/**
 * DELETE .../scope-allowance?words=a,b: the owner takes words away. They leave the allowance and
 * every live grant of the app (a word a grant's holder added by hand stays on that grant), and are
 * kept as removed. Owner only: a builder is refused.
 */
export async function removeScopeAllowanceFor(
  storage: Storage, config: AimeatConfig, caller: AppOpCaller, ref: { owner: string; filename: string }, rawWords: unknown,
): Promise<AppOpOutcome> {
  const found = await allowanceTarget(storage, config, caller, ref);
  if (!found.ok) return found;
  if (found.delegated) return refuse(403, 'FORBIDDEN', 'Only the app owner removes a permission the app kept.');
  const words = (Array.isArray(rawWords) ? rawWords : String(rawWords ?? '').split(/[\s,]+/))
    .map(w => String(w).trim()).filter(Boolean);
  if (!words.length) return refuse(400, 'INVALID_INPUT', 'words is required: the permission words to remove, for example ext:invoke.');
  const a = await readAppScopeAllowance(storage, found.appId);
  const taking = a ? words.filter(w => a.words.includes(w)) : [];
  if (!a || !taking.length) {
    return refuse(404, 'NOT_FOUND', `The app keeps none of: ${words.join(', ')}. Read the list with scope_allowance.`);
  }
  await writeAllowance(storage, {
    ...a, words: a.words.filter(w => !taking.includes(w)), removed: [...new Set([...a.removed, ...taking])],
  });
  let grants = 0;
  for (const grant of await liveGrantsOf(storage, found.appId)) {
    const own = heldOwnerAdded(grant);
    const next = grant.scopes.filter(s => !taking.includes(s) || own.includes(s));
    if (next.length === grant.scopes.length) continue;
    await storage.updateAppGrant(grant.grantId, { scopes: next });
    grants++;
  }
  await recordAppAudit(storage, {
    ownerGhii: found.app.ownerGaii, filename: found.app.filename, by: resolveIdentity(caller, config.nodeId),
    action: 'scope_allowance.removed', detail: { words: taking.join(', '), grants },
  });
  logger.info('app scope allowance: words removed by the owner', { app: found.appId, words: taking, grants });
  emitChange('apps');
  return done({ app: found.appId, removed: taking, words: a.words.filter(w => !taking.includes(w)), grants_changed: grants });
}
