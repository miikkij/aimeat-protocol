/**
 * @file compliance-tab.browse.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dialog a row of the records section (09) opens on the admin Compliance page (plan
 *   doc-mvlftkh9zmc9, C7.7, Jouni 2026-10-24: "miksen voi avata noita rekistereitä"): every place that
 *   keeps that kind of document, the installation first, then each shared place and each app by
 *   name with a way to its own page; and an entry opened from the list, with its details, what it
 *   leaves open, its status changes and the paste for the person's AI (compliance-tab.item.js).
 *
 *   ONE READ, GET /v1/compliance/docs/<kind>?scope=all, the operator's view of every place, which
 *   aimeat_compliance_register_read with scope "all" answers the same. Each place says whether the
 *   reader may change it (`may_write`): the operator keeps the installation's documents and their own
 *   apps', a shared place's creator or admin keeps its, so elsewhere the page shows and does not offer.
 *   The list follows the live stream: a change by the person's AI shows here without a reload.
 * @structure RecordsBrowser({ target, gaps, onClose, onPrint, onChanged })
 * @usage <${RecordsBrowser} target=${{ kind: 'registers' }} gaps=${report.processing.gaps} ... />
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvlftkh9zmc9, C7.7).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPatch } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { Modal } from '/components/Modal.js';
import { Readings } from '/components/Readings.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Space } from '/components/Layout.js';
import { useToast, Toast } from './shared.js';
import { placeWord, placeHref, placeQuery, itemRow, itemName, ItemDetail } from './compliance-tab.item.js';

const html = htm.bind(h);
const R = (key, params) => t('admin.compliance.records.' + key, params);
const O = (key, params) => t('admin.compliance.records.open.' + key, params);

/** The dialog's title for each kind, in the records section's own words. */
const TITLE = { registers: 'registers', requests: 'requests', breaches: 'breaches', dpias: 'dpias', processors: 'processors' };
const titleOf = (kind) => (TITLE[kind] ? R(TITLE[kind]) : O('lawsTitle'));

/** A place's key in the dialog's state. */
const keyOf = (p) => [p.scope, p.organism_id || '', p.owner || '', p.app || ''].join('|');

/** The entries of a place: a law answers per framework, every other kind per item. */
const entriesOf = (kind, p) => (kind === 'frameworks' ? (p.verdicts || []) : (p.items || []));

/**
 * The dialog. `target` is { kind, item?, domain? }: `item` opens one entry of the installation
 * directly (a law row of section 09), `domain` keeps the registers that name a regulated domain.
 */
export function RecordsBrowser({ target, gaps, onClose, onPrint, onChanged }) {
  const kind = target?.kind;
  // The dialog is the browser's top layer, so its messages show inside it, not on the page behind.
  const [toastMsg, showError, showSuccess, clearToast] = useToast();
  const [places, setPlaces] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [registersAll, setRegistersAll] = useState(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState(null);          // { place: key, id } while an entry is open
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!kind) return;
    try {
      const r = await apiGet(`/v1/compliance/docs/${kind}?scope=all`);
      setPlaces(r?.data?.places || []);
      setFailed(false);
      if (kind === 'frameworks') setCatalog((await apiGet('/v1/compliance/catalog'))?.data || null);
      if (kind === 'dpias') setRegistersAll((await apiGet('/v1/compliance/docs/registers?scope=all'))?.data?.places || []);
    } catch (e) {
      setFailed(true);
      swallowed('compliance-browse: load', e);
    }
  }, [kind]);

  useEffect(() => {
    setPlaces(null); setFailed(false);
    setView(target?.item ? { place: keyOf({ scope: 'node' }), id: target.item } : null);
    load();
  }, [target, load]);
  useEffect(() => (kind ? onLiveUpdate(['compliance'], load) : undefined), [kind, load]);

  if (!kind) return null;

  const patch = async (place, id, set, done) => {
    setBusy(true);
    try {
      await apiPatch(`/v1/compliance/docs/${kind}/${encodeURIComponent(id)}?${placeQuery(place)}`, { set });
      showSuccess(done);
      // The page's report holds the gaps this dialog reads, so both read again.
      await Promise.all([load(), onChanged?.()]);
    } catch (e) {
      showError(e?.message || O('changeFailed'));
      swallowed('compliance-browse: patch', e);
    }
    setBusy(false);
  };

  const shown = (places || [])
    .map(p => ({ ...p, entries: entriesOf(kind, p).filter(it => !target.domain || (it.domains || []).length) }))
    .filter(p => p.place.scope === 'node' || p.entries.length);

  const open = view && shown.find(p => keyOf(p.place) === view.place);
  const item = open && open.entries.find(it => it.id === view.id);
  const registerTitle = (place, id) => {
    const at = (registersAll || []).find(p => keyOf(p.place) === keyOf(place));
    return (at?.items || []).find(r => r.id === id)?.title;
  };
  // A shared place a register names, by its name where this dialog knows it.
  const orgName = (id) => (places || []).find(p => p.place.organism_id === id)?.place.name;
  const ctxOf = (place, it) => ({ registerTitle: kind === 'dpias' ? registerTitle(place, it.registerId) : undefined, orgName });

  const body = failed ? html`<${Note} kind="quiet">${O('loadFailed')}<//>`
    : places === null ? html`<${Note} kind="quiet">${O('loading')}<//>`
      : item ? html`
        <${Actions}><${Action} small soft onClick=${() => setView(null)}>${O('back')}<//><//>
        <${SubHeading} level=${3} desc=${`${placeWord(open.place)}: ${open.place.name}`}>${itemName(kind, item, ctxOf(open.place, item))}<//>
        <${ItemDetail} kind=${kind} item=${item} place=${open.place} mayWrite=${open.may_write} gaps=${gaps} busy=${busy}
          ctx=${{ catalog, answers: open.answers, sources: open.answerSources, ...ctxOf(open.place, item) }}
          onPatch=${(set, done) => patch(open.place, item.id, set, done)}
          message=${toastMsg ? html`<${Toast} type=${toastMsg.type} text=${toastMsg.text} onDismiss=${clearToast} />` : null}
          onPrint=${(regs) => onPrint(regs, `${item.title || item.id} · ${open.place.name}`)} />`
        : html`
        <${Note} kind="lead">${O('lead.' + kind)}<//>
        ${shown.map(p => html`
          <${Space} key=${keyOf(p.place)} below="part">
            <${SubHeading} part desc=${placeWord(p.place)}>${p.place.name}<//>
            <${Actions}>
              ${placeHref(p.place) ? html`<${Action} small soft href=${placeHref(p.place)}>${O('openPlace.' + p.place.scope)}<//>` : null}
              ${kind === 'registers' && p.entries.length ? html`<${Action} small soft onClick=${() => onPrint(p.entries, p.place.name)}>${O('printPlace')}<//>` : null}
            <//>
            ${p.entries.length === 0 ? html`<${Note} kind="quiet">${O('empty')}<//>` : html`<${Readings} rows=${p.entries.map((it, i) => {
              const row = itemRow(kind, it, p.place, gaps, ctxOf(p.place, it));
              return {
                key: it.id, name: row.name, why: row.why, value: row.value, last: i === p.entries.length - 1,
                mark: html`<${Action} small soft onClick=${() => setView({ place: keyOf(p.place), id: it.id })}>${O('open')}<//>`,
              };
            })} />`}
          <//>`)}`;

  return html`
    <${Modal} open=${true} onClose=${onClose} size="lg" title=${target.domain ? O('domainsTitle') : titleOf(kind)} guard=${false}>
      ${toastMsg && !item ? html`<${Toast} type=${toastMsg.type} text=${toastMsg.text} onDismiss=${clearToast} />` : null}
      ${body}
    <//>`;
}
