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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure HookBind({ data, onBind, busy }) — the moment, the picker, the order, the contract
 * @usage <${HookBind} data=${data} onBind=${bind} busy=${busy} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): Field and Select for the moment
 *     and the action, removable Mark tags for the picked actions, Code blocks for the contract,
 *     SettingBox for the warning, Loud and Action for the buttons, Beside for the two columns.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose the shared heading and externalize spacing.
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { Field, FormActions } from '/components/Field.js';
import { Select } from '/components/Select.js';
import { Mark, Marks, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Action, Loud } from '/components/Action.js';
import { Beside, Stack } from '/components/Layout.js';

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

  const contract = html`
    <${Label} block>${S('bind.whatIsSent')}<//>
    <${Code} block>${sentExample(hook, data.node_id ?? '')}<//>
    <${Label} block>${S('bind.whatItAnswers')}<//>
    <${Code} block>${S('bind.contract', { s: seconds })}<//>
    <${SettingBox} label=${S('bind.warnLabel')}>${S('bind.warnBody', { s: seconds })}<//>`;

  return html`
    <${Section} id="adm-hook-03" num="03" title=${S('bind.title')}>
      <${Note} kind="lead">${S('bind.lead')}<//>

      <${Beside} wide side=${contract}>
        <${Stack} gap="large">
          <${Field} id="adm-hook-bind-moment" label=${S('bind.theMoment')}
            labelNote=${gate ? S('moments.canRefuse') : S('moments.toldAfter')} hint=${S('moments.w_' + (row?.name ?? ''))}>
            <${Select} id="adm-hook-bind-moment" value=${hook} onChange=${choose}
              options=${data.hooks.map(h_ => ({ value: h_.name, label: h_.name }))} />
          <//>

          <${Field} group label=${S('bind.whatItCalls')} hint=${S('bind.actionsWhy')}>
            ${refs.length > 0 ? html`
              <${Marks}>
                ${refs.map((ref, i) => html`
                  <${Mark} key=${ref} tone="ink" removeLabel=${S('bind.remove')} onRemove=${() => drop(ref)}>${i + 1}. ${nameOf(ref)}<//>`)}
              <//>` : null}
            ${data.bindable_actions.length === 0
              ? html`<${Note} kind="hint">${S('bind.noActions')}<//>`
              : available.length === 0
                ? html`<${Note} kind="hint">${S('bind.allPicked')}<//>`
                : html`<${Select} value="" placeholder=${S('bind.pickAction')} ariaLabel=${S('bind.pickAction')}
                    onChange=${(v) => { if (v) add(v); }}
                    options=${available.map(a => ({ value: a.ref, label: `${a.name}${a.has_address ? ` · ${a.host}` : ` · ${S('bind.optionNoAddress')}`}` }))} />`}
          <//>

          <${Field} group label=${S('bind.order')}>
            <${Note} kind="hint">${refs.length === 0 ? S('bind.orderNone') : gate ? S('bind.orderGate') : S('bind.orderNotify')}<//>
          <//>

          <${FormActions}>
            <${Loud} control disabled=${busy || !touched} onClick=${save}>
              ${refs.length === 0 ? S('bind.clearIt') : S('bind.bindIt')}
            <//>
            ${touched ? html`<${Action} small soft onClick=${() => setTouched(false)}>${S('bind.cancel')}<//>` : null}
          <//>
        <//>
      <//>
    <//>`;
}
