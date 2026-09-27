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
 *   Every part is a library component; the page passes data and writes no class.
 *
 * @structure HookRuns({ data }) — the filter, the table, the empty state
 * @usage <${HookRuns} data=${data} />
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components only (admin group G2): Tabs (filter) for the filter,
 *     the canonical table (shared.js DataTable) for the calls, More for the foot, Note for the empty
 *     line and the reasons.
 *   v1.1.0 — 2026-09-13 — Compose the shared poster section heading.
 *   v1.0.0 — 2026-09-12 — Initial (the Hooks page in the poster face).
 */
import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Badge, DataTable, when } from './shared.js';
import { Section } from '/components/Section.js';
import { Tabs } from '/components/Tabs.js';
import { More } from '/components/List.js';
import { Note } from '/components/Note.js';

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

  return html`
    <${Section} id="adm-hook-04" num="04" title=${S('runs.title')}
      doors=${html`<${Tabs} tone="filter" value=${refusedOnly ? 'refused' : 'all'} onSelect=${(v) => { setRefusedOnly(v === 'refused'); setAll(false); }} label=${S('runs.title')}
        items=${[{ value: 'all', label: S('runs.filterAll') }, { value: 'refused', label: S('runs.filterRefused') }]} />`}>
      <${Note} kind="lead">${S('runs.lead')}<//>

      ${rows.length === 0
        ? html`<${Note} kind="quiet">${(data.runs || []).length === 0 ? S('runs.none') : S('runs.noneMatch')}<//>`
        : html`<${DataTable} scroll
            headers=${[S('runs.colWhen'), S('runs.colMoment'), S('runs.colCalled'), S('runs.colAnswer'), S('runs.colTook'), S('runs.colWhat')]}
            rows=${shown.map(r => [
              { text: when(r.at), mono: true },
              { text: r.hook, mono: true },
              { text: r.actionName || r.actionRef, mono: true },
              html`<${Badge} type=${TONE[r.answer] || 'muted'} label=${S('runs.answer_' + r.answer)} />${r.status ? html` <${Note} kind="meta" mono inline>${r.status}<//>` : null}`,
              { text: S('runs.ms', { n: r.ms }), mono: true },
              { mono: true, text: html`${r.subject || '—'}${!r.allowed
                ? html`<${Note} kind="meta">${S('runs.stopped')}${r.reason ? `: ${r.reason}` : ''}<//>`
                : r.reason ? html`<${Note} kind="meta">${r.reason}<//>` : null}` },
            ])} />`}

      ${rows.length > 0 ? html`
        <${More} note=${S('runs.shown', { n: shown.length, total: rows.length, kept: data.summary.runs_kept })}
          label=${all ? S('runs.showFewer') : S('runs.showAll', { n: rows.length })}
          onMore=${rows.length > PAGE ? () => setAll(!all) : undefined} />` : null}
    <//>`;
}
