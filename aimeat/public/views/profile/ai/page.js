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
 * @structure renderPage · identity · strip · secConnection · secModels · secBudget · chart ·
 *   secParams · secConsumers
 * @usage import { renderPage } from './ai/page.js';
 * @version-history
 *   2026-09-22 -- The key field tells password managers to leave it alone again (passwordManager={false}).
 *   2026-09-22 -- Composed from the shared component set (Page, Rail, Section, NumeralBand, ListRow,
 *     Table, KeyValue, Field, Meter), so the page follows the theme and the parts in one edit;
 *     ai-poster.css is gone. The spend list is a Table that stacks on a phone.
 *   v1.2.0 -- 2026-09-13 -- V2: compose shared page headlines; keep measured sizes on view roots.
 *   v1.1.0 — 2026-09-09 — A reasoning row in the parameters section: model default, off, or an
 *     effort level, beside the retry row whose promise the server now keeps.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Page, Rail, Section, Stack, NumeralBand, Field, Table, KeyValue, Meter, Text, Chip, Action } from '/components/poster-parts.js';
import { UsageChart, colorForIndex } from '/components/UsageChart.js';
import { x, ROLES, money, compact, dateWord, crumb, pageLinks, StatusLine } from './frame.js';
import { roleRow, appCells } from './rows.js';

const SHOWN = 8;
const msg = (m) => (m ? html`<${StatusLine} error=${m.error}>${m.text}<//>` : null);
const kv = (label, body, sub) => html`<${KeyValue} label=${label}><${Stack} density="compact"><span>${body}</span>${sub ? html`<${Text} kind="caption" tone="muted">${sub}<//>` : null}<//><//>`;
const unset = () => html`<${Text} tone="muted">${x('modelDefault')}<//>`;

export function renderPage(ctx) {
  const s = ctx.settings;
  const loading = !s;
  const chosen = ROLES.filter((r) => s?.[r.field]).length;
  const keyed = ctx.keyed;
  const desc = !s ? '' : keyed ? x('desc', { host: ctx.host }) : x('descNoKey', { host: ctx.host, n: money(ctx.chat?.allowance_remaining_usd || 0) });
  const rail = html`<${Rail} kind="index" title=${x('railTitle')} entries=${[
    { href: '#ai-connection', label: x('secConnection') },
    { href: '#ai-models', label: x('secModels'), count: s ? `${chosen} / ${ROLES.length}` : undefined },
    { href: '#ai-budget', label: x('secBudget'), count: ctx.usage ? x('perDayShort', { n: money(ctx.usage.daily_budget_usd) }) : undefined },
    { href: '#ai-params', label: x('secParams') },
    { href: '#ai-consumers', label: x('secConsumers') },
  ]}>${pageLinks(ctx.navigate)}<//>`;
  return html`<${Page} crumbs=${crumb()} title=${t('profile.generator.openrouter.title')} identity=${identity(ctx)}
    actions=${html`${keyed
        ? html`<${Action} kind="primary" disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}<//>`
        : html`<${Action} kind="primary" href="https://openrouter.ai/keys" target="_blank">${x('getKey')}<//>`}
      ${keyed ? html`<${Action} href="https://openrouter.ai/keys" target="_blank">${x('getKeyShort')}<//>` : null}
      <${Action} href="https://openrouter.ai/credits" target="_blank">${x('credits')}<//>`}
    rail=${rail}>
    <${Stack}>
      ${desc ? html`<${Text} tone="muted">${desc}<//>` : null}
      ${strip(ctx)}
      ${loading ? html`<${Text} tone="muted">${x('loading')}<//>` : html`
        ${secConnection(ctx)}
        ${secModels(ctx, chosen)}
        ${secBudget(ctx)}
        ${secParams(ctx)}
        ${secConsumers(ctx)}`}
    <//>
    <${ctx.ConfirmUI} />
  <//>`;
}

function identity(ctx) {
  const s = ctx.settings;
  const chips = !s ? [] : ctx.keyed
    ? [html`<${Chip} tone="sun">${s.provider === 'openrouter' ? x('chipOwnKey') : x('chipOwnProvider')}<//>`, html`<${Chip}>${x('provider.' + (s.provider || 'openrouter'))}<//>`, ctx.models.length ? html`<${Chip}>${x('chipModels', { n: ctx.models.length })}<//>` : null, ctx.usage ? html`<${Chip} tone="muted">${x('chipBudget', { n: money(ctx.usage.daily_budget_usd) })}<//>` : null]
    : [html`<${Chip} tone="coral">${x('chipNoKey')}<//>`, ctx.chat && ctx.chat.allowance_remaining_usd > 0 ? html`<${Chip}>${x('chipHouseKey', { host: ctx.host, n: money(ctx.chat.allowance_remaining_usd) })}<//>` : null, html`<${Chip} tone="muted">${x('provider.openrouter')}<//>`];
  return html`<${Stack} density="compact"><${Text} tone="muted">${x('titleSub')}<//>
    ${chips.length ? html`<${Stack} direction="wrap" density="compact">${chips}<//>` : null}<//>`;
}

function strip(ctx) {
  const s = ctx.settings;
  const u = ctx.usage;
  const r = ctx.roll;
  if (!s) return html`<${NumeralBand} tone="plain" size="small" items=${['a', 'b', 'c', 'd'].map((id) => ({ id, label: '', value: '…' }))} />`;
  const chosen = ROLES.filter((role) => s[role.field]);
  return html`<${NumeralBand} tone="plain" size="small" items=${[
    { id: 'pays', label: x('stripPays'), value: ctx.keyed ? x('stripOwnKey') : ctx.host, tone: 'coral', note: ctx.keyed ? x('stripPaysSub', { provider: x('provider.' + (s.provider || 'openrouter')), host: ctx.host }) : (ctx.chat ? x('stripAllowance', { n: money(ctx.chat.allowance_remaining_usd || 0) }) : '') },
    { id: 'today', label: x('stripToday'), value: u ? money(u.spent_today_usd) : '…', note: u ? x('stripTodaySub', { n: money(u.daily_budget_usd) }) : '' },
    { id: 'month', label: x('stripMonth'), value: r ? money(r.cost) : '…', note: r ? x('stripMonthSub', { calls: r.calls, apps: r.apps.length }) : '' },
    { id: 'roles', label: x('stripRoles'), value: `${chosen.length} / ${ROLES.length}`, note: chosen.length ? chosen.map((role) => x('role.' + role.id).toLowerCase()).join(' · ') : x('stripRolesNone') },
  ]} />`;
}

/* ── 01 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConnection(ctx) {
  const s = ctx.settings;
  const d = ctx.conn;   // the draft: provider, baseUrl, apiKey
  const isOr = d.provider === 'openrouter';
  const count = ctx.keyed ? x('secConnectionSub', { provider: x('provider.' + (s.provider || 'openrouter')) }) : x('secConnectionNone');
  return html`
    <${Section} id="ai-connection" title=${x('secConnection')} count=${count}>
      <${Stack}>
        <div>
          <${KeyValue} label=${x('providerLabel')}><${Stack} density="compact">
            <${Stack} direction="wrap" role="radiogroup" label=${x('providerLabel')}>
              ${['openrouter', 'lmstudio', 'custom'].map((p) => html`<${Action} key=${p} kind="tab" semantics="radio" selected=${d.provider === p} onClick=${() => ctx.setProvider(p)}>${x('providerChoice.' + p)}<//>`)}
            <//>
            ${!isOr ? html`<${Field} type="url" value=${d.baseUrl} placeholder="https://…/v1" ariaLabel=${x('baseUrl')} onInput=${(e) => ctx.setConn({ baseUrl: e.target.value })} />` : null}
            <${Text} kind="caption" tone="muted">${x('providerHint')}<//>
          <//><//>
          <${KeyValue} label=${x('keyLabel')}><${Stack} density="compact">
            <${Stack} direction="horizontal" align="end">
              <${Field} type="password" autoComplete="off" passwordManager=${false} value=${d.apiKey} placeholder=${s.hasApiKey ? x('keyMasked') : 'sk-or-v1-…'} ariaLabel=${x('keyLabel')} onInput=${(e) => ctx.setConn({ apiKey: e.target.value })} />
              <${Action} disabled=${ctx.busy === 'conn'} onClick=${() => ctx.saveConnection()}>${x('save')}<//>
            <//>
            ${msg(ctx.connMsg)}
            <${Text} kind="caption" tone="muted">${s.hasApiKey ? x('keyStoredHint') : x('keyHint')}<//>
            ${ctx.keyed ? html`
              <${Stack} direction="wrap" align="center">
                <${Action} disabled=${ctx.busy === 'test'} onClick=${() => ctx.testConnection()}>${ctx.busy === 'test' ? x('testing') : x('testConnection')}<//>
                <${Action} disabled=${ctx.busy === 'models'} onClick=${() => ctx.loadModels()}>${ctx.busy === 'models' ? x('loading') : x('refreshModels')}<//>
                ${s.hasApiKey ? html`<${Action} tone="danger" onClick=${() => ctx.removeKey()}>${x('removeKey')}<//>` : null}
              <//>` : null}
          <//><//>
        </div>
        ${!ctx.keyed ? html`<${Text}><strong>${x('noKeyLead')}</strong> ${x('noKeyBody', { host: ctx.host })}<//>` : null}
      <//>
    <//>`;
}

/* ── 02 ───────────────────────────────────────────────────────────────────────────────────────── */

function secModels(ctx, chosen) {
  return html`
    <${Section} id="ai-models" title=${x('secModels')} count=${x('secModelsSub', { n: chosen, total: ROLES.length })}>
      <${Stack}>
        ${ctx.modelsError ? html`<${StatusLine} error=${true}>${ctx.modelsError}<//>` : null}
        <div>
          <${Stack} direction="horizontal" align="between" density="compact">
            <${Text} kind="label">${x('colRole')} · ${x('colWhat')}<//><${Text} kind="label">${x('colModel')}<//>
          <//>
          ${ROLES.map((role) => roleRow(ctx, role))}
        </div>
        ${msg(ctx.modelsMsg)}
        <${Text} kind="caption" tone="muted">${x('hintUnits')}<//>
        <${Text} kind="caption" tone="muted">${ctx.keyed ? x('hintModels') : x('hintModelsNoKey')}<//>
      <//>
    <//>`;
}

/* ── 03 ───────────────────────────────────────────────────────────────────────────────────────── */

function secBudget(ctx) {
  const u = ctx.usage;
  const r = ctx.roll;
  if (!u) return html`<${Section} id="ai-budget" title=${x('secBudget')}><${Text} tone="muted">${x('loading')}<//><//>`;
  const budget = Number(u.daily_budget_usd) || 0;
  const spent = Number(u.spent_today_usd) || 0;
  const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
  const perDay = r && r.days ? r.cost / Math.max(1, r.days) : 0;
  const rows = r ? r.apps : [];
  const shown = ctx.showAllApps ? rows : rows.slice(0, SHOWN);
  const editing = ctx.capsEditing;
  const history = ctx.history;
  return html`
    <${Section} id="ai-budget" title=${x('secBudget')} count=${x('secBudgetSub', { n: money(budget), today: money(spent) })}>
      <${Stack}>
        <div>
          <${KeyValue} label=${x('dailyBudget')}><${Stack} density="compact">
            <span>${x('dailyBudgetBody', { n: money(budget), today: money(spent) })}</span>
            <${Text} kind="caption" tone="muted">${x('dailyBudgetSub', { def: money(ctx.aiSettings?.defaults?.daily_budget_usd ?? 1), month: r ? money(r.cost) : money(0), perDay: money(perDay) })}<//>
            <${Meter} value=${spent} max=${budget > 0 ? budget : 1} label=${x('dailyBudget')} />
            <${Text} kind="mono">${money(spent)} / ${money(budget)} · ${pct} %<//>
            ${ctx.budgetEditing ? html`
              <${Stack} direction="wrap" align="end">
                <${Field} type="number" width="narrow" min="0" max="1000" step="0.10" value=${ctx.budgetDraft} ariaLabel=${x('dailyBudget')} onInput=${(e) => ctx.setBudgetDraft(e.target.value)} />
                <${Action} disabled=${ctx.busy === 'budget'} onClick=${() => ctx.saveBudget()}>${x('save')}<//>
                <${Action} onClick=${() => ctx.setBudgetEditing(false)}>${x('cancel')}<//>
              <//>` : html`<div><${Action} onClick=${() => ctx.setBudgetEditing(true)}>${x('changeBudget')}<//></div>`}
            ${msg(ctx.budgetMsg)}
          <//><//>
          ${kv(x('monthLabel'), r && r.days ? x('monthBody', { cost: money(r.cost), calls: r.calls, tokens: compact(r.tokens), apps: r.apps.length, big: r.apps.filter((a) => a.cost >= 0.1).length }) : x('monthNone'), x('monthSub'))}
        </div>
        ${rows.length ? html`
          <${Text} kind="label">${x('whatSpent', { shown: shown.length, total: rows.length })}<//>
          <${Table} collapse="600" density="compact" label=${x('whatSpent', { shown: shown.length, total: rows.length })}
            headers=${[x('colApp'), x('colMonth'), x('colToday'), x('colCap'), x('colCalls')]}
            rows=${shown.map((row) => appCells(ctx, row, editing))} />
          <${Stack} direction="wrap" align="center">
            ${rows.length > SHOWN ? html`<${Action} onClick=${() => ctx.setShowAllApps(!ctx.showAllApps)}>${ctx.showAllApps ? x('showFewer') : x('showAllApps', { n: rows.length })}<//>` : null}
            ${editing
              ? html`<${Action} disabled=${ctx.busy === 'caps'} onClick=${() => ctx.saveCaps()}>${x('saveCaps')}<//><${Action} onClick=${() => ctx.setCapsEditing(false)}>${x('cancel')}<//>`
              : html`<${Action} onClick=${() => ctx.setCapsEditing(true)}>${x('setCaps')}<//>`}
            <${Text} kind="caption" tone="muted">${editing ? x('capsEditingHint') : x('capsHint')}<//>
          <//>
          ${msg(ctx.capsMsg)}
          <${Text} kind="caption" tone="muted">${x('hintCaps')}<//>` : html`<${Text} tone="muted">${x('noSpend')}<//>`}
        ${history && Array.isArray(history.days) && history.days.length ? chart(ctx, history, r) : null}
      <//>
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
    <${Stack} density="compact">
      <${Stack} direction="wrap" align="between">
        <${Text} kind="caption" tone="muted">${x('chartTitle', { n: history.days.length, first: dateWord(r.first), last: dateWord(r.last) })}${r.maxDay ? ` · ${x('chartMax', { n: money(r.maxDay.cost), date: dateWord(r.maxDay.date) })}` : ''}<//>
        <${Stack} direction="horizontal" density="compact">${['cost', 'tokens', 'seconds'].map((k) => html`<${Action} key=${k} kind="tab" selected=${metric === k} onClick=${() => ctx.setMetric(k)}>${x('metric.' + k)}<//>`)}<//>
      <//>
      <${UsageChart} stacked labels=${labels} datasets=${datasets} height=${200} legend=${false} yFormat=${yFormat} />
    <//>`;
}

/* ── 04 ───────────────────────────────────────────────────────────────────────────────────────── */

function secParams(ctx) {
  const s = ctx.settings;
  const p = ctx.params;   // the draft while editing
  const e = ctx.paramsEditing;
  const count = [s.temperature != null ? x('tempShort', { n: s.temperature }) : '', s.temperature == null && s.top_p == null && s.max_tokens == null ? x('allDefaults') : ''].filter(Boolean).join(' · ');
  const field = (key, min, max, step, label) => html`<${Field} type="number" width="narrow" min=${min} max=${max} step=${step} value=${p[key]} placeholder=${x('default')} label=${label} ariaLabel=${x('param.' + key)} onInput=${(ev) => ctx.setParams({ [key]: ev.target.value })} />`;
  return html`
    <${Section} id="ai-params" title=${x('secParams')} count=${count} description=${x('paramsIntro')}>
      <${Stack}>
        <div>
          ${kv(x('param.temperature'), e ? field('temperature', 0, 2, 0.1) : (s.temperature != null ? x('tempBody', { n: s.temperature }) : unset()), x('tempSub'))}
          ${kv(x('param.top_p'), e ? field('top_p', 0, 1, 0.05) : (s.top_p != null ? String(s.top_p) : unset()), x('topPSub'))}
          ${kv(x('param.max_tokens'), e ? field('max_tokens', 256, 128000, 256) : (s.max_tokens != null ? x('tokensN', { n: compact(s.max_tokens) }) : unset()), x('maxTokensSub'))}
          ${kv(x('param.retry'), e
            ? html`<${Stack} direction="wrap" align="end">
                <${Action} kind="choice" semantics="switch" title=${x('retryOn')} selected=${!!p.autoRetry} onClick=${() => ctx.setParams({ autoRetry: !p.autoRetry })} />
                ${p.autoRetry ? field('maxRetries', 1, 10, 1, x('retryMax')) : null}
              <//>`
            : (s.autoRetry ? x('retryBody', { n: s.maxRetries || 3 }) : x('retryOff')), x('retrySub'))}
          ${kv(x('param.reasoning'), e
            ? html`<${Field} type="select" width="narrow" ariaLabel=${x('param.reasoning')} value=${p.reasoning} onChange=${(ev) => ctx.setParams({ reasoning: ev.target.value })}
                options=${['', 'off', 'low', 'medium', 'high'].map((k) => ({ value: k, label: x('reasoning.' + (k || 'default')) }))} />`
            : (s.reasoning && s.reasoning.enabled === false
              ? x('reasoningOff')
              : s.reasoning && s.reasoning.effort
                ? x('reasoningOn', { level: x('reasoning.' + s.reasoning.effort) })
                : unset()), x('reasoningSub'))}
        </div>
        <${Stack} direction="wrap" align="center">
          ${e
            ? html`<${Action} disabled=${ctx.busy === 'params'} onClick=${() => ctx.saveParams()}>${x('save')}<//><${Action} onClick=${() => ctx.setParamsEditing(false)}>${x('cancel')}<//>`
            : html`<${Action} onClick=${() => ctx.setParamsEditing(true)}>${x('change')}<//>`}
        <//>
        ${msg(ctx.paramsMsg)}
      <//>
    <//>`;
}

/* ── 05 ───────────────────────────────────────────────────────────────────────────────────────── */

function secConsumers(ctx) {
  const top = (ctx.roll?.apps || []).filter((a) => !a.app.includes(':')).slice(0, 3).map((a) => a.app);
  const chat = ctx.chat;
  return html`
    <${Section} id="ai-consumers" title=${x('secConsumers')} description=${x('consumersIntro')}>
      <div>
        ${kv(x('consumer.apps'), `${x('consumerAppsBody')}${top.length ? ` ${x('consumerAppsTop', { apps: top.join(', ') })}` : ''}`)}
        ${kv(x('consumer.agents'), x('consumerAgentsBody'))}
        ${kv(x('consumer.media'), x('consumerMediaBody'))}
        ${kv(x('consumer.chat'), chat
          ? (chat.pays === 'node' ? x('consumerChatNode', { host: ctx.host, model: chat.model || '' }) : chat.pays === 'own' ? x('consumerChatOwn') : x('consumerChatAllowance', { n: money(chat.allowance_remaining_usd || 0) }))
          : x('consumerChatUnknown'), x('consumerChatSub'))}
        ${kv(x('consumer.agentRule'), x('consumerAgentRuleBody'))}
      </div>
    <//>`;
}
