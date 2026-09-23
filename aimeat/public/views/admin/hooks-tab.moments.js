/**
 * @file hooks-tab.moments.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 02 of the admin Hooks page: one row per moment, grouped by what it guards.
 *
 *   The row leads with what the moment IS, not with its name: `pre_owner_registration` is the
 *   address of the thing, and "somebody is about to get an account" is the thing. Every row carries
 *   the chip that the old table never had, because it is the only fact on this page that can hurt:
 *   a gate DECIDES whether the thing happens, and the other seven are told afterwards.
 *
 *   A bound action says whether it still exists and whether it still carries an address, because
 *   both failures look exactly like a working binding from the config.
 *
 * @structure HookMoments({ data, onBind, busy, toSection }) — the filters, the groups, the rows
 * @usage <${HookMoments} data=${data} onBind=${bind} busy=${busy} toSection=${toSection} />
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: each moment is a list row (what
 *     it is, why, its name, the gate chip and what is bound at the right, the doors), the filters
 *     are tab actions, the gate's loud chip is the shared danger chip. No classes of its own.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster section heading.
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Stack, ListRow, Chip, Action, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** The three groups, in the order a person meets them. */
const GROUPS = ['accounts', 'work', 'social'];

/** What is bound to one moment, as lines a person can read. */
function Bound({ hook }) {
  if (hook.actions.length === 0) {
    return html`<${Badge} type="muted" label=${S('moments.nothingBound')} />`;
  }
  return html`<${Stack} density="compact" align="end">
    ${hook.actions.map(a => html`<${Text} key=${a.ref} kind="mono">
      ${a.name || a.ref}
      ${!a.published
        ? html` <${Text} kind="mono" tone="muted">${S('moments.notPublished')}<//>`
        : !a.has_address
          ? html` <${Text} kind="mono" tone="muted">${S('moments.noAddress')}<//>`
          : html` <${Text} kind="mono" tone="muted">· ${a.host}<//>`}
    <//>`)}
    ${hook.last
      ? html`<${Badge} type=${hook.last.allowed ? (hook.last.answer === 'ok' ? 'healthy' : 'watch') : 'danger'}
                       label=${S('runs.answer_' + hook.last.answer)} />`
      : html`<${Text} kind="mono" tone="muted">${S('moments.notCalledYet')}<//>`}
  <//>`;
}

export function HookMoments({ data, onBind, busy, toSection }) {
  const [only, setOnly] = useState('all');
  const { confirm, ConfirmUI } = useConfirm();

  const shown = useMemo(() => data.hooks.filter(h_ =>
    only === 'all' ? true : only === 'gates' ? h_.kind === 'gate' : h_.actions.length > 0), [data.hooks, only]);

  const clear = (hook) => confirm(S('moments.clearConfirm', { hook: hook.name }), () => onBind(hook.name, []), { danger: true });

  return html`<${Section} id="adm-hook-02" title=${S('moments.title')} count="02" description=${S('moments.lead')}
    actions=${[['all', S('moments.filterAll')], ['gates', S('moments.filterGates')], ['bound', S('moments.filterBound')]]
      .map(([id, label]) => html`<${Action} key=${id} kind="tab" selected=${only === id} onClick=${() => setOnly(id)}>${label}<//>`)}>
    <${Stack}>
      ${GROUPS.map(group => {
        const rows = shown.filter(h_ => h_.guards === group);
        if (rows.length === 0) return null;
        return html`<${Stack} key=${group} density="compact">
          <${Text} kind="label">${S('moments.group_' + group)}<//>
          <div>
            ${rows.map((hook) => html`<${ListRow} key=${hook.name}
              name=${S('moments.h_' + hook.name)} detail=${S('moments.w_' + hook.name)} detailKind="text"
              value=${html`<${Stack} density="compact" align="end">
                <${Text} kind="mono">${hook.name}<//>
                ${hook.kind === 'gate'
                  ? html`<${Chip} tone="danger">${S('moments.canRefuse')}<//>`
                  : html`<${Badge} type="info" label=${S('moments.toldAfter')} />`}
                <${Bound} hook=${hook} />
              <//>`}
              actions=${html`
                <${Action} disabled=${busy} onClick=${() => toSection('03')}>${S('moments.bind')}<//>
                ${hook.actions.length > 0
                  ? html`<${Action} tone="danger" disabled=${busy} onClick=${() => clear(hook)}>${S('moments.clear')}<//>`
                  : null}`} />`)}
          </div>
        <//>`;
      })}
      ${shown.length === 0 ? html`<${Text} tone="muted">${S('moments.noneMatch')}<//>` : null}
      ${data.runs.length > 0 ? html`<${Text} kind="caption" tone="muted">${S('moments.lastCall', { at: when(data.runs[0].at) })}<//>` : null}
    <//>
    <${ConfirmUI} />
  <//>`;
}
