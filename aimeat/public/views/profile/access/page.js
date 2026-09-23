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
 *   03 your accounts at other services; 04 the MCP servers; 05 the secrets an extension may use
 *   without seeing them; 06 sharing groups; 07 your addresses for an AI; 08 how your AI reads this
 *   page. Pure render over the ctx bag; the rows are rows.js.
 *
 *   SECRETS SIT WITH THE ACCOUNTS, not with the keys. Both sections answer the same question — a
 *   credential of the person's that something else uses without ever holding it — while section 02
 *   answers the opposite one, which is what a key of THIS account may do.
 * @structure renderPage · mast · strip · secSignIn · secKeys · tokenFold · secAccounts · secMcp ·
 *   secSecrets · secretFold · secGroups · secAddresses · secRoads
 * @usage import { renderPage } from './access/page.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared component set: Page with a numbered index Rail, the
 *     strip a plain NumeralBand, the sign-in states and keys as ListRows (a panel, a session table
 *     or an opened key as the row's body), the filters a Toolbar, the forms Fields in Folds, the
 *     addresses KeyValues, the two roads two Surfaces in Columns; no own CSS (access-poster.css is
 *     gone). The kept components' hidden titles are gone from them rather than hidden here.
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
import { Page, Rail, Section, Fold, Stack, Columns, ListRow, KeyValue, Toolbar, NumeralBand, Chip, Action, CopyAction, Field, Surface, Text, scrollToId } from '/components/poster-parts.js';
import { TwoFactorSection } from '../security-tab/two-factor.js';
import { PasskeysSection } from '../security-tab/passkeys.js';
import { ConnectionsSection } from '../access-tab/connections.js';
import { McpServersSection } from '../access-tab/mcp-servers.js';
import { SharingGroupsSection } from '../access-tab/sharing-groups.js';
import { SharesIncomingSection } from '../access-tab/shares-incoming.js';
import { x, n, dateWord, crumb, pageLinks, FILTERS, filterRows, scopeSentence } from './frame.js';
import { keyRow, secretRow, sessionsBlock, federationBlock, msgLine } from './rows.js';

export function renderPage(ctx) {
  const ov = ctx.ov;
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#ac-signin', label: x('rail.signIn'), count: ov ? (ov.sign_in.two_factor.enabled ? x('twoStep.onShort') : x('twoStep.offShort')) : undefined },
    { href: '#ac-keys', label: x('rail.keys'), count: ov ? String(ctx.rows.length) : undefined },
    { href: '#ac-accounts', label: x('rail.elsewhere'), count: ov ? String(ov.connections?.connections?.length || 0) : undefined },
    { href: '#ac-mcp', label: x('rail.mcp'), count: ctx.mcpCount == null ? undefined : String(ctx.mcpCount) },
    { href: '#ac-secrets', label: x('rail.secrets'), count: ctx.secrets ? String(ctx.secrets.length) : undefined },
    { href: '#ac-groups', label: x('rail.groups'), count: ov ? String(ov.groups?.groups?.length || 0) : undefined },
    { href: '#ac-addresses', label: x('rail.addresses') },
    { href: '#ac-roads', label: x('rail.ai') },
  ]}>${pageLinks(ctx.isOperator)}<//>`;
  return html`<${Page} width="wide" title=${t('profile.tabs.access')} crumbs=${crumb()} identity=${identity(ctx)} actions=${mastActions(ctx)} rail=${rail}>
    <${Stack}>
      <${Text} kind="lead">${x('desc')}<//>
      ${strip(ctx)}
      ${!ov ? html`<${Text} tone="muted">${ctx.failed ? x('loadFailed') : x('loading')}<//>` : html`
        ${secSignIn(ctx)}
        ${secKeys(ctx)}
        ${secAccounts(ctx)}
        ${secMcp(ctx)}
        ${secSecrets(ctx)}
        ${secGroups(ctx)}
        ${secAddresses(ctx)}
        ${secRoads()}`}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

/** Under the title: what this page is about, and the chips that say the state at a glance. */
function identity(ctx) {
  const ov = ctx.ov;
  const s = ov?.sign_in;
  return html`<${Stack} density="compact">
    <${Text} kind="label">${x('titleSub')}<//>
    ${ov ? html`<${Stack} direction="wrap" density="compact">
      <${Chip} tone="sun">${x('chipApps', { n: ov.appGrants.total })}<//>
      ${s.two_factor.enabled ? html`<${Chip}>${x('chipTwoStepOn')}<//>` : html`<${Chip} tone="coral">${x('chipTwoStepOff')}<//>`}
      <${Chip}>${x('chipTokensAccounts', { tokens: ov.accessTokens.total, accounts: ov.connections?.connections?.length || 0 })}<//>
      <${Chip} tone="muted">${x('chipSessions', { n: s.sessions.mine.total })}<//>
    <//>` : null}
  <//>`;
}

/** The one loud action (a passkey while there is none, a new token after that) and the doors. */
function mastActions(ctx) {
  const ov = ctx.ov;
  const s = ov?.sign_in;
  const wantPasskey = ov && s.passkeys.available && s.passkeys.count === 0 && ctx.passkeysSupported && !s.managed_by;
  return html`<${Stack} density="compact" align="end">
    ${wantPasskey
      ? html`<${Action} kind="primary" disabled=${ctx.busy === 'passkey'} onClick=${() => ctx.addPasskeyNow()}>${ctx.busy === 'passkey' ? x('working') : x('slabPasskey')}<//>
          <${Text} kind="caption" tone="muted">${x('slabPasskeyHint')}<//>`
      : html`<${Action} kind="primary" onClick=${() => ctx.toggleForm(true)}>${x('slabToken')}<//>
          <${Text} kind="caption" tone="muted">${x('slabTokenHint')}<//>`}
    <${Stack} direction="wrap" density="compact">
      ${wantPasskey ? html`<${Action} onClick=${() => ctx.toggleForm(true)}>${x('doorNewToken')}<//>` : null}
      <${Action} kind="text" onClick=${() => scrollToId('ac-roads')}>${x('doorToAi')}<//>
    <//>
  <//>`;
}

function strip(ctx) {
  const ov = ctx.ov;
  if (!ov) return html`<${NumeralBand} tone="plain" items=${[1, 2, 3, 4, 5].map((i) => ({ id: i, label: '', value: '…' }))} />`;
  const s = ov.sign_in;
  const apps = ctx.rows.filter((r) => r.kind === 'app');
  const tokens = ctx.rows.filter((r) => r.kind === 'token');
  const day = apps.filter((r) => r.last && Date.now() - new Date(r.last).getTime() < 86400000).length;
  const unused = apps.filter((r) => r.lastLow).length;
  const ops = tokens.filter((r) => r.token.grant_operator).length;
  const owners = tokens.filter((r) => r.token.grant_owner).length;
  const forever = tokens.filter((r) => !r.token.expires_at).length;
  const tokenSub = tokens.length
    ? [ops ? x('stripTokensOperator', { n: ops }) : '', owners ? x('stripTokensOwner', { n: owners }) : '', forever ? x('stripTokensNoExpiry', { n: forever }) : x('stripTokensAllExpire')].filter(Boolean).join(' · ')
    : x('stripTokensNone');
  const list = ctx.secrets || [];
  const used = list.filter((sc) => (sc.usedBy || []).length).length;
  return html`<${NumeralBand} tone="plain" items=${[
    { id: 'apps', label: x('stripApps'), value: n(ov.appGrants.total), note: ov.appGrants.total ? x('stripAppsSub', { day, unused: x('unusedN', { n: unused, days: 30 }), base: ctx.baseHolders }) : x('stripAppsNone') },
    { id: 'tokens', label: x('stripTokens'), value: n(ov.accessTokens.total), note: tokenSub },
    { id: 'secrets', label: x('stripSecrets'), value: n(list.length), note: list.length ? x('stripSecretsSub', { used, spare: list.length - used }) : x('stripSecretsNone') },
    { id: 'two', label: x('stripTwoStep'), value: s.two_factor.enabled ? x('twoStep.onWord') : x('twoStep.offWord'), tone: s.two_factor.enabled ? undefined : 'coral',
      note: x('stripTwoStepSub', { passkeys: s.passkeys.count, password: s.has_password ? x('passwordSet') : x('passwordNone') }) },
    { id: 'sessions', label: x('stripSessions'), value: n(s.sessions.mine.total), note: x('stripSessionsSub', { devices: s.sessions.mine.by_device.length, agents: s.sessions.agents.total }) },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secSignIn(ctx) {
  const ov = ctx.ov;
  const s = ov.sign_in;
  const tf = s.two_factor;
  const sub = [s.has_password ? x('passwordSet') : x('passwordNone'), tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort'), x('passkeysN', { n: s.passkeys.count })].join(' · ');
  return html`
    <${Section} id="ac-signin" title=${x('secSignIn')} count=${sub}>
      <${Stack}>
        <${Text} tone="muted">${tf.enabled || s.passkeys.count ? x('signInIntroOn') : x('signInIntro')}<//>
        ${s.managed_by ? html`<${Surface} kind="aside"><${Text}><strong>${t('profile.security.managedTitle')}</strong> ${t('profile.security.managedDesc').replace('{name}', s.managed_by.name)}<//><//>` : null}
        <${Stack} density="compact">
          <${ListRow} name=${x('row.password')} detail=${s.has_password ? x('row.passwordSet') : x('row.passwordNone')}
            value=${html`<${Chip} tone=${s.has_password ? 'plain' : 'coral'}>${s.has_password ? x('inUse') : x('none')}<//>`} />
          ${!s.managed_by && s.passkeys.available ? html`
            <${ListRow} name=${x('row.passkeys')} detail=${s.passkeys.count ? x('row.passkeysN', { n: s.passkeys.count }) : x('row.passkeysNone')}
              value=${html`<${Chip} tone=${s.passkeys.count ? 'plain' : 'coral'}>${x('devicesN', { n: s.passkeys.count })}<//>`}>
              <${PasskeysSection} showToast=${ctx.showToast} />
            <//>` : null}
          ${!s.managed_by && tf.available ? html`
            <${ListRow} name=${x('row.twoStep')} detail=${tf.enabled ? x('row.twoStepOn', { n: tf.backup_codes_left }) : tf.pending ? x('row.twoStepPending') : x('row.twoStepOff')}
              value=${html`<${Chip} tone=${tf.enabled ? 'plain' : 'coral'}>${tf.enabled ? x('twoStep.onShort') : x('twoStep.offShort')}<//>`}>
              <${TwoFactorSection} twoFactor=${tf} managed=${!!s.managed_by} showToast=${ctx.showToast} onChanged=${() => ctx.load()} />
            <//>` : null}
          <${ListRow} name=${x('row.sessions')} detail=${x('row.sessionsSub', { mine: s.sessions.mine.total, agents: s.sessions.agents.total })}
            value=${html`<${Text} kind="number" size="small">${n(s.sessions.mine.total)}<//>`}
            actions=${s.sessions.mine.total > 1 ? html`<${Action} disabled=${ctx.busy === 'sessions'} onClick=${() => ctx.signOutOthers()}>${x('doorSignOutOthers')}<//>` : null}>
            ${s.sessions.mine.total ? sessionsBlock(ctx) : null}
          <//>
          <${ListRow} name=${x('row.federation')} detail=${ctx.fed.all ? x('row.federationAll') : ctx.fed.nodes.length ? x('row.federationList', { n: ctx.fed.nodes.length }) : x('row.federationNone')}
            value=${html`<${Chip}>${ctx.fed.all ? x('fed.allChip') : x('fed.listChip', { n: ctx.fed.nodes.length })}<//>`}
            actions=${html`<${Action} disabled=${ctx.busy === 'fed'} onClick=${() => ctx.toggleFedAll()}>${ctx.fed.all ? x('fed.restrict') : x('fed.allowAll')}<//>`}>
            ${federationBlock(ctx)}
          <//>
          <${ListRow} name=${x('row.recovery')} detail=${ctx.ownerKey ? x('row.recoveryHere') : x('row.recoveryNotHere')}
            value=${ctx.ownerKey ? null : html`<${Chip} tone="muted">${x('notHere')}<//>`}
            actions=${ctx.ownerKey ? html`<${Action} kind="text" onClick=${() => ctx.setKeyShown(!ctx.keyShown)}>${ctx.keyShown ? x('hide') : x('show')}<//>
              <${CopyAction} text=${ctx.ownerKey} label=${x('copy')} onCopied=${() => ctx.showToast(x('keyCopied'))} />` : null}>
            ${ctx.ownerKey ? html`<${Surface} kind="box"><${Stack} density="compact">
              <${Text}><strong>${x('recovery.title')}</strong> ${x('recovery.body')}<//>
              <${ListRow} density="compact" concealed=${!ctx.keyShown} name=${html`<${Text} kind="mono">${ctx.ownerKey}<//>`} />
            <//><//>` : null}
          <//>
        <//>
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
  return html`
    <${Section} id="ac-keys" title=${x('secKeys')} count=${x('secKeysSub', { apps: ov.appGrants.total, tokens: ov.accessTokens.total })}>
      <${Stack}>
        <${Text} tone="muted">${x('keysIntro')}<//>
        ${all.length ? html`
          <${Toolbar} label=${x('secKeys')} filters=${FILTERS.map((f) => ({ id: f, label: `${x('filter.' + f, { days: 30 })} · ${counts[f]}`, selected: ctx.filter === f, onClick: () => ctx.setFilter(f) }))} />
          <${Stack} density="compact">${shown.map((r) => keyRow(ctx, r))}<//>
          ${list.length > shown.length || unused ? html`<${Stack} direction="wrap" density="compact">
            ${list.length > shown.length ? html`<${Action} onClick=${() => ctx.showMoreKeys()}>${x('moreKeys', { n: list.length - shown.length })}<//>` : null}
            ${unused ? html`<${Action} tone="danger" disabled=${ctx.busy === 'unused'} onClick=${() => ctx.revokeUnused()}>${x('revokeUnused', { n: unused, days: 30 })}<//>` : null}
          <//>` : null}
          ${ctx.baseHolders ? html`<${Surface} kind="aside"><${Text}><strong>${x('whyBaseTitle')}</strong> ${x('whyBase', { n: ctx.baseHolders, total: ov.appGrants.total })} ${ov.base_package.map(scopeSentence).join('; ')}.<//><//>` : null}`
        : html`<${Text}><strong>${x('keysEmptyTitle')}</strong> ${x('keysEmptyBody')}<//>`}
        ${tokenFold(ctx)}
      <//>
    <//>`;
}

/** One choice of a form's row: a radio tab, on when the form holds that value. */
function opt(ctx, field, value, label) {
  return html`<${Action} kind="tab" semantics="radio" selected=${ctx.form[field] === value} onClick=${() => ctx.setForm({ [field]: value })}>${label}<//>`;
}

/** A labelled row of the token form: the label, the controls, the hint under them. */
const formRow = (label, controls, hint) => html`<${Stack} density="compact">
  <${Text} kind="label">${label}<//>${controls}${hint ? html`<${Text} kind="caption" tone="muted">${hint}<//>` : null}
<//>`;

function tokenFold(ctx) {
  const f = ctx.form;
  const scoped = f.level === 'scoped';
  const chosen = Object.keys(f.scopes).filter((s) => f.scopes[s]);
  const ready = !!f.label.trim() && (!scoped || chosen.length > 0);
  const created = ctx.created;
  return html`
    <${Fold} id="ac-token" title=${x('form.title')} sub=${created ? x('form.subCreated') : ''} open=${f.open} onToggle=${() => ctx.toggleForm()}>
      <${Stack}>
        ${created ? html`<${Surface} kind="record"><${Stack}>
          <${Text} kind="label">${x('created.title')}<//>
          <${Text}>${x('created.once')}<//>
          <${Surface} kind="code">${created.token}<//>
          <${Stack} direction="horizontal" align="start">
            <${CopyAction} text=${created.token} label=${x('copy')} onCopied=${() => ctx.showToast(x('created.copied'))} />
          <//>
          <${ListRow} name=${x('created.prompt')} detail=${x('created.promptSub')} detailKind="text"
            actions=${html`<${CopyAction} text=${created.prompt} label=${x('created.copyPrompt')} onCopied=${() => ctx.showToast(x('created.promptCopied'))} />`} />
          <${Stack} direction="horizontal" align="start">
            <${Action} kind="text" onClick=${() => ctx.clearCreated()}>${x('created.done')}<//>
          <//>
        <//><//>` : null}
        <${Text} tone="muted">${x('form.intro')}<//>
        ${formRow(x('form.name'), html`<${Field} ariaLabel=${x('form.name')} maxLength=${120} value=${f.label} placeholder=${x('form.namePlaceholder')} onInput=${(e) => ctx.setForm({ label: e.target.value })} />`, x('form.nameHint'))}
        ${formRow(x('form.level'), html`
          <${Stack} direction="wrap" density="compact" role="radiogroup" label=${x('form.level')}>
            ${opt(ctx, 'level', 'scoped', x('level.scopedOpt'))}${opt(ctx, 'level', 'owner', x('level.ownerOpt'))}${ctx.isOperator ? opt(ctx, 'level', 'operator', x('level.operatorOpt')) : null}
          <//>
          ${scoped ? html`<${Stack} direction="wrap" density="compact">${ctx.tokenScopes.map((s) => html`<${Action} key=${s} kind="tab" selected=${!!f.scopes[s]} onClick=${() => ctx.toggleScope(s)}>${scopeSentence(s)}<//>`)}<//>` : null}`,
          scoped ? x('form.levelHintScoped') : f.level === 'owner' ? x('level.ownerText') : x('level.operatorText'))}
        ${formRow(x('form.expiry'), html`<${Stack} direction="wrap" density="compact" role="radiogroup" label=${x('form.expiry')}>
          ${opt(ctx, 'expiry', '86400', x('expiry.day'))}${opt(ctx, 'expiry', '604800', x('expiry.week'))}${opt(ctx, 'expiry', '2592000', x('expiry.month'))}${opt(ctx, 'expiry', '', x('expiry.never'))}
        <//>`, x('form.expiryHint'))}
        <${Stack} direction="wrap" density="compact" align="center">
          <${Action} disabled=${!ready || ctx.busy === 'token'} onClick=${() => ctx.createToken()}>${ctx.busy === 'token' ? x('form.making') : x('form.make')}<//>
          <${Action} kind="text" onClick=${() => ctx.toggleForm(false)}>${x('cancel')}<//>
          ${msgLine(ctx.formMsg)}
        <//>
      <//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secAccounts(ctx) {
  const c = ctx.ov.connections;
  const count = c?.connections?.length || 0;
  return html`
    <${Section} id="ac-accounts" title=${x('secAccounts')} count=${c?.enabled ? x('secAccountsSub', { n: count, providers: c.providers.length }) : x('secAccountsOff')}>
      <${Stack}>
        <${Text} tone="muted">${x('accountsIntro')}<//>
        ${c?.enabled ? html`<${ConnectionsSection} showToast=${ctx.showToast} />` : html`<${Text}><strong>${x('accountsOffBody')}</strong><//>`}
      <//>
    <//>`;
}

/* ── 04: the MCP servers ─────────────────────────────────────────────────────────────────────── */

/**
 * The MCP servers this person attached, in a section of their own. They sat under "Your accounts at
 * other services" until 2026-09-16, which on a server without outside accounts put them directly
 * under "not enabled on this server". An MCP server is a set of tools, not an account, and it does
 * not follow the accounts switch, so it gets its own number, title and count. The section supplies
 * the title and intro; the panel is only its body.
 */
function secMcp(ctx) {
  return html`
    <${Section} id="ac-mcp" title=${x('secMcp')} count=${ctx.mcpCount == null ? '' : x('secMcpSub', { n: ctx.mcpCount })}>
      <${Stack}>
        <${Text} tone="muted">${x('mcpIntro')}<//>
        <${McpServersSection} showToast=${ctx.showToast} />
      <//>
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
    <${Section} id="ac-secrets" title=${x('secSecrets')} count=${x('secSecretsSub', { n: list.length })}>
      <${Stack}>
        <${Text} tone="muted">${x('secretsIntro')}<//>
        ${ctx.secretsFailed ? html`<${Text} tone="coral">${x('secrets.loadFailed')}<//>` : null}
        ${list.length ? html`<${Stack} density="compact">${list.map((s) => secretRow(ctx, s))}<//>`
          : (!ctx.secretsFailed ? html`<${Text}><strong>${x('secrets.emptyTitle')}</strong> ${x('secrets.emptyBody')}<//>` : null)}
        <${Surface} kind="aside"><${Text}><strong>${x('secrets.whoTitle')}</strong> ${x('secretsWho')}<//><//>
        ${secretFold(ctx)}
      <//>
    <//>`;
}

/** The add form: a name and a write-only value, and nothing that reads one back. */
function secretFold(ctx) {
  const f = ctx.secretForm;
  const ready = !!f.name.trim() && !!f.value;
  return html`
    <${Fold} id="ac-secret-add" title=${x('secrets.addTitle')} open=${f.open} onToggle=${() => ctx.toggleSecretForm()}>
      <${Stack}>
        ${formRow(x('secrets.name'), html`<${Field} ariaLabel=${x('secrets.name')} maxLength=${64} autoComplete="off" spellCheck=${false} value=${f.name}
          placeholder=${x('secrets.namePlaceholder')} onInput=${(e) => ctx.setSecretForm({ name: e.target.value })} />`, x('secrets.nameHint'))}
        ${formRow(x('secrets.value'), html`<${Field} type="password" ariaLabel=${x('secrets.value')} autoComplete="new-password" spellCheck=${false} value=${f.value}
          placeholder=${x('secrets.valuePlaceholder')} onInput=${(e) => ctx.setSecretForm({ value: e.target.value })} />`, x('secrets.valueHint'))}
        <${Stack} direction="wrap" density="compact" align="center">
          <${Action} disabled=${!ready || ctx.busy === 'secret:' + f.name.trim()} onClick=${() => ctx.writeSecret(f.name.trim(), f.value, false)}>${ctx.busy === 'secret:' + f.name.trim() ? x('secrets.saving') : x('secrets.save')}<//>
          <${Action} kind="text" onClick=${() => ctx.toggleSecretForm(false)}>${x('cancel')}<//>
          ${msgLine(ctx.secretMsg)}
        <//>
      <//>
    <//>`;
}

/* ── 06 ───────────────────────────────────────────────────────────────────────────────────────── */

function secGroups(ctx) {
  const groups = ctx.ov.groups?.groups || [];
  return html`
    <${Section} id="ac-groups" title=${x('secGroups')} count=${x('secGroupsSub', { n: groups.length })}>
      <${Stack}>
        <${Text} tone="muted">${x('groupsIntro')}<//>
        <${SharingGroupsSection} showToast=${ctx.showToast} initial=${ctx.ov.groups} />
        <${SharesIncomingSection} />
      <//>
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
    <${Section} id="ac-addresses" title=${x('secAddresses')} count=${x('secAddressesSub')}>
      <${Stack}>
        <${Text} tone="muted">${x('addressesIntro')}<//>
        <${Stack} density="compact">
          ${rows.map(([k, v, sub]) => html`<${KeyValue} key=${k} label=${x('addr.' + k)} value=${html`<${Stack} density="compact">
            ${v ? html`<${Text} kind="mono">${v}<//>` : null}
            <${Text} kind="caption" tone="muted">${sub}<//>
            ${v ? html`<${Stack} direction="horizontal" align="start"><${CopyAction} kind="text" text=${v} label=${x('copy')} onCopied=${() => ctx.showToast(x('copied'))} /><//>` : null}
          <//>`} />`)}
          <${KeyValue} label=${x('addr.session')} value=${html`<${Stack} density="compact">
            <${Text}>${cur ? x('addr.sessionValue', { date: dateWord(cur.expires_at), days: days ?? '' }) : x('addr.sessionNone')}<//>
            <${Text} kind="caption" tone="muted">${x('addr.sessionSub')}<//>
          <//>`} />
        <//>
      <//>
    <//>`;
}

/* ── 08 ───────────────────────────────────────────────────────────────────────────────────────── */

function secRoads() {
  const ask = x('roadAskPrompt');
  return html`
    <${Section} id="ac-roads" title=${x('secRoads')}>
      <${Columns} layout="leading" collapse="640">
        <${Surface} kind="record"><${Stack}>
          <${Text} kind="label">${x('roadAskTitle')}<//>
          <${Text}>${x('roadAskBody')}<//>
          <${Surface} kind="code">${ask}<//>
          <${Stack} direction="horizontal" align="start">
            <${CopyAction} text=${ask} label=${x('copyPrompt')} />
          <//>
        <//><//>
        <${Surface} kind="box"><${Stack}>
          <${Text} kind="label">${x('roadAgentTitle')}<//>
          <${Text}>${x('roadAgentBody')}<//>
          <${Text} kind="mono" tone="muted">aimeat_access_list · aimeat_connection_list · aimeat_group_list · aimeat_consent_list · ${x('roadAgentScope')}<//>
        <//><//>
      <//>
    <//>`;
}
