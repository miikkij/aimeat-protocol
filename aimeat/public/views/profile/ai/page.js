/**
 * @file public/views/profile/ai/page.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI page in the poster face: which model answers, on whose key, within what
 *   daily budget. The mast and the strip say who pays and what it has cost; then 01 the connection
 *   (the provider, the key, a real test), 02 the six model roles as rows, 03 the budget and what
 *   spent it (the daily figure in words, the apps that spent most with the cap written on the row,
 *   the 30-day chart), 04 fine-tuning in words, 05 what consumes the key. Pure render over the ctx
 *   bag; the rows are rows.js.
 * @structure renderPage · mast · strip · secConnection · secModels · secBudget · secParams ·
 *   secConsumers
 * @usage import { renderPage } from './ai/page.js';
 * @version-history
 *   v1.30.0 -- 2026-10-02 -- The crews' row follows own_key.agents: the key pays when every agent's crew thinks through this server; when only some do, the row names them; otherwise none do.
 *   v1.29.0 -- 2026-10-02 -- 07 says what the own key does not reach, from the server's own_key: a row for the agents' crews (they call their model with the key of the machine that runs them), and the chat's line about moving onto this server only while the operator's shared chat key pays for it. The lead and the agents' row no longer say that everything here spends the key.
 *   v1.28.0 -- 2026-09-28 -- AI roles (wish-tekoalyn-roolit): the six fixed model roles (05) and the fine-tuning (07) leave the page, since a capability's model and fine-tuning are set on its provider and what a model is for is a role; 04 is the roles and the apps' roles (ai/roles-section.js), the model policy is 05, the budget 06, the consumers 07. The strip's fourth figure counts the roles and says how many app roles wait for a binding.
 *   v1.27.0 -- 2026-09-28 -- Three sections after the connection: 02 the providers, 03 the routing, 04 the model policy (ai/providers.js, System 2); the sections after them are 05 to 08.
 *   v1.26.0 -- 2026-09-26 -- Every part is a kit component (SettingsPage with its head, strip and rail as data; FigureStrip; Facts with a value left to the model grey; Meter; List; More; Box; Tabs; TextField, Select, Check; Label; Note; Action; Layout): the page passes data and writes no class. The key field stays hidden with no eye, kept out of password managers, as on main (page group G8).
 *   v1.25.0 -- 2026-09-26 -- The provider's radio dots and the retry check box carry the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.24.0 -- 2026-09-26 -- The figure on the budget bar is the Meter's figure (.poster-meter-figure), the Wallet meter's look (a unification: the lead's ruling on a figure written on a meter).
 *   v1.23.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.22.0 -- 2026-09-26 -- The last loading line here carries the Loading mark, only while it says loading (a unification: the look most tabs use).
 *   v1.21.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.20.0 -- 2026-09-26 -- A grey line that explains is the Hint (.poster-hint); the rule that drew it here goes and its place stays (a unification: the look most tabs use).
 *   v1.19.0 -- 2026-09-26 -- A table's cells are the Listing's own: figures the figure cell (.listing-n), words the words cell (.listing-desc), a row of servers the Listing; the rules that drew them here go (a unification: the look most tabs use).
 *   v1.18.0 -- 2026-09-25 -- The budget bar is the quota meter (.poster-box--meter.poster-box--quota, is-full from 90 %), as Memory's storage and the overview draw theirs, a unification.
 *   v1.17.0 -- 2026-09-25 -- The line under a list with its count is the More line (css/components/more-line.css), a unification: the look most tabs use.
 *   v1.16.0 -- 2026-09-25 -- A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.15.0 -- 2026-09-25 -- The connection, the budget, the fine-tuning and the consumers are the Facts (css/components/facts.css), a unification: the look most tabs use.
 *   v1.14.0 -- 2026-09-25 -- The model roles and the spend table are the Listing (css/components/listing.css), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- A framed box around one thing is the Object box (.poster-box; on a grey ground its copy tone), in the tone its look already was (Jouni's decision "Object box", a unification).
 *   v1.11.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.10.0 -- 2026-09-25 -- The line a form says after it acted is the Form message; a refusal is its error tone (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.8.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.7.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.6.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.5.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.4.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.3.0 -- 2026-09-25 -- The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-09 — A reasoning row in the parameters section: model default, off, or an
 *     effort level, beside the retry row whose promise the server now keeps.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageSection } from '/components/PageSection.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Meter } from '/components/Figure.js';
import { List, More } from '/components/List.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { Check } from '/components/Check.js';
import { Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Row as Line } from '/components/Layout.js';
import { x, money, compact, dateWord, crumb, pageLinks } from './frame.js';
import { appRow } from './rows.js';
import { secProviders, secRouting, secPolicy } from './providers.js';
import { secRoles, roleTitle } from './roles-section.js';
import { Hint } from '/components/Hint.js';

const SHOWN = 8;
/** The line a form says after it acted; a refusal in its error tone. */
const msg = (m) => (m ? html`<${Note} kind="message" error=${!!m.error}>${m.text}<//>` : null);

export function renderPage(ctx) {
  const s = ctx.settings;
  const loading = !s;
  return html`
    <${SettingsPage} name="ai"
      crumb=${crumb()}
      ...${mast(ctx)}
      strip=${strip(ctx)}
      railTitle=${x('railTitle')}
      sections=${[
        { id: 'ai-connection', num: '01', label: x('secConnection'), count: '' },
        { id: 'ai-providers', num: '02', label: x('pv.title'), count: ctx.pv.view ? String(ctx.pv.providers.length) : '' },
        { id: 'ai-routing', num: '03', label: x('rt.title'), count: '' },
        { id: 'ai-roles', num: '04', label: x('rl.title'), count: ctx.rl.view ? String(ctx.rl.roles.length) : '' },
        { id: 'ai-policy', num: '05', label: x('pol.title'), count: ctx.pv.policy ? x('pol.mode.' + (ctx.pv.policy.policy?.mode || 'open')) : '' },
        { id: 'ai-budget', num: '06', label: x('secBudget'), count: ctx.usage ? x('perDayShort', { n: money(ctx.usage.daily_budget_usd) }) : '' },
        { id: 'ai-consumers', num: '07', label: x('secConsumers'), count: '' },
      ]}
      pagesLabel=${x('pages')}
      pages=${pageLinks(ctx.navigate)}
      after=${html`<${ctx.ConfirmUI} />`}>
      ${loading ? html`<${Note} kind="loading">${x('loading')}<//>` : html`
        ${secConnection(ctx)}
        ${secProviders(ctx, '02')}
        ${secRouting(ctx, '03')}
        ${secRoles(ctx, '04')}
        ${secPolicy(ctx, '05')}
        ${secBudget(ctx)}
        ${secConsumers(ctx)}`}
    <//>`;
}

/** The head: the title, its tags and line, the loud action and the doors, as SettingsPage props. */
function mast(ctx) {
  const s = ctx.settings;
  const keyed = ctx.keyed;
  const marks = !s ? [] : keyed
    ? [{ label: s.provider === 'openrouter' ? x('chipOwnKey') : x('chipOwnProvider'), tone: 'sun' }, { label: x('provider.' + (s.provider || 'openrouter')) }, ctx.usage ? { label: x('chipBudget', { n: money(ctx.usage.daily_budget_usd) }) } : null]
    : [{ label: x('chipNoKey'), tone: 'coral' }, ctx.chat && ctx.chat.allowance_remaining_usd > 0 ? { label: x('chipHouseKey', { host: ctx.host, n: money(ctx.chat.allowance_remaining_usd) }) } : null, { label: x('provider.openrouter') }];
  const desc = !s ? '' : keyed ? x('desc', { host: ctx.host }) : x('descNoKey', { host: ctx.host, n: money(ctx.chat?.allowance_remaining_usd || 0) });
  const loud = keyed
    ? html`<${Loud} control disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}<//>`
    : html`<${Loud} href="https://openrouter.ai/keys" newTab>${x('getKey')}<//>`;
  return {
    title: t('profile.generator.openrouter.title'), sub: x('titleSub'), marks, desc,
    actions: html`${loud}<${Actions}>
      ${keyed ? html`<${Action} small href="https://openrouter.ai/keys" newTab>${x('getKeyShort')}<//>` : null}
      <${Action} small soft href="https://openrouter.ai/credits" newTab>${x('credits')}<//>
    <//>`,
  };
}

function strip(ctx) {
  const s = ctx.settings;
  const u = ctx.usage;
  const r = ctx.roll;
  if (!s) return html`<${FigureStrip} loading=${4} />`;
  const rl = ctx.rl;
  const payer = ctx.keyed ? x('stripOwnKey') : ctx.host;
  return html`<${FigureStrip} items=${[
    { key: 'pays', n: payer, tone: 'coral', label: x('stripPays'),
      sub: ctx.keyed ? x('stripPaysSub', { provider: x('provider.' + (s.provider || 'openrouter')), host: ctx.host }) : (ctx.chat ? x('stripAllowance', { n: money(ctx.chat.allowance_remaining_usd || 0) }) : '') },
    { key: 'today', n: u ? money(u.spent_today_usd) : '…', label: x('stripToday'), sub: u ? x('stripTodaySub', { n: money(u.daily_budget_usd) }) : '' },
    { key: 'month', n: r ? money(r.cost) : '…', label: x('stripMonth'), sub: r ? x('stripMonthSub', { calls: r.calls, apps: r.apps.length }) : '' },
    { key: 'roles', n: rl.view ? String(rl.roles.length) : '…', label: x('rl.title'), tone: rl.waiting ? 'coral' : undefined,
      sub: rl.view ? (rl.waiting ? x('rl.stripWaiting', { n: rl.waiting }) : rl.roles.map(roleTitle).join(' · ')) : '' },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConnection(ctx) {
  const s = ctx.settings;
  const d = ctx.conn;   // the draft: provider, baseUrl, apiKey
  const isOr = d.provider === 'openrouter';
  const count = ctx.keyed ? x('secConnectionSub', { provider: x('provider.' + (s.provider || 'openrouter')) }) : x('secConnectionNone');
  const providers = html`
    ${['openrouter', 'lmstudio', 'custom'].map((p) => html`<${Check} radio inline name="ai-provider" key=${p} checked=${d.provider === p} onChange=${() => ctx.setProvider(p)}>${x('providerChoice.' + p)}<//>`)}
    ${!isOr ? html`<${TextField} box type="url" value=${d.baseUrl} placeholder="https://…/v1" ariaLabel=${x('baseUrl')} onInput=${(v) => ctx.setConn({ baseUrl: v })} />` : null}`;
  const keyDoors = ctx.keyed ? html`
    <${Action} small soft disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}<//>
    ${s.hasApiKey ? html`<${Action} small soft tone="danger" onClick=${() => ctx.removeKey()}>${x('removeKey')}<//>` : null}` : null;
  const key = html`
    <${TextField} box unmanaged value=${d.apiKey} placeholder=${s.hasApiKey ? x('keyMasked') : 'sk-or-v1-…'} ariaLabel=${x('keyLabel')}
      onInput=${(v) => ctx.setConn({ apiKey: v })}
      actions=${html`<${Action} small disabled=${ctx.busy === 'conn'} onClick=${() => ctx.saveConnection()}>${x('save')}<//>`} />
    ${msg(ctx.connMsg)}`;
  return html`
    <${PageSection} id="ai-connection" num="01" title=${x('secConnection')} count=${count} first=${true}>
      <${Facts} rows=${[
        { k: x('providerLabel'), v: providers, sub: x('providerHint') },
        { k: x('keyLabel'), v: key, sub: s.hasApiKey ? x('keyStoredHint') : x('keyHint'), actions: keyDoors },
      ]} />
      ${!ctx.keyed ? html`<${Note} kind="quiet"><b>${x('noKeyLead')}</b> ${x('noKeyBody', { host: ctx.host })}<//>` : null}
    <//>`;
}

/* ── 06 ───────────────────────────────────────────────────────────────────────────────────────── */

function secBudget(ctx) {
  const u = ctx.usage;
  const r = ctx.roll;
  if (!u) return html`<${PageSection} id="ai-budget" num="06" title=${x('secBudget')} count=${null}><${Note} kind="loading">${x('loading')}<//><//>`;
  const budget = Number(u.daily_budget_usd) || 0;
  const spent = Number(u.spent_today_usd) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perDay = r && r.days ? r.cost / Math.max(1, r.days) : 0;
  const rows = r ? r.apps : [];
  const shown = ctx.showAllApps ? rows : rows.slice(0, SHOWN);
  const editing = ctx.capsEditing;
  const history = ctx.history;
  const budgetDoors = ctx.budgetEditing
    ? html`<${TextField} box type="number" size="short" min="0" max="1000" step="0.10" value=${ctx.budgetDraft} ariaLabel=${x('dailyBudget')}
        onInput=${(v) => ctx.setBudgetDraft(v)}
        actions=${html`<${Action} small disabled=${ctx.busy === 'budget'} onClick=${() => ctx.saveBudget()}>${x('save')}<//><${Action} small soft onClick=${() => ctx.setBudgetEditing(false)}>${x('cancel')}<//>`} />`
    : html`<${Actions}><${Action} small soft onClick=${() => ctx.setBudgetEditing(true)}>${x('changeBudget')}<//><//>`;
  const budgetValue = html`
    <${FactLine} sub=${x('dailyBudgetSub', { def: money(ctx.aiSettings?.defaults?.daily_budget_usd ?? 1), month: r ? money(r.cost) : money(0), perDay: money(perDay) })}>${x('dailyBudgetBody', { n: money(budget), today: money(spent) })}<//>
    <${Meter} quota pct=${pct} figure=${`${money(spent)} / ${money(budget)} · ${pct} %`} />
    ${budgetDoors}
    ${msg(ctx.budgetMsg)}`;
  const capDoors = editing
    ? html`<${Loud} control disabled=${ctx.busy === 'caps'} onClick=${() => ctx.saveCaps()}>${x('saveCaps')}<//><${Action} small soft onClick=${() => ctx.setCapsEditing(false)}>${x('cancel')}<//>`
    : html`<${Action} small soft onClick=${() => ctx.setCapsEditing(true)}>${x('setCaps')}<//>`;
  return html`
    <${PageSection} id="ai-budget" num="06" title=${x('secBudget')} count=${x('secBudgetSub', { n: money(budget), today: money(spent) })}>
      <${Facts} rows=${[
        { k: x('dailyBudget'), v: budgetValue },
        { k: x('monthLabel'), v: r && r.days ? x('monthBody', { cost: money(r.cost), calls: r.calls, tokens: compact(r.tokens), apps: r.apps.length, big: r.apps.filter((a) => a.cost >= 0.1).length }) : x('monthNone'), sub: x('monthSub') },
      ]} />
      ${rows.length ? html`
        <${Label} block>${x('whatSpent', { shown: shown.length, total: rows.length })}<//>
        <${List} cols="name-n-n-cap-n" keepCols apart head=${[x('colApp'), { label: x('colMonth'), num: true }, { label: x('colToday'), num: true }, { label: x('colCap'), num: true }, { label: x('colCalls'), num: true }]}>
          ${shown.map((row) => appRow(ctx, row, editing))}
        <//>
        <${More} wrap label=${ctx.showAllApps ? x('showFewer') : x('showAllApps', { n: rows.length })} onMore=${rows.length > SHOWN ? () => ctx.setShowAllApps(!ctx.showAllApps) : null}>
          ${capDoors}
          <small>${editing ? x('capsEditingHint') : x('capsHint')}</small>
        <//>
        ${msg(ctx.capsMsg)}
        <${Hint}>${x('hintCaps')}<//>` : html`<${Note} kind="quiet">${x('noSpend')}<//>`}
      ${history && Array.isArray(history.days) && history.days.length ? chart(ctx, history, r) : null}
    <//>`;
}

function chart(ctx, history, r) {
  const labels = history.days.map((d) => dateWord(d.date));
  const apps = history.apps || [];
  const metric = ctx.metric;
  const pick = (m) => (metric === 'tokens' ? m.tokens : metric === 'seconds' ? m.audio_seconds : m.cost_usd) || 0;
  const datasets = apps.map((app, i) => ({ label: app, data: history.days.map((d) => pick((d.per_app && d.per_app[app]) || {})), backgroundColor: colorForIndex(i) }));
  const yFormat = metric === 'tokens' ? ((v) => compact(v)) : metric === 'seconds' ? ((v) => `${Math.round(v)} s`) : ((v) => money(v));
  return html`
    <${Box}>
      <${Line} justify="between" wrap gap="large" below="small">
        <${Note} inline>${x('chartTitle', { n: history.days.length, first: dateWord(r.first), last: dateWord(r.last) })}${r.maxDay ? ` · ${x('chartMax', { n: money(r.maxDay.cost), date: dateWord(r.maxDay.date) })}` : ''}<//>
        <${Tabs} tone="filter" value=${metric} onSelect=${(k) => ctx.setMetric(k)} items=${['cost', 'tokens', 'seconds'].map((k) => ({ value: k, label: x('metric.' + k) }))} />
      <//>
      <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${200} legend=${false} yFormat=${yFormat} />
    <//>`;
}

/* ── 07 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConsumers(ctx) {
  const top = (ctx.roll?.apps || []).filter((a) => !a.app.includes(':')).slice(0, 3).map((a) => a.app);
  const chat = ctx.chat;
  // What the own key never reaches here, as the server says it (own_key.not_covered, services/
  // own-key-coverage.ts). Without the server's answer the crews' row is still shown: no runtime takes
  // the key from the node today, whatever the node's configuration.
  const gaps = (chat?.own_key?.not_covered || []).map((g) => g.part);
  const chatMissed = gaps.includes('chat');
  const crewsMissed = !chat?.own_key || gaps.includes('agent_runtimes');
  // The agents whose runtime said their crew thinks through this server, so the key reaches them.
  const onNode = (chat?.own_key?.agents || []).filter((a) => a.llm === 'node').map((a) => a.agent);
  const crewsRow = {
    k: x('consumer.crews'),
    v: !crewsMissed ? x('consumerCrewsNodeBody') : onNode.length ? x('consumerCrewsMixed', { agents: onNode.join(', ') }) : x('consumerCrewsBody'),
  };
  return html`
    <${PageSection} id="ai-consumers" num="07" title=${x('secConsumers')} count=${null}>
      <${Note} kind="lead">${x('consumersIntro')}<//>
      <${Facts} rows=${[
        { k: x('consumer.apps'), v: `${x('consumerAppsBody')}${top.length ? ` ${x('consumerAppsTop', { apps: top.join(', ') })}` : ''}` },
        { k: x('consumer.agents'), v: x('consumerAgentsBody') },
        { k: x('consumer.media'), v: x('consumerMediaBody') },
        { k: x('consumer.chat'), v: chat
          ? (chat.pays === 'node' ? x('consumerChatNode', { host: ctx.host, model: chat.model || '' }) : chat.pays === 'own' ? x('consumerChatOwn') : x('consumerChatAllowance', { n: money(chat.allowance_remaining_usd || 0) }))
          : x('consumerChatUnknown'), ...(chatMissed ? { sub: x('consumerChatSub') } : {}) },
        crewsRow,
        { k: x('consumer.agentRule'), v: x('consumerAgentRuleBody') },
      ]} />
    <//>`;
}
