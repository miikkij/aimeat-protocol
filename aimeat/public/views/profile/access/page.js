/**
 * @file public/views/profile/access/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Access page in the poster face: the mast says what a key is and offers the one
 *   loud action (a passkey while there is none, a new token after that); the strip says how many
 *   apps act in the person's name, how many tokens, whether two-step is on and how many sessions are
 *   open; 01 how you sign in (password, passkeys, two-step, the open sessions grouped, the servers
 *   allowed to verify you, the recovery key); 02 who acts in your name (the apps' keys and the
 *   tokens in one list, in words, with the base package said once, and the token form as a fold);
 *   03 your accounts at other services; 04 the secrets an extension may use without seeing them;
 *   05 sharing groups; 06 your addresses for an AI; 07 how your AI reads this page. Pure render
 *   over the ctx bag; the rows are rows.js. Every part is a component that takes data
 *   (components/SettingsPage, Section, List, Box, Facts, FigureStrip, Roads, the Field family,
 *   Action, Mark, Note); this file writes no class.
 *
 *   SECRETS SIT WITH THE ACCOUNTS, not with the keys. Both sections answer the same question — a
 *   credential of the person's that something else uses without ever holding it — while section 02
 *   answers the opposite one, which is what a key of THIS account may do.
 *
 *   THE KEPT SECTIONS DRAW NO HEADING OF THEIR OWN HERE. The two-step and passkey panels, the
 *   accounts, the MCP servers, the sharing groups and what is shared with you are components of
 *   their own that carry a heading and an intro for when they stand alone. Here the page's section
 *   or the sign-in row above them already says both, so each is given `inRow` and leaves them out
 *   (until 2026-09-26 a page rule, .ac-kept and .ac-panel, hid them after they were drawn).
 * @structure renderPage · marks · mastActions · strip · secretTile · secSignIn · secKeys ·
 *   tokenFold · secAccounts · secMcp · secSecrets · secretFold · secGroups · secAddresses · secRoads
 * @usage import { renderPage } from './access/page.js';
 * @version-history
 *   v1.29.0 -- 2026-10-03 -- The page's start (components/PageStart.js: the first prompt asks the person's AI what each key may do, its button opens the keys) and the title's question mark, concept.scope (guidance part B).
 *   v1.28.0 -- 2026-10-02 -- The question mark that explains a key's level: access.scopes on the level Field group (components/HelpTip.js).
 *   v1.27.0 --2026-09-26 -- Every part is a component that takes data, and the file writes no class
 *     (component plan, page group G3): the frame is SettingsPage, the sections Section (the two forms
 *     its fold), the strip FigureStrip, the sign-in rows one List whose rows carry their panel or
 *     block under them (Row below), the keys and the secrets List rows, the filters Tabs in their
 *     filter tone with the count as the tally, the "why" boxes and the recovery key Box (the key a
 *     blurred Code), the forms the Field family, the addresses Facts with the copy beside the value,
 *     the two roads Roads. Put back from main: the tag that counts nothing yet (the sessions tag,
 *     "not on this device") in its dim tone. The kept sections are given `inRow` instead of being
 *     hidden by .ac-kept and .ac-panel.
 *   v1.26.0 -- 2026-09-26 -- The ready-made request and the new token are the Code block (css/components/code-block.css), a unification: Jouni's decision "Code block".
 *   v1.25.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.24.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.23.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.22.0 -- 2026-09-25 -- Picking a key's level, rights and expiry is the Tab in its tile tone, a risky choice in its attention tone (a unification: Jouni's decision "Choice").
 *   v1.21.0 -- 2026-09-25 -- The addresses are the Facts (css/components/facts.css), a unification: the look most tabs use. A copy door sits at the end of its value.
 *   v1.20.0 -- 2026-09-25 -- The sign-in rows, the keys and the secrets are the Listing (css/components/listing.css), a unification: the look most tabs use. Each sign-in row is a listing of its own, with its panel or block between the listings.
 *   v1.19.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.18.0 -- 2026-09-25 -- The paragraph that opens a section is the og-lead, as in most tabs, not the Hint (UI consolidation phase 5, a unification).
 *   v1.17.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.16.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.15.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.14.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.13.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.12.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.11.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.10.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's
 *     danger tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.9.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.8.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- The filter "unused" is coral again while unused keys exist, as the tab's attention tone.
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.7.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.6.0 -- 2026-09-16 -- MCP servers get section 04 of their own, with a title, a count and an
 *     intro, and the sections after it move one number down (05 secrets to 08 your AI). They had sat
 *     under "Your accounts at other services", where on a server without outside accounts they
 *     appeared directly under "not enabled on this server". An MCP server is tools, not an account.
 *   v1.5.0 -- 2026-09-16 -- Section 03 says the MCP servers list's own title and explanation. The
 *     .ac-kept rule hid them, so the servers showed unlabelled under "not enabled on this server".
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   v1.4.0 -- 2026-09-13 -- Compose the recovery frame from poster.css.
 *   v1.3.0 -- 2026-09-13 -- Compose the existing instruction frame from poster.css.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-06 — Section 04, the secrets: the list with what names each one, the add form
 *     as a fold with a write-only value field, a replace on the row and a delete behind the
 *     confirm. The strip counts them, the rail carries them, and 05 to 07 moved down by one.
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", direction A).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { PageStart } from '/components/PageStart.js';
import { Section } from '/components/Section.js';
import { scrollToSection } from '/components/Rail.js';
import { Tabs } from '/components/Tabs.js';
import { Space } from '/components/Layout.js';
import { List, Row, Name, Doors, More } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { Roads, Road } from '/components/Roads.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { TwoFactorSection } from '../security-tab/two-factor.js';
import { PasskeysSection } from '../security-tab/passkeys.js';
import { ConnectionsSection } from '../access-tab/connections.js';
import { McpServersSection } from '../access-tab/mcp-servers.js';
import { SharingGroupsSection } from '../access-tab/sharing-groups.js';
import { SharesIncomingSection } from '../access-tab/shares-incoming.js';
import { x, n, dateWord, crumb, pageLinks, FILTERS, filterRows, scopeSentence } from './frame.js';
import { keyRow, secretRow, sessionsBlock, federationBlock } from './rows.js';

/** The line a form says after it acted ({ text, error } or nothing). */
const msg = (m) => (m ? html`<${Note} kind="message" error=${m.error}>${m.text}<//>` : null);

export function renderPage(ctx) {
  const ov = ctx.ov;
  const rail = [
    ['01', 'ac-signin', x('rail.signIn'), ov ? (ov.sign_in.two_factor.enabled ? x('twoStep.onShort') : x('twoStep.offShort')) : ''],
    ['02', 'ac-keys', x('rail.keys'), ov ? String(ctx.rows.length) : ''],
    ['03', 'ac-accounts', x('rail.elsewhere'), ov ? String(ov.connections?.connections?.length || 0) : ''],
    ['04', 'ac-mcp', x('rail.mcp'), ctx.mcpCount == null ? '' : String(ctx.mcpCount)],
    ['05', 'ac-secrets', x('rail.secrets'), ctx.secrets ? String(ctx.secrets.length) : ''],
    ['06', 'ac-groups', x('rail.groups'), ov ? String(ov.groups?.groups?.length || 0) : ''],
    ['07', 'ac-addresses', x('rail.addresses'), ''],
    ['08', 'ac-roads', x('rail.ai'), ''],
  ];
  return html`
    <${SettingsPage} name="ac"
      crumb=${crumb()}
      title=${t('profile.tabs.access')} sub=${x('titleSub')} help="concept.scope"
      marks=${marks(ctx)}
      desc=${x('desc')}
      actions=${mastActions(ctx)}
      start=${html`<${PageStart} id="access" action=${{ onClick: () => scrollToSection('ac-keys') }} />`}
      strip=${strip(ctx)}
      railTitle=${x('railTitle')}
      sections=${rail.map(([num, id, label, count]) => ({ id, num, label, count }))}
      pagesLabel=${x('pages')}
      pages=${pageLinks(ctx.isOperator)}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${!ov ? html`<${Note} kind=${ctx.failed ? 'quiet' : 'loading'}>${ctx.failed ? x('loadFailed') : x('loading')}<//>` : html`
        ${secSignIn(ctx)}
        ${secKeys(ctx)}
        ${secAccounts(ctx)}
        ${secMcp(ctx)}
        ${secSecrets(ctx)}
        ${secGroups(ctx)}
        ${secAddresses(ctx)}
        ${secRoads()}`}
    <//>`;
}

/** The mast's tags: apps (on the sun), two-step (coral while off), tokens and accounts, sessions (dim). */
function marks(ctx) {
  const ov = ctx.ov;
  if (!ov) return [];
  const s = ov.sign_in;
  return [
    { label: x('chipApps', { n: ov.appGrants.total }), tone: 'sun' },
    s.two_factor.enabled ? { label: x('chipTwoStepOn') } : { label: x('chipTwoStepOff'), tone: 'coral' },
    { label: x('chipTokensAccounts', { tokens: ov.accessTokens.total, accounts: ov.connections?.connections?.length || 0 }) },
    { label: x('chipSessions', { n: s.sessions.mine.total }), tone: 'dim' },
  ];
}

/** The one loud action (a passkey while there is none, a new token after that) and the doors under it. */
function mastActions(ctx) {
  const ov = ctx.ov;
  const s = ov?.sign_in;
  const wantPasskey = ov && s.passkeys.available && s.passkeys.count === 0 && ctx.passkeysSupported && !s.managed_by;
  return html`
    ${wantPasskey
      ? html`<${Loud} control disabled=${ctx.busy === 'passkey'} onClick=${() => ctx.addPasskeyNow()}>${ctx.busy === 'passkey' ? x('working') : x('slabPasskey')}<//><${Note} kind="hint" slab inline>${x('slabPasskeyHint')}<//>`
      : html`<${Loud} onClick=${() => ctx.toggleForm(true)}>${x('slabToken')}<//><${Note} kind="hint" slab inline>${x('slabTokenHint')}<//>`}
    <${Actions}>
      ${wantPasskey ? html`<${Action} small onClick=${() => ctx.toggleForm(true)}>${x('doorNewToken')}<//>` : null}
      <${Action} small soft onClick=${() => scrollToSection('ac-roads')}>${x('doorToAi')}<//>
    <//>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<${FigureStrip} loading=${5} />`;
  const s = ov.sign_in;
  const apps = ctx.rows.filter((r) => r.kind === 'app');
  const tokens = ctx.rows.filter((r) => r.kind === 'token');
  const day = apps.filter((r) => r.last && Date.now() - new Date(r.last).getTime() < 86400000).length;
  const unused = apps.filter((r) => r.lastLow).length;
  const tokenSub = tokens.length
    ? [tokens.filter((r) => r.token.grant_operator).length ? x('stripTokensOperator', { n: tokens.filter((r) => r.token.grant_operator).length }) : '', tokens.filter((r) => r.token.grant_owner).length ? x('stripTokensOwner', { n: tokens.filter((r) => r.token.grant_owner).length }) : '', tokens.filter((r) => !r.token.expires_at).length ? x('stripTokensNoExpiry', { n: tokens.filter((r) => !r.token.expires_at).length }) : x('stripTokensAllExpire')].filter(Boolean).join(' · ')
    : x('stripTokensNone');
  return html`<${FigureStrip} wrap items=${[
    { key: 'apps', n: n(ov.appGrants.total), label: x('stripApps'), sub: ov.appGrants.total ? x('stripAppsSub', { day, unused: x('unusedN', { n: unused, days: 30 }), base: ctx.baseHolders }) : x('stripAppsNone') },
    { key: 'tokens', n: n(ov.accessTokens.total), label: x('stripTokens'), sub: tokenSub },
    secretTile(ctx),
    { key: 'twoStep', n: s.two_factor.enabled ? x('twoStep.onWord') : x('twoStep.offWord'), tone: s.two_factor.enabled ? 'fine' : 'notice', label: x('stripTwoStep'), sub: x('stripTwoStepSub', { passkeys: s.passkeys.count, password: s.has_password ? x('passwordSet') : x('passwordNone') }) },
    { key: 'sessions', n: n(s.sessions.mine.total), label: x('stripSessions'), sub: x('stripSessionsSub', { devices: s.sessions.mine.by_device.length, agents: s.sessions.agents.total }) },
  ]} />`;
}

/** The strip's third figure: how many secrets are kept, and how many of them anything names. */
function secretTile(ctx) {
  const list = ctx.secrets || [];
  const used = list.filter((s) => (s.usedBy || []).length).length;
  return { key: 'secrets', n: n(list.length), label: x('stripSecrets'), sub: list.length ? x('stripSecretsSub', { used, spare: list.length - used }) : x('stripSecretsNone') };
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSignIn(ctx) {
  const ov = ctx.ov;
  const s = ov.sign_in;
  const tf = s.two_factor;
  const sub = [s.has_password ? x('passwordSet') : x('passwordNone'), tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort'), x('passkeysN', { n: s.passkeys.count })].join(' · ');
  // One list of sign-in rows. A panel or a block that belongs to a row stands under it (Row below),
  // so the row and its panel read as one thing and the rule falls under the panel.
  const row = (key, name, subText, doors, below) => html`
    <${Row} key=${key} below=${below || null}><${Name} meta=${subText}>${name}<//><${Doors}>${doors}<//><//>`;
  const state = (fine, words) => html`<${Mark} kind="status" tone=${fine ? 'fine' : 'attention'}>${words}<//>`;
  return html`
    <${Section} id="ac-signin" num="01" title=${x('secSignIn')} count=${sub} first=${true}>
      <${Note} kind="lead">${tf.enabled || s.passkeys.count ? x('signInIntroOn') : x('signInIntro')}<//>
      ${s.managed_by ? html`<${Box}><b>${t('profile.security.managedTitle')}</b> ${t('profile.security.managedDesc').replace('{name}', s.managed_by.name)}<//>` : null}
      <${List} cols="name-state">
        ${row('password', x('row.password'), s.has_password ? x('row.passwordSet') : x('row.passwordNone'), state(s.has_password, s.has_password ? x('inUse') : x('none')))}
        ${!s.managed_by && s.passkeys.available
          ? row('passkeys', x('row.passkeys'), s.passkeys.count ? x('row.passkeysN', { n: s.passkeys.count }) : x('row.passkeysNone'), state(s.passkeys.count, x('devicesN', { n: s.passkeys.count })),
            html`<${PasskeysSection} inRow showToast=${ctx.showToast} />`)
          : null}
        ${!s.managed_by && tf.available
          ? row('twoStep', x('row.twoStep'), tf.enabled ? x('row.twoStepOn', { n: tf.backup_codes_left }) : tf.pending ? x('row.twoStepPending') : x('row.twoStepOff'), state(tf.enabled, tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort')),
            html`<${TwoFactorSection} inRow twoFactor=${tf} managed=${!!s.managed_by} showToast=${ctx.showToast} onChanged=${() => ctx.load()} />`)
          : null}
        ${row('sessions', x('row.sessions'), x('row.sessionsSub', { mine: s.sessions.mine.total, agents: s.sessions.agents.total }),
          html`<${Figure} small n=${n(s.sessions.mine.total)} />${s.sessions.mine.total > 1 ? html`<${Action} small disabled=${ctx.busy === 'sessions'} onClick=${() => ctx.signOutOthers()}>${x('doorSignOutOthers')}<//>` : null}`,
          s.sessions.mine.total ? sessionsBlock(ctx) : null)}
        ${row('federation', x('row.federation'), ctx.fed.all ? x('row.federationAll') : ctx.fed.nodes.length ? x('row.federationList', { n: ctx.fed.nodes.length }) : x('row.federationNone'),
          html`<${Mark}>${ctx.fed.all ? x('fed.allChip') : x('fed.listChip', { n: ctx.fed.nodes.length })}<//><${Action} small disabled=${ctx.busy === 'fed'} onClick=${() => ctx.toggleFedAll()}>${ctx.fed.all ? x('fed.restrict') : x('fed.allowAll')}<//>`,
          federationBlock(ctx))}
        ${row('recovery', x('row.recovery'), ctx.ownerKey ? x('row.recoveryHere') : x('row.recoveryNotHere'),
          ctx.ownerKey
            ? html`<${Action} small soft onClick=${() => ctx.setKeyShown(!ctx.keyShown)}>${ctx.keyShown ? x('hide') : x('show')}<//><${Action} small copy=${ctx.ownerKey} onCopied=${() => ctx.showToast(x('keyCopied'))}>${x('copy')}<//>`
            : html`<${Mark} tone="dim">${x('notHere')}<//>`,
          ctx.ownerKey ? html`<${Box}><b>${x('recovery.title')}</b> ${x('recovery.body')}<br /><${Code} blurred=${!ctx.keyShown}>${ctx.ownerKey}<//><//>` : null)}
      <//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secKeys(ctx) {
  const ov = ctx.ov;
  const all = ctx.rows;
  const list = filterRows(all, ctx.filter);
  const shown = list.slice(0, ctx.shownKeys);
  const counts = Object.fromEntries(FILTERS.map((f) => [f, filterRows(all, f).length]));
  const unused = counts.unused;
  const more = list.length > shown.length;
  return html`
    <${Section} id="ac-keys" num="02" title=${x('secKeys')} count=${x('secKeysSub', { apps: ov.appGrants.total, tokens: ov.accessTokens.total })}>
      <${Note} kind="lead">${x('keysIntro')}<//>
      ${all.length ? html`
        <${Tabs} tone="filter" value=${ctx.filter} onSelect=${(f) => ctx.setFilter(f)}
          items=${FILTERS.map((f) => ({ value: f, label: x('filter.' + f, { days: 30 }), count: counts[f], attention: f === 'unused' && counts[f] > 0 && ctx.filter !== f }))} />
        <${List} cols="name-desc-when-doors" head=${[x('col.who'), x('col.may'), x('col.last'), '']}>
          ${shown.map((r) => keyRow(ctx, r))}
        <//>
        ${more || unused ? html`
          <${More} label=${x('moreKeys', { n: list.length - shown.length })} onMore=${more ? () => ctx.showMoreKeys() : null}>
            ${unused ? html`<${Action} small soft tone="danger" disabled=${ctx.busy === 'unused'} onClick=${() => ctx.revokeUnused()}>${x('revokeUnused', { n: unused, days: 30 })}<//>` : null}
          <//>` : null}
        ${ctx.baseHolders ? html`<${Box}><b>${x('whyBaseTitle')}</b> ${x('whyBase', { n: ctx.baseHolders, total: ov.appGrants.total })} ${ov.base_package.map(scopeSentence).join('; ')}.<//>` : null}`
      : html`<${Note} kind="quiet"><b>${x('keysEmptyTitle')}</b> ${x('keysEmptyBody')}<//>`}
      <${Space} above="large">${tokenFold(ctx)}<//>
    <//>`;
}

/** One answer of the token form's tile rows; a risky one (acting as the owner, never expiring) in the attention tone. */
const opt = (value, label, attention) => ({ value, label, attention: !!attention });

function tokenFold(ctx) {
  const f = ctx.form;
  const scoped = f.level === 'scoped';
  const chosen = Object.keys(f.scopes).filter((s) => f.scopes[s]);
  const ready = !!f.label.trim() && (!scoped || chosen.length > 0);
  const created = ctx.created;
  return html`
    <${Section} fold id="ac-token" num="" title=${x('form.title')} sub=${created ? x('form.subCreated') : ''} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      ${created ? html`
        <${Space} below="large">
          <${Label} block>${x('created.title')}<//>
          <${Note} kind="lead">${x('created.once')}<//>
          <${Code} block>${created.token}<//>
          <${Actions}><${Action} small copy=${created.token} onCopied=${() => ctx.showToast(x('created.copied'))}>${x('copy')}<//><//>
          <${List} cols="name-state">
            <${Row}><${Name} meta=${x('created.promptSub')}>${x('created.prompt')}<//><${Doors}><${Action} small row copy=${created.prompt} onCopied=${() => ctx.showToast(x('created.promptCopied'))}>${x('created.copyPrompt')}<//><//><//>
          <//>
          <${Actions}><${Action} small soft onClick=${() => ctx.clearCreated()}>${x('created.done')}<//><//>
        <//>` : null}
      <${Note} kind="lead">${x('form.intro')}<//>
      <${Fields}>
        <${TextField} label=${x('form.name')} hint=${x('form.nameHint')} maxLength=${120} value=${f.label} placeholder=${x('form.namePlaceholder')} onInput=${(v) => ctx.setForm({ label: v })} />
        <${Field} group label=${x('form.level')} help="access.scopes" hint=${scoped ? x('form.levelHintScoped') : f.level === 'owner' ? x('level.ownerText') : x('level.operatorText')}>
          <${Tabs} tone="tile" label=${x('form.level')} value=${f.level} onSelect=${(v) => ctx.setForm({ level: v })}
            items=${[opt('scoped', x('level.scopedOpt')), opt('owner', x('level.ownerOpt'), true), ctx.isOperator ? opt('operator', x('level.operatorOpt'), true) : null]} />
          ${scoped ? html`<${Tabs} tone="tile" kind="toggle" value=${chosen} onSelect=${(s) => ctx.toggleScope(s)}
            items=${ctx.tokenScopes.map((s) => ({ value: s, label: scopeSentence(s) }))} />` : null}
        <//>
        <${Choice} tone="tile" label=${x('form.expiry')} hint=${x('form.expiryHint')} value=${f.expiry} onChange=${(v) => ctx.setForm({ expiry: v })}
          options=${[opt('86400', x('expiry.day')), opt('604800', x('expiry.week')), opt('2592000', x('expiry.month')), opt('', x('expiry.never'), true)]} />
        <${FormActions}>
          <${Loud} control disabled=${!ready || ctx.busy === 'token'} onClick=${() => ctx.createToken()}>${ctx.busy === 'token' ? x('form.making') : x('form.make')}<//>
          <${Action} small soft onClick=${() => ctx.toggleForm(false)}>${x('cancel')}<//>
          ${msg(ctx.formMsg)}
        <//>
      <//>
    <//>`;
}

/* ── 03, 04 and 06: the sections that keep their components ──────────────────────────────────── */

function secAccounts(ctx) {
  const c = ctx.ov.connections;
  const count = c?.connections?.length || 0;
  return html`
    <${Section} id="ac-accounts" num="03" title=${x('secAccounts')} count=${c?.enabled ? x('secAccountsSub', { n: count, providers: c.providers.length }) : x('secAccountsOff')}>
      <${Note} kind="lead">${x('accountsIntro')}<//>
      ${c?.enabled ? html`<${ConnectionsSection} inRow showToast=${ctx.showToast} />` : html`<${Note} kind="quiet">${x('accountsOffBody')}<//>`}
    <//>`;
}

/* ── 04: the MCP servers ─────────────────────────────────────────────────────────────────────── */

/**
 * The MCP servers this person attached, in a section of their own. They sat under "Your accounts at
 * other services" until 2026-09-16, which on a server without outside accounts put them directly
 * under "not enabled on this server", and the kept-component rule hid their own title. An MCP server
 * is a set of tools, not an account, and it does not follow the accounts switch, so it gets its own
 * number, title and count. The section supplies the title and intro; `inRow` leaves out the panel's own.
 */
function secMcp(ctx) {
  return html`
    <${Section} id="ac-mcp" num="04" title=${x('secMcp')} count=${ctx.mcpCount == null ? '' : x('secMcpSub', { n: ctx.mcpCount })}>
      <${Note} kind="lead">${x('mcpIntro')}<//>
      <${McpServersSection} inRow showToast=${ctx.showToast} />
    <//>`;
}

/* ── 05: the vault ────────────────────────────────────────────────────────────────────────────── */

/**
 * The secrets, and the one thing this section can never do: show a value. The list carries the
 * name, when it was set, when it was last replaced and what names it; the value goes in once and
 * is not read back by this page, by an app or by an agent.
 */
function secSecrets(ctx) {
  const list = ctx.secrets || [];
  return html`
    <${Section} id="ac-secrets" num="05" title=${x('secSecrets')} count=${x('secSecretsSub', { n: list.length })}>
      <${Note} kind="lead">${x('secretsIntro')}<//>
      ${ctx.secretsFailed ? html`<${Note} kind="quiet">${x('secrets.loadFailed')}<//>` : null}
      ${list.length ? html`
        <${List} cols="name-who-when-doors" head=${[x('secrets.colName'), x('secrets.colUsedBy'), x('secrets.colSet'), '']}>
          ${list.map((s) => secretRow(ctx, s))}
        <//>`
      : (!ctx.secretsFailed ? html`<${Note} kind="quiet"><b>${x('secrets.emptyTitle')}</b> ${x('secrets.emptyBody')}<//>` : null)}
      <${Box}><b>${x('secrets.whoTitle')}</b> ${x('secretsWho')}<//>
      <${Space} above="large">${secretFold(ctx)}<//>
    <//>`;
}

/** The add form: a name and a write-only value, and nothing that reads one back. */
function secretFold(ctx) {
  const f = ctx.secretForm;
  const ready = !!f.name.trim() && !!f.value;
  const busy = ctx.busy === 'secret:' + f.name.trim();
  return html`
    <${Section} fold id="ac-secret-add" num="" title=${x('secrets.addTitle')} open=${f.open} onToggle=${() => ctx.toggleSecretForm()}>
      <${Fields}>
        <${TextField} label=${x('secrets.name')} hint=${x('secrets.nameHint')} maxLength=${64} autoComplete="off" spellCheck=${false}
          value=${f.name} placeholder=${x('secrets.namePlaceholder')} onInput=${(v) => ctx.setSecretForm({ name: v })} />
        <${TextField} label=${x('secrets.value')} hint=${x('secrets.valueHint')} type="password" autoComplete="new-password" spellCheck=${false}
          value=${f.value} placeholder=${x('secrets.valuePlaceholder')} onInput=${(v) => ctx.setSecretForm({ value: v })} />
        <${FormActions}>
          <${Loud} control disabled=${!ready || busy} onClick=${() => ctx.writeSecret(f.name.trim(), f.value, false)}>${busy ? x('secrets.saving') : x('secrets.save')}<//>
          <${Action} small soft onClick=${() => ctx.toggleSecretForm(false)}>${x('cancel')}<//>
          ${msg(ctx.secretMsg)}
        <//>
      <//>
    <//>`;
}

/* ── 06 ───────────────────────────────────────────────────────────────────────────────────────── */

function secGroups(ctx) {
  const groups = ctx.ov.groups?.groups || [];
  return html`
    <${Section} id="ac-groups" num="06" title=${x('secGroups')} count=${x('secGroupsSub', { n: groups.length })}>
      <${Note} kind="lead">${x('groupsIntro')}<//>
      <${SharingGroupsSection} inRow showToast=${ctx.showToast} initial=${ctx.ov.groups} />
      <${SharesIncomingSection} inRow />
    <//>`;
}

/* ── 07 ───────────────────────────────────────────────────────────────────────────────────────── */

function secAddresses(ctx) {
  const ov = ctx.ov;
  const cur = ov.sign_in.sessions.mine.current;
  const days = cur ? Math.round((new Date(cur.expires_at).getTime() - new Date(cur.issued_at).getTime()) / 86400000) : null;
  const rows = [
    ['ghii', ctx.ghii, x('addr.ghiiSub', { node: ctx.nodeId })],
    ['node', ctx.nodeUrl, x('addr.nodeSub')],
    ['mcp', ctx.nodeUrl + '/v1/mcp', x('addr.mcpSub')],
    ['key', ov.publicKey || '', ov.publicKey ? x('addr.keySub', { n: ov.publicKey.length }) : x('addr.keyNone')],
  ];
  return html`
    <${Section} id="ac-addresses" num="07" title=${x('secAddresses')} count=${x('secAddressesSub')}>
      <${Note} kind="lead">${x('addressesIntro')}<//>
      <${Facts} rows=${[
        ...rows.map(([k, v, sub]) => ({
          key: k, k: x('addr.' + k), v, mono: true, sub,
          action: v ? html`<${Action} small copy=${v} onCopied=${() => ctx.showToast(x('copied'))}>${x('copy')}<//>` : null,
        })),
        { key: 'session', k: x('addr.session'), v: cur ? x('addr.sessionValue', { date: dateWord(cur.expires_at), days: days ?? '' }) : x('addr.sessionNone'), sub: x('addr.sessionSub') },
      ]} />
    <//>`;
}

/* ── 08 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="ac-roads" num="08" title=${x('secRoads')}>
      <${Roads} wide>
        <${Road} lead name=${x('roadAskTitle')} text=${x('roadAskBody')} code=${ask}
          doors=${html`<${Action} small soft copy=${ask}>${x('copyPrompt')}<//>`} />
        <${Road} name=${x('roadAgentTitle')} text=${x('roadAgentBody')}
          meta=${`aimeat_access_list · aimeat_connection_list · aimeat_group_list · aimeat_consent_list · ${x('roadAgentScope')}`} />
      <//>
    <//>`;
}
