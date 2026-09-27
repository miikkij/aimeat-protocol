/**
 * @file public/views/appcat/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One row per app, for every list of the catalogue (features.md F33–F39, F46–F47,
 *   F113–F115, F118): the number, the icon, the name with its star and markers and the line under it,
 *   what it does, its state, how often it was opened, the arrow. Pressing a row opens its panel under
 *   it: the doors (Open, the draft, Details; on another person's app Fork and Agent) and one line about
 *   where the work is. An own app's row and another person's row differ only in what the row says and
 *   which doors it has, as in the old rows.js. Drawn with the List family (cut
 *   n-mark-name-desc-state-n-arrow, index tone); no class here.
 * @structure AppRow({ sa, i, own, open, onToggle, starred }) · openApp(sa) · openDraft(sa)
 * @usage html`<${AppRow} key=${ref} sa=${sa} i=${i} own open=${ref === openRef} onToggle=${…} starred=${favs.has(ref)} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell).
 */
import { h, Fragment } from 'preact';
import htm from 'htm';
import { Row, Name, Desc, Num, Cell, Lead, Panel } from '/components/List.js';
import { Loud, Action, Actions } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { StarToggle } from '/components/StarToggle.js';
import { getSession } from '/js/services/auth.js';
import { x } from '/views/appcat/i18n.js';
import { notice, openDetail, toggleFavourite, appRef } from '/views/appcat/store.js';
import { openDialog } from '/views/appcat/dialogs/host.js';
import { openPublished, openDraftPreview, appUrl } from '/views/appcat/dialogs/app-io.js';
import { appName, appIcon, appDesc, shipsAgents, fmtKb, fmtDate } from '/views/appcat/model.js';

const html = htm.bind(h);

/**
 * Open a published app in a new tab, top level, never framed (F113, F118, F294): the node serves it
 * inline or sends it on to the app origin. The owner's own access-coded app carries its code (F113).
 */
export function openApp(sa) { openPublished(appUrl(sa.owner, sa.filename) + '?mode=inline', sa); }

/** Open the saved draft on its real address in a new tab (F114). */
export function openDraft(sa) {
  if (!getSession()) { notice(x('detail.draftNeedsSignin')); return; }
  openDraftPreview(sa.owner, sa.filename).catch((err) => notice((err && err.message) || x('row.draftPreviewFailed'), 'error'));
}

/** The markers after the name (F36, F46): agents, AI that generates and unlabelled AI (own rows),
 *  and the forks (other people's rows). */
function markers(sa, own) {
  const out = [];
  if (shipsAgents(sa)) out.push(html`<span key="agent" title=${x('card.agentHint')}> 🤖</span>`);
  // The AI markers are the own list's only: the old community and favourites rows
  // (server-io.js publishedRowHtml) never drew them.
  const p = own ? sa.ai_posture : null;
  if (p && Array.isArray(p.generates) && p.generates.length) out.push(html`<${Fragment} key="gen"> <${Mark} tone="dim" title=${x('card.aiGenerativeHint')}>${x('card.aiGenerative')}<//><//>`);
  if (p && p.gap) out.push(html`<${Fragment} key="gap"> <${Mark} kind="status" tone="attention" title=${x('card.aiUnlabelledHint')}>${x('card.aiUnlabelled')}<//><//>`);
  if (!own && sa.forks > 0) {
    const lineage = (e) => { e.stopPropagation(); openDialog('lineage', { owner: sa.owner, filename: sa.filename }); };
    const key = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lineage(e); } };
    // The old row drew the fork count in the name's own letters (an unstyled .pcb-forks), pressed to
    // open the lineage; here it can also be reached with the keyboard.
    out.push(html`<span key="forks" role="button" tabIndex="0" title=${x('card.forksHint')} onClick=${lineage} onKeyDown=${key}>⑂ ${sa.forks}</span>`);
  }
  return out;
}

/**
 * @param {{ sa: any, i: number, own: boolean, open: boolean, onToggle: () => void, starred: boolean }} props
 */
export function AppRow({ sa, i, own, open, onToggle, starred }) {
  const m = sa.manifest || {};
  const ref = appRef(sa);
  const when = fmtDate(sa.created_at);
  const v = sa.version_number ? 'v' + sa.version_number : '';
  const author = m.authorDisplay || sa.owner || '';
  const meta = own ? [v, when, fmtKb(sa.size)].filter(Boolean).join(' · ') : [author, v, when].filter(Boolean).join(' · ');
  const draft = own && !!sa.has_draft;
  const state = (sa.parked ? x('status.parked') : x('status.published')) + (draft ? ' · ' + x('state.draftShort') : '');
  const opens = own ? (sa.downloads || 0) : (typeof sa.downloads === 'number' ? sa.downloads : '');
  const n = String(i + 1).padStart(2, '0');
  const star = sa.filename ? html`<${StarToggle} bright on=${starred} title=${starred ? x('fav.remove') : x('fav.add')}
    onClick=${(e) => { e.stopPropagation(); toggleFavourite(ref); }} />` : null;
  const line = own
    ? (draft ? x('row.lineDraft') : sa.parked ? x('row.lineUnlisted') : x('row.linePublished', { v, date: when }))
    : x('row.lineBy', { owner: author, date: when });
  const doors = own
    ? html`
      <${Loud} title=${draft ? x('card.openReleasedHint') : x('card.openHint')} onClick=${() => openApp(sa)}>${x('card.open')}<//>
      ${draft ? html`<${Action} title=${x('card.openStagingHint')} onClick=${() => openDraft(sa)}>${x('card.openDraft')}<//>` : null}
      <${Action} title=${x('ctx.details')} onClick=${() => openDetail(sa)}>${x('card.details')}<//>`
    : html`
      <${Loud} onClick=${() => openApp(sa)}>${x('card.view')}<//>
      ${sa.forkable ? html`<${Action} title=${x('card.forkHint')} onClick=${() => openDialog('fork', { owner: sa.owner, filename: sa.filename, version: sa.version_number || 0 })}>${x('card.fork')}<//>` : null}
      ${shipsAgents(sa) ? html`<${Action} title=${x('card.agentHint')} onClick=${() => openDialog('agents', { owner: sa.owner, filename: sa.filename })}>${x('card.agent')}<//>` : null}
      <${Action} title=${x('ctx.details')} onClick=${() => openDetail(sa)}>${x('card.details')}<//>`;
  return html`<${Row} order=${i} open=${open} onToggle=${onToggle} faded=${!!sa.parked}>
    <${Cell} sign>${n}<//>
    <${Lead} text=${appIcon(sa)} />
    <${Name} before=${star} after=${markers(sa, own)} meta=${meta}>${appName(sa)}<//>
    <${Desc} clip>${appDesc(sa)}<//>
    <${Cell}>${state}<//>
    <${Num}>${opens}<//>
    <${Cell}>${open ? '↓' : '→'}<//>
    ${open ? html`<${Panel}><${Actions}>${doors}<//><${Note} kind="hint">${line}<//><//>` : null}
  <//>`;
}

export default AppRow;
