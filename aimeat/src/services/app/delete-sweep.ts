/**
 * @file src/services/app/delete-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Everything a whole-app delete removes besides the app's own rows: one list of steps,
 *   so the owner's delete (services/app/lifecycle.ts deleteOwnedApp, REST and MCP), the operator's
 *   delete (DELETE /v1/admin/apps/:owner/:filename) and the erasure of the account that owns the app
 *   (services/owner/erasure.ts, which calls deleteOwnedApp per app) remove the same things.
 *
 *   WHY IT EXISTS. Deleting an app removed its rows, screenshot, dependencies, compliance documents,
 *   plan and registered people, and left the rest: the settings values, the App Catalog checkpoints
 *   (up to eight bodies of about 750 kB each), the roster and its visit records, the icon, the draft
 *   slot, the bound skills, the internet opening and the grants people gave the app. The owner's
 *   records kept counting against the owner's key budget, and a later app of the same name
 *   inherited the grants, the opening and the roster.
 *
 *   FOR GOOD, NOT TO THE BIN. The app's own rows are deleted outright, so a record that only served
 *   the app is too: storage.bulkDeleteMemory, and the record's stored versions with it. A record in
 *   the bin would still count and could be restored without the app it belongs to. The compliance
 *   documents and the signup setting of the registered people go the way their own modules remove
 *   them, to the bin, which the sweeper empties after its grace period.
 *
 *   WHAT STAYS, AND WHY (each one carries the app's id on purpose):
 *   - The design spec and the roadmap: the owner's own delete and republish of an app keeps both
 *     (secaudit2026oct26; test/e2e-app-design-spec.ts holds it). They are the author's documents, in
 *     the platform's namespaces, so they do not count against the owner's keys; an erased account's
 *     go with the account (services/app/record-keys.ts appRecordsOfAuthor).
 *   - The app's audit log, `audit.apps.<filename>` and its yearly archives: the developer's ruling of
 *     2026-10-01 keeps audit information unless the owner sets a limit (services/app/audit-archive.ts),
 *     and an app that sold something or handled personal data still answers for what it did.
 *   - Purchases (app_purchases), paid contracts (metered entitlements), the tool interface versions
 *     those contracts pin (services/app/tool-interfaces.ts), a delisted market offering, and a
 *     beneficiary's share agreement: receipts and bookkeeping for sales already made.
 *   - Usage calls and their roll-ups: the metering ledger. Visits fold after thirteen months by the
 *     retention job (core:usage-visit-retention).
 *   - The revoked grants: a grant is revoked, never removed (storage/repositories/app-grant.repository.ts),
 *     and the row is the proof of the consent the person gave, and when.
 *   - Sent app invitations (the invitations table): the record of a mail the node sent in the
 *     inviter's name, counted by the inviter's sending limit. A pending one is cancelled here.
 *   - The held address (subdomain_sites): it holds the app's label against reuse by another account.
 *   - Fork lineage (app_forks): the attribution of a fork to its source author.
 *   - Moderation flags and appeals, the site change log line of the delete, people's own account
 *     events, AI decisions (they age out on their own), AI provenance records (copies of the bytes can
 *     still circulate), organism join requests made through the app, agents deployed from it and
 *     template proposals made from it: each belongs to another party or is a record of an act.
 *
 *   BEST EFFORT, STEP BY STEP. A failed step is logged and the next step runs: the app is already
 *   gone when this runs, and one store that cannot be reached must not keep the others.
 *
 *   A NAME SHARED WITH ANOTHER APP. Three keys are derived from the filename by a lossy rule (the
 *   data map drops `.html`, the App Catalog checkpoints and the content label flatten punctuation).
 *   Those are removed only when no remaining app of the owner derives the same key.
 * @structure
 *   - AppSweepTarget, AppSweepResult
 *   - APP_SWEEP_STEPS — the ordered list of what goes, one entry per store
 *   - removeAppLeftovers(storage, config, target) — run every step
 * @usage
 *   await removeAppLeftovers(storage, config, { ownerName, ownerGhii, filename, buckets: [app.ownerGaii] });
 * @version-history
 *   v1.1.3 — 2026-11-20 — The data-map id comes from services/app/app-ref.ts (appDataMapId) instead
 *     of a regex of this file's own; no change in behaviour.
 *   v1.1.2 — 2026-11-19 — The grants and push devices steps remove by app id in storage
 *     (revokeAppGrantsForApp, deletePushSubscriptionsForApp) instead of reading every row on the node.
 *   v1.1.1 — 2026-11-19 — The AI settings step keeps the owner's own role bindings of the app: the roles
 *     view shows them under the app marked gone, for the owner to remove (test/e2e-ai-roles.ts 13).
 *   v1.1.0 — 2026-11-19 — Each step runs in its own savepoint, so the account erasure, which runs this
 *     inside its transaction for every app the account owns, keeps going past a refused statement.
 *   v1.0.0 — 2026-11-19 — Initial: the delete completeness fix (feature audit 2026-11-19, 4.3). The
 *     first five steps moved here from deleteOwnedApp; the plan now goes for good instead of to the bin.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { inSavepoint } from '../tolerant-step.js';
import { appSlug } from '../../utils/gaii.js';
import { removeComplianceDocs } from '../compliance/docs.js';
import { holdAppLabels } from '../held-app-labels.js';
import { removeAppPartiesOfApp } from '../app-parties/app-removal.js';
import { DesignBookReasons, OWNER_NOTES_PREFIX } from '../design-book/reasons.js';
import { appPlanKey } from './plan.js';
import { appKeySegment, equalAppId, legacyAppSegment } from './record-keys.js';
import { appConfigKey } from './config.js';
import { appWorkspacesKey } from './workspaces.js';
import { appIconKey } from './seo.js';
import { appScopeAllowanceKey } from './scope-allowance-store.js';
/**
 * The roster invitations' key prefix, as services/app/member-invites.ts writes it (INVITE_PREFIX).
 * Repeated here because importing that module closes an import cycle through member-approve.ts and
 * audit.ts back to lifecycle.ts; test/e2e-app-delete-sweep.ts fails if the two ever differ.
 */
const INVITE_PREFIX = 'appmeminv.';
import { cancelAppInviteLinks } from './invite-link.js';
import { agentFaceKey } from '../agent/face.js';
import { appToolsKey } from '../../models/app-tool-schemas.js';
import { behaviourAppKey } from '../../models/behaviour-schemas.js';
import { appDataMapKey } from '../data-map/data-map-types.js';
import { mosaicKey } from '../app-ui/service.js';
import { streamKey, monthKeyPrefix } from '../../models/signal-schemas.js';
import { getStream, deleteStream } from '../signals/signal-service.js';
import { pageStreamId } from '../signals/page-views.js';
import { openingKey, openingOwner } from '../internet-opening/opening-types.js';
import { refreshOpenings } from '../internet-opening/opening-registry.js';
import { appTarget } from '../classification/containers.js';
import { ROLES_KEY } from '../ai/roles.js';
import { updateMemoryRecord, UNCHANGED } from '../record-cas.js';
import { reconcileOwnerOfferings } from '../exchange/projection.js';
import { listSkillsByBinding, deleteSkill } from '../skills.js';
import { appDataMapId } from './app-ref.js';

/** The app a whole-app delete removed. */
export interface AppSweepTarget {
  /** The owner's bare account name. */
  ownerName: string;
  /** The owner's GHII: the namespace of the owner's records. */
  ownerGhii: string;
  filename: string;
  /** Every ownerGaii bucket the delete found the app in (old publish paths wrote shadow buckets). */
  buckets?: string[];
}

/** Which steps did not finish. Empty when every store was reached. */
export interface AppSweepResult { failed: string[] }

interface SweepCtx {
  storage: Storage;
  config: AimeatConfig;
  t: AppSweepTarget;
  /** `owner/filename`. */
  appId: string;
  nodeId: string;
  /** The filenames of the owner's apps that are still there, for the shared-name guard; null when unknown. */
  remaining: string[] | null;
}

type Ref = { ownerGaii: string; key: string };

/** Delete rows for good, and the stored versions of each. */
async function dropRefs(storage: Storage, refs: Ref[]): Promise<number> {
  if (!refs.length) return 0;
  const n = await storage.bulkDeleteMemory(refs);
  for (const r of refs) await storage.pruneMemoryHistory(r.ownerGaii, r.key, 0);
  return n;
}

/** The rows of `key` (and, with `children`, of `key.*`) in one namespace, or in any when `owner` is null. */
async function refsOf(storage: Storage, owner: string | null, key: string, children = false): Promise<Ref[]> {
  const rows = await storage.listMemoryKeysByPrefix(key);
  return rows.filter(r => (owner === null || r.ownerGaii === owner) && (r.key === key || (children && r.key.startsWith(`${key}.`))));
}

/** The App Catalog's checkpoint slug (src/static/app-catalog/js/workcopy.js slugFor), written in one place there. */
function catalogSlug(owner: string, filename: string): string {
  return `${owner}-${filename}`.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80);
}

/** A record keyed by a legacy (lossy) app segment, removed only when its own appId says it is this app. */
async function legacyRefs(storage: Storage, key: string, appId: string): Promise<Ref[]> {
  const out: Ref[] = [];
  for (const r of await refsOf(storage, null, key)) {
    const rec = await storage.getMemory(r.ownerGaii, r.key);
    if (equalAppId((rec?.value as { appId?: string } | null)?.appId ?? '', appId)) out.push(r);
  }
  return out;
}

/**
 * Every store a whole-app delete reaches, in order. One entry per store: a later store is one more
 * line here, and test/e2e-app-delete-sweep.ts names it in its own list.
 */
export const APP_SWEEP_STEPS: ReadonlyArray<{ name: string; run: (c: SweepCtx) => Promise<unknown> }> = [
  // The first five moved here from deleteOwnedApp unchanged.
  { name: 'compliance documents', run: c => removeComplianceDocs(c.storage, c.nodeId, { kind: 'app', ownerName: c.t.ownerName, app: c.t.filename }) },
  // Its own address stays as a held name for this owner, and the hold's clock starts now
  // (services/held-app-labels.ts; secaudit2026oct22). The daily sweep starts it if this fails.
  { name: 'held address', run: c => holdAppLabels(c.storage, c.t.ownerName, c.t.filename) },
  // The plan, or the structure page would list a deleted app as one being built.
  // For good rather than through deleteAppPlan, which puts the record in the bin.
  { name: 'plan', run: async c => dropRefs(c.storage, await refsOf(c.storage, null, appPlanKey(c.appId))) },
  // The people who registered to it: their rows and addresses, what they kept, their roster rows and
  // the signup setting. Their e-mail addresses are the owner's personal data about them.
  { name: 'registered people', run: c => removeAppPartiesOfApp(c.storage, c.nodeId, c.t.ownerName, c.t.ownerGhii, c.t.filename) },
  // The Design Book's reasons: a part must not look favoured by apps that no longer exist. Before the
  // build notes go, because the notes say which part records the app wrote into.
  { name: 'Design Book reasons', run: c => new DesignBookReasons(c.storage, { nodeId: c.nodeId }).forget(c.t.ownerGhii, c.t.ownerName, c.t.filename) },

  { name: 'draft', run: c => c.storage.deleteAppDraft(c.t.ownerGhii, c.t.filename) },
  {
    name: 'icon', run: async c => {
      // An app with no icon has none to delete; a storage error fails the step and is logged there.
      for (const b of new Set([c.t.ownerGhii, ...(c.t.buckets ?? [])])) await c.storage.deleteStorageFile(b, appIconKey(c.t.filename));
    },
  },
  {
    // The owner's records that exist only for this app: its settings values, its tool manifest, the
    // workspaces an installed copy uses, its agent face, its Atelier layout, its behaviour record and
    // the owner's build notes.
    name: 'owner records', run: async c => {
      const { storage, t } = c;
      const keys = [
        appConfigKey(t.filename), appToolsKey(t.filename), appWorkspacesKey(t.filename), agentFaceKey(t.filename),
        mosaicKey(t.filename), behaviourAppKey(t.filename), `${OWNER_NOTES_PREFIX}${t.filename}`,
      ];
      const refs: Ref[] = [];
      for (const k of keys) refs.push(...await refsOf(storage, t.ownerGhii, k));
      await dropRefs(storage, refs);
    },
  },
  {
    // The tool manifest went, so the market listing projected from it is delisted (the record stays,
    // because a contract made under it points to it).
    name: 'market listing', run: c => reconcileOwnerOfferings(c.storage, c.t.ownerGhii, { appId: c.t.filename }),
  },
  {
    // Keys derived by a lossy rule: removed only when no remaining app derives the same one.
    name: 'shared-name records', run: async c => {
      const { storage, t } = c;
      if (c.remaining === null) throw new Error('the owner\'s other apps are unknown, so a shared name cannot be ruled out');
      const remaining = c.remaining;
      const stripped = (f: string) => appDataMapId(f);
      const refs: Ref[] = [];
      if (!remaining.some(f => stripped(f) === stripped(t.filename))) refs.push(...await refsOf(storage, t.ownerGhii, appDataMapKey(stripped(t.filename))));
      const slug = catalogSlug(t.ownerName, t.filename);
      if (!remaining.some(f => catalogSlug(t.ownerName, f) === slug)) refs.push(...await refsOf(storage, t.ownerGhii, `app-catalog.wc.${slug}`, true));
      await dropRefs(storage, refs);
      // appTarget's scope is the owner's GHII; the bare account name the target is built from here
      // would not carry the node, so the target is written with the GHII this sweep already has.
      if (!remaining.some(f => appSlug(f) === appSlug(t.filename))) await storage.deleteContentLabel({ ...appTarget(t.ownerName, t.filename), scope: t.ownerGhii });
    },
  },
  {
    // The platform's records of the app: the scope allowance, the roster (members, requests, visits,
    // the carry plan) and the roster invitations. The design spec and the roadmap stay (see the
    // header, WHAT STAYS). The pending mail
    // links of those invitations are cancelled first, while the invitations still name the addresses.
    name: 'platform records', run: async c => {
      const { storage, appId } = c;
      const seg = appKeySegment(appId);
      const invites = await refsOf(storage, null, `${INVITE_PREFIX}${seg}`, true);
      for (const r of invites) {
        const hash = r.key.slice(`${INVITE_PREFIX}${seg}.`.length);
        if (hash) await cancelAppInviteLinks(storage, appId, hash);
      }
      const refs: Ref[] = [...invites];
      for (const k of [appScopeAllowanceKey(appId), `appmemplan.${seg}`]) refs.push(...await refsOf(storage, null, k));
      for (const p of ['appmember.', 'appmemreq.', 'appmemseen.']) refs.push(...await refsOf(storage, null, `${p}${seg}`, true));
      // Records written before the v2 segment, which a read would migrate on sight.
      const legacy = legacyAppSegment(appId);
      for (const p of ['appscopeallowance.', 'appplan.']) refs.push(...await legacyRefs(storage, `${p}${legacy}`, appId));
      await dropRefs(storage, refs);
    },
  },
  {
    // The operator opened this app to the internet: the opening goes with the app, so a later app of
    // the same name is never open without the operator's own look.
    name: 'internet opening', run: async c => {
      await dropRefs(c.storage, await refsOf(c.storage, openingOwner(c.nodeId), openingKey(c.t.ownerName, c.t.filename)));
      await refreshOpenings({ storage: c.storage, config: c.config });
    },
  },
  {
    // The visitor counts of the app's page, when the stream was made for this app.
    name: 'visitor counts', run: async c => {
      const { storage, t } = c;
      const id = pageStreamId(t.filename);
      const stream = await getStream(storage, t.ownerGhii, id);
      if (!stream || !equalAppId((stream.group ?? '').replace(/^app:/, ''), c.appId)) return;
      // The addresses first: deleteStream puts the rows in the bin, and a key listing skips the bin.
      const months = (await storage.listMemoryKeysByPrefix(monthKeyPrefix(id))).filter(r => r.ownerGaii === t.ownerGhii);
      const refs = [...await refsOf(storage, t.ownerGhii, streamKey(id)), ...months];
      await deleteStream(storage, t.ownerGhii, id);
      await dropRefs(storage, refs);
    },
  },
  {
    // The owner's skills bound to the app describe an app that is gone. A node skill stays: the
    // operator publishes those.
    name: 'bound skills', run: async c => {
      const bound = await listSkillsByBinding(c.storage, c.config, `app:${c.t.ownerName}/${c.t.filename}`, { ownerName: c.t.ownerName });
      for (const s of bound) {
        if (s.scope !== 'user' || s.owner !== c.t.ownerName) continue;
        // deleteSkill puts its records in the bin; their addresses are read first, and they go for good.
        const refs = await refsOf(c.storage, c.t.ownerGhii, `skills.${s.name}`, true);
        await deleteSkill(c.storage, c.config, 'user', s.name, { owner: c.t.ownerName });
        await dropRefs(c.storage, refs);
      }
    },
  },
  {
    // Every live grant people gave the app is revoked; a later app of the same name asks again.
    // One statement in storage, which reads no other app's grants.
    name: 'grants', run: async c => { await c.storage.revokeAppGrantsForApp(c.appId); },
  },
  {
    // Devices that subscribed to notifications from the app's own origin.
    name: 'push devices', run: async c => { await c.storage.deletePushSubscriptionsForApp(c.appId); },
  },
  {
    // People's AI settings that name the app: a role bound to one of its declared roles, a daily
    // budget for it, its place on an allow list. The owner's own entries name the bare filename.
    name: 'AI settings', run: async c => {
      const { storage, t, appId } = c;
      const names = (owner: string, v: string) => equalAppId(v, appId) || (owner === t.ownerGhii && v === t.filename);
      for (const r of await refsOf(storage, null, ROLES_KEY)) {
        // The owner's own bindings stay: the roles view marks the app `gone` and the owner removes
        // them there (services/ai/roles-view.ts; test/e2e-ai-roles.ts test 13 holds it). Another
        // person's binding of this owner's app goes, because that person has no app left to see it by.
        if (r.ownerGaii === t.ownerGhii) continue;
        await updateMemoryRecord(storage, r.ownerGaii, r.key, rec => {
          const v = rec?.value as { bindings?: Record<string, unknown> } | null;
          const drop = Object.keys(v?.bindings ?? {}).filter(k => names(r.ownerGaii, k.slice(0, k.lastIndexOf('#'))));
          if (!v || !drop.length) return UNCHANGED;
          const bindings = { ...v.bindings };
          for (const k of drop) delete bindings[k];
          return { value: { ...v, bindings } };
        });
      }
      for (const r of await refsOf(storage, null, 'openrouter.settings')) {
        await updateMemoryRecord(storage, r.ownerGaii, r.key, rec => {
          const v = rec?.value as { app_quotas?: Record<string, unknown>; app_allowlist?: unknown } | null;
          if (!v) return UNCHANGED;
          const quotas = Object.keys(v.app_quotas ?? {}).filter(k => names(r.ownerGaii, k));
          const list = Array.isArray(v.app_allowlist) ? v.app_allowlist as unknown[] : null;
          const listed = list ? list.filter(e => typeof e === 'string' && names(r.ownerGaii, e)) : [];
          if (!quotas.length && !listed.length) return UNCHANGED;
          const app_quotas = { ...v.app_quotas };
          for (const k of quotas) delete app_quotas[k];
          return { value: { ...v, app_quotas, ...(list ? { app_allowlist: list.filter(e => !listed.includes(e)) } : {}) } };
        });
      }
    },
  },
];

/**
 * Remove what a deleted app leaves behind. Call it after the app's rows are gone, for a whole-app
 * delete only (one version gone is still an app).
 */
export async function removeAppLeftovers(storage: Storage, config: AimeatConfig, t: AppSweepTarget): Promise<AppSweepResult> {
  const nodeId = t.ownerGhii.slice(t.ownerGhii.indexOf('@') + 1);
  // Unknown when the list cannot be read: the shared-name step then removes nothing, because it
  // cannot tell whether another app still derives the same key.
  let remaining: string[] | null = null;
  try {
    const listed = await storage.listApps({ ownerGaii: t.ownerGhii, viewerGhii: t.ownerGhii, limit: 1000 });
    remaining = listed.apps.map(a => a.filename).filter(f => f !== t.filename);
  } catch (err) {
    logger.warn('removeAppLeftovers: the owner\'s other apps could not be listed; records a shared name derives stay', { filename: t.filename, error: String(err) });
  }
  const c: SweepCtx = { storage, config, t, appId: `${t.ownerName}/${t.filename}`, nodeId, remaining };
  const failed: string[] = [];
  for (const step of APP_SWEEP_STEPS) {
    try {
      // Its own savepoint inside an open transaction (the account erasure runs this in one): on
      // PostgreSQL a statement the database refuses would otherwise fail every step after it. Outside
      // a transaction (the owner's and the operator's delete) the savepoint is no savepoint.
      await inSavepoint(storage, () => step.run(c));
    } catch (err) {
      failed.push(step.name);
      logger.warn('removeAppLeftovers: a store was not cleared; the next one runs', { step: step.name, filename: t.filename, error: String(err) });
    }
  }
  return { failed };
}
