/**
 * @file federation-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing federated peer nodes and their online/offline status.
 * @version-history
 *   v1.11.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage, List, Mark, Note): the page passes data and writes no class. Put back from main: a member peer and a permanent one stand out (the success colour on main, the tag's fine tone now) from a visiting, genesis or temporary one (the plain tag) (page group G8).
 *   v1.10.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.7.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.6.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.5.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.4.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-16 — Initial federation tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (#11): peer online/offline dot
 *     uses canonical <StatusDot> (alive/dead) instead of bespoke .peer-dot.
 *   v1.3.0 — 2026-06-19 — Show peer tier (visiting/member/genesis) + availability
 *     (temporary/permanent) pills next to the status (visiting-node feature).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { PageSection } from '/components/PageSection.js';
import { StatusDot } from '/components/StatusDot.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { listPeers } from '/js/services/federation.js';
import { swallowed } from '/js/swallowed.js';

export default function FederationTab() {
  const [federation, setFederation] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const peers = await listPeers();
      setFederation(peers);
    } catch (err) { swallowed('federation-tab', err); setFederation([]); }
  }

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['federation'], () => loadRef.current()), []);

  // A peer's tier and availability are kinds (tags); main drew the settled ones (a member, a
  // permanent node) in the success colour and the passing ones (visiting, genesis, temporary) in
  // the info colour: the settled one is the tag's fine tone now, the others the plain tag.
  const kindMark = (settled, words) => html`<${Mark} tone=${settled ? 'fine' : undefined}>${words}<//>`;

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuInfra'), t('profile.tabs.federation')]}
      title=${t('profile.federation.title')}
      desc=${t('profile.federation.desc')}>
    ${!federation ? html`<${LoadingLine} text=${t('profile.federation.loading')} />`
      : federation.length === 0 ? html`<${Note} kind="quiet">${t('profile.federation.empty')}<//>`
      : html`<${PageSection} band title=${t('profile.federation.peers')}>
          <${List} cols="name-desc-doors">
          ${federation.map(p => {
            const alive = p.status === 'active' || p.alive;
            const tier = p.tier || 'member';
            return html`
              <${Row} key=${p.node_id || p.nodeId || p.url}>
                <${Name}>${escHtml(p.node_id || p.nodeId || p.url)}<//>
                <${Desc}>${escHtml(p.url || '')}<//>
                <${Doors}>
                    ${kindMark(tier === 'member', t('profile.federation.tier_' + tier) || tier)}
                    ${p.availability && p.availability !== 'unknown' ? kindMark(p.availability === 'permanent', t('profile.federation.avail_' + p.availability) || p.availability) : null}
                    <${StatusDot} status=${alive ? 'alive' : 'dead'} />
                    <${Mark} kind="status" tone=${alive ? 'fine' : 'danger'}>${alive ? t('profile.federation.online') : t('profile.federation.offline')}<//>
                <//>
              <//>`;
          })}
          <//><//>`
    }
    <//>`;
}
