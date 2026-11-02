/**
 * @file public/views/profile/exposure/named.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data row of "What others can see" (design canvas "Jaettu data", board
 *   Mita-muut-nakevat; WP11): the data packages, the named shares and the outside parties are ONE row
 *   here, with how many packages are shared and how, the reads of 30 days, and the way to "Data you
 *   share", where each of them is listed and closed. So the same list is not on two pages. The numbers
 *   are GET /v1/datapackages/shared, the view that page reads; the exposure report itself (GET
 *   /v1/exposure/mine, aimeat_exposure_report) keeps every item, only this page groups them.
 *   Made of the component kit.
 * @structure secData · NAMED_KINDS
 * @usage ${secData({ shared, num })}
 * @version-history
 *   v2.0.0 — 2026-11-02 — The three sections (named shares, outside parties, data products) are one Data
 *     row with a way to "Data you share" (WP11, board Mita-muut-nakevat).
 *   v1.1.0 — 2026-11-01 — "Manage" and "Change" open the Data Wallet party and the product in the
 *     profile (they changed the address only, WP10e B2).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn } from '/js/i18n.js';
import { Section } from '/components/Section.js';
import { Box } from '/components/Box.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { openTabAt } from '../landing-page.helpers.js';

const x = (key, vars) => (vars && 'n' in vars ? tn(`exposure.${key}`, vars.n, vars) : t(`exposure.${key}`, vars));

/** A press on a link to another profile tab opens that tab here (a plain link changed only the address). */
const inProfile = (e) => {
  const href = e.currentTarget?.getAttribute?.('href');
  if (href && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 1 && openTabAt(href)) e.preventDefault();
};

/** The kinds the Data row stands for, which the list of everything else then leaves out. */
export const NAMED_KINDS = ['named_share', 'outside_party', 'datapackage'];

export function secData({ shared, num }) {
  const pkgs = shared?.packages || [];
  // Shared: a package someone other than the person can read (an audience, a named share, a sale).
  const out = pkgs.filter((p) => p.audience !== 'private' || (p.shares || []).length || p.sale);
  const c = shared?.counts || {};
  const members = pkgs.filter((p) => p.audience === 'members' || String(p.audience).startsWith('organism:')).length;
  const parts = [
    c.public ? x('data.public', { n: c.public }) : null,
    members ? x('data.members', { n: members }) : null,
    c.named ? x('data.named', { n: c.named }) : null,
    c.sale ? x('data.sale', { n: c.sale }) : null,
    c.space ? x('data.space', { n: c.space }) : null,
  ].filter(Boolean);
  return html`<${Section} id="ex-data" num=${num} title=${x('data.title')}>
    <${Box} name=${shared ? x('data.shared', { n: out.length }) : x('loading')}
      doors=${html`<${Action} small href="/v1/profile?tab=sharedData" onClick=${inProfile}>${t('profile.tabs.sharedData')}<//>`}>
      ${parts.length ? html`<${Note}>${parts.join(' · ')}<//>` : html`<${Note} kind="quiet">${x('data.none')}<//>`}
      <${Note} kind="quiet">${x('data.reads', { n: shared?.reads_30d || 0 })}<//>
    <//>
  <//>`;
}
