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
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

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

  return html`
    <section class="og-sec" id="adm-hook-03">
      <div class="og-sec-h"><h2>${S('bind.title')}<small>03</small></h2></div>
      <p class="adm-hook-lead">${S('bind.lead')}</p>

      <div class="adm-hook-two">
        <div class="adm-hook-form">
          <div>
            <div class="adm-hook-lbl">${S('bind.theMoment')}</div>
            <div class="adm-hook-fld">
              <select value=${hook} onChange=${e => choose(e.target.value)}>
                ${data.hooks.map(h_ => html`<option key=${h_.name} value=${h_.name}>${h_.name}</option>`)}
              </select>
              <span class="adm-hook-mono">${gate ? S('moments.canRefuse') : S('moments.toldAfter')}</span>
            </div>
            <p class="adm-hook-note">${S('moments.w_' + (row?.name ?? ''))}</p>
          </div>

          <div>
            <div class="adm-hook-lbl">${S('bind.whatItCalls')}</div>
            ${refs.length > 0 ? html`
              <div class="adm-hook-picked">
                ${refs.map((ref, i) => html`
                  <span key=${ref} class="adm-hook-chip">
                    <span>${i + 1}. ${nameOf(ref)}</span>
                    <button type="button" aria-label=${S('bind.remove')} onClick=${() => drop(ref)}>✗</button>
                  </span>`)}
              </div>` : null}
            ${data.bindable_actions.length === 0
              ? html`<p class="adm-hook-note">${S('bind.noActions')}</p>`
              : available.length === 0
                ? html`<p class="adm-hook-note">${S('bind.allPicked')}</p>`
                : html`
                  <div class="adm-hook-fld" style=${refs.length > 0 ? 'margin-top:10px' : ''}>
                    <select value="" onChange=${e => { if (e.target.value) add(e.target.value); }}>
                      <option value="">${S('bind.pickAction')}</option>
                      ${available.map(a => html`
                        <option key=${a.ref} value=${a.ref}>
                          ${a.name}${a.has_address ? ` · ${a.host}` : ` · ${S('bind.optionNoAddress')}`}
                        </option>`)}
                    </select>
                  </div>`}
            <p class="adm-hook-note">${S('bind.actionsWhy')}</p>
          </div>

          <div>
            <div class="adm-hook-lbl">${S('bind.order')}</div>
            <p class="adm-hook-note" style="margin-top:0">
              ${refs.length === 0 ? S('bind.orderNone') : gate ? S('bind.orderGate') : S('bind.orderNotify')}
            </p>
          </div>

          <div class="adm-hook-acts">
            <button type="button" class="og-slab" disabled=${busy || !touched} onClick=${save}>
              ${refs.length === 0 ? S('bind.clearIt') : S('bind.bindIt')}
            </button>
            ${touched ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => setTouched(false)}>${S('bind.cancel')}</button>` : null}
          </div>
        </div>

        <div>
          <div class="adm-hook-lbl">${S('bind.whatIsSent')}</div>
          <div class="adm-hook-frame" style="margin-bottom:16px">
            <pre class="adm-hook-pre">${sentExample(hook, data.node_id ?? '')}</pre>
          </div>
          <div class="adm-hook-lbl">${S('bind.whatItAnswers')}</div>
          <div class="adm-hook-frame">
            <pre class="adm-hook-pre">${S('bind.contract', { s: seconds })}</pre>
          </div>
          <div class="og-box" style="margin-top:16px">
            <span class="og-box-label">${S('bind.warnLabel')}</span>
            <div class="adm-hook-box-body">${S('bind.warnBody', { s: seconds })}</div>
          </div>
        </div>
      </div>
    </section>`;
}
