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
 * @structure renderPage · head · figures · noOrganism · notEnabled · numbered
 * @usage import { renderPage } from './kyc/page.js';
 * @version-history
 *   v1.4.0 — 2026-11-27 — The DPIA is a closed row of its own after the risk assessment (kyc-dpia,
 *     assessment.js secDpia), in the rail too.
 *   v1.3.0 — 2026-11-27 — A figure strip under the head for a person who does the due diligence
 *     (customers, due for review and possible sanctions matches in the notice tone, and for an officer
 *     the suspicions still to decide), counted from the lists the page already reads, never a
 *     person's data; not drawn while every figure is zero (FigureStrip hideZeros). "Due for review"
 *     turns the list's filter on. Risk assessment and Settings are rows that say their state and open
 *     in place (each opens by itself when it needs the person). "Your own verification" is drawn once
 *     it holds something, and for a person who does no due diligence it comes first. The two headings
 *     that were sentences are noun phrases. Sections are numbered as drawn, the contents rail lists
 *     them once there are two or more, and the related pages stay in the rail. Every section keeps
 *     its id; no control was removed.
 *   v1.2.0 — 2026-11-19 — The section "Risk assessment" (assessment.js) before Settings, for officers and admins.
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
import { FigureStrip } from '/components/FigureStrip.js';
import { inboxLinkHref } from '/components/InboxLink.js';
import { x, word, crumb, pageLinks, today, ORG_ROLES } from './frame.js';
import { secCustomers, customerDialog, isDue, hasMatch } from './customers.js';
import { secCard } from './card.js';
import { cardDialog } from './card-dialogs.js';
import { secSuspicions, openCases } from './suspicions.js';
import { secSettings } from './settings.js';
import { secMine, mineHas } from './mine.js';
import { secAssessment, secDpia } from './assessment.js';

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

/**
 * Where the due diligence stands, for a person who does it: counts from the lists the page already
 * read (the customers without the "due" filter, and the officer's cases), never a person's data.
 * Every customer first, so a firm with none yet shows no strip (hideZeros); what needs the person in
 * the notice tone. Null for a person who does no due diligence here: nothing on the page is counted.
 */
function figures(ctx, active) {
  if (!active) return null;
  const cu = ctx.cu;
  if (!cu.all) return cu.err ? null : html`<${FigureStrip} loading=${ctx.su.officer ? 4 : 3} />`;
  const day = today();
  // With the "due" filter on, the list holds exactly the server's due customers; else count them here.
  const dueList = cu.due && cu.list ? cu.list : cu.all.filter((c) => isDue(c, day));
  const dueN = dueList.length;
  const matchN = dueList.filter(hasMatch).length;
  const casesN = openCases(ctx.su);
  return html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'all', n: cu.all.length, label: x('secCustomers') },
    { key: 'due', n: dueN, tone: dueN ? 'notice' : undefined, label: x('filter.due'),
      sub: dueN && !cu.due ? x('strip.dueSub') : undefined, onClick: dueN && !cu.due ? () => cu.setDue(true) : undefined },
    { key: 'match', n: matchN, tone: matchN ? 'notice' : undefined, label: x('strip.matches'), sub: matchN ? x('strip.matchesSub') : undefined },
    ctx.su.officer && { key: 'cases', n: casesN, tone: casesN ? 'notice' : undefined, label: x('strip.cases') },
  ]} />`;
}

/** No organism: what turns the page on, and the message to the operators when their setting is off. */
function noOrganism(ctx, num, first) {
  const mode = ctx.orgs?.mode || '';
  const open = OPEN_MODES.has(mode);
  return html`
    <${Section} id="kyc-off" num=${num} title=${x('offHead')} count="" first=${first}>
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

/**
 * The organism's due diligence is off. The server's sentence is written for an AI (it names a tool
 * and a route, in English), so the page says the same fact in the person's language from the
 * refusal's code and the node's mode; a refusal it does not know is shown as the server sent it.
 */
function notEnabled(ctx, num, first) {
  const open = OPEN_MODES.has(ctx.orgs?.mode || '');
  const code = ctx.cu.code;
  const row = code === 'KYC_NOT_STAFF'
    ? { k: x('offRole'), v: x('offMemberNeeded'), sub: x('offMemberSub'), warn: true }
    : !open
      ? { k: x('offSetting'), v: x('offSettingOff'), sub: x('offSettingSub'), warn: true }
      : { k: x('offDeclaration'), v: x('offDeclarationNeeded'), sub: x('offDeclarationSub'), warn: true };
  const known = code === 'KYC_NOT_ENABLED' || code === 'KYC_NOT_STAFF';
  return html`
    <${Section} id="kyc-off" num=${num} title=${x('offHead')} count="" first=${first}>
      ${known ? html`<${Facts} rows=${[row]} />` : html`<${Note} kind="aside">${ctx.cu.err}<//>`}
      ${open ? null : html`
        <${Actions}><${Action} small href=${inboxLinkHref('support@operators', x('askSubject'))}>${x('askOperator')}<//><//>`}
    <//>`;
}

/** The sections of the page in order, each with its number and its rail entry. */
function numbered(ctx) {
  const parts = [];
  // Numbered in the order drawn, so a section not drawn leaves no gap; the first has no rule on top.
  const add = (id, label, draw) => { const num = String(parts.length + 1).padStart(2, '0'); parts.push({ id, num, label, node: draw(num, parts.length === 0) }); };
  const list = ctx.orgs?.organisms || [];
  const org = list.find((o) => o.id === ctx.org);
  const active = !!org && ORG_ROLES.includes(org.role);
  const mine = mineHas(ctx.me);
  const addMine = () => add('kyc-mine', x('secMine'), (n, first) => secMine(ctx.me, n, first));
  const working = list.length && active && ctx.cu.code !== 'KYC_NOT_ENABLED' && ctx.cu.code !== 'KYC_NOT_STAFF';
  if (!working) {
    // The person does no due diligence here: their own verification, when they have one, is what is
    // theirs on the page, so it comes first; then what would turn the work on.
    if (mine) addMine();
    if (!list.length) add('kyc-off', x('offHead'), (n, first) => noOrganism(ctx, n, first));
    else if (ctx.cu.code === 'KYC_NOT_ENABLED') add('kyc-off', x('offHead'), (n, first) => notEnabled(ctx, n, first));
    // Named in the settings but not an active member: the server answers KYC_NOT_STAFF.
    else if (ctx.cu.code === 'KYC_NOT_STAFF') add('kyc-off', x('offRole'), (n, first) => html`
      <${Section} id="kyc-off" num=${n} title=${x('offRole')} count="" first=${first}>
        <${Note} kind="lead">${x('notMemberLead', { organism: org?.name || '' })}<//><//>`);
    else add('kyc-off', x('offRole'), (n, first) => html`
      <${Section} id="kyc-off" num=${n} title=${x('offRole')} count="" first=${first}><${Note} kind="lead">${x('noRoleLead', { organism: org?.name || '' })}<//><//>`);
    return parts;
  }
  // The customers are the main thing, then the opened card and the suspicions, open; the risk
  // assessment and the settings are rows that say their state; the person's own verification last.
  add('kyc-customers', x('secCustomers'), (n) => secCustomers(ctx.cu, ctx.card, n));
  if (ctx.card.id) add('kyc-card', x('card.title'), (n) => secCard(ctx.card, n));
  add('kyc-suspicions', x('secSuspicions'), (n) => secSuspicions(ctx.su, ctx.cu, n));
  if (ctx.ra.may) add('kyc-assessment', x('secAssessment'), (n) => secAssessment(ctx.ra, n));
  if (ctx.ra.may && ctx.ra.dpia?.item) add('kyc-dpia', x('dpia.title'), (n) => secDpia(ctx.ra, n));
  if (ctx.st.reader) add('kyc-settings', x('secSettings'), (n) => secSettings(ctx.st, n));
  if (mine) addMine();
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
  // The contents rail lists the sections once there are two or more; the related pages stay in it.
  const railed = parts.length > 1;
  return html`
    <${SettingsPage} crumb=${crumb()} ...${head(ctx)} start=${start} strip=${figures(ctx, active)}
      railTitle=${railed ? x('railTitle') : undefined} sections=${railed ? parts.map((p) => ({ id: p.id, num: p.num, label: p.label })) : undefined}
      pagesLabel=${x('pages')} pages=${pageLinks()}
      after=${html`${customerDialog(ctx.cu)}${cardDialog(ctx.card)}`}>
      ${parts.map((p) => p.node)}
    <//>`;
}
