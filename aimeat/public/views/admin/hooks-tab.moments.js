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
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';
import { useConfirm } from '/components/Modal.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** The three groups, in the order a person meets them. */
const GROUPS = ['accounts', 'work', 'social'];

/** What is bound to one moment, as lines a person can read. */
function Bound({ hook }) {
  if (hook.actions.length === 0) {
    return html`<${Badge} type="muted" label=${S('moments.nothingBound')} />`;
  }
  return html`<div class="adm-hook-bound">
    ${hook.actions.map(a => html`
      <span key=${a.ref} class="adm-hook-bound-a">
        ${a.name || a.ref}
        ${!a.published
          ? html` <i>${S('moments.notPublished')}</i>`
          : !a.has_address
            ? html` <i>${S('moments.noAddress')}</i>`
            : html` <i>· ${a.host}</i>`}
      </span>`)}
    ${hook.last
      ? html`<span><${Badge} type=${hook.last.allowed ? (hook.last.answer === 'ok' ? 'healthy' : 'watch') : 'danger'}
                             label=${S('runs.answer_' + hook.last.answer)} /></span>`
      : html`<span class="adm-hook-mono">${S('moments.notCalledYet')}</span>`}
  </div>`;
}

export function HookMoments({ data, onBind, busy, toSection }) {
  const [only, setOnly] = useState('all');
  const { confirm, ConfirmUI } = useConfirm();

  const shown = useMemo(() => data.hooks.filter(h_ =>
    only === 'all' ? true : only === 'gates' ? h_.kind === 'gate' : h_.actions.length > 0), [data.hooks, only]);

  const clear = (hook) => confirm(S('moments.clearConfirm', { hook: hook.name }), () => onBind(hook.name, []), { danger: true });

  return html`
    <section class="og-sec" id="adm-hook-02">
      <div class="og-sec-h"><h2>${S('moments.title')}<small>02</small></h2>
        <div class="adm-hook-filters">
          ${[['all', S('moments.filterAll')], ['gates', S('moments.filterGates')], ['bound', S('moments.filterBound')]]
            .map(([id, label]) => html`
              <button type="button" key=${id} class=${'adm-hook-fchip' + (only === id ? ' on' : '')}
                      onClick=${() => setOnly(id)}>${label}</button>`)}
        </div>
      </div>
      <p class="adm-hook-lead">${S('moments.lead')}</p>

      ${GROUPS.map(group => {
        const rows = shown.filter(h_ => h_.guards === group);
        if (rows.length === 0) return null;
        return html`<div key=${group}>
          <div class="adm-hook-group">${S('moments.group_' + group)}</div>
          ${rows.map((hook, i) => html`
            <div key=${hook.name} class=${'adm-hook-row' + (i === rows.length - 1 ? ' adm-hook-row--last' : '')}>
              <span class="adm-hook-name">${hook.name}</span>
              <span>
                <b>${S('moments.h_' + hook.name)}</b>
                <span class="adm-why">${S('moments.w_' + hook.name)}</span>
              </span>
              <span>${hook.kind === 'gate'
                ? html`<span class="adm-hook-gate">${S('moments.canRefuse')}</span>`
                : html`<${Badge} type="info" label=${S('moments.toldAfter')} />`}</span>
              <span><${Bound} hook=${hook} /></span>
              <span class="adm-hook-rowacts">
                <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => toSection('03')}>${S('moments.bind')}</button>
                ${hook.actions.length > 0
                  ? html`<button type="button" class="og-door og-door--danger" disabled=${busy} onClick=${() => clear(hook)}>${S('moments.clear')}</button>`
                  : null}
              </span>
            </div>`)}
        </div>`;
      })}
      ${shown.length === 0 ? html`<div class="adm-hook-empty">${S('moments.noneMatch')}</div>` : null}
      ${data.runs.length > 0 ? html`<p class="adm-hook-note">${S('moments.lastCall', { at: when(data.runs[0].at) })}</p>` : null}
      <${ConfirmUI} />
    </section>`;
}
