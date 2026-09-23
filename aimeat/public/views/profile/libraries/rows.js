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
 *   2026-09-22 -- Composed from the shared component set: ListRow with a status marker and the
 *     version as a Chip, the opened record a Surface of KeyValue rows, the proof ledger and the
 *     changelog as compact rows, the caveat a coral aside; no own CSS.
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num } from '/js/format.js';
import { ListRow, Stack, KeyValue, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { x, statusWord, modelWord, proofWord, isCommunity, appName, appUrlOf, aiTextFor } from './frame.js';

/** A KeyValue whose value is a body and a quieter note under it. */
const kv = (label, body, note) => html`<${KeyValue} label=${label}>
  <${Stack} density="compact"><div>${body}</div>${note ? html`<${Text} kind="caption" tone="muted">${note}<//>` : null}<//>
<//>`;

function subLine(p) {
  const parts = [isCommunity(p) ? x('communityWord') : '', statusWord(p), modelWord(p), proofWord(p)].filter(Boolean);
  if ((p.requires || []).length) parts.push(x('requiresShort', { list: p.requires.join(', ') }));
  return parts.join(' · ');
}

function usesLine(p) {
  const n = p.used_by?.apps || 0;
  if (!n) return html`<${Text} kind="caption" tone="muted">${x('usedNone')}<//>`;
  return html`<${Text} kind="caption">${n === 1 ? x('usedOne') : x('usedMany', { n })}<//>`;
}

export function packRow(ctx, p) {
  const open = ctx.expanded === p.id;
  const deprecated = p.status === 'deprecated';
  const replaced = deprecated && p.supersededBy;
  return html`<${ListRow} key=${p.id} density="compact" marker=${deprecated ? 'muted' : 'success'}
    name=${html`${p.title || p.id}${p.version ? html` <${Chip}>${p.version}<//>` : null}`}
    detail=${replaced ? undefined : subLine(p)}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggle(p)}>${open ? x('close') : x('open')}<//>
      <${Action} onClick=${() => ctx.copyForAi(p)}>${x('copyAi')}<//>`}>
    <${Stack} density="compact">
      ${replaced ? html`<${Text} kind="mono" tone="coral">${statusWord(p)} → ${p.supersededBy}<//>` : null}
      ${p.description ? html`<${Text}>${p.description}<//>` : null}
      <${Stack} direction="wrap" density="compact"><${Text} kind="mono">${p.apiSurface || p.id}<//>${usesLine(p)}<//>
      ${open ? packOpen(ctx, p) : null}
    <//>
  <//>`;
}

function modelExplained(p) {
  if (p.modelTier === 'any') return html`<strong>${x('model.any')}.</strong> ${x('model.anyLong')}`;
  if (p.modelTier === 'frontier') return html`<strong>${x('model.frontier')}.</strong> ${x('model.frontierLong')}`;
  if (isCommunity(p)) return x('model.communityLong');
  return x('model.needsDocLong');
}

function packOpen(ctx, p) {
  const d = ctx.details[p.id];
  if (!d) return html`<${Surface} kind="record"><${Text} tone="muted">${t('common.loading')}<//><//>`;
  if (d.error) return html`<${Surface} kind="record"><${Text} tone="muted">${d.error}<//><//>`;
  const include = Array.isArray(d.include) ? d.include : (p.include || []);
  const proofs = p.proofs || d.proofs || [];
  const used = p.used_by || {};
  const changelog = Array.isArray(d.changelog) ? d.changelog.slice().reverse() : [];
  const aiText = aiTextFor(p, d);
  return html`
    <${Surface} kind="record">
      <${Stack}>
        ${p.description ? html`<${Text} kind="lead">${p.description}<//>` : null}
        <div>
          ${kv(x('intoApp'), html`<${Stack} density="compact">${include.map((line) => html`<${Text} kind="mono" key=${line}>${line}<//>`)}<//>`,
            html`${include.length > 1 ? x('intoAppOrder') : x('intoAppOne')} · <${CopyAction} kind="text" text=${include.join('\n')} label=${x('copyLines')} copiedLabel=${x('copied')} />`)}
          ${kv(x('forAi'), html`<${Stack} density="compact">
              <span>${d.ai_doc ? x('forAiBody', { n: num(d.ai_doc.length) }) : x('forAiNone')}</span>
              <${Text} kind="caption" tone="muted">${x('forAiSub', { id: p.id })} · <${CopyAction} kind="text" text=${aiText} label=${x('copyAi')} copiedLabel=${x('copied')} /> · <${Action} kind="text" expanded=${ctx.docShown === p.id} onClick=${() => ctx.toggleDoc(p)}>${ctx.docShown === p.id ? x('hide') : x('show')}<//><//>
              ${ctx.docShown === p.id && d.ai_doc ? html`<${Surface} kind="code" height="tall">${d.ai_doc}<//>` : null}
            <//>`)}
          ${p.apiSurface ? kv(x('api'), html`<${Text} kind="mono">${p.apiSurface}<//>`) : null}
          ${kv(x('forModel'), html`<${Stack} density="compact"><span>${modelExplained(p)}</span>${p.apiCaveat ? html`<${Surface} kind="aside" density="compact"><${Text}>${x('caveatLead')} ${p.apiCaveat}<//><//>` : null}<//>`)}
          ${kv(x('proven'), proofs.length ? html`<${Stack} density="compact">${proofs.map((pr) => html`<${ListRow} key=${pr.model + pr.date} density="compact"
              name=${pr.model} nameTitle=${pr.evidence || ''}
              detail=${[pr.tokens ? `${num(pr.tokens)} tok` : '', pr.date || '', `${(pr.evidence || '').split('/').pop()}${pr.self_reported || d.self_reported ? ` · ${x('selfReported')}` : ''}`].filter(Boolean).join(' · ')}
              value=${html`<${Chip} tone=${pr.verdict === 'pass' ? 'success' : 'coral'}>${pr.verdict === 'pass' ? x('proofPass') : x('proofFail')}<//>`} />`)}<//>` : x('provenNone'), x('provenSub'))}
          ${(used.apps || 0)
            ? kv(x('usedBy'), html`${(used.app_names || []).map((ref) => html`<${Action} kind="text" key=${ref} href=${appUrlOf(ref)} target="_blank">${appName(ref)}<//> `)}${(used.apps || 0) > (used.app_names || []).length ? x('usedMore', { n: used.apps - (used.app_names || []).length }) : ''}`, x('usedBySub'))
            : kv(x('usedBy'), x('usedNone'), x('usedNoneSub'))}
          ${p.showcaseUrl || p.demoTemplateId ? kv(x('seeWorking'), html`${p.showcaseUrl ? html`<${Action} kind="text" href=${p.showcaseUrl} target="_blank">Design Book<//> ` : null}${p.demoTemplateId ? html`<span>${p.showcaseUrl ? ' · ' : ''}${x('demoTemplate', { id: p.demoTemplateId })}</span>` : null}`, x('seeWorkingSub')) : null}
          ${kv(x('versionSize'), html`${[p.version || x('noVersion'), p.license, p.sizeEstimate].filter(Boolean).join(' · ')}${d.sourceUrl ? html` · <${Action} kind="text" href=${d.sourceUrl} target="_blank">${d.sourceUrl.replace(/^https?:\/\//, '')}<//>` : null}`, p.version ? x('versionSub') : x('noVersionSub'))}
          ${p.status === 'deprecated' ? kv(x('deprecatedK'), p.supersededBy ? x('deprecatedWith', { id: p.supersededBy }) : x('deprecatedWithout')) : null}
          ${changelog.length ? kv(x('changes'), html`<${Stack} density="compact">${changelog.map((c, i) => html`<${ListRow} key=${'c' + i} density="compact" detailKind="text"
              name=${html`<${Text} kind="mono">${c.version} · ${c.date}<//>`} detail=${c.summary}>
              ${c.breaking ? html`<${Text} tone="coral"><strong>${x('breaking')}: ${c.breaking}</strong><//>` : null}
            <//>`)}<//>`) : null}
        </div>
        <${Stack} direction="wrap">
          <${CopyAction} text=${aiText} label=${x('copyAi')} copiedLabel=${x('copied')} />
          <${Action} onClick=${() => ctx.toggle(p)}>${x('close')}<//>
        <//>
      <//>
    <//>`;
}
