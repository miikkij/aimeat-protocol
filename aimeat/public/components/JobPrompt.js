/**
 * @file public/components/JobPrompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a scheduled job sends each time it runs, in the Object box: a row label over it,
 *   the prompt's title at the page's size and its body in smaller grey words, long lines wrapped. The
 *   Scheduler's job page and an agent's schedules draw it alike (Jouni's decision "Box": a framed
 *   thing is the Object box, at the page's size). A page passes the words; it never writes a class.
 *   Its look is css/components/job-prompt.css with the box shape of css/poster.css.
 * @structure JobPrompt({ label, title, body })
 * @usage html`<${JobPrompt} label=${t('profile.scheduler.dispatches')} title=${d.title} body=${d.body} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the job prompt (.poster-box.job-prompt, written as markup in
 *     scheduler/detail.js and schedule-item.js) as a component that takes data (page group G5).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ label: any, title?: any, body?: any }} props */
export function JobPrompt({ label, title, body }) {
  if (!title && !body) return null;
  return html`<div class="poster-box box job-prompt">
    <span class="poster-label">${label}</span>
    ${title ? html`<div class="job-prompt-title">${title}</div>` : null}
    ${body ? html`<div class="job-prompt-body">${body}</div>` : null}
  </div>`;
}

export default JobPrompt;
