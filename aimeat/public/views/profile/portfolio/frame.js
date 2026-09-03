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
 *   v1.0.0 — 2026-09-03 — Initial (design canvas "AIMEAT Portfolio-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';

export const x = (key, vars) => t('pfpage.' + key, vars);

const localeTag = () => (getLocale() === 'fi' ? 'fi-FI' : getLocale() === 'es' ? 'es-ES' : 'en-GB');

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
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(), { day: 'numeric', month: 'numeric', year: 'numeric' });
}
export function timeWord(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
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

export function crumb() {
  return html`<div class="og-crumb"><span>${t('nav.profile')}</span><span>/</span><span>${t('profile.landing.menuBuildShare')}</span><span>/</span><span class="og-crumb-here">${t('portfolio.tabLabel')}</span></div>`;
}

export const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
export function pageLinks(navigate) {
  return html`
    <button type="button" class="og-rail-link" onClick=${() => navigate('/v1/home')}><i>→</i>${t('nav.home')}<em>→</em></button>
    <a class="og-rail-link" href="/v1/members" target="_blank" rel="noopener"><i>→</i>${t('members.title')}<em>→</em></a>
    <button type="button" class="og-rail-link" onClick=${() => openTab('companies')}><i>→</i>${t('profile.tabs.companies')}<em>→</em></button>
    <button type="button" class="og-rail-link" onClick=${() => openTab('apps')}><i>→</i>${t('profile.tabs.apps')}<em>→</em></button>`;
}
