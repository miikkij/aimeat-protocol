/**
 * @file public/components/DataMap.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE data map, wherever one is shown: an app, an extension, an ecosystem app, a
 *   package, an agent, a schedule. One component, so those six cannot drift into six vocabularies
 *   for the same thing — which is the state this replaces, three of them being live already.
 *
 *   THE `derived` STATE DECIDES THIS DESIGN. On day one every program's map is a draft the node
 *   worked out, and a corner badge saying so is read as decoration: 169 machine guesses would look
 *   like 169 promises. So it is a banner in the reading path, full width, above the first row, at
 *   body size, carrying both actions. The precedent is the compliance tab, whose own header states
 *   the rule: what needs action goes at the top and the counts are evidence underneath it.
 *
 *   THE BASIS COLUMN CARRIES ITS SENTENCE. A chip reading "Fixed shape" means nothing on its own,
 *   and a tooltip is not an answer for somebody reading on a phone. Every basis renders as chip PLUS
 *   sentence in body text, the same rule AiLabel follows for its icon.
 *
 *   FIXED GRID, NEVER AN `auto` COLUMN. A per-row grid with an auto column drifts out of line by the
 *   width of the longest family name, which is exactly what the alignment check measures.
 * @structure DataMap · DataMapRow · DataMapBanner · basisChip
 * @usage
 *   import { DataMap } from '/components/DataMap.js';
 *   html`<${DataMap} map=${map} observed=${families} subject=${{ kind: 'app', id, label }} />`
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073, the surfaces half.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { mapState, orderRows, summarise, contradictions, covers } from './data-map/model.js';

const html = htm.bind(h);

/** Chip plus its sentence. Both, always — the chip alone is a word nobody outside this repo knows. */
function basisChip(tier) {
  const key = ['schema-locked', 'declared-space', 'platform-prefix', 'owner-named'].includes(tier)
    ? { 'schema-locked': 'locked', 'declared-space': 'declared', 'platform-prefix': 'platform', 'owner-named': 'named' }[tier]
    : 'unknown';
  return html`
    <span class="dm-basis dm-basis-${key}">
      <span class="dm-basis-chip">${t(`dataMap.basis.${key}`)}</span>
      <span class="dm-basis-note">${t(`dataMap.basisNote.${key}`)}</span>
    </span>`;
}

/** What is unmistakable at a glance, and what the reader is asked to do about it. */
function DataMapBanner({ state, onCorrect, onConfirm }) {
  if (state !== 'derived' && state !== 'contradicted') return null;
  return html`
    <div class="dm-banner dm-banner-${state}">
      <div class="dm-banner-text">${t(`dataMap.stateNote.${state}`)}</div>
      ${onCorrect ? html`
        <div class="dm-banner-actions">
          ${state === 'derived' && onConfirm
            ? html`<button type="button" class="btn-outline btn-sm" onClick=${onConfirm}>${t('dataMap.confirm')}</button>`
            : null}
          <button type="button" class="btn-primary btn-sm" onClick=${onCorrect}>${t('dataMap.correct')}</button>
        </div>` : null}
    </div>`;
}

function DataMapRow({ row, disagrees, observed }) {
  const [open, setOpen] = useState(false);
  const rights = (row.grant?.rights ?? []).join(', ');
  const personal = row.personalData === 'yes' ? 'yes' : row.personalData === 'no' ? 'no' : 'unstated';
  const trace = observed?.find(o => covers(row.grant?.pattern, o.family));

  return html`
    <div class=${`dm-row${disagrees ? ' dm-row-disagrees' : ''}`}>
      <button type="button" class="dm-row-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
        <span class="dm-family">${row.grant?.pattern}</span>
        <span class="dm-rights">${rights}</span>
        ${basisChip(row.basis?.tier)}
        <span class=${`dm-personal dm-personal-${personal}`}>${t(`dataMap.personal.${personal}`)}</span>
      </button>
      <div class="dm-why">
        ${String(row.why || '').trim()
          ? row.why
          : html`<span class="dm-why-missing">${t('dataMap.noWhy')}</span>`}
      </div>
      ${open ? html`
        <dl class="dm-detail">
          <dt>${t('dataMap.col.where')}</dt><dd>${row.grant?.area}</dd>
          <dt>${t('dataMap.col.readers')}</dt>
          <dd>${row.readers?.visibility}${(row.readers?.alsoNamed ?? []).length ? `: ${row.readers.alsoNamed.join(', ')}` : ''}</dd>
          <dt>${t('dataMap.col.keeps')}</dt><dd>${t(`dataMap.retention.${row.retention?.kind ?? 'unknown'}`)}</dd>
          <dt>${t('dataMap.col.deleteMeans')}</dt>
          <dd>
            ${row.deletion?.says || t(`dataMap.deleteEffect.${row.deletion?.effect ?? 'unknown'}`)}
            ${(row.deletion?.survives ?? []).length
              ? html`<div class="dm-survives">${t('dataMap.survives')}: ${row.deletion.survives.join('; ')}</div>`
              : null}
          </dd>
          ${trace ? html`
            <dt>${t('dataMap.col.seen')}</dt>
            <dd>${t('dataMap.seenCount', { writes: trace.trace?.writeCount ?? 0, keys: trace.trace?.keyCount ?? 0 })}</dd>` : null}
          <dt>${t('dataMap.col.basis')}</dt>
          <dd class="dm-mono">${row.basis?.by || t('dataMap.basisNote.unknown')}</dd>
        </dl>` : null}
    </div>`;
}

export function DataMap({ map, observed = [], subject, variant = 'full', onCorrect, onConfirm }) {
  const [expanded, setExpanded] = useState(variant !== 'strip');
  const state = mapState(map, observed);
  const s = summarise(map, observed);

  if (variant === 'strip' && !expanded) {
    return html`
      <button type="button" class=${`dm-strip dm-strip-${state}`} onClick=${() => setExpanded(true)}>
        <span class="dm-strip-state">${t(`dataMap.state.${state}`)}</span>
        <span class="dm-strip-summary">
          ${state === 'empty'
            ? t('dataMap.emptyStores')
            : t('dataMap.strip.summary', { groups: s.groups, unexplained: s.unexplained })}
        </span>
      </button>`;
  }

  if (state === 'empty') {
    return html`
      <section class="dm-panel dm-panel-empty">
        <h4 class="dm-title">${t('dataMap.title')}</h4>
        <p class="dm-empty">
          ${t('dataMap.emptyStores')}
          ${map?.at ? html` <span class="dm-checked">${t('dataMap.checkedAt', { at: new Date(map.at).toLocaleDateString() })}</span>` : null}
        </p>
      </section>`;
  }

  const { undeclared, dead } = contradictions(map, observed);
  const rows = orderRows(map, observed);
  // Only a real disagreement is marked. `dead` is a note under the rows, not a colour on them.
  const disagrees = row => undeclared.some(o => covers(row.grant?.pattern, o.family));

  return html`
    <section class=${`dm-panel dm-panel-${state}`}>
      <h4 class="dm-title">${t('dataMap.title')}${subject?.label ? ` — ${subject.label}` : ''}</h4>
      <${DataMapBanner} state=${state} onCorrect=${onCorrect} onConfirm=${onConfirm} />

      ${undeclared.length ? html`
        <div class="dm-finding">
          ${t('dataMap.observedNotDeclared', { count: undeclared.length })}
          <ul class="dm-finding-list">
            ${undeclared.slice(0, 5).map(o => html`<li class="dm-mono" key=${o.family}>${o.family}</li>`)}
          </ul>
        </div>` : null}

      <div class="dm-rows">
        <div class="dm-head">
          <span>${t('dataMap.col.family')}</span>
          <span>${t('dataMap.col.rights')}</span>
          <span>${t('dataMap.col.basis')}</span>
          <span>${t('dataMap.col.personal')}</span>
        </div>
        ${rows.map(row => html`
          <${DataMapRow} key=${row.grant?.pattern} row=${row} disagrees=${disagrees(row)} observed=${observed} />`)}
      </div>

      ${dead.length ? html`
        <p class="dm-note">${t('dataMap.declaredNeverUsed', { count: dead.length })}</p>` : null}

      ${(map.elsewhere ?? []).length ? html`
        <h5 class="dm-subtitle">${t('dataMap.elsewhereTitle')}</h5>
        <div class="dm-rows">
          ${map.elsewhere.map(row => html`
            <div class="dm-row dm-row-elsewhere" key=${row.grant?.pattern}>
              <div class="dm-elsewhere-head">
                <span class="dm-family">${row.grant?.pattern}</span>
                <span class="dm-elsewhere-status">${t(`dataMap.elsewhere.${row.status}`)}</span>
              </div>
              <div class="dm-why">${row.where}${row.controller ? ` — ${row.controller}` : ''}</div>
              <div class="dm-why">${row.deletion?.says}</div>
            </div>`)}
        </div>` : null}

      ${variant === 'strip'
        ? html`<button type="button" class="btn-ghost btn-sm dm-collapse" onClick=${() => setExpanded(false)}>${t('dataMap.collapse')}</button>`
        : null}
    </section>`;
}

/**
 * The one-line form for a listing, drawn from the manifest STAMP rather than the map.
 *
 * A stamp is a different input, not a smaller one: it carries counts and the weakest basis and no
 * rows at all, so it is a separate component rather than a mode of the one above. This is what a
 * card in a list of 169 apps shows — fetching and rendering a whole map per card is the shape that
 * took an app subdomain down once already.
 *
 * `href` turns it into a link to wherever the full map lives; without one it is plain text, because
 * a control that does nothing is worse than no control.
 */
export function DataMapStamp({ stamp, href }) {
  if (!stamp) return null;
  // A GAP IS NOT A CONTRADICTION, and calling it one was wrong on the first screen it reached. The
  // stamp is a summary of what the program SAID; whether that disagrees with what it has been seen
  // doing needs the observed side, which a listing does not have. An unanswered deletion question is
  // something to finish, not a lie, and the word has to say which.
  const empty = (stamp.heldRows ?? 0) === 0 && (stamp.elsewhereRows ?? 0) === 0;
  const state = empty ? 'empty' : (stamp.source === 'derived' ? 'derived' : 'declared');
  const unfinished = !empty && state !== 'derived' && !!stamp.gap;
  const text = html`
    <span class="dm-strip-state">${t(`dataMap.state.${unfinished ? 'needsFinishing' : state}`)}</span>
    <span class="dm-strip-summary">
      ${empty
        ? t('dataMap.emptyStores')
        : t('dataMap.strip.summary', {
          groups: (stamp.heldRows ?? 0) + (stamp.elsewhereRows ?? 0),
          unexplained: stamp.rowsWithoutWhy ?? 0,
        })}
    </span>
    ${stamp.gap ? html`<span class="dm-strip-gap">${t('dataMap.stripGap')}</span>` : null}`;

  const cls = `dm-strip dm-strip-${state}${unfinished ? ' dm-strip-unfinished' : ''}`;
  return href ? html`<a class=${cls} href=${href}>${text}</a>` : html`<div class=${cls}>${text}</div>`;
}

export default DataMap;
