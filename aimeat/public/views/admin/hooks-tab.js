/**
 * @file public/views/admin/hooks-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Hooks page in the poster face (design canvas "AIMEAT Admin Hooks"): the eleven
 *   moments in this node's life where it calls out to somebody's own code, which of them can refuse
 *   the thing outright, how to bind one, and every call the node has made.
 *
 *   The page opens on the word, and the word is whichever gate is failing. That is the whole reason
 *   this was rebuilt: a bound gate whose address stops answering refuses every registration on the
 *   node, and the old page could not say so. It could not bind one either, only clear.
 *
 * @structure
 *   HooksTab (default) — one read, RightNow (01) with the strip, then the sections from the sibling
 *     files: moments (02), bind (03), runs (04), and AskAi (05) here.
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face and its own read: the status word, the metric rows, the
 *     strip and five numbered sections. Binding is possible from the page for the first time, and
 *     every call a hook makes is recorded and listed.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, Badge, useToast, Toast, Row, when } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getNodeUrl } from '/js/services/auth.js';
import * as adminService from '/js/services/admin.js';
import { HookMoments } from './hooks-tab.moments.js';
import { HookBind } from './hooks-tab.bind.js';
import { HookRuns } from './hooks-tab.runs.js';
import { buildHooksPrompt } from './hooks-tab.prompt.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** Section 01: the word, its sentence, the log line, the five rows, the strip. */
function RightNow({ data, onBind, toSection }) {
  const s = data.summary;
  const failing = data.failing || [];
  const gate = failing.length ? data.hooks.find(h_ => h_.name === failing[0]) : null;
  const word = gate ? S('now.wordFailing') : s.bound > 0 ? S('now.wordBound', { n: s.bound }) : S('now.wordNone');
  const line = gate
    ? S('now.lineFailing', { hook: gate.name, what: gate.last?.actionName || gate.last?.actionRef || '' })
    : s.bound > 0
      ? S('now.lineBound', { n: s.bound, gates: s.bound_gates })
      : S('now.lineNone');
  const log = [
    S('now.logHooks', { n: s.total }),
    S('now.logBound', { n: s.bound }),
    S('now.logActions', { n: s.actions_available }),
    S('now.logRead', { at: new Date().toLocaleTimeString() }),
  ].join(' · ');
  const last = data.runs[0] || null;

  return html`
    <section class="og-sec og-sec--first" id="adm-hook-01">
      <div class="og-sec-h"><h2>${S('now.title')}<small>01</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => toSection('03')}>${S('now.bindOne')}</button>
        </div>
      </div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status ${gate ? 'danger' : ''}">${word}</div>
          <p class="adm-alert-line">${line}</p>
          <div class="adm-ov-up">${log}</div>
          ${gate ? html`<div style="margin-top: 14px;">
            <button type="button" class="og-door og-door--danger" onClick=${() => onBind(gate.name, [])}>
              ${S('now.clearFailing', { hook: gate.name })}
            </button>
          </div>` : null}
        </div>
        <div>
          ${Row({ title: S('now.whatIs'), why: S('now.whatIsWhy'),
            chip: html`<${Badge} type="muted" label=${S('now.chipMoments', { n: s.total })} />`,
            value: S('now.whatIsVal') })}
          ${Row({ title: S('now.gates', { n: s.gates }), why: S('now.gatesWhy', { rest: s.total - s.gates }),
            chip: html`<span class="adm-hook-gate">${S('now.chipGates', { n: s.gates })}</span>`,
            value: 'pre_ · post_' })}
          ${Row({ title: S('now.bindWhat'), why: s.actions_available === 0 ? S('now.bindWhatNone') : S('now.bindWhatWhy', { n: s.actions_with_address }),
            chip: html`<${Badge} type=${s.actions_available === 0 ? 'danger' : 'healthy'} label=${S('now.chipActions', { n: s.actions_available })} />`,
            value: 'POST /v1/actions' })}
          ${Row({ title: S('now.whenDown'), why: S('now.whenDownWhy', { s: Math.round(s.timeout_ms / 1000) }),
            chip: html`<${Badge} type="watch" label=${S('now.chipRefuses')} />`,
            value: S('now.whenDownVal', { s: Math.round(s.timeout_ms / 1000) }) })}
          ${Row({ title: S('now.lastRan'), why: S('now.lastRanWhy'),
            chip: html`<${Badge} type=${last ? (last.allowed ? 'healthy' : 'danger') : 'muted'}
                                 label=${last ? S('runs.answer_' + last.answer) : S('now.chipNever')} />`,
            value: last
              ? html`${when(last.at)} · <button type="button" class="og-door og-door--quiet" onClick=${() => toSection('04')}>${S('now.toRuns')}</button>`
              : S('now.neverVal'),
            last: true })}
        </div>
      </div>
      <${Strip} data=${data} />
    </section>`;
}

/** The numeral strip: the moments, the gates, what is bound, and what the calls have been doing. */
function Strip({ data }) {
  const s = data.summary;
  const failing = (data.failing || []).length;
  return html`
    <div class="og-strip">
      <div><b>${s.total}</b><span>${S('strip.moments')}</span><small>${S('strip.momentsSub')}</small></div>
      <div><b class="adm-hook-coral">${s.gates}</b><span>${S('strip.gates')}</span><small>${S('strip.gatesSub')}</small></div>
      <div><b class=${failing ? 'adm-hook-coral' : ''}>${s.bound}</b><span>${S('strip.bound')}</span>
        <small>${failing ? S('strip.boundFailing', { n: failing }) : S('strip.boundSub', { n: s.bound_gates })}</small></div>
      <div><b>${s.calls_24h}</b><span>${S('strip.calls')}</span>
        <small>${s.calls_24h === 0 ? S('strip.callsNone') : S('strip.callsSub', { refused: s.refused_24h, ms: s.median_ms ?? 0 })}</small></div>
    </div>`;
}

/** Section 05: what an agent can do with these, and the paste. */
function AskAi() {
  const paste = buildHooksPrompt({ url: getNodeUrl() });
  return html`
    <section class="og-sec" id="adm-hook-05">
      <div class="og-sec-h"><h2>${S('ai.title')}<small>05</small></h2>
        <div class="og-doors"><${CopyButton} text=${paste} label=${S('ai.copy')} className="og-door og-door--quiet" /></div></div>
      <div class="adm-hook-ai">
        <div>
          <p class="adm-hook-lead">${S('ai.lead')}</p>
          ${Row({ title: S('ai.read'), why: S('ai.readWhy'), chip: null, value: 'aimeat_admin_hooks' })}
          ${Row({ title: S('ai.write'), why: S('ai.writeWhy'), chip: null, value: 'aimeat_admin_hook_set' })}
          ${Row({ title: S('ai.publish'), why: S('ai.publishWhy'), chip: null, value: 'POST /v1/actions', last: true })}
        </div>
        <div class="og-box">
          <span class="og-box-label">${S('ai.label')}</span>
          <div class="adm-hook-paste">${paste}</div>
        </div>
      </div>
    </section>`;
}

export default function HooksTab() {
  useViewCSS('/css/views/admin-hooks.css');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, showError, showSuccess, clearToast] = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await adminService.getHooks();
      // The node's own id comes off the envelope, not the payload: the bind form writes it into the
      // example body so what a person copies is this node's, not a placeholder.
      setData(resp?.data ? { ...resp.data, node_id: resp.node } : null);
    } catch (err) {
      setError(err?.message || String(err));
      setData(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // A binding is a config write, and an action published elsewhere changes what can be bound.
  useEffect(() => onLiveUpdate(['config', 'features'], () => load()), [load]);

  /** The one write on this page: bind a list of actions to a moment, or clear it with an empty one. */
  const bind = useCallback(async (hook, actions) => {
    setBusy(true);
    try {
      const r = await adminService.setHook(hook, actions);
      if (r?.ok === false) throw new Error(r.error?.message || 'refused');
      const out = r?.data || {};
      showSuccess(out.note || S('bind.saved'));
      if (out.unknown?.length) showError(S('bind.unknown', { refs: out.unknown.join(', ') }));
      await load();
      return true;
    } catch (err) {
      showError(err?.message || String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [load, showSuccess, showError]);

  const toSection = (n) => document.getElementById('adm-hook-' + n)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (error) return html`<${ErrorBox} message=${error} />`;
  if (!data) return html`<${Spinner} text=${S('loading')} />`;

  return html`<div class="adm-hook">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${RightNow} data=${data} onBind=${bind} toSection=${toSection} />
    <${HookMoments} data=${data} onBind=${bind} busy=${busy} toSection=${toSection} />
    <${HookBind} data=${data} onBind=${bind} busy=${busy} />
    <${HookRuns} data=${data} />
    <${AskAi} />
  </div>`;
}
