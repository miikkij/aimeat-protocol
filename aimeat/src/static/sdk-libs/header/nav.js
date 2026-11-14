/**
 * @file header/nav.js
 * @description The links of the served header (aimeat-header.js), as data. The node's own pages draw
 *   their bar in public/spa.html (Header); a page outside the shell (an operator's front page, an
 *   app) draws the same bar with this library. The two are one bar to the person using them, so the
 *   links, their order and who sees them are written here once and
 *   test/unit/sdk-header-nav.test.ts holds them against spa.html: a link added to the shell's bar
 *   and not here fails that test.
 *
 *   The library had fallen behind: on 2026-11-14 a signed-in person on aimeat.io's front page had
 *   Help, Apps and Settings only (the shell had gained Home, Messages, Agents and Chat on
 *   2026-10-18), and Apps opened /app-catalog.html, the catalogue the shell left for /v1/appcat.
 * @structure PUBLIC_LINKS · SIGNED_IN_LINKS · brandPath(signedIn) · headerLinks(site, navConfig) ·
 *   linkShown(link, session)
 * @usage import { headerLinks, linkShown, brandPath } from './nav.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial: the shell's signed-in links (Home, Messages, Agents, Chat, Apps,
 *     Settings, Admin), the operator's order and hidden list for the public ones, Learn when the
 *     node has one, and the shorter bar of a customer's node and of a signed-in-only node.
 */

/**
 * The public links, in the declared order (spa.html PUBLIC_NAV_LINKS). `when: 'anon'` is shown
 * without a session only; a link with `site` takes its address from the node's own site links and
 * is left out when the node has none.
 * @type {ReadonlyArray<{ id: string, path?: string, site?: string, key: string, fallback: string, when?: 'anon', external?: boolean }>}
 */
export const PUBLIC_LINKS = [
  { id: 'howItWorks', path: '/v1/how-it-works', key: 'nav.howItWorks', fallback: 'How it works', when: 'anon' },
  { id: 'learn', site: 'learn', key: 'nav.learn', fallback: 'Learn', when: 'anon', external: true },
  { id: 'business', path: '/v1/business', key: 'nav.business', fallback: 'For your business', when: 'anon' },
  { id: 'help', path: '/v1/help', key: 'nav.help', fallback: 'Help' },
];

/**
 * Where a signed-in person goes, in the shell's order. `operator` is shown to an operator only.
 * nav.chat has no entry in the locale files: the shell shows "Chat" in every language too.
 * @type {ReadonlyArray<{ id: string, path: string, key: string, fallback: string, operator?: boolean, cls?: string }>}
 */
export const SIGNED_IN_LINKS = [
  { id: 'home', path: '/v1/home', key: 'nav.home', fallback: 'Home' },
  { id: 'messages', path: '/v1/profile?tab=messages', key: 'nav.messages', fallback: 'Messages' },
  { id: 'agents', path: '/v1/home?agents=1', key: 'nav.agents', fallback: 'Agents' },
  { id: 'chat', path: '/v1/chat', key: 'nav.chat', fallback: 'Chat' },
  { id: 'apps', path: '/v1/appcat', key: 'nav.apps', fallback: 'Apps' },
  { id: 'profile', path: '/v1/profile', key: 'nav.profile', fallback: 'Settings & Controls', cls: 'profile-link visible' },
  { id: 'admin', path: '/v1/admin', key: 'nav.admin', fallback: 'Admin', operator: true },
];

/**
 * Where the wordmark goes: the home for a signed-in person, the front page for everyone else.
 * @param {boolean} signedIn
 * @returns {string}
 */
export function brandPath(signedIn) {
  return signedIn ? '/v1/home' : '/v1/portal';
}

/**
 * The links this node's bar carries, in the order drawn. Each has `show`: 'anon' (no session),
 * 'auth' (a session), 'operator' (an operator's session) or 'always'.
 *
 * - The public links follow the operator's order and hidden list (GET /v1/site/header-nav). Without
 *   one (the request failed) they keep the declared order.
 * - On a customer's node the bar is the owner's: of the public links only Help, and no Admin (the
 *   maintenance is in Settings there).
 * - On a signed-in-only node a visitor without a session reaches no public page, so the bar carries
 *   no link for them: Help shows with a session only.
 *
 * @param {{ learn?: string, customerNode?: boolean, signedInOnly?: boolean } | null | undefined} site
 *   what the node says about itself (window.__AIMEAT_HEADER_CFG__)
 * @param {{ order?: unknown, hidden?: unknown } | null | undefined} navConfig the operator's arrangement
 * @returns {Array<{ id: string, href: string, key: string, fallback: string, show: 'anon'|'auth'|'operator'|'always', external: boolean, cls: string }>}
 */
export function headerLinks(site, navConfig) {
  const s = site || {};
  const declared = PUBLIC_LINKS.map((l) => l.id);
  const stored = (navConfig && Array.isArray(navConfig.order))
    ? navConfig.order.filter((id) => typeof id === 'string' && declared.indexOf(id) !== -1)
    : [];
  // An order that does not name a declared link keeps that link, in its declared place at the end.
  const order = stored.concat(declared.filter((id) => stored.indexOf(id) === -1));
  const hidden = (navConfig && Array.isArray(navConfig.hidden)) ? navConfig.hidden : [];

  /** @type {Array<{ id: string, href: string, key: string, fallback: string, show: 'anon'|'auth'|'operator'|'always', external: boolean, cls: string }>} */
  const out = [];
  for (const id of order) {
    const link = PUBLIC_LINKS.find((l) => l.id === id);
    if (!link || hidden.indexOf(id) !== -1) continue;
    if (s.customerNode && id !== 'help') continue;
    const href = link.site ? String(s[link.site] || '').trim() : String(link.path);
    if (!href) continue;
    if (link.when === 'anon' && s.signedInOnly) continue;
    out.push({
      id, href, key: link.key, fallback: link.fallback,
      show: link.when === 'anon' ? 'anon' : (s.signedInOnly ? 'auth' : 'always'),
      external: !!link.external, cls: '',
    });
  }
  for (const link of SIGNED_IN_LINKS) {
    if (link.operator && s.customerNode) continue;
    out.push({
      id: link.id, href: link.path, key: link.key, fallback: link.fallback,
      show: link.operator ? 'operator' : 'auth', external: false, cls: link.cls || '',
    });
  }
  return out;
}

/**
 * Whether a link is drawn for this session.
 * @param {{ show: string }} link
 * @param {{ roles?: string[] } | null | undefined} session
 * @returns {boolean}
 */
export function linkShown(link, session) {
  if (link.show === 'always') return true;
  if (link.show === 'anon') return !session;
  if (link.show === 'auth') return !!session;
  return !!(session && Array.isArray(session.roles) && session.roles.indexOf('operator') !== -1);
}
