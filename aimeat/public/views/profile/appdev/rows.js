/**
 * @file public/views/profile/appdev/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the AppDev page's three lists, each a shared list row and, when open, a
 *   record under it: a pitfall an agent filed (symptom, resolution, where it came from, the share /
 *   outdated / delete doors), a template proposal (what generalises, the source app, the packs, the
 *   proofs) and an entry of the platform's own registry (symptom, fix).
 * @structure learnedRow · proposalRow · curatedRow
 * @usage import { learnedRow, proposalRow, curatedRow } from './rows.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: ListRow with the severity as a Chip, the
 *     opened entry a Surface record of labelled paragraphs, Chips for areas, packs and proofs; no
 *     own CSS.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { ListRow, Stack, Action, Chip, Text, Surface } from '/components/poster-parts.js';
import { a, day, areaLabel, sevLabel, modeLabel, appName, appUrlOf, appUrl } from './frame.js';

const sevTone = (s) => (s === 'critical' ? 'coral' : s === 'info' ? 'muted' : 'plain');
const sev = (s) => html`<${Chip} tone=${sevTone(s)}>${sevLabel(s)}<//>`;
/** The value column: a chip over a short mono line. */
const valueOf = (chip, line) => html`<${Stack} density="compact" align="end">${chip}${line ? html`<${Text} kind="mono">${line}<//>` : null}<//>`;
/** One labelled paragraph of an opened record. */
const para = (label, body) => html`<${Text} kind="label">${label}<//><${Text}>${body}<//>`;
const chips = (list) => html`<${Stack} direction="wrap" density="compact">${list}<//>`;

/** A pitfall the owner's agents filed, or one another owner shared. */
export function learnedRow(ctx, p) {
  const key = p.key + (p.owner || '');
  const open = ctx.expanded === key;
  const own = p.source === 'own';
  const outdated = p.status === 'outdated';
  const busy = ctx.busy === p.key;
  const meta = [a('filedOn', { date: day(p.updated) }), p.app_ref ? appName(p.app_ref) : null, outdated ? a('outdatedMark') : null, !own ? a('communityMark') : null].filter(Boolean).join(' · ');
  return html`<${ListRow} key=${key} muted=${outdated} name=${p.title} detail=${meta}
    value=${valueOf(sev(p.severity), `${areaLabel(p.category)} · ${p.model || ''}`)}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleRow(key)}>${open ? a('close') : a('open')}<//>
      ${own ? html`
        <${Action} disabled=${busy} onClick=${() => ctx.toggleShare(p)}>${p.shared ? a('makePrivate') : a('shareAll')}<//>
        ${outdated
          ? html`<${Action} disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeActive')}<//>
                 <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.removeLearned(p)}>${a('remove')}<//>`
          : html`<${Action} disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeOutdated')}<//>`}` : null}`}>
    ${open ? html`
      <${Surface} kind="record">
        <${Stack} density="compact">
          ${para(a('symptom'), p.symptom)}
          ${para(a('resolution'), p.resolution)}
          <${Text} kind="label">${a('whence')}<//>
          <${Text}>${own ? a('whenceOwn', { model: p.model || '', date: day(p.updated) }) : a('whenceShared', { model: p.model || '', who: p.owner || '', date: day(p.updated) })}
            ${p.app_ref ? html` · <${Action} kind="text" href=${appUrlOf(p.app_ref)} target="_blank">${appName(p.app_ref)}<//>` : null}
            ${own ? html` · ${p.shared ? a('stateShared') : a('statePrivate')}` : null}
            ${outdated ? html` · ${a('outdatedMark')}` : null}<//>
          ${(p.applies_to || []).length ? chips(p.applies_to.map((x) => html`<${Chip} tone="muted" key=${x}>${areaLabel(x)}<//>`)) : null}
        <//>
      <//>` : null}
  <//>`;
}

/** A template an agent proposed from a finished app. */
export function proposalRow(ctx, p) {
  const open = ctx.expanded === 'tpl:' + p.id;
  const busy = ctx.busy === 'tpl:' + p.id;
  const proofs = p.proofs || [];
  const passed = proofs.filter((x) => x.verdict === 'pass').length;
  const src = p.derivedFrom || {};
  const meta = [a('proposedOn', { date: day(p.createdAt) }), modeLabel(p.startMode), proofs.length ? a('proofsOf', { passed, n: proofs.length }) : a('noProof')].join(' · ');
  return html`<${ListRow} key=${'tpl:' + p.id} name=${p.title} detail=${meta}
    value=${valueOf(html`<${Chip}>${p.tier || '—'}<//>`, [p.model || '', appName(src.filename)].filter(Boolean).join(' · '))}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleRow('tpl:' + p.id)}>${open ? a('close') : a('open')}<//>
      ${src.owner && src.filename ? html`<${Action} href=${appUrl(src.owner, src.filename)} target="_blank">${a('sourceApp')}<//>` : null}
      <${Action} tone="danger" disabled=${busy} onClick=${() => ctx.removeProposal(p)}>${a('remove')}<//>`}>
    ${open ? html`
      <${Surface} kind="record">
        <${Stack} density="compact">
          <${Text}>${p.description}<//>
          ${para(a('generalises'), p.reuseNotes)}
          ${p.startModeRationale ? para(a('startMode'), `${modeLabel(p.startMode)}: ${p.startModeRationale}`) : null}
          ${para(a('derivedFrom'), `${src.owner}/${src.filename} · ${a('versionN', { n: src.version })}`)}
          ${(p.packs || []).length ? html`<${Text} kind="label">${a('packs')}<//>${chips(p.packs.map((x) => html`<${Chip} tone="muted" key=${x}>${x}<//>`))}` : null}
          ${proofs.length ? html`<${Text} kind="label">${a('proofs')}<//>${chips(proofs.map((x, i) => html`<${Chip} tone=${x.verdict === 'pass' ? 'sun' : 'coral'} key=${i}>${x.model}: ${x.verdict === 'pass' ? a('proofPass') : a('proofFail')}<//>`))}` : null}
        <//>
      <//>` : null}
  <//>`;
}

/** One entry of the platform's own registry: read-only, the same for everyone. */
export function curatedRow(ctx, p) {
  const open = ctx.expanded === 'cur:' + p.id;
  return html`<${ListRow} key=${'cur:' + p.id} name=${p.title} detail=${a('updatedOn', { date: day(p.updatedAt) })}
    value=${valueOf(sev(p.severity), (p.appliesTo || []).map(areaLabel).join(' · '))}
    actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggleRow('cur:' + p.id)}>${open ? a('close') : a('open')}<//>`}>
    ${open ? html`
      <${Surface} kind="record">
        <${Stack} density="compact">
          ${para(a('symptom'), p.symptom)}
          ${para(a('resolution'), p.fix)}
        <//>
      <//>` : null}
  <//>`;
}
