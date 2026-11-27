/**
 * @file federation-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab showing federated peer nodes and their online/offline status. The page
 *   explains itself the designed way (.claude/rules/page-guidance.md): the title's question mark is
 *   concept.peer, and the page's start (PageStart id "federation") gives the prompt that has one's own
 *   AI read where this server stands, with a link to the admin Federation page where peers are
 *   approved and changed.
 * @version-history
 *   v1.14.0 -- 2026-11-27 -- The peer list has a head row (the server, its address, its state).
 *   v1.13.0 -- 2026-11-27 -- Settings usability pass: the peer list is section 01 (fd-peers), always
 *     drawn, with its loading and empty lines inside it (List loading/empty); a figure strip under the
 *     head counts the peers (members in its sub line), the online ones and the offline ones (attention
 *     tone when any), all from the one listPeers() read the page already made. The strip takes
 *     hideZeros, so a server with no peer opens on the empty line; the peers that do not answer are
 *     listed first. No contents rail: the page has one section.
 *   v1.12.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart "federation" (its link opens the admin Federation page) and the title's question
 *     mark concept.peer; the head's line is two sentences and the empty line says how the list fills.
 *   v1.11.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes itself, so a peer id or URL with an ampersand showed as &amp;.
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
import { LoadingLine } from './shared.js';
import { PageSection } from '/components/PageSection.js';
import { StatusDot } from '/components/StatusDot.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';
import { Mark } from '/components/Mark.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PageStart } from '/components/PageStart.js';
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

  // The start: the prompt has one's own AI read where this server stands; the peers are approved and
  // changed on the admin Federation page, which the link opens.
  const start = html`<${PageStart} id="federation" link=${{ href: '/v1/admin?tab=federation' }} />`;

  // Where the peers stand, from the same list the section shows: how many, how many answer, and how
  // many do not (the one a person looks at, so it takes the attention tone when there is any).
  const isAlive = (p) => p.status === 'active' || !!p.alive;
  const peers = federation || [];
  const offline = peers.filter((p) => !isAlive(p)).length;
  const members = peers.filter((p) => (p.tier || 'member') === 'member').length;
  // The peers that do not answer come first in the list: they are what a person acts on. The sort is
  // stable, so the server's order holds within each group.
  const ordered = peers.slice().sort((a, b) => Number(isAlive(a)) - Number(isAlive(b)));
  // hideZeros: with no peer, the strip is not drawn and the section's empty line says how one joins.
  const strip = !federation ? html`<${FigureStrip} loading=${3} />` : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'peers', n: peers.length, label: t('profile.federation.stripPeers'), sub: t('profile.federation.stripPeersSub', { n: members }) },
    { key: 'online', n: peers.length - offline, label: t('profile.federation.stripOnline') },
    { key: 'offline', n: offline, tone: offline ? 'notice' : undefined, label: t('profile.federation.stripOffline'),
      sub: offline ? t('profile.federation.stripOfflineSub') : undefined },
  ]} />`;
  const count = federation ? peers.length : undefined;

  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuInfra'), t('profile.tabs.federation')]}
      title=${t('profile.federation.title')}
      help="concept.peer"
      desc=${t('profile.federation.desc')}
      start=${start}
      strip=${strip}>
      <${PageSection} id="fd-peers" num="01" title=${t('profile.federation.peers')} count=${count} first>
        ${!federation ? html`<${LoadingLine} text=${t('profile.federation.loading')} />` : html`
          <${List} cols="name-desc-doors" empty=${t('profile.federation.empty')}
            head=${peers.length ? [t('profile.federation.colNode'), t('profile.federation.colAddress'), t('profile.federation.colState')] : null}>
          ${ordered.map(p => {
            const alive = isAlive(p);
            const tier = p.tier || 'member';
            return html`
              <${Row} key=${p.node_id || p.nodeId || p.url}>
                <${Name}>${p.node_id || p.nodeId || p.url}<//>
                <${Desc}>${p.url || ''}<//>
                <${Doors}>
                    ${kindMark(tier === 'member', t('profile.federation.tier_' + tier) || tier)}
                    ${p.availability && p.availability !== 'unknown' ? kindMark(p.availability === 'permanent', t('profile.federation.avail_' + p.availability) || p.availability) : null}
                    <${StatusDot} status=${alive ? 'alive' : 'dead'} />
                    <${Mark} kind="status" tone=${alive ? 'fine' : 'danger'}>${alive ? t('profile.federation.online') : t('profile.federation.offline')}<//>
                <//>
              <//>`;
          })}
          <//>`}
      <//>
    <//>`;
}
