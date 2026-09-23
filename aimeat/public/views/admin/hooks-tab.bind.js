/**
 * @file hooks-tab.bind.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 03 of the admin Hooks page: binding a moment to an address, beside the
 *   contract the address has to answer.
 *
 *   THE FORM THAT DID NOT EXIST. The PUT route has accepted a binding since the hooks were written;
 *   no frontend function ever called it, so the page could take a binding away and never make one.
 *   An operator who wanted a hook had to write curl.
 *
 *   The contract is on the page rather than in a document nobody has, because it is four lines: what
 *   the node POSTs, and the four answers it understands. The dashed box beside it says the thing
 *   that costs money to learn the other way, which is that a gate whose address is down refuses
 *   everything it guards.
 *
 * @structure HookBind({ data, onBind, busy }) — the moment, the picker, the order, the contract
 * @usage <${HookBind} data=${data} onBind=${bind} busy=${busy} />
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the two pickers are shared
 *     select fields, the picked actions chips with a remove icon, the contract two code surfaces and
 *     the warning the shared aside. No classes of its own.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose the shared heading and externalize spacing.
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section, Columns, Stack, Field, Action, Chip, Surface, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** The example body, with the chosen moment written into it so it is this node's own. */
function sentExample(hook, nodeId) {
  return `POST <your address>\nContent-Type: application/json\n\n{\n  "hook": "${hook}",\n  "action_ref": "<the action you bound>",\n  "context": { "name": "alice", "display_name": "Alice" },\n  "node_id": "${nodeId}",\n  "timestamp": "${new Date().toISOString()}"\n}`;
}

export function HookBind({ data, onBind, busy }) {
  const [hook, setHook] = useState(data.hooks[0]?.name ?? '');
  const [picked, setPicked] = useState([]);
  const [touched, setTouched] = useState(false);

  const row = data.hooks.find(h_ => h_.name === hook) ?? data.hooks[0];
  // Until the operator touches the picker, the form shows what is bound to the chosen moment: the
  // form IS the moment's state, so opening it on an empty list would read as "nothing is bound".
  const refs = touched ? picked : (row?.actions ?? []).map(a => a.ref);
  const available = useMemo(
    () => data.bindable_actions.filter(a => !refs.includes(a.ref)),
    [data.bindable_actions, refs]);

  const choose = (name) => { setHook(name); setPicked([]); setTouched(false); };
  const add = (ref) => { setPicked([...refs, ref]); setTouched(true); };
  const drop = (ref) => { setPicked(refs.filter(r => r !== ref)); setTouched(true); };
  const save = async () => { if (await onBind(hook, refs)) setTouched(false); };

  const nameOf = (ref) => data.bindable_actions.find(a => a.ref === ref)?.name ?? ref;
  const gate = row?.kind === 'gate';
  const seconds = Math.round(data.summary.timeout_ms / 1000);

  return html`<${Section} id="adm-hook-03" title=${S('bind.title')} count="03" description=${S('bind.lead')}>
    <${Columns} layout="equal" collapse=${900}>
      <${Stack} density="roomy">
        <${Stack} density="compact">
          <${Field} type="select" label=${S('bind.theMoment')} value=${hook} onChange=${e => choose(e.target.value)}
            options=${data.hooks.map(h_ => ({ value: h_.name, label: h_.name }))} />
          <${Text} kind="mono" tone="muted">${gate ? S('moments.canRefuse') : S('moments.toldAfter')}<//>
          <${Text} kind="caption" tone="muted">${S('moments.w_' + (row?.name ?? ''))}<//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${S('bind.whatItCalls')}<//>
          ${refs.length > 0 ? html`<${Stack} direction="wrap" align="center" density="compact">
            ${refs.map((ref, i) => html`<${Stack} key=${ref} direction="horizontal" align="center" density="compact">
              <${Chip}>${i + 1}. ${nameOf(ref)}<//>
              <${Action} kind="icon" label=${S('bind.remove')} onClick=${() => drop(ref)}>✗<//>
            <//>`)}
          <//>` : null}
          ${data.bindable_actions.length === 0
            ? html`<${Text} kind="caption" tone="muted">${S('bind.noActions')}<//>`
            : available.length === 0
              ? html`<${Text} kind="caption" tone="muted">${S('bind.allPicked')}<//>`
              : html`<${Field} type="select" ariaLabel=${S('bind.pickAction')} value="" onChange=${e => { if (e.target.value) add(e.target.value); }}
                  options=${[{ value: '', label: S('bind.pickAction') }, ...available.map(a => ({
                    value: a.ref, label: `${a.name}${a.has_address ? ` · ${a.host}` : ` · ${S('bind.optionNoAddress')}`}`,
                  }))]} />`}
          <${Text} kind="caption" tone="muted">${S('bind.actionsWhy')}<//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${S('bind.order')}<//>
          <${Text} kind="caption" tone="muted">
            ${refs.length === 0 ? S('bind.orderNone') : gate ? S('bind.orderGate') : S('bind.orderNotify')}
          <//>
        <//>

        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${busy || !touched} onClick=${save}>
            ${refs.length === 0 ? S('bind.clearIt') : S('bind.bindIt')}
          <//>
          ${touched ? html`<${Action} onClick=${() => setTouched(false)}>${S('bind.cancel')}<//>` : null}
        <//>
      <//>

      <${Stack}>
        <${Stack} density="compact">
          <${Text} kind="label">${S('bind.whatIsSent')}<//>
          <${Surface} kind="code">${sentExample(hook, data.node_id ?? '')}<//>
        <//>
        <${Stack} density="compact">
          <${Text} kind="label">${S('bind.whatItAnswers')}<//>
          <${Surface} kind="code">${S('bind.contract', { s: seconds })}<//>
        <//>
        <${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${S('bind.warnLabel')}<//>
          <${Text}>${S('bind.warnBody', { s: seconds })}<//>
        <//><//>
      <//>
    <//>
  <//>`;
}
