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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure HookMoments({ data, onBind, busy, toSection }) — the filters, the groups, the rows
 * @usage <${HookMoments} data=${data} onBind=${bind} busy=${busy} toSection=${toSection} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): Tabs (filter) for the filters,
 *     the List (cut name-desc-state-doors) with its Group headings for the moments, a coral Mark for
 *     the gate chip, Action for the doors. The moment's own name stands under what it is.
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
import { Section } from '/components/Section.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Group, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tinted } from '/components/Figure.js';
import { Stack } from '/components/Layout.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** The three groups, in the order a person meets them. */
const GROUPS = ['accounts', 'work', 'social'];

/** What is bound to one moment, as lines a person can read. */
function Bound({ hook }) {
  if (hook.actions.length === 0) {
    return html`<${Badge} type="muted" label=${S('moments.nothingBound')} />`;
  }
  return html`<${Stack} gap="tight">
    ${hook.actions.map(a => html`
      <${Note} key=${a.ref} kind="meta" mono>
        ${a.name || a.ref}
        ${!a.published
          ? html` <${Tinted} tone="dim">${S('moments.notPublished')}<//>`
          : !a.has_address
            ? html` <${Tinted} tone="dim">${S('moments.noAddress')}<//>`
            : html` <${Tinted} tone="dim">· ${a.host}<//>`}
      <//>`)}
    ${hook.last
      ? html`<span><${Badge} type=${hook.last.allowed ? (hook.last.answer === 'ok' ? 'healthy' : 'watch') : 'danger'}
                             label=${S('runs.answer_' + hook.last.answer)} /></span>`
      : html`<${Note} kind="meta" mono>${S('moments.notCalledYet')}<//>`}
  <//>`;
}

export function HookMoments({ data, onBind, busy, toSection }) {
  const [only, setOnly] = useState('all');
  const { confirm, ConfirmUI } = useConfirm();

  const shown = useMemo(() => data.hooks.filter(h_ =>
    only === 'all' ? true : only === 'gates' ? h_.kind === 'gate' : h_.actions.length > 0), [data.hooks, only]);

  const clear = (hook) => confirm(S('moments.clearConfirm', { hook: hook.name }), () => onBind(hook.name, []), { danger: true });

  return html`
    <${Section} id="adm-hook-02" num="02" title=${S('moments.title')}
      doors=${html`<${Tabs} tone="filter" value=${only} onSelect=${setOnly} label=${S('moments.title')}
        items=${[{ value: 'all', label: S('moments.filterAll') }, { value: 'gates', label: S('moments.filterGates') }, { value: 'bound', label: S('moments.filterBound') }]} />`}>
      <${Note} kind="lead">${S('moments.lead')}<//>

      <${List} cols="name-desc-state-doors" empty=${S('moments.noneMatch')}>
        ${GROUPS.map(group => {
          const rows = shown.filter(h_ => h_.guards === group);
          if (rows.length === 0) return null;
          return html`<${Group} key=${group} title=${S('moments.group_' + group)}>
            ${rows.map(hook => html`
              <${Row} key=${hook.name}>
                <${Name} meta=${hook.name} desc=${S('moments.w_' + hook.name)}>${S('moments.h_' + hook.name)}<//>
                <${Desc}><${Bound} hook=${hook} /><//>
                <${Cell}>${hook.kind === 'gate'
                  ? html`<${Mark} tone="coral">${S('moments.canRefuse')}<//>`
                  : html`<${Badge} type="info" label=${S('moments.toldAfter')} />`}<//>
                <${Doors}>
                  <${Action} small row soft disabled=${busy} onClick=${() => toSection('03')}>${S('moments.bind')}<//>
                  ${hook.actions.length > 0
                    ? html`<${Action} small row tone="danger" disabled=${busy} onClick=${() => clear(hook)}>${S('moments.clear')}<//>`
                    : null}
                <//>
              <//>`)}
          <//>`;
        })}
      <//>
      ${data.runs.length > 0 ? html`<${Note} kind="hint">${S('moments.lastCall', { at: when(data.runs[0].at) })}<//>` : null}
      <${ConfirmUI} />
    <//>`;
}
