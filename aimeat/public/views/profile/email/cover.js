/**
 * @file public/views/profile/email/cover.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Email page in the poster face (design canvas "AIMEAT Sähköpostin sivu",
 *   direction A). Your mailboxes (the mail providers, each connection's state, the addresses it may
 *   send as, who may use it), what left through the node once something has, your address and
 *   what it is used for (with the change and the code; open and first while it needs the person,
 *   otherwise a row), and as a row the emails the node sends you (with the switches). The page's
 *   start (PageStart: the prompt connects a
 *   mailbox through the person's own AI, the mailboxes section is its button) and the title's
 *   question mark (concept.mailbox: reading and sending, who a mail may go to, an app's
 *   delegation, whose a connection is). Pure render over the ctx bag. How the page explains
 *   itself: .claude/rules/page-guidance.md.
 * @structure renderCover · lettersSub · secAddress · addressBody · secMailboxes · secSent · lettersFold
 * @usage import { renderCover } from './email/cover.js';
 * @version-history
 *   v1.25.1 -- 2026-11-27 -- The mailboxes list carries a head row (mailbox, what your agent does, state), as
 *     every list of columns on a Settings page does.
 *   v1.25.0 -- 2026-11-27 -- A mailbox that needs a new sign-in has "Connect again" as its row's main action, the
 *     same connect round its service's Connect starts; Remove stays beside it in the quiet tone. Such a mailbox
 *     is read from the server's own status, 'needs_reauth' (js/connection-wait.js needsSignIn): the page tested
 *     'expired' and 'needs-reauth', which the server never sends, so it never showed one as needing a sign-in.
 *   v1.24.0 -- 2026-11-27 -- Usability pass of the Settings pages: the mailboxes are the page (01), the
 *     one that needs a new sign-in first in its list and its figure in the notice tone. The address
 *     leads, open, only while it is missing or not confirmed; confirmed, it is one row that says the
 *     address and since when and opens in place with the change inside. What left through here is
 *     drawn once something has. The emails' row says how many are on and their language. The strip
 *     draws nothing while the page holds nothing (hideZeros) and drops the last-email figure, whose
 *     emails are listed in the emails' row; the head's marks that repeated it are gone, and the
 *     mailboxes' head no longer repeats each row's Connect. Connect a mailbox is quiet while the
 *     address is being changed or every service is connected. Sections are numbered after the filter.
 *   v1.23.0 -- 2026-11-08 -- Two letters explain themselves through their names (HelpLabel): the
 *     digest with notify.digest, the same term as the Notifications page's digest card, and the
 *     reminder with email.nudge (.claude/rules/page-guidance.md).
 *   v1.22.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart and the title's question mark concept.mailbox; the fold "Mail from a chat" (em-chat)
 *     is gone: its examples are in the concept, its prompt is the head's "Prompt for your AI".
 *   v1.21.0 -- 2026-10-28 -- The agentNarrowed row is gone: the node no longer narrows an agent by itself, so that email is never sent.
 *   v1.20.0 -- 2026-10-18 -- A letters row for the email the node sends when it narrows an agent that held all permissions (email.agentNarrowed, on unless switched off).
 *   v1.19.0 -- 2026-10-18 -- The letters open with the language they come in: a choice of English, Suomi or Español that sets the account language (PUT /v1/ghii locale), which every email the node sends the owner already followed but which only the profile dialog could set.
 *   v1.18.0 -- 2026-10-17 -- A letters row for the email an agent's permission request sends (email.agentAsks, on unless switched off).
 *   v1.17.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip with the address in its long tone; the change form as Fields; the uses, mailboxes, their delegations, the sent log and the letters as the List with Tick, Lead, When and Mark; Tabs in the fold tone; More; CardGrid; Roads; Note; Action): the page passes data and writes no class. Put back from main: no letter sent in 30 days is a dim tag (page group G8).
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-26 -- The mark of a sender that is not a person is the avatar's agent tone (.poster-box--agent, css/poster.css), a unification: the look Contacts, Notifications, Email and MCP drew alike.
 *   v1.14.0 -- 2026-09-25 -- The last emails from here are the Item grid (.item-grid, two columns), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- The mailboxes and the letters are the Listing (listing, listing-row and its name, words and doors cells, the mark in a cell of its own), a unification: the look most tabs use.
 *   v1.12.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.9.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.8.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.5.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.4.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.3.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   2026-09-13 -- Compose the shared initials-box role and its measured size cut.
 *   v1.2.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.0.0 — 2026-08-30 — Initial. Replaces a page that verified one address and said nothing else.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { FoldSection } from '/components/FoldSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { scrollToSection } from '/components/Rail.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Tick, Lead, Name, Desc, When, Cell, Doors, More } from '/components/List.js';
import { Card, CardGrid } from '/components/Card.js';
import { Tabs } from '/components/Tabs.js';
import { PageStart } from '/components/PageStart.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Mark, Label } from '/components/Mark.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Space } from '/components/Layout.js';
import { c, rel, day, clock, providerWord, isSender, stateWord, kindWord, channelWord, statusWord, Switch, crumb, pageLinks } from './frame.js';
import { Hint } from '/components/Hint.js';
import { HelpLabel } from '/components/HelpTip.js';
import { needsSignIn } from '/js/connection-wait.js';

const PAGE = 12;

/** A mailbox whose sign-in ran out: its owner signs in at the provider again (status 'needs_reauth'). */
const isStale = (conn) => needsSignIn(conn);
/** The mailbox rows' order: one that needs a new sign-in, then the connected, then the rest. */
const mailboxRank = ({ conn }) => (!conn ? 3 : isStale(conn) ? 0 : conn.status === 'active' ? 1 : 2);
const LANGUAGES = [['en', 'English'], ['fi', 'Suomi'], ['es', 'Español']];

export function renderCover(ctx) {
  const me = ctx.me || {};
  const verified = !!me.email_verified_at;
  const address = me.notification_email || '';
  // The address needs the person while it is missing or not confirmed: recovery and sign-in by link
  // wait for it. Said only once the record has loaded.
  const addressNeeds = !!ctx.me && !verified;
  const since = Date.now() - 30 * 864e5;
  const sent30 = ctx.outbound.filter(m => new Date(m.createdAt).getTime() >= since).length;
  const mailboxes = ctx.connections.length;
  const stale = ctx.connections.filter(isStale).length;
  const toConnect = ctx.providers.some(p => !ctx.connections.some(x => x.provider === p.id));
  // The figures, from what the page already read: the address and its state, the mailboxes (in the
  // notice tone when one needs a new sign-in), and what left through here in 30 days. With no
  // address, no mailbox and nothing sent the strip is not drawn (hideZeros).
  const strip = html`<${FigureStrip} hideZeros items=${[
    { key: 'address', n: address || '·', tone: address && !verified ? 'long notice' : 'long', label: c('stripAddress'), sub: verified ? c('verifiedOn', { when: day(me.email_verified_at) }) : address ? c('notVerified') : c('noAddress') },
    { key: 'mailboxes', n: mailboxes, tone: stale ? 'notice' : undefined, label: c('stripMailboxes'),
      sub: stale ? c('stripMailboxesStale', { n: stale }) : mailboxes ? c('stripMailboxesActive') : c('stripMailboxesNone') },
    { key: 'sent', n: sent30, label: c('stripSent'), sub: ctx.outbound.length ? c('stripSentSub', { total: ctx.outboundTotal }) : c('stripSentNone') },
  ]} />`;
  // The start: folded once a mailbox is connected; its button goes to the mailboxes.
  const start = html`<${PageStart} id="email" done=${ctx.me ? mailboxes > 0 : null}
    action=${{ onClick: () => scrollToSection('em-mailboxes') }} />`;
  // The mailboxes are the page. The address leads only while it needs the person; once confirmed it
  // is one row that says it. What left through here is drawn once something has, and the emails
  // AIMEAT sends are one row with their state. Numbered after the filter.
  const shown = [
    addressNeeds ? { id: 'em-address', label: c('secAddress'), count: '' } : null,
    { id: 'em-mailboxes', label: c('secMailboxes'), count: mailboxes },
    ctx.outbound.length ? { id: 'em-sent', label: c('secSent'), count: ctx.outboundTotal } : null,
    addressNeeds ? null : { id: 'em-address', label: c('secAddress'), count: '' },
    { id: 'em-letters', label: c('lettersTitle'), count: '' },
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  const sectionOf = {
    'em-address': () => secAddress(ctx, me, verified, address, numOf['em-address'], addressNeeds),
    'em-mailboxes': () => secMailboxes(ctx, numOf['em-mailboxes'], !addressNeeds),
    'em-sent': () => secSent(ctx, numOf['em-sent']),
    'em-letters': () => html`<${FoldSection} id="em-letters" num=${numOf['em-letters']} title=${c('lettersTitle')} sub=${lettersSub(ctx)} open=${ctx.folds.letters} onToggle=${() => ctx.setFold('letters', !ctx.folds.letters)}>${lettersFold(ctx)}<//>`,
  };
  return html`
    <${SettingsPage} name="em"
      crumb=${crumb()}
      title=${c('title')}
      help="concept.mailbox"
      start=${start}
      desc=${c('desc')}
      actions=${html`
        <${Loud} quiet=${ctx.changing || !toConnect} onClick=${() => scrollToSection('em-mailboxes')}>${c('connectMailbox')}<//>
        <${Actions}><${Action} small onClick=${() => ctx.copyPrompt()}>${c('promptToChat')}<//><//>`}
      strip=${strip}
      railTitle=${c('railTitle')}
      sections=${shown}
      pagesLabel=${c('pages')}
      pages=${pageLinks()}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${shown.map((s) => sectionOf[s.id]())}
    <//>`;
}

/** The emails' row: how many of the four that can be switched are on, and their language. */
function lettersSub(ctx) {
  const s = ctx.settings || {};
  const em = s.email || { workflowEnd: true };
  const on = [em.workflowEnd !== false, !!s.emailDigest?.enabled, em.nudge === true, em.agentAsks !== false].filter(Boolean).length;
  const lang = (LANGUAGES.find(([k]) => k === (ctx.me?.locale || 'en')) || LANGUAGES[0])[1];
  return ctx.me?.email_verified_at ? c('lettersSubOn', { n: on, all: 4, lang }) : c('lettersSubWaiting', { lang });
}

/**
 * The address. While it needs the person (none, or not confirmed) it is an open section with its
 * door in the plain tone; once confirmed it is one row that says the address and since when, and
 * opens in place, the change door inside it.
 */
function secAddress(ctx, me, verified, address, num, needs) {
  const door = ctx.changing ? null
    : needs ? html`<${Action} small onClick=${() => ctx.startChange()}>${address ? c('verifyAddress') : c('addAddress')}<//>`
      : html`<${Action} small soft onClick=${() => ctx.startChange()}>${c('changeAddress')}<//>`;
  const body = addressBody(ctx, verified, address);
  if (needs) {
    return html`
      <${PageSection} id="em-address" num=${num} title=${c('secAddress')} count=${c('secAddressSub')} doors=${door} first>${body}<//>`;
  }
  const open = !!ctx.folds.address || ctx.changing;
  return html`
    <${FoldSection} id="em-address" num=${num} title=${c('secAddress')} sub=${c('addressSub', { address, when: day(me.email_verified_at) })} clip
      open=${open} onToggle=${() => { if (ctx.changing) ctx.cancelChange(); ctx.setFold('address', !open); }}>
      ${door ? html`<${Actions}>${door}<//>` : null}
      ${body}
    <//>`;
}

function addressBody(ctx, verified, address) {
  const uses = ['recovery', 'magic', 'invites', 'contact', 'letters'];
  const setForm = (patch) => ctx.setForm({ ...ctx.form, ...patch });
  return html`
      ${ctx.changing ? html`
        <${Fields}>
          <${TextField} type="email" label=${c('fAddress')} value=${ctx.form.email} disabled=${ctx.busy || ctx.form.codeSent} placeholder=${t('profile.email.enterEmail')}
            onInput=${(v) => setForm({ email: v })}
            hint=${verified && address && ctx.form.email.trim() && ctx.form.email.trim() !== address ? c('changeWarning') : c('codeHint')} />
          ${ctx.form.codeSent ? html`
            <${TextField} size="short" inputMode="numeric" label=${c('fCode')} value=${ctx.form.code} placeholder="123456"
              onInput=${(v) => setForm({ code: v })} hint=${c('codeSentTo', { email: ctx.form.email.trim() })} />` : null}
        <//>
        <${FormActions}>
          ${ctx.form.codeSent
            ? html`<${Loud} control disabled=${ctx.busy || ctx.form.code.trim().length < 4} onClick=${() => ctx.confirmCode()}>${c('confirm')}<//>`
            : html`<${Loud} control disabled=${ctx.busy || !ctx.form.email.trim()} onClick=${() => ctx.sendCode()}>${c('sendCode')}<//>`}
          <${Action} small soft onClick=${() => ctx.cancelChange()}>${t('common.cancel')}<//>
        <//>`
      : html`
        <${List} cols="mark-name-mark-name" keepCols>
          ${uses.map(k => html`<${Row} key=${k}><${Tick} bare state=${verified ? 'done' : 'off'} /><${Name} desc=${c('use.' + k + 'D')}>${c('use.' + k + 'T')}<//><//>`)}
          <${Row} key="never"><${Tick} bare state="off" /><${Name} desc=${c('use.neverD')}>${c('use.neverT')}<//><//>
        <//>
        <${Hint}>${verified ? c('addressHint') : address ? c('unverifiedHint') : c('noAddressHint')}<//>`}`;
}

/** The delegations of a mailbox: which app may act on it, what it does, and the way to stop it. */
function delegations(ctx, conn) {
  const list = ctx.delegations[conn.id] || [];
  return html`<${List} cols="name-doors" dense>
    ${list.map(d => html`
      <${Row} key=${d.id}>
        <${Name} meta=${`${d.action || ''}${d.enabled === false ? ' · ' + c('stopped') : ''}`}>${d.appId || d.app_id || d.app || '?'}<//>
        <${Doors}>${d.enabled === false ? null : html`<${Action} small soft disabled=${ctx.busy} onClick=${() => ctx.stopDelegation(conn, d)}>${c('stop')}<//>`}<//>
      <//>`)}
  <//>`;
}

function secMailboxes(ctx, num, first) {
  // One row per mail service, the one that needs a new sign-in first (stable within a rank). Each
  // row has its own Connect; the head's provider buttons said the same a second time.
  const rows = ctx.providers.map((p, i) => ({ p, i, conn: ctx.connections.find(x => x.provider === p.id) || null }))
    .sort((a, b) => (mailboxRank(a) - mailboxRank(b)) || (a.i - b.i));
  return html`
    <${PageSection} id="em-mailboxes" num=${num} title=${c('secMailboxes')} count=${c('secMailboxesSub')} first=${first}>
      <${List} cols="mark-name-desc-doors" keepCols head=${rows.length ? ['', c('colMailbox'), c('colAgentDoes'), c('colState')] : null} empty=${c('noProviders')}>
        ${rows.map(({ p, conn }) => {
          const deleg = conn && (ctx.delegations[conn.id] || []).length;
          return html`
          <${Row} key=${p.id} below=${deleg ? delegations(ctx, conn) : null}>
            <${Lead} text=${providerWord(p).slice(0, 1)} agent=${!conn} />
            <${Name} meta=${conn ? [conn.accountLabel, ctx.aliases[conn.id]?.length ? c('aliases', { list: ctx.aliases[conn.id].join(', ') }) : null].filter(Boolean).join(' · ') : c('notConnected')}>${providerWord(p)}<//>
            <${Desc} sub=${deleg ? c('delegationsN', { n: ctx.delegations[conn.id].filter(d => d.enabled !== false).length }) : null}>${c(isSender(p) ? 'sendWhat' : 'readWhat')}<//>
            <${Doors}>
              ${conn ? html`
                <${Mark} kind="status" tone=${conn.status === 'active' ? 'fine' : 'attention'}>${stateWord(conn)}<//>
                ${isStale(conn) ? html`<${Action} small row disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p, true)}>${ctx.connecting === p.id ? c('connecting') : c('connectAgain')}<//>` : null}
                <${Action} small row soft disabled=${ctx.busy} onClick=${() => ctx.remove(conn, p)}>${c('remove')}<//>`
                : html`<${Action} small row disabled=${!!ctx.connecting} onClick=${() => ctx.connect(p)}>${ctx.connecting === p.id ? c('connecting') : c('connect')}<//>`}
            <//>
          <//>`; })}
      <//>
      <${Hint}>${c('mailboxesHint')}<//>
    <//>`;
}

function secSent(ctx, num) {
  const f = ctx.sentFilter;
  let list = ctx.outbound;
  if (f === 'email') list = list.filter(m => m.channel !== 'inbox');
  if (f === 'inbox') list = list.filter(m => m.channel === 'inbox');
  const shown = ctx.showAll ? list : list.slice(0, PAGE);
  const doors = html`<${Tabs} tone="fold" value=${f} onSelect=${(v) => ctx.setSentFilter(v)}
    items=${[{ value: 'all', label: c('all') }, { value: 'email', label: c('via.email') }, { value: 'inbox', label: c('via.inbox') }]} />`;
  return html`
    <${PageSection} id="em-sent" num=${num} title=${c('secSent')} count=${`${ctx.outboundTotal} · ${c('secSentSub')}`} doors=${doors}>
      <${List} cols="when-name-via-doors" keepCols empty=${ctx.outbound.length ? c('emptyFiltered') : c('emptySent')}
        head=${shown.length ? [c('colWhen'), c('colWhat'), c('colVia'), ''] : null}>
        ${shown.map(m => html`
          <${Row} key=${m.id}>
            <${When} at=${clock(m.createdAt)}>${rel(m.createdAt)}<//>
            <${Name} meta=${`${ctx.contactName(m.contactId)} · ${c('kind.' + (m.kind || 'transactional'))} · ${statusWord(m.status)}`}>${m.subject || c('noSubject')}<//>
            <${Cell} meta>${channelWord(m)}${m.organismId ? html`<br />${c('asOrganism')}` : null}<//>
            <${Doors}>${m.contactId ? html`<${Action} small row soft onClick=${() => ctx.openContact(m.contactId)}>${c('openContact')}<//>` : null}<//>
          <//>`)}
      <//>
      ${list.length > shown.length ? html`<${More} onMore=${() => ctx.setShowAll(true)} label=${c('showRest', { n: list.length - shown.length })} />` : null}
      <${Hint}>${c('sentHint')}<//>
    <//>`;
}

function lettersFold(ctx) {
  const s = ctx.settings || {};
  const em = s.email || { workflowEnd: true };
  const digest = s.emailDigest || { enabled: false, afterHours: 8 };
  const verified = !!ctx.me?.email_verified_at;
  const off = ctx.busy || !verified;
  // `help`: the term whose explanation the row's name opens (HelpLabel), for a letter whose rules
  // its words cannot carry: the digest's hours, the reminder's 14 and 60 days.
  const named = (key, help) => (help
    ? html`<${HelpLabel} term=${help} label=${c('letter.' + key + 'T')}>${c('letter.' + key + 'T')}<//>`
    : c('letter.' + key + 'T'));
  const row = (key, ctl, help) => html`
    <${Row} key=${key}>
      <${Lead} text="A" />
      <${Name} meta=${c('letter.' + key + 'S')}>${named(key, help)}<//>
      <${Desc}>${c('letter.' + key + 'D')}<//>
      <${Doors}>${ctl}<//>
    <//>`;
  const setDigest = (patch) => ctx.saveSettings({ ...s, emailDigest: { ...digest, ...patch } });
  return html`
    <${List} cols="mark-name-desc-doors" keepCols>
      ${row('language', html`<${Select} fit ariaLabel=${c('letter.languageT')} value=${ctx.me?.locale || 'en'} disabled=${ctx.busy || !ctx.me}
        onChange=${(v) => ctx.saveLanguage(v)} options=${LANGUAGES} />`)}
      ${row('security', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('invites', html`<${Switch} on locked label=${c('always')} />`)}
      ${row('workflow', html`<${Switch} on=${em.workflowEnd !== false} label=${c('emailWord')} disabled=${off} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, workflowEnd: em.workflowEnd === false } })} />`)}
      ${row('digest', html`
        ${digest.enabled ? html`<${Select} fit ariaLabel=${c('letter.digestT')} value=${String(digest.afterHours)} onChange=${(v) => setDigest({ afterHours: Number(v) })}
          options=${[2, 4, 8, 24, 72].map(h => [String(h), c('afterHours', { h })])} />` : null}
        <${Switch} on=${digest.enabled} label=${c('emailWord')} disabled=${off} onToggle=${() => setDigest({ enabled: !digest.enabled })} />`, 'notify.digest')}
      ${row('nudge', html`<${Switch} on=${em.nudge === true} label=${c('emailWord')} disabled=${off} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, nudge: em.nudge !== true } })} />`, 'email.nudge')}
      ${row('agentAsks', html`<${Switch} on=${em.agentAsks !== false} label=${c('emailWord')} disabled=${off} onToggle=${() => ctx.saveSettings({ ...s, email: { ...em, agentAsks: em.agentAsks === false } })} />`)}
    <//>
    <${Hint}>${verified ? c('lettersHint') : c('lettersNeedVerified')}<//>
    ${ctx.mailLog.length ? html`
      <${Space} above="large"><${Label} block>${c('lastLetters')}<//><//>
      <${CardGrid} cols="two">${ctx.mailLog.slice(0, 8).map((e, i) => html`<${Card} key=${i} name=${kindWord(e.kind)} meta=${`${rel(e.at)}${e.subject ? ' · ' + e.subject : ''}`} />`)}<//>` : null}`;
}
