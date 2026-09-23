/**
 * @file hooks-tab.runs.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 04 of the admin Hooks page: every call the node made, newest first.
 *
 *   This did not exist. A gate refused a registration, the node wrote a line to the server log, and
 *   the operator saw nothing: nine people turned away looked exactly like nine people not bothering
 *   to sign up. A refusal here names what it stopped, so an account that could not be created has a
 *   reason somebody can read back to the person who was turned away.
 *
 * @structure HookRuns({ data }) — the filter, the table, the empty state
 * @usage <${HookRuns} data=${data} />
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the filters are tab actions on
 *     the section's row, the calls the shared table that stacks on a phone, the empty state a quiet
 *     line. No classes of its own.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster section heading.
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, when } from './shared.js';
import { Section, Stack, Table, Action, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.hooks.' + key, params);

/** How many rows show before the rest are behind a word. */
const PAGE = 25;

/** The tone each answer reads as. `no_address` is muted: nothing went wrong, nothing happened. */
const TONE = { ok: 'healthy', refused: 'danger', no_answer: 'danger', no_address: 'muted', missing: 'watch' };

export function HookRuns({ data }) {
  const [refusedOnly, setRefusedOnly] = useState(false);
  const [all, setAll] = useState(false);

  const rows = useMemo(
    () => (data.runs || []).filter(r => (refusedOnly ? !r.allowed || r.answer === 'refused' || r.answer === 'no_answer' : true)),
    [data.runs, refusedOnly]);
  const shown = all ? rows : rows.slice(0, PAGE);

  const tableRows = shown.map((r) => [
    { text: when(r.at), mono: true },
    { text: r.hook, mono: true },
    { text: r.actionName || r.actionRef, mono: true },
    html`<${Stack} direction="horizontal" align="center" density="compact">
      <${Badge} type=${TONE[r.answer] || 'muted'} label=${S('runs.answer_' + r.answer)} />
      ${r.status ? html`<${Text} kind="mono" tone="muted">${r.status}<//>` : null}
    <//>`,
    { text: S('runs.ms', { n: r.ms }), mono: true, align: 'end' },
    html`<${Stack} density="compact">
      <${Text} kind="mono">${r.subject || '—'}<//>
      ${!r.allowed ? html`<${Text} kind="caption" tone="muted">${S('runs.stopped')}${r.reason ? `: ${r.reason}` : ''}<//>`
        : r.reason ? html`<${Text} kind="caption" tone="muted">${r.reason}<//>` : null}
    <//>`,
  ]);

  return html`<${Section} id="adm-hook-04" title=${S('runs.title')} count="04" description=${S('runs.lead')}
    actions=${html`
      <${Action} kind="tab" selected=${!refusedOnly} onClick=${() => { setRefusedOnly(false); setAll(false); }}>${S('runs.filterAll')}<//>
      <${Action} kind="tab" selected=${refusedOnly} onClick=${() => { setRefusedOnly(true); setAll(false); }}>${S('runs.filterRefused')}<//>`}>
    <${Stack}>
      ${rows.length === 0
        ? html`<${Text} tone="muted">${(data.runs || []).length === 0 ? S('runs.none') : S('runs.noneMatch')}<//>`
        : html`<${Table} label=${S('runs.title')} collapse=${600} density="compact" rows=${tableRows}
            headers=${[S('runs.colWhen'), S('runs.colMoment'), S('runs.colCalled'), S('runs.colAnswer'), S('runs.colTook'), S('runs.colWhat')]} />`}

      ${rows.length > 0 ? html`<${Stack} direction="wrap" align="between">
        <${Text} kind="mono" tone="muted">${S('runs.shown', { n: shown.length, total: rows.length, kept: data.summary.runs_kept })}<//>
        ${rows.length > PAGE ? html`<${Action} onClick=${() => setAll(!all)}>${all ? S('runs.showFewer') : S('runs.showAll', { n: rows.length })}<//>` : null}
      <//>` : null}
    <//>
  <//>`;
}
