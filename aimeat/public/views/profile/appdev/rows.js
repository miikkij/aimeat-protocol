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
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { a, day, areaLabel, sevLabel, modeLabel, appName, appUrlOf, appUrl } from './frame.js';

const sev = (s) => html`<div class="ad-sv"><b class=${s === 'critical' ? 'is-crit' : s === 'info' ? 'is-info' : ''}>${sevLabel(s)}</b></div>`;

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
        <button type="button" class="og-door" onClick=${() => ctx.toggleRow(key)}>${open ? a('close') : a('open')}</button>
        ${own ? html`
          <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.toggleShare(p)}>${p.shared ? a('makePrivate') : a('shareAll')}</button>
          ${outdated
            ? html`<button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeActive')}</button>
                   <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.removeLearned(p)}>${a('remove')}</button>`
            : html`<button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeOutdated')}</button>`}` : null}
      </div>
      ${open ? html`
        <div class="ad-open">
          <span class="og-label">${a('symptom')}</span><p>${p.symptom}</p>
          <span class="og-label">${a('resolution')}</span><p>${p.resolution}</p>
          <span class="og-label">${a('whence')}</span>
          <p>${own ? a('whenceOwn', { model: p.model || '', date: day(p.updated) }) : a('whenceShared', { model: p.model || '', who: p.owner || '', date: day(p.updated) })}
            ${p.app_ref ? html` · <a class="og-crumb-link" href=${appUrlOf(p.app_ref)} target="_blank" rel="noopener">${appName(p.app_ref)}</a>` : null}
            ${own ? html` · ${p.shared ? a('stateShared') : a('statePrivate')}` : null}
            ${outdated ? html` · ${a('outdatedMark')}` : null}</p>
          ${(p.applies_to || []).length ? html`<div class="og-chips">${p.applies_to.map((x) => html`<span class="og-chip og-chip--dim og-chip--xs" key=${x}>${areaLabel(x)}</span>`)}</div>` : null}
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
      <div class="ad-sv"><b>${p.tier || '—'}</b></div>
      <div class="ad-ti">${p.title}<small>${meta}</small></div>
      <div class="ad-me"><b>${p.model || ''}</b>${appName(src.filename)}</div>
      <div class="ad-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggleRow('tpl:' + p.id)}>${open ? a('close') : a('open')}</button>
        ${src.owner && src.filename ? html`<a class="og-door og-door--quiet" href=${appUrl(src.owner, src.filename)} target="_blank" rel="noopener">${a('sourceApp')}</a>` : null}
        <button type="button" class="og-door og-door--quiet" disabled=${busy} onClick=${() => ctx.removeProposal(p)}>${a('remove')}</button>
      </div>
      ${open ? html`
        <div class="ad-open">
          <p>${p.description}</p>
          <span class="og-label">${a('generalises')}</span><p>${p.reuseNotes}</p>
          ${p.startModeRationale ? html`<span class="og-label">${a('startMode')}</span><p>${modeLabel(p.startMode)}: ${p.startModeRationale}</p>` : null}
          <span class="og-label">${a('derivedFrom')}</span><p>${src.owner}/${src.filename} · ${a('versionN', { n: src.version })}</p>
          ${(p.packs || []).length ? html`<span class="og-label">${a('packs')}</span><div class="og-chips">${p.packs.map((x) => html`<span class="og-chip og-chip--dim og-chip--xs" key=${x}>${x}</span>`)}</div>` : null}
          ${proofs.length ? html`<span class="og-label">${a('proofs')}</span><div class="og-chips">${proofs.map((x, i) => html`<span class=${`og-chip og-chip--xs ${x.verdict === 'pass' ? 'og-chip--sun' : 'og-chip--coral'}`} key=${i}>${x.model}: ${x.verdict === 'pass' ? a('proofPass') : a('proofFail')}</span>`)}</div>` : null}
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
      <div class="ad-go"><button type="button" class="og-door" onClick=${() => ctx.toggleRow('cur:' + p.id)}>${open ? a('close') : a('open')}</button></div>
      ${open ? html`
        <div class="ad-open">
          <span class="og-label">${a('symptom')}</span><p>${p.symptom}</p>
          <span class="og-label">${a('resolution')}</span><p>${p.fix}</p>
        </div>` : null}
    </div>`;
}
