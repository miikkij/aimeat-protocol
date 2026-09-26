/**
 * @file public/views/profile/appdev/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rows of the AppDev page's three lists, each four cells of the List's
 *   state-name-who-doors cut and, when open, a panel under them: a pitfall an agent filed (symptom,
 *   resolution, where it came from, the share / outdated / delete doors), a template proposal (what
 *   generalises, the source app, the packs, the proofs) and an entry of the platform's own registry
 *   (symptom, fix). Made of the component kit: the rows pass data and never a class.
 * @structure learnedRow · proposalRow · curatedRow
 * @usage import { learnedRow, proposalRow, curatedRow } from './rows.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): a row is
 *     the List's Row (an outdated pitfall faded), the severity the Status Mark and the tier the Tag in
 *     a Cell, the title the Name with its meta line, the area and model the Who, the doors Action; an
 *     opened row is the List's Panel (the raised box, the look most opened rows have; it was the
 *     dashed aside, indented) with its parts as Facts (wide) keeping their line breaks, and the areas
 *     and packs the dim Tag again (main's og-chip--dim, which the previous branch lost).
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
import { Row, Name, Who, Cell, Doors, Panel } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { a, day, areaLabel, sevLabel, modeLabel, appName, appUrlOf, appUrl } from './frame.js';

/** A pitfall's severity as the Status: critical danger, info off, a warning attention. */
const sev = (s) => html`<${Cell}><${Mark} kind="status" tone=${s === 'critical' ? 'danger' : s === 'info' ? 'off' : 'attention'}>${sevLabel(s)}<//><//>`;

/** The open and close door every row has. */
const toggleDoor = (ctx, key, open) => html`<${Action} small row onClick=${() => ctx.toggleRow(key)}>${open ? a('close') : a('open')}<//>`;

/** A pitfall the owner's agents filed, or one another owner shared. */
export function learnedRow(ctx, p) {
  const key = p.key + (p.owner || '');
  const open = ctx.expanded === key;
  const own = p.source === 'own';
  const outdated = p.status === 'outdated';
  const busy = ctx.busy === p.key;
  const meta = [a('filedOn', { date: day(p.updated) }), p.app_ref ? appName(p.app_ref) : null, outdated ? a('outdatedMark') : null, !own ? a('communityMark') : null].filter(Boolean).join(' · ');
  const whence = html`${own ? a('whenceOwn', { model: p.model || '', date: day(p.updated) }) : a('whenceShared', { model: p.model || '', who: p.owner || '', date: day(p.updated) })}
    ${p.app_ref ? html` · <${Action} tone="link" href=${appUrlOf(p.app_ref)} newTab>${appName(p.app_ref)}<//>` : null}
    ${own ? html` · ${p.shared ? a('stateShared') : a('statePrivate')}` : null}
    ${outdated ? html` · ${a('outdatedMark')}` : null}`;
  return html`
    <${Row} key=${key} faded=${outdated} open=${open}>
      ${sev(p.severity)}
      <${Name} meta=${meta}>${p.title}<//>
      <${Who}>${areaLabel(p.category)} · ${p.model || ''}<//>
      <${Doors}>
        ${toggleDoor(ctx, key, open)}
        ${own ? html`
          <${Action} small row soft disabled=${busy} onClick=${() => ctx.toggleShare(p)}>${p.shared ? a('makePrivate') : a('shareAll')}<//>
          ${outdated
            ? html`<${Action} small row soft disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeActive')}<//>
                   <${Action} small row soft disabled=${busy} onClick=${() => ctx.removeLearned(p)}>${a('remove')}<//>`
            : html`<${Action} small row soft disabled=${busy} onClick=${() => ctx.toggleOutdated(p)}>${a('makeOutdated')}<//>`}` : null}
      <//>
      ${open ? html`
        <${Panel}>
          <${Facts} wide flush rows=${[
            { k: a('symptom'), v: p.symptom, pre: true },
            { k: a('resolution'), v: p.resolution, pre: true },
            { k: a('whence'), v: whence },
          ]} />
          ${(p.applies_to || []).length ? html`<${Marks}>${p.applies_to.map((x) => html`<${Mark} tone="dim" key=${x}>${areaLabel(x)}<//>`)}<//>` : null}
        <//>` : null}
    <//>`;
}

/** A template an agent proposed from a finished app. */
export function proposalRow(ctx, p) {
  const key = 'tpl:' + p.id;
  const open = ctx.expanded === key;
  const busy = ctx.busy === key;
  const proofs = p.proofs || [];
  const passed = proofs.filter((x) => x.verdict === 'pass').length;
  const src = p.derivedFrom || {};
  const meta = [a('proposedOn', { date: day(p.createdAt) }), modeLabel(p.startMode), proofs.length ? a('proofsOf', { passed, n: proofs.length }) : a('noProof')].join(' · ');
  return html`
    <${Row} key=${key} open=${open}>
      <${Cell}><${Mark}>${p.tier || '—'}<//><//>
      <${Name} meta=${meta}>${p.title}<//>
      <${Who} sub=${appName(src.filename)}>${p.model || ''}<//>
      <${Doors}>
        ${toggleDoor(ctx, key, open)}
        ${src.owner && src.filename ? html`<${Action} small row soft href=${appUrl(src.owner, src.filename)} newTab>${a('sourceApp')}<//>` : null}
        <${Action} small row soft disabled=${busy} onClick=${() => ctx.removeProposal(p)}>${a('remove')}<//>
      <//>
      ${open ? html`
        <${Panel} text=${p.description}>
          <${Facts} wide flush rows=${[
            { k: a('generalises'), v: p.reuseNotes, pre: true },
            p.startModeRationale && { k: a('startMode'), v: `${modeLabel(p.startMode)}: ${p.startModeRationale}`, pre: true },
            { k: a('derivedFrom'), v: `${src.owner}/${src.filename} · ${a('versionN', { n: src.version })}` },
            (p.packs || []).length && { k: a('packs'), v: html`<${Marks}>${p.packs.map((x) => html`<${Mark} tone="dim" key=${x}>${x}<//>`)}<//>` },
            proofs.length && { k: a('proofs'), v: html`<${Marks}>${proofs.map((x, i) => html`<${Mark} kind="status" tone=${x.verdict === 'pass' ? 'fine' : 'danger'} key=${i}>${x.model}: ${x.verdict === 'pass' ? a('proofPass') : a('proofFail')}<//>`)}<//>` },
          ]} />
        <//>` : null}
    <//>`;
}

/** One entry of the platform's own registry: read-only, the same for everyone. */
export function curatedRow(ctx, p) {
  const key = 'cur:' + p.id;
  const open = ctx.expanded === key;
  return html`
    <${Row} key=${key} open=${open}>
      ${sev(p.severity)}
      <${Name} meta=${a('updatedOn', { date: day(p.updatedAt) })}>${p.title}<//>
      <${Who}>${(p.appliesTo || []).map(areaLabel).join(' · ')}<//>
      <${Doors}>${toggleDoor(ctx, key, open)}<//>
      ${open ? html`
        <${Panel}>
          <${Facts} wide flush rows=${[
            { k: a('symptom'), v: p.symptom, pre: true },
            { k: a('resolution'), v: p.fix, pre: true },
          ]} />
        <//>` : null}
    <//>`;
}
