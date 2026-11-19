/**
 * @file public/views/profile/kyc/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The customer due diligence page (Settings & Controls → Account): the head with the
 *   title's question mark (concept.kyc) and the organism picker (only the organisms where the person
 *   has a role or which have declared themselves obliged entities), the page's start (PageStart: what
 *   the page is for, the prompt that has one's own AI open a card and say what it lacks, what happens
 *   next), then the sections: the customers (customers.js), the open card (card.js), the suspicions
 *   (suspicions.js), the settings (settings.js, for admins and officers) and the person's own
 *   verification (mine.js, for everyone). With no organism the page says what turns it on: the
 *   operator's setting and the organism's declaration, with a message to the operators when the
 *   setting is off. How the page explains itself: .claude/rules/page-guidance.md.
 * @structure renderPage · head · noOrganism · notEnabled · numbered
 * @usage import { renderPage } from './kyc/page.js';
 * @version-history
 *   v1.1.0 — 2026-11-19 — Browser check: a person named in the settings who is not an active member
 *     (KYC_NOT_STAFF) is told that only active members do this work and that an admin adds them as a
 *     member first; the empty state says the same; every section's small figure is a count or empty,
 *     never the section's number; the suspicions get the customers' names.
 *   v1.0.0 — 2026-11-19 — Initial (wish-kyc-aml-aimeatiin-suunnitelma-ja-design).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { PageStart } from '/components/PageStart.js';
import { Select } from '/components/Select.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { inboxLinkHref } from '/components/InboxLink.js';
import { x, word, crumb, pageLinks, ORG_ROLES } from './frame.js';
import { secCustomers, customerDialog } from './customers.js';
import { secCard } from './card.js';
import { cardDialog } from './card-dialogs.js';
import { secSuspicions } from './suspicions.js';
import { secSettings } from './settings.js';
import { secMine } from './mine.js';

const html = htm.bind(h);

/** The modes in which an organism may be an obliged entity (services/aml/gate.ts). */
const OPEN_MODES = new Set(['owners', 'node']);

/** The head: title, its question mark, the role as a mark, the picker as the head's action. */
function head(ctx) {
  const list = ctx.orgs?.organisms || [];
  const org = list.find((o) => o.id === ctx.org);
  const marks = org ? [{ label: word('role', org.role), tone: org.role === 'officer' ? 'sun' : undefined }, !org.declared && { label: x('notDeclared'), tone: 'coral' }].filter(Boolean) : [];
  const actions = list.length > 1 ? html`
    <${Select} label=${x('organism')} value=${ctx.org} onChange=${(v) => ctx.setOrg(v)} options=${list.map((o) => [o.id, o.name])} />` : null;
  return { title: t('profile.tabs.kyc'), help: 'concept.kyc', desc: x('desc'), marks, actions, sub: org && list.length === 1 ? org.name : undefined };
}

/** No organism: what turns the page on, and the message to the operators when their setting is off. */
function noOrganism(ctx) {
  const mode = ctx.orgs?.mode || '';
  const open = OPEN_MODES.has(mode);
  return html`
    <${Section} id="kyc-off" num="01" title=${x('offTitle')} count="" first=${true}>
      <${Note} kind="lead">${x('offLead')}<//>
      <${Facts} rows=${[
        { k: x('offSetting'), v: open ? x('offSettingOn') : x('offSettingOff'), warn: !open, sub: x('offSettingSub') },
        { k: x('offDeclaration'), v: x('offDeclarationNeeded'), sub: x('offDeclarationSub') },
        { k: x('offRole'), v: x('offMemberNeeded'), sub: x('offMemberSub') },
      ]} />
      ${open ? null : html`
        <${Actions}>
          <${Action} small href=${inboxLinkHref('support@operators', x('askSubject'))}>${x('askOperator')}<//>
        <//>`}
    <//>`;
}

/** The organism's due diligence is off: the server's sentence names what is missing. */
function notEnabled(ctx, num) {
  return html`
    <${Section} id="kyc-off" num=${num} title=${x('offTitle')} count="" first=${true}>
      <${Note} kind="aside">${ctx.cu.err}<//>
      ${OPEN_MODES.has(ctx.orgs?.mode || '') ? null : html`
        <${Actions}><${Action} small href=${inboxLinkHref('support@operators', x('askSubject'))}>${x('askOperator')}<//><//>`}
    <//>`;
}

/** The sections of the page in order, each with its number and its rail entry. */
function numbered(ctx) {
  const parts = [];
  const add = (id, label, draw) => { const num = String(parts.length + 1).padStart(2, '0'); parts.push({ id, num, label, node: draw(num) }); };
  const list = ctx.orgs?.organisms || [];
  const org = list.find((o) => o.id === ctx.org);
  const active = !!org && ORG_ROLES.includes(org.role);
  if (!list.length) add('kyc-off', x('offTitle'), () => noOrganism(ctx));
  else if (ctx.cu.code === 'KYC_NOT_ENABLED') add('kyc-off', x('offTitle'), (n) => notEnabled(ctx, n));
  // Named in the settings but not an active member: the server answers KYC_NOT_STAFF.
  else if (ctx.cu.code === 'KYC_NOT_STAFF') add('kyc-off', x('noRoleTitle'), (n) => html`
    <${Section} id="kyc-off" num=${n} title=${x('noRoleTitle')} count="" first=${true}>
      <${Note} kind="lead">${x('notMemberLead', { organism: org?.name || '' })}<//><//>`);
  else if (!active) add('kyc-off', x('noRoleTitle'), (n) => html`
    <${Section} id="kyc-off" num=${n} title=${x('noRoleTitle')} count="" first=${true}><${Note} kind="lead">${x('noRoleLead', { organism: org?.name || '' })}<//><//>`);
  else {
    add('kyc-customers', x('secCustomers'), (n) => secCustomers(ctx.cu, ctx.card, n));
    if (ctx.card.id) add('kyc-card', x('card.title'), (n) => secCard(ctx.card, n));
    add('kyc-suspicions', x('secSuspicions'), (n) => secSuspicions(ctx.su, ctx.cu, n));
    if (ctx.st.reader) add('kyc-settings', x('secSettings'), (n) => secSettings(ctx.st, n));
  }
  add('kyc-mine', x('secMine'), (n) => secMine(ctx.me, n));
  return parts;
}

/**
 * The whole page.
 * @param {any} ctx the tab's state and handlers (kyc-tab.js)
 */
export function renderPage(ctx) {
  const list = ctx.orgs?.organisms || [];
  const org = list.find((o) => o.id === ctx.org);
  const active = !!org && ORG_ROLES.includes(org.role) && ctx.cu.code !== 'KYC_NOT_ENABLED' && ctx.cu.code !== 'KYC_NOT_STAFF';
  const start = html`<${PageStart} id="kyc" vars=${{ organism: org?.name || x('yourOrganism') }}
    action=${active ? { onClick: ctx.cu.startForm } : null} done=${active && ctx.cu.list ? ctx.cu.list.length > 0 : false} />`;
  if (!ctx.orgs) {
    return html`
      <${SettingsPage} crumb=${crumb()} ...${head(ctx)} start=${start}>
        ${ctx.orgsErr ? html`<${Note} kind="quiet">${ctx.orgsErr}<//>` : html`<${Note} kind="loading">${x('loading')}<//>`}
      <//>`;
  }
  const parts = numbered(ctx);
  return html`
    <${SettingsPage} crumb=${crumb()} ...${head(ctx)} start=${start}
      railTitle=${x('railTitle')} sections=${parts.map((p) => ({ id: p.id, num: p.num, label: p.label }))}
      pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`${customerDialog(ctx.cu)}${cardDialog(ctx.card)}`}>
      ${parts.map((p) => p.node)}
    <//>`;
}
