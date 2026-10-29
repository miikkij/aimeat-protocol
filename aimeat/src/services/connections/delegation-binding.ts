/**
 * @file src/services/connections/delegation-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which author's app a delegation over a shared channel belongs to.
 *
 *   WHY (secaudit2026oct26 round 8c, delegated-publish/app-id-not-bound-to-caller). A delegation names
 *   its app by the label the channel owner typed, and an app sends that label when it publishes. A
 *   label that is only a file name (`app:funvids`) matched an app of that file name by ANY author, so
 *   another person could publish an app called funvids.html and post through the channel. The label
 *   itself cannot change: the app's own code carries it. So the node keeps, beside the delegation, the
 *   one app (`owner/filename`) it belongs to.
 *
 *   HOW A DELEGATION GETS ITS APP (the developer's decision, 2026-10-29):
 *     - a new delegation is bound when it is made: to the app its label names in full (`owner/file`),
 *       or to the channel owner's own app of that file name;
 *     - an older delegation with a bare file name binds itself to the channel owner's own app of that
 *       file name when its first use comes from that app (positive evidence), and the channel owner is
 *       told once;
 *     - when its first use comes from an app by another author, also when the channel owner holds an
 *       app of that name, the channel owner gets ONE question with Allow and Don't allow
 *       (services/approval-standard.ts). Allow binds it to that author's app; Don't allow keeps that
 *       app out. Nothing is published while the question waits.
 *
 *   WHERE. One record per delegation, `connections.delegation-app.<delegation id>`, under
 *   `system@<node>`, which no owner-scoped principal can address: the node reads it to decide who may
 *   post on someone's channel, so nobody but this module writes it.
 * @structure DelegationApp · bareLabel · labelNamesAuthor · readDelegationApp · bindDelegationApp ·
 *   noteAsked · noteDeclined · ownAppOf · bindOnSave · delegationView · tellBoundToOwnApp
 * @usage const bound = await readDelegationApp(storage, nodeId, delegation.id);
 * @version-history
 *   2026-10-29 — Initial (secaudit2026oct26 round 8c, delegated-publish/app-id-not-bound-to-caller).
 */
import type { Storage } from '../../storage/interface.js';
import type { DelegationRecord } from '../../models/connection-schemas.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { localAccountName } from '../../utils/gaii.js';
import { logger } from '../../utils/logger.js';

const SPEC = 'aimeat.delegation-app/v1';
const KEY_PREFIX = 'connections.delegation-app.';
const systemOf = (nodeId: string) => `system@${nodeId}`;

/** What the node keeps about one delegation's app. */
export interface DelegationApp {
  spec: typeof SPEC;
  delegation: string;
  /** The app it belongs to, `owner/filename`; null while it is not bound. */
  app: string | null;
  /** How it got bound: made bound, the channel owner's own app, or the channel owner's Allow. */
  how: 'created' | 'own-app' | 'owner-allowed' | null;
  boundAt: string | null;
  /** The questions the channel owner was asked, by the app asked about: the request id. */
  asked: Record<string, string>;
  /** The apps the channel owner did not allow. */
  declined: string[];
}

const empty = (delegation: string): DelegationApp =>
  ({ spec: SPEC, delegation, app: null, how: null, boundAt: null, asked: {}, declined: [] });

function parse(delegation: string) {
  return (v: unknown): DelegationApp => {
    const r = v as Partial<DelegationApp> | null | undefined;
    if (!r || r.spec !== SPEC) return empty(delegation);
    return {
      ...empty(delegation),
      app: typeof r.app === 'string' && r.app ? r.app : null,
      how: r.how ?? null,
      boundAt: typeof r.boundAt === 'string' ? r.boundAt : null,
      asked: r.asked && typeof r.asked === 'object' ? { ...r.asked } : {},
      declined: Array.isArray(r.declined) ? r.declined.filter((x): x is string => typeof x === 'string') : [],
    };
  };
}

/** The label without the `app:` or `eco:` a channel owner may have typed in front of it. */
export function bareLabel(label: string): string {
  return label.trim().replace(/^(app|eco):/i, '');
}

/** True when the label names its app in full (`owner/filename`), so the label itself binds it. */
export function labelNamesAuthor(label: string): boolean {
  return bareLabel(label).includes('/');
}

export async function readDelegationApp(storage: Storage, nodeId: string, delegationId: string): Promise<DelegationApp> {
  const rec = await storage.getMemory(systemOf(nodeId), `${KEY_PREFIX}${delegationId}`);
  return parse(delegationId)(rec?.value);
}

async function change(storage: Storage, nodeId: string, delegationId: string, fn: (cur: DelegationApp) => DelegationApp | typeof UNCHANGED): Promise<DelegationApp> {
  return updateRecord(storage, systemOf(nodeId), `${KEY_PREFIX}${delegationId}`, parse(delegationId), fn, { tag: 'delegation-app' });
}

/**
 * Bind the delegation to `app`. Answers the record as it stands: bound to `app`, or to another app it
 * was bound to before (a binding is never moved from here).
 */
export async function bindDelegationApp(
  storage: Storage, nodeId: string, delegationId: string, app: string, how: NonNullable<DelegationApp['how']>,
): Promise<DelegationApp> {
  return change(storage, nodeId, delegationId, cur => (cur.app
    ? UNCHANGED
    : { ...cur, app, how, boundAt: new Date().toISOString(), declined: cur.declined.filter(d => d !== app) }));
}

/** Record the question asked about `app`. */
export async function noteAsked(storage: Storage, nodeId: string, delegationId: string, app: string, requestId: string): Promise<void> {
  await change(storage, nodeId, delegationId, cur => (cur.asked[app] === requestId ? UNCHANGED : { ...cur, asked: { ...cur.asked, [app]: requestId } }));
}

/** Record that the channel owner did not allow `app`. */
export async function noteDeclined(storage: Storage, nodeId: string, delegationId: string, app: string): Promise<void> {
  await change(storage, nodeId, delegationId, cur => (cur.declined.includes(app) ? UNCHANGED : { ...cur, declined: [...cur.declined, app] }));
}

/**
 * The channel owner's own app that a bare label names (`funvids` or `funvids.html`), as
 * `owner/filename`; null when they have none, or when the label names an author.
 */
export async function ownAppOf(storage: Storage, channelOwnerGhii: string, label: string): Promise<string | null> {
  const bare = bareLabel(label);
  // An `eco:` label names an ecosystem app by its global name, never a file of the channel owner's.
  if (!bare || bare.includes('/') || /^eco:/i.test(label.trim())) return null;
  const filename = /\.html?$/i.test(bare) ? bare : `${bare}.html`;
  const app = await storage.getApp(channelOwnerGhii, filename).catch((err: unknown) => {
    logger.warn('delegation app: the channel owner\'s app could not be read; the delegation stays as it is', { owner: channelOwnerGhii, filename, error: String(err) });
    return null;
  });
  return app ? `${localAccountName(channelOwnerGhii)}/${filename}` : null;
}

/**
 * A delegation just made or saved again binds to the app its label names: in full (the label itself
 * binds it), or the channel owner's own app of that file name. Otherwise it stays unbound, and the
 * first app by another author that uses it asks the channel owner.
 */
export async function bindOnSave(storage: Storage, nodeId: string, channelOwnerGhii: string, d: DelegationRecord): Promise<void> {
  const own = await ownAppOf(storage, channelOwnerGhii, d.appId);
  if (own) await bindDelegationApp(storage, nodeId, d.id, own, 'created');
}

/** The delegation as the channel owner reads it, with the app it belongs to (`owner/filename`, null while not bound). */
export async function delegationView(storage: Storage, nodeId: string, d: DelegationRecord): Promise<DelegationRecord & { bound_app: string | null }> {
  if (labelNamesAuthor(d.appId)) return { ...d, bound_app: bareLabel(d.appId) };
  return { ...d, bound_app: (await readDelegationApp(storage, nodeId, d.id)).app };
}

/** Tell the channel owner, once, that an older delegation now takes only their own app. Never throws. */
export async function tellBoundToOwnApp(
  storage: Storage, channelOwnerGhii: string, d: { label: string; action: string; app: string },
): Promise<void> {
  const file = d.app.slice(d.app.indexOf('/') + 1);
  try {
    await notify(storage, channelOwnerGhii, {
      type: 'delegation_bound',
      title: `Only your own app ${file} may now publish as "${d.label}" on your channel`,
      body: `You let the app "${d.label}" publish "${d.action}" on your channel and named it only by its file name, so an app of the same name by someone else could have used the permission. From now on only your own app ${file} may use it. Its users publish through it as before.`,
      link: '/v1/profile?tab=notifications',
      i18n: { key: 'delegation_bound', vars: { label: d.label, action: d.action, app: file } },
    });
    emitChange('notifications', channelOwnerGhii);
  } catch (err) {
    logger.warn('delegation app: the channel owner could not be told about the binding; it stands', { owner: channelOwnerGhii, error: String(err) });
  }
}
