/**
 * @file src/services/internet-opening/opening-notify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who hears what about an opening. Every operator hears of a request, an opening made
 *   without them, a new version of an open app, forms a new version adds and a request to extend; the
 *   owner hears the decision, a close they did not make, the reminder before the end, and a change of
 *   their trust. The texts are English fallbacks with a `notiftext.<type>` locale key, so the bell
 *   says them in the reader's language. Best-effort: notify() never throws.
 * @structure notifyOperators · tellOperators · tellOwner · formsText
 * @usage await tellOperators(ctx, 'internet_opening_requested', opening, { reason });
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { notify, type NotifAction, type NotifyInput } from '../notify.js';
import { listOperatorGhiis } from '../operators.js';
import { emitChange } from '../event-bus.js';
import { intakeFormKey } from '../app-intake-forms.js';
import type { OpeningCtx } from './opening-store.js';
import type { InternetOpening, IntakeFormRef } from './opening-types.js';

/** The operators' page of openings (public/views/admin/internet-openings-tab.js). */
export const OPENINGS_PAGE = '/v1/admin?tab=internet-openings';

/** Send one notification to every operator of this node. Returns how many were addressed. */
export async function notifyOperators(ctx: OpeningCtx, input: NotifyInput): Promise<number> {
  const operators = await listOperatorGhiis(ctx.storage, ctx.config);
  await Promise.all(operators.map(ghii => notify(ctx.storage, ghii, input)));
  return operators.length;
}

export function formsText(forms: IntakeFormRef[]): string {
  return forms.length ? forms.map(intakeFormKey).join(', ') : 'none';
}

const doorOf = (o: InternetOpening) =>
  `/v1/admin/internet-openings/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.filename)}`;

type OperatorNotice = 'internet_opening_requested' | 'internet_opening_opened' | 'internet_opening_version'
  | 'internet_opening_forms' | 'internet_opening_extend';

/** The operators hear of one event of an opening, with the buttons that answer it. */
export async function tellOperators(ctx: OpeningCtx, type: OperatorNotice, o: InternetOpening, vars: Record<string, string | number> = {}): Promise<void> {
  const app = `${o.owner}/${o.filename}`;
  const all: Record<string, string | number> = {
    app, owner: o.owner, reason: o.request?.reason ?? o.reason, forms: formsText(o.request?.forms ?? o.forms),
    until: (o.until ?? '').slice(0, 10), by: o.owner, version: o.currentVersion ?? '', days: o.request?.days ?? o.days, ...vars,
  };
  const decide: NotifAction[] = [
    { id: 'approve', label: 'Approve', kind: 'api', method: 'POST', endpoint: `${doorOf(o)}/decision`, body: { decision: 'approve' }, style: 'primary' },
    { id: 'decline', label: 'Decline', kind: 'navigate', link: OPENINGS_PAGE },
  ];
  const close: NotifAction = { id: 'close', label: 'Close it', kind: 'api', method: 'POST', endpoint: `${doorOf(o)}/close`, body: { reason: 'Closed from the notification.' }, confirm: true, style: 'danger' };
  const texts: Record<OperatorNotice, { title: string; body: string; actions: NotifAction[] }> = {
    internet_opening_requested: {
      title: `${o.owner} asks to open ${app} to the internet`,
      body: `Reason: ${all.reason}. Forms that open with it: ${all.forms}. It stays closed until an operator approves.`,
      actions: decide,
    },
    internet_opening_opened: {
      title: `${o.owner} opened ${app} to the internet`,
      body: `Reason: ${all.reason}. Open until ${all.until}. Forms open with it: ${all.forms}.`,
      actions: [close],
    },
    internet_opening_version: {
      title: `New version of ${app}, which is open to the internet`,
      body: `${all.by} published version ${all.version}. Everyone on the internet sees it now.`,
      actions: [{ id: 'open', label: 'Open the app', kind: 'navigate', link: `/v1/apps/${encodeURIComponent(o.owner)}/${encodeURIComponent(o.filename)}` }, close],
    },
    internet_opening_forms: {
      title: `${app} asks to open more forms to the internet`,
      body: `Version ${all.version} submits to ${all.forms}. Those forms stay closed until an operator approves; the app stays open.`,
      actions: decide,
    },
    internet_opening_extend: {
      title: `${o.owner} asks to keep ${app} open to the internet longer`,
      body: `Reason: ${all.reason}. ${all.days} more days from the approval.`,
      actions: decide,
    },
  };
  const t = texts[type];
  await notifyOperators(ctx, { type, title: t.title, body: t.body, link: OPENINGS_PAGE, actions: t.actions, i18n: { key: type, vars: all } });
  emitChange('internet-openings');
}

type OwnerNotice = 'internet_opening_approved' | 'internet_opening_declined' | 'internet_opening_closed'
  | 'internet_opening_reminder' | 'internet_opening_trusted' | 'internet_opening_untrusted';

/** The owner hears of one event of their opening or their trust. */
export async function tellOwner(ctx: OpeningCtx, owner: string, type: OwnerNotice, vars: Record<string, string | number>): Promise<void> {
  const v = (k: string) => String(vars[k] ?? '');
  const texts: Record<OwnerNotice, { title: string; body: string }> = {
    internet_opening_approved: { title: `${v('app')} is open to the internet`, body: `${v('by')} approved it. Open until ${v('until')}.` },
    internet_opening_declined: { title: `Opening ${v('app')} to the internet was declined`, body: `${v('by')}: ${v('note')}` },
    internet_opening_closed: { title: `${v('app')} is no longer open to the internet`, body: v('reason') },
    internet_opening_reminder: { title: `${v('app')} closes to the internet on ${v('until')}`, body: 'Extend it with a new reason, or let it close.' },
    internet_opening_trusted: { title: 'You may open apps to the internet on your own', body: `${v('by')} gave you the right. Reason: ${v('reason')}.` },
    internet_opening_untrusted: { title: 'Opening an app to the internet now needs an operator\'s approval', body: `${v('by')} took the right away. What you opened stays open.` },
  };
  const t = texts[type];
  const link = vars.app ? `/v1/apps/${String(vars.app)}` : '/v1/profile';
  await notify(ctx.storage, `${owner}@${ctx.config.nodeId}`, { type, title: t.title, body: t.body, link, i18n: { key: type, vars } });
}
