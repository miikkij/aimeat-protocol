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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure
 *   HooksTab (default) — one read, RightNow (01) with the strip, then the sections from the sibling
 *     files: moments (02), bind (03), runs (04), and AskAi (05) here.
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (admin group G2): Section, Verdict and Readings,
 *     FigureStrip, Beside, SettingBox (`pre`) for the paste, Action for the doors, a coral
 *     Mark for the gate chip. The page sheet admin-hooks.css goes.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared section headings and externalize spacing.
 *   v2.0.0 — 2026-09-12 — The poster face and its own read: the status word, the metric rows, the
 *     strip and five numbered sections. Binding is possible from the page for the first time, and
 *     every call a hook makes is recorded and listed.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Spinner, ErrorBox, Badge, useToast, Toast, when } from './shared.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Beside } from '/components/Layout.js';
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
    S('now.logRead', { at: fmtTime(new Date()) }),
  ].join(' · ');
  const last = data.runs[0] || null;

  return html`
    <${Section} first id="adm-hook-01" num="01" title=${S('now.title')}
      doors=${html`<${Action} small soft onClick=${() => toSection('03')}>${S('now.bindOne')}<//>`}>
      <${Verdict} word=${word} tone=${gate ? 'danger' : undefined} line=${line} stamp=${log}
        doors=${gate ? html`<${Action} small tone="danger" onClick=${() => onBind(gate.name, [])}>${S('now.clearFailing', { hook: gate.name })}<//>` : undefined}>
        <${Readings} rows=${[
          { key: 'what', name: S('now.whatIs'), why: S('now.whatIsWhy'),
            mark: html`<${Badge} type="muted" label=${S('now.chipMoments', { n: s.total })} />`, value: S('now.whatIsVal') },
          { key: 'gates', name: S('now.gates', { n: s.gates }), why: S('now.gatesWhy', { rest: s.total - s.gates }),
            mark: html`<${Mark} tone="coral">${S('now.chipGates', { n: s.gates })}<//>`, value: 'pre_ · post_' },
          { key: 'bind', name: S('now.bindWhat'), why: s.actions_available === 0 ? S('now.bindWhatNone') : S('now.bindWhatWhy', { n: s.actions_with_address }),
            mark: html`<${Badge} type=${s.actions_available === 0 ? 'danger' : 'healthy'} label=${S('now.chipActions', { n: s.actions_available })} />`,
            value: 'POST /v1/actions' },
          { key: 'down', name: S('now.whenDown'), why: S('now.whenDownWhy', { s: Math.round(s.timeout_ms / 1000) }),
            mark: html`<${Badge} type="watch" label=${S('now.chipRefuses')} />`,
            value: S('now.whenDownVal', { s: Math.round(s.timeout_ms / 1000) }) },
          { key: 'last', name: S('now.lastRan'), why: S('now.lastRanWhy'),
            mark: html`<${Badge} type=${last ? (last.allowed ? 'healthy' : 'danger') : 'muted'}
                             label=${last ? S('runs.answer_' + last.answer) : S('now.chipNever')} />`,
            value: last
              ? html`${when(last.at)} · <${Action} small soft onClick=${() => toSection('04')}>${S('now.toRuns')}<//>`
              : S('now.neverVal'),
            last: true },
        ]} />
      <//>
      <${Strip} data=${data} />
    <//>`;
}

/** The numeral strip: the moments, the gates, what is bound, and what the calls have been doing. */
function Strip({ data }) {
  const s = data.summary;
  const failing = (data.failing || []).length;
  return html`<${FigureStrip} wrap items=${[
    { key: 'moments', n: s.total, label: S('strip.moments'), sub: S('strip.momentsSub') },
    { key: 'gates', n: s.gates, tone: 'notice', label: S('strip.gates'), sub: S('strip.gatesSub') },
    { key: 'bound', n: s.bound, tone: failing ? 'notice' : undefined, label: S('strip.bound'),
      sub: failing ? S('strip.boundFailing', { n: failing }) : S('strip.boundSub', { n: s.bound_gates }) },
    { key: 'calls', n: s.calls_24h, label: S('strip.calls'),
      sub: s.calls_24h === 0 ? S('strip.callsNone') : S('strip.callsSub', { refused: s.refused_24h, ms: s.median_ms ?? 0 }) },
  ]} />`;
}

/** Section 05: what an agent can do with these, and the paste. */
function AskAi() {
  const paste = buildHooksPrompt({ url: getNodeUrl() });
  return html`
    <${Section} id="adm-hook-05" num="05" title=${S('ai.title')}
      doors=${html`<${Action} small soft copy=${paste}>${S('ai.copy')}<//>`}>
      <${Beside} wide side=${html`<${SettingBox} pre label=${S('ai.label')}>${paste}<//>`}>
        <${Note} kind="lead">${S('ai.lead')}<//>
        <${Readings} rows=${[
          { key: 'read', name: S('ai.read'), why: S('ai.readWhy'), mark: null, value: 'aimeat_admin_hooks' },
          { key: 'write', name: S('ai.write'), why: S('ai.writeWhy'), mark: null, value: 'aimeat_admin_hook_set' },
          { key: 'publish', name: S('ai.publish'), why: S('ai.publishWhy'), mark: null, value: 'POST /v1/actions', last: true },
        ]} />
      <//>
    <//>`;
}

export default function HooksTab() {
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

  return html`<${Fragment}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${RightNow} data=${data} onBind=${bind} toSection=${toSection} />
    <${HookMoments} data=${data} onBind=${bind} busy=${busy} toSection=${toSection} />
    <${HookBind} data=${data} onBind=${bind} busy=${busy} />
    <${HookRuns} data=${data} />
    <${AskAi} />
  <//>`;
}
