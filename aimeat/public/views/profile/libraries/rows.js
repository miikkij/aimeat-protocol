/**
 * @file public/views/profile/libraries/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row of the Libraries page and what opens under it. The row: the pack's name
 *   with its version, its status and model words, what it gives, the name the code calls it by and
 *   how many published apps load it, the doors. Opened: the include lines, the text an AI gets,
 *   the API, the model words explained, the proof ledger, who uses it, where it is seen working,
 *   version, licence, size and source, the changelog.
 * @structure packRow · packOpen
 * @usage import { packRow } from './rows.js';
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { x, statusWord, modelWord, proofWord, isCommunity, appName, appUrlOf, aiTextFor } from './frame.js';

const dot = (p) => html`<i class=${`lb-dot ${p.status === 'deprecated' ? 'is-off' : 'is-on'}`} aria-hidden="true"></i>`;

function subLine(p) {
  const parts = [isCommunity(p) ? x('communityWord') : '', statusWord(p), modelWord(p), proofWord(p)].filter(Boolean);
  if ((p.requires || []).length) parts.push(x('requiresShort', { list: p.requires.join(', ') }));
  return parts.join(' · ');
}

function usesLine(p) {
  const n = p.used_by?.apps || 0;
  if (!n) return html`<small class="is-dim">${x('usedNone')}</small>`;
  return html`<small>${n === 1 ? x('usedOne') : x('usedMany', { n })}</small>`;
}

export function packRow(ctx, p) {
  const open = ctx.expanded === p.id;
  const deprecated = p.status === 'deprecated';
  return html`
    <div class=${`lb-p ${open ? 'is-open' : ''}`} key=${p.id}>
      <div class="lb-nm">${dot(p)}${p.title || p.id}${p.version ? html`<span class="lb-tag">${p.version}</span>` : null}<small class=${deprecated ? 'is-warn' : ''}>${deprecated && p.supersededBy ? `${statusWord(p)} → ${p.supersededBy}` : subLine(p)}</small></div>
      <div class="lb-ds">${p.description || ''}</div>
      <div class="lb-me">${p.apiSurface || p.id}${usesLine(p)}</div>
      <div class="lb-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggle(p)}>${open ? x('close') : x('open')}</button>
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.copyForAi(p)}>${x('copyAi')}</button>
      </div>
      ${open ? packOpen(ctx, p) : null}
    </div>`;
}

function modelExplained(p) {
  if (p.modelTier === 'any') return html`<b>${x('model.any')}.</b> ${x('model.anyLong')}`;
  if (p.modelTier === 'frontier') return html`<b>${x('model.frontier')}.</b> ${x('model.frontierLong')}`;
  if (isCommunity(p)) return x('model.communityLong');
  return x('model.needsDocLong');
}

function packOpen(ctx, p) {
  const d = ctx.details[p.id];
  if (!d) return html`<div class="lb-open"><p class="lb-empty">${t('common.loading')}</p></div>`;
  if (d.error) return html`<div class="lb-open"><p class="lb-empty">${d.error}</p></div>`;
  const include = Array.isArray(d.include) ? d.include : (p.include || []);
  const proofs = p.proofs || d.proofs || [];
  const used = p.used_by || {};
  const changelog = Array.isArray(d.changelog) ? d.changelog.slice().reverse() : [];
  const aiText = aiTextFor(p, d);
  return html`
    <div class="lb-open">
      <p class="lb-lead">${p.description || ''}</p>
      <div class="lb-kv">
        <div class="lb-k">${x('intoApp')}</div><div class="lb-v">${include.map((line) => html`<code key=${line}>${line}</code>`)}<small>${include.length > 1 ? x('intoAppOrder') : x('intoAppOne')} · <${CopyButton} text=${include.join('\n')} className="og-crumb-link" label=${x('copyLines')} copiedLabel=${x('copied')} /></small></div>
        <div class="lb-k">${x('forAi')}</div><div class="lb-v">${d.ai_doc ? x('forAiBody', { n: d.ai_doc.length.toLocaleString() }) : x('forAiNone')}<small>${x('forAiSub', { id: p.id })} · <${CopyButton} text=${aiText} className="og-crumb-link" label=${x('copyAi')} copiedLabel=${x('copied')} /> · <button type="button" class="og-crumb-link lb-linkbtn" onClick=${() => ctx.toggleDoc(p)}>${ctx.docShown === p.id ? x('hide') : x('show')}</button></small>${ctx.docShown === p.id && d.ai_doc ? html`<pre class="lb-out">${d.ai_doc}</pre>` : null}</div>
        ${p.apiSurface ? html`<div class="lb-k">${x('api')}</div><div class="lb-v"><code>${p.apiSurface}</code></div>` : null}
        <div class="lb-k">${x('forModel')}</div><div class="lb-v">${modelExplained(p)}${p.apiCaveat ? html`<div class="lb-warnbox">${x('caveatLead')} ${p.apiCaveat}</div>` : null}</div>
        <div class="lb-k">${x('proven')}</div><div class="lb-v">${proofs.length ? html`<div class="lb-proof">${proofs.map((pr) => html`
            <div key=${pr.model + pr.date}>${pr.model}</div><div class=${pr.verdict === 'pass' ? 'ok' : 'no'}>${pr.verdict === 'pass' ? x('proofPass') : x('proofFail')}</div><div>${pr.tokens ? `${pr.tokens.toLocaleString()} tok` : ''}</div><div>${pr.date || ''}</div><div title=${pr.evidence || ''}>${(pr.evidence || '').split('/').pop()}${pr.self_reported || d.self_reported ? ` · ${x('selfReported')}` : ''}</div>`)}</div>` : x('provenNone')}<small>${x('provenSub')}</small></div>
        <div class="lb-k">${x('usedBy')}</div><div class="lb-v">${(used.apps || 0) ? html`${(used.app_names || []).map((ref) => html`<a class="og-crumb-link" key=${ref} href=${appUrlOf(ref)} target="_blank" rel="noopener">${appName(ref)}</a> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - (used.app_names || []).length }) : ''}<small>${x('usedBySub')}</small>` : html`${x('usedNone')}<small>${x('usedNoneSub')}</small>`}</div>
        ${p.showcaseUrl || p.demoTemplateId ? html`<div class="lb-k">${x('seeWorking')}</div><div class="lb-v">${p.showcaseUrl ? html`<a class="og-crumb-link" href=${p.showcaseUrl} target="_blank" rel="noopener">Design Book</a> ` : null}${p.demoTemplateId ? html`<span>${p.showcaseUrl ? ' · ' : ''}${x('demoTemplate', { id: p.demoTemplateId })}</span>` : null}<small>${x('seeWorkingSub')}</small></div>` : null}
        <div class="lb-k">${x('versionSize')}</div><div class="lb-v">${[p.version || x('noVersion'), p.license, p.sizeEstimate].filter(Boolean).join(' · ')}${d.sourceUrl ? html` · <a class="og-crumb-link" href=${d.sourceUrl} target="_blank" rel="noopener">${d.sourceUrl.replace(/^https?:\/\//, '')}</a>` : null}<small>${p.version ? x('versionSub') : x('noVersionSub')}</small></div>
        ${p.status === 'deprecated' ? html`<div class="lb-k">${x('deprecatedK')}</div><div class="lb-v">${p.supersededBy ? x('deprecatedWith', { id: p.supersededBy }) : x('deprecatedWithout')}</div>` : null}
        ${changelog.length ? html`<div class="lb-k">${x('changes')}</div><div class="lb-v"><div class="lb-cl">${changelog.map((c, i) => html`<div class="m" key=${'v' + i}>${c.version}</div><div class="m" key=${'d' + i}>${c.date}</div><div key=${'s' + i}>${c.summary}${c.breaking ? html` <b class="is-warn">${x('breaking')}: ${c.breaking}</b>` : null}</div>`)}</div></div>` : null}
      </div>
      <div class="og-doors lb-open-doors">
        <${CopyButton} text=${aiText} className="og-door" label=${x('copyAi')} copiedLabel=${x('copied')} />
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(p)}>${x('close')}</button>
      </div>
    </div>`;
}
