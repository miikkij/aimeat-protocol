/**
 * @file public/components/JobChips.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The jobs that run all the time, as a wrapping row of framed buttons: each the job's name
 *   in bold with how often it runs in typewriter; coral under the pointer, and a coral frame when its
 *   last run failed (`warn`). A press opens the job. A special view of the Scheduler page, drawn from
 *   data; the page passes the jobs and never a class. Its look is css/components/job-chips.css (its
 *   own class names: .job-chips, .job-chips-job, .job-chips-job--warn).
 * @structure JobChips({ items })
 * @usage html`<${JobChips} items=${list.map((f) => ({ key: f.id, name, note, warn: failed, onOpen: () => open(f) }))} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Its own class names (.sc-cont → .job-chips, .sc-job → .job-chips-job,
 *     .sc-job--warn → .job-chips-job--warn); every rule keeps its value (Jouni: components draw only
 *     their own class names, a move).
 *   v1.0.0 — 2026-09-26 — Initial: the Scheduler's continuous jobs (.sc-cont, .sc-job, written as
 *     markup in views/profile/scheduler/cover.js) as a component that takes data (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/**
 * @param {{ items: Array<{ key: any, name: any, note?: any, warn?: boolean, title?: string, onOpen?: () => void }> }} props
 */
export function JobChips({ items = [] }) {
  return html`<div class="job-chips">
    ${items.map((it) => html`<button type="button" key=${it.key} class=${it.warn ? 'job-chips-job job-chips-job--warn' : 'job-chips-job'} title=${it.title} onClick=${it.onOpen}>
      ${it.name}<i>${it.note}</i>
    </button>`)}
  </div>`;
}

export default JobChips;
