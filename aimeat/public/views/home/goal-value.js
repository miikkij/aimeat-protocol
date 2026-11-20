/**
 * @file public/views/home/goal-value.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The goal page's "What it gave" section: the baseline the person gave when the goal was
 *   made, what the goal's works delivered and what happened to it since (kept as it was, corrected by
 *   someone else, opened by someone else, gone), what it cost, and the saving counted from the baseline.
 *   Read from the person's own value report (GET /v1/usage/summary?report=value, services/value/report.ts),
 *   which the node counts from writes, deletes and opens; nobody acknowledges anything.
 *
 *   Without a baseline the section says what it would count and gives the sentence to say to one's own
 *   AI; the saving is never guessed here. Composed from library components only.
 * @structure GoalValue({ goal })
 * @usage <${GoalValue} goal=${goal} /> in views/home/goal.js
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-n-hy-ty-n-kyy-kulu-hy-ty-ja-k-yt-n-rytmi, phase 3).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { money, date } from '/js/format.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { PageSection } from '/components/PageSection.js';
import { PromptCard } from '/components/PromptCard.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('home.goal.value.' + key, fallback);
const fill = (s, p) => Object.entries(p).reduce((acc, [k, v]) => acc.replace('{' + k + '}', String(v)), s);

/** Minutes as hours and minutes, the way a person says it. */
function duration(min) {
  const m = Math.max(0, Math.round(min));
  const hrs = Math.floor(m / 60);
  const rest = m % 60;
  if (hrs === 0) return fill(g('min', '{m} min'), { m: rest });
  return rest ? fill(g('hMin', '{h} h {m} min'), { h: hrs, m: rest }) : fill(g('h', '{h} h'), { h: hrs });
}

export function GoalValue({ goal }) {
  const [v, setV] = useState(undefined);

  useEffect(() => {
    let on = true;
    const from = (goal.created_at || '').slice(0, 10) || undefined;
    apiGet(`/v1/usage/summary?report=value${from ? `&from=${from}` : ''}`)
      .then((r) => { if (on) setV((r?.data?.goals ?? []).find((x) => x.goal_id === goal.id) ?? null); })
      .catch((err) => { swallowed('goal: the value report', err); if (on) setV(null); });
    return () => { on = false; };
  }, [goal.id, goal.updated_at, goal.created_at]);

  const b = goal.baseline;
  const per = b ? g('per.' + b.per, b.per) : '';
  const rows = [
    b
      ? { k: g('baseline', 'Without AI'), v: fill(g('baselineV', '{time} per {per}'), { time: duration(b.minutes), per }), sub: b.note || (b.set_at ? fill(g('setAt', 'You said so on {d}'), { d: date(b.set_at) }) : undefined) }
      : { k: g('baseline', 'Without AI'), v: g('noBaseline', 'Not told yet') },
    b?.measure && { k: g('measure', 'Should move'), v: b.measure },
    v && { k: g('results', 'Results'), v: String(v.results), sub: fill(g('resultsSub', '{asIs} as they were · {corrected} corrected · {used} opened by someone else · {gone} gone'), { asIs: v.as_is, corrected: v.corrected, used: v.used, gone: v.gone }) },
    { k: g('cost', 'AI cost'), v: money(goal.spent?.usd ?? 0) },
    v && v.saving_minutes !== null && { k: g('saving', 'Saving counted'), v: duration(v.saving_minutes), sub: g('savingSub', 'The baseline times the results still standing; your AI reads what it rests on.') },
  ].filter(Boolean);

  return html`
    <${PageSection} group ends title=${g('title', 'What it gave')}>
      <${Facts} wide rows=${rows} />
      ${!b && html`
        <${Note} kind="quiet">${g('noBaselineNote', 'Tell your AI how long the work takes you without AI, and this section counts the saving from it.')}<//>
        <${PromptCard} label=${g('promptLabel', 'Say it to your own AI')}
          prompt=${fill(g('prompt', 'The goal "{title}" takes me about … without AI (per result, per week or per month). Save it as the goal\'s baseline.'), { title: goal.title })}
          copyLabel=${g('copy', 'Copy')} />`}
      ${v === null && b && html`<${Note} kind="quiet">${g('noResults', 'No result of this goal has been counted yet.')}<//>`}
    <//>`;
}
