/**
 * @file public/views/profile/portfolio/frame.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Portfolio page's views share: the words (x), the page's two addresses, the
 *   title read out of the stored HTML, the words for who wrote the page and when, the request a
 *   person hands their AI and the rule an agent gets, the crumb and the cross-page rail links.
 * @structure x · apexUrl · titleOf · dateWord · timeWord · writtenBy · aiRequest · agentRule ·
 *   crumb · pageLinks · openTab
 * @usage import { x, titleOf } from './frame.js';
 * @version-history
 *   v1.1.0 — 2026-09-26 — The crumb and the rail's sibling pages are data for SettingsPage; openTab is
 *     the Rail's (component plan C9); this file writes no markup (page group G8).
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Portfolio-sivu", direction A).
 */
import { t } from '/js/i18n.js';
import { date as fmtDate, time as fmtTime } from '/js/format.js';

export const x = (key, vars) => t('pfpage.' + key, vars);

// The six copies of localeTag() that used to live here derived the FORMAT from the LANGUAGE, and
// they had already drifted: five gave English en-GB while the money path special-cased en-US. The
// format is the reader's own now, from their profile, falling back to their browser. /js/format.js

/** The page's address on this node. */
export const apexUrl = (owner) => `${window.location.origin}/v1/portfolio/${encodeURIComponent(owner)}`;

/** The <title> of a stored page, entities decoded, or '' when it has none. */
export function titleOf(pageHtml) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(pageHtml || '');
  if (!m) return '';
  const el = document.createElement('textarea');
  el.innerHTML = m[1];
  return el.value.replace(/\s+/g, ' ').trim();
}

export function dateWord(iso) {
  if (!iso) return '';
  return fmtDate(iso, { day: 'numeric', month: 'numeric', year: 'numeric' });
}
export function timeWord(iso) {
  if (!iso) return '';
  return fmtTime(iso, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Who wrote the page, in words. A page that came from the welcome mat carries the model and the
 * app in its head, and the home has already read them; any other page says so plainly.
 */
export function writtenBy(cfg, ai) {
  if (cfg?.source === 'welcome-mat' && ai && (ai.model || ai.client || ai.vendor)) {
    const who = [ai.model || ai.vendor, ai.client].filter(Boolean).join(' · ');
    return { main: x('writerMat', { who }), sub: x('writerMatSub') };
  }
  if (cfg?.source === 'welcome-mat') return { main: x('writerMatUnknown'), sub: x('writerMatSub') };
  return { main: x('writerUnknown'), sub: x('writerUnknownSub') };
}

/** The request a person pastes into their own AI chat. English, since it is for the model. */
export function aiRequest(owner, hasPage) {
  const url = apexUrl(owner);
  return hasPage
    ? `Read my page at ${url} and improve it: (say here what you want changed). Keep everything that is still true, write the whole HTML document, and publish it with the aimeat_portfolio_publish tool. Then tell me the address so I can look.`
    : `Make me a page for my AIMEAT home: one HTML document that says who I am, what I work on and how to reach me. Ask me what to say if you do not know. Publish it with the aimeat_portfolio_publish tool and tell me the address so I can look.`;
}

/** The rule an agent gets with the page's slab. English, since it is for the model. */
export function agentRule(owner, nodeUrl) {
  return [
    `When the person you act for asks to change their page or portfolio on this AIMEAT node, read the current page first (GET ${apexUrl(owner)}), make the requested change to the WHOLE document, and publish it with aimeat_portfolio_publish { html }. Publishing replaces the previous page completely. Tell the person the address and ask them to look. A company's page is a different thing and a different tool (aimeat_company_portfolio_publish).`,
    `Without MCP: PUT ${nodeUrl}/v1/portfolio/upload with a JSON body { "html": "<!doctype html>…" }.`,
  ].join('\n');
}

/** The crumb's steps (SettingsPage draws them). */
export function crumb() {
  return [t('nav.profile'), t('profile.landing.menuBuildShare'), t('portfolio.tabLabel')];
}

export { openTab } from '/components/Rail.js';
/** The sibling pages in the rail, as data (SettingsPage draws them → … →). */
export function pageLinks(navigate) {
  return [
    { onClick: () => navigate('/v1/home'), label: t('nav.home') },
    { href: '/v1/members', newTab: true, label: t('members.title') },
    { tab: 'companies', label: t('profile.tabs.companies') },
    { tab: 'apps', label: t('profile.tabs.apps') },
  ];
}
