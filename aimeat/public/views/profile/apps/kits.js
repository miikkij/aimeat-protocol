/**
 * @file public/views/profile/apps/kits.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The style kit a new app starts from: the section on the Apps page where a person
 *   chooses their own default kit, and the default of each organism they own or run as an admin.
 *   The node's default shows here as a fact; its operator chooses it in the admin Apps tab.
 *
 *   The chat path does the same through aimeat_designbook_kit_default and aimeat_designbook_kit
 *   { view: "defaults" }; this section is where the choice shows. A choice is saved when it is
 *   picked, because a default changes nothing until the next new app.
 *
 *   It loads on its own (GET /v1/designbook/kits/defaults and GET /v1/designbook?kind=kit) and
 *   loads again on the aimeat-live-update event, so the rest of the page never waits on it.
 * @structure KitsSection({ num, gallery, showToast })
 * @usage html`<${KitsSection} num="07" gallery=${galleryUrl} showToast=${showToast} />`
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-omat-tyylipohjat-yrityksen-ja-k-ytt-j-n-jaettavissa).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { apiGet, apiPut } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';
import { a } from './frame.js';

const usable = (k) => k.status === 'published' || k.status === 'aging';

/** The kits a subject's default may point at: the person's own takes any kit they read; an organism's, its own and the node's. */
function optionsFor(kits, organism) {
  const fit = kits.filter((k) => usable(k) && (!organism || k.reach === 'node' || (k.reach === 'organism' && k.organism === organism)));
  return [['', a('kitNone')], ...fit.map((k) => [k.id, k.title])];
}

/** What the row says under its name: the kit in force there, or why the chosen one no longer answers. */
function metaOf(entry) {
  if (!entry) return a('kitNoneChosen');
  if (entry.unavailable) return a('kitUnavailable', { kit: entry.kit });
  return a('kitChosen', { title: entry.title || entry.kit });
}

export function KitsSection({ num, gallery, showToast }) {
  const [view, setView] = useState(null);      // GET /v1/designbook/kits/defaults; false when it failed
  const [kits, setKits] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, list] = await Promise.all([apiGet('/v1/designbook/kits/defaults'), apiGet('/v1/designbook?kind=kit&limit=200')]);
      setView(d?.data || false);
      setKits(list?.data?.parts || []);
    } catch (err) { swallowed('apps-tab: kits', err); setView(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  async function choose(subject, kit) {
    setBusy(true);
    try {
      await apiPut('/v1/designbook/kits/default', { kit: kit || null, ...(subject.organism ? { organism: subject.organism } : {}) });
      showToast?.(kit ? a('kitSavedToast') : a('kitClearedToast'));
      await load();
    } catch (e) { showToast?.(e?.error?.message || e?.message || a('kitFailed'), true); }
    finally { setBusy(false); }
  }

  const row = (key, name, entry, subject) => html`
    <${Row} key=${key}>
      <${Name} meta=${subject.organism ? a('kitPlaceMeta', { state: metaOf(entry) }) : metaOf(entry)}>${name}<//>
      <${Doors}>
        <${Select} ariaLabel=${a('kitPick', { name })} value=${entry && !entry.unavailable ? entry.kit : ''}
          disabled=${busy} options=${optionsFor(kits, subject.organism)} onChange=${(v) => choose(subject, v)} />
      <//>
    <//>`;

  return html`
    <${Section} id="ap-kits" num=${num} title=${a('secKits')}>
      <${Note} kind="lead">${a('kitsLead')}<//>
      ${view === null ? html`<${Note} kind="loading">${a('kitsLoading')}<//>` : null}
      ${view === false ? html`<${Note} kind="quiet">${a('kitsFailed')}<//>` : null}
      ${view ? html`
        <${List} cols="name-doors" keepCols>
          ${row('own', a('kitOwn'), view.own, {})}
          ${(view.organisms || []).map((o) => row('org-' + o.id, o.name, o.default, { organism: o.id }))}
          <${Row} key="node">
            <${Name} meta=${a('kitNodeMeta')}>${a('kitNode')}<//>
            <${Doors}><${Note} kind="quiet">${view.node ? (view.node.title || view.node.kit) : a('kitNoneChosen')}<//><//>
          <//>
        <//>
        <${Note}>${a('kitsOrder')}<//>
        ${gallery ? html`<${Space} above="small"><${Action} small href=${gallery} newTab>${a('kitsGallery')}<//><//>` : null}` : null}
    <//>`;
}
