/**
 * @file public/views/profile/appdev/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the AppDev page's three lists, each four cells in the shared grid and,
 *   when open, a panel under them: a pitfall an agent filed (symptom, resolution, where it came
 *   from, the share / outdated / delete doors), a template proposal (what generalises, the source
 *   app, the packs, the proofs) and an entry of the platform's own registry (symptom, fix).
 * @structure learnedRow · proposalRow · curatedRow
 * @usage import { learnedRow, proposalRow, curatedRow } from './rows.js';
 * @version-history
 *   v1.7.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 -- 2026-09-25 -- A pitfall's severity is the Status (critical danger, warning attention, info off), a unification: Jouni's decision "Status".
 *   v1.5.0 -- 2026-09-25 -- A proposal's tier is the Tag (.poster-chip, plain: it names a level), a unification: Jouni's decision "Tag".
 *   v1.4.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.3.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.2.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.1.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { a, day, areaLabel, sevLabel, modeLabel, appName, appUrlOf, appUrl } from './frame.js';

const sev = (s) => html`<div class="ad-sv"><b class=${`poster-status ${s === 'critical' ? 'poster-status--danger' : s === 'info' ? 'poster-status--off' : 'poster-status--attention'}`}>${sevLabel(s)}</b></div>`;

/** A pitfall the owner's agents filed, or one another owner shared. */
export function learnedRow(ctx, p) {
  const key = p.key + (p.owner || '');
  const open = ctx.expanded === key;
  const own = p.source === 'own';
  const outdated = p.status === 'outdated';
  const busy = ctx.busy === p.key;
  const meta = [a('filedOn', { date: day(p.updated) }), p.app_ref ? appName(p.app_ref) : null, outdated ? a('outdatedMark') : null, !own ? a('communityMark') : null].filter(Boolean).join(' · ');
  return html`
    <div class=${`ad-p ${outdated ? 'ad-p--dim' : ''}`} key=${key}>
      ${sev(p.severity)}
      <div class="ad-ti">${p.title}<small>${meta}</small></div>
      <div class="ad-me"><b>${areaLabel(p.category)} · ${p.model || ''}</b></div>
      <div class="ad-go">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleRow(key)}>${open ? a('close') : a('open')}</button>
        ${own ? html`
          <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.toggleShare(p)}>${p.shared ? a('makePrivate') : a('shareAll')}</button>
          ${outdated
            ? html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeActive')}</button>
                   <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.removeLearned(p)}>${a('remove')}</button>`
            : html`<button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeOutdated')}</button>`}` : null}
      </div>
      ${open ? html`
        <div class="ad-open poster-aside">
          <span class="poster-label">${a('symptom')}</span><p>${p.symptom}</p>
          <span class="poster-label">${a('resolution')}</span><p>${p.resolution}</p>
          <span class="poster-label">${a('whence')}</span>
          <p>${own ? a('whenceOwn', { model: p.model || '', date: day(p.updated) }) : a('whenceShared', { model: p.model || '', who: p.owner || '', date: day(p.updated) })}
            ${p.app_ref ? html` · <a class="og-crumb-link" href=${appUrlOf(p.app_ref)} target="_blank" rel="noopener">${appName(p.app_ref)}</a>` : null}
            ${own ? html` · ${p.shared ? a('stateShared') : a('statePrivate')}` : null}
            ${outdated ? html` · ${a('outdatedMark')}` : null}</p>
          ${(p.applies_to || []).length ? html`<div class="poster-chips">${p.applies_to.map((x) => html`<span class="poster-chip" key=${x}>${areaLabel(x)}</span>`)}</div>` : null}
        </div>` : null}
    </div>`;
}

/** A template an agent proposed from a finished app. */
export function proposalRow(ctx, p) {
  const open = ctx.expanded === 'tpl:' + p.id;
  const busy = ctx.busy === 'tpl:' + p.id;
  const proofs = p.proofs || [];
  const passed = proofs.filter((x) => x.verdict === 'pass').length;
  const src = p.derivedFrom || {};
  const meta = [a('proposedOn', { date: day(p.createdAt) }), modeLabel(p.startMode), proofs.length ? a('proofsOf', { passed, n: proofs.length }) : a('noProof')].join(' · ');
  return html`
    <div class="ad-p" key=${'tpl:' + p.id}>
      <div class="ad-sv"><b class="poster-chip">${p.tier || '—'}</b></div>
      <div class="ad-ti">${p.title}<small>${meta}</small></div>
      <div class="ad-me"><b>${p.model || ''}</b>${appName(src.filename)}</div>
      <div class="ad-go">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleRow('tpl:' + p.id)}>${open ? a('close') : a('open')}</button>
        ${src.owner && src.filename ? html`<a class="poster-action poster-action--small poster-action--row poster-action--lower" href=${appUrl(src.owner, src.filename)} target="_blank" rel="noopener">${a('sourceApp')}</a>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--row poster-action--lower" disabled=${busy} onClick=${() => ctx.removeProposal(p)}>${a('remove')}</button>
      </div>
      ${open ? html`
        <div class="ad-open poster-aside">
          <p>${p.description}</p>
          <span class="poster-label">${a('generalises')}</span><p>${p.reuseNotes}</p>
          ${p.startModeRationale ? html`<span class="poster-label">${a('startMode')}</span><p>${modeLabel(p.startMode)}: ${p.startModeRationale}</p>` : null}
          <span class="poster-label">${a('derivedFrom')}</span><p>${src.owner}/${src.filename} · ${a('versionN', { n: src.version })}</p>
          ${(p.packs || []).length ? html`<span class="poster-label">${a('packs')}</span><div class="poster-chips">${p.packs.map((x) => html`<span class="poster-chip" key=${x}>${x}</span>`)}</div>` : null}
          ${proofs.length ? html`<span class="poster-label">${a('proofs')}</span><div class="poster-chips">${proofs.map((x, i) => html`<span class=${`poster-status ${x.verdict === 'pass' ? 'poster-status--fine' : 'poster-status--danger'}`} key=${i}>${x.model}: ${x.verdict === 'pass' ? a('proofPass') : a('proofFail')}</span>`)}</div>` : null}
        </div>` : null}
    </div>`;
}

/** One entry of the platform's own registry: read-only, the same for everyone. */
export function curatedRow(ctx, p) {
  const open = ctx.expanded === 'cur:' + p.id;
  return html`
    <div class="ad-p" key=${'cur:' + p.id}>
      ${sev(p.severity)}
      <div class="ad-ti">${p.title}<small>${a('updatedOn', { date: day(p.updatedAt) })}</small></div>
      <div class="ad-me"><b>${(p.appliesTo || []).map(areaLabel).join(' · ')}</b></div>
      <div class="ad-go"><button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggleRow('cur:' + p.id)}>${open ? a('close') : a('open')}</button></div>
      ${open ? html`
        <div class="ad-open poster-aside">
          <span class="poster-label">${a('symptom')}</span><p>${p.symptom}</p>
          <span class="poster-label">${a('resolution')}</span><p>${p.fix}</p>
        </div>` : null}
    </div>`;
}
