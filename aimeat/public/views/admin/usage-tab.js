/**
 * @file usage-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Usage page in the poster face (design canvas "AIMEAT Admin Usage"): what AI
 *   costs on this node, organised by WHOSE MONEY IT IS.
 *
 *   THE PAGE OPENS ON WHAT IT CANNOT SEE, and that is the honest lead. Every chat turn here is
 *   spent from one key handed to a child process (services/goose-acp.ts), so it never passes the
 *   metering and no total anywhere contains a cent of it. The old page said so in grey text at the
 *   end of a row, under four cards of numbers that were not the operator's money at all: $0.0000
 *   house spend, 0 people on the house key, $35.27 marked "(not yours)", and a config setting.
 *
 *   AN OPERATOR OPENS THIS PAGE TO ANSWER ONE QUESTION: what is this costing me. Every ingredient
 *   was already here and the answer was on none of it — including the arithmetic nothing had done,
 *   which is the free grant times the number of accounts: the most the house key can cost before
 *   somebody is refused.
 *
 *   ONE READ, PLUS ONE THAT IS ASKED FOR. GET /v1/admin/usage/page replaces four separate fetches
 *   the page used to reconcile by itself and could not. Asking the provider what the operator's own
 *   keys spent is a second, deliberate press: it costs an outbound round trip, and a page that
 *   phones a third party on every render stops loading when that third party is slow.
 *
 *   The page draws library components only and writes no class (admin page group G3).
 * @structure
 *   - Period — the chips, in section 01's header
 *   - WhatItCostsYou (01) — the word, the five rows, the strip, the door that asks the provider
 *   - AskAi (06) — what an agent can do with this, and the paste
 *   - UsageTab (default) — the reads, and the six sections
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.1.0 — 2026-10-02 — The chat row says "metered" when the chat runs through the node (no shared
 *     chat key): its calls are in the server's and people's own figures. It said "not measured" on
 *     every node with a chat, which turned false when hosted places moved off the shared key.
 *   v3.0.0 — 2026-09-27 — Library components only: Section, Verdict and Readings, FigureStrip, the
 *     filter Tabs for the period, Action for the doors and the copy, SettingBox for the paste,
 *     Beside for the checks and the paste; admin-usage.css goes.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face and six numbered sections, over one read that says whose
 *     money each figure is. The eighteen-series stacked charts are gone (the palette cycled at
 *     twelve, so six models shared a colour); the models are ranked rows and the one chart splits
 *     by whose key paid. The chat agent's key can be asked about instead of only disclaimed.
 *   v1.1.0 — 2026-08-14 — Third section: the CALL stream (surfaces, tools, apps, refusals) from
 *     GET /v1/admin/usage/summary. It counts invocations, never spend, so it is never summed with
 *     the two above. Body in usage-tab.calls.js.
 *   v1.0.0 — 2026-07-11 — Initial: unified operator usage tab (agent LLM ledger + AI apps spend),
 *     with per-user drill-down on the ledger's top-spenders table.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, Badge, Spinner, ErrorBox } from './shared.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Row, Beside } from '/components/Layout.js';
import { getNodeUrl } from '/js/services/auth.js';
import * as api from '/js/services/admin.js';
import { swallowed } from '/js/swallowed.js';
import { WhereItWent, ByDay, usd } from './usage-tab.models.js';
import { WhoSpent, WhatWasCalled } from './usage-tab.people.js';
import { buildUsagePrompt } from './usage-tab.prompt.js';

const S = (key, params) => t('admin.usage.' + key, params);

const PRESETS = ['7d', '30d', '90d', 'all'];

/** A preset as the two dates the route wants. */
function rangeFor(period) {
  const today = new Date();
  const iso = (d) => d.toISOString().split('T')[0];
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  switch (period) {
    case '7d': return { from: back(6), to: iso(today) };
    case '90d': return { from: back(89), to: iso(today) };
    case 'all': return { from: '2000-01-01', to: iso(today) };
    default: return { from: back(29), to: iso(today) };
  }
}

/**
 * The period control, in section 01's header rather than above the page.
 *
 * It governs every figure under it EXCEPT the provider's answer about a key, which is that key's
 * lifetime total and says so in its own row. Placing the control inside the section is how the page
 * stops implying it reaches things it does not.
 */
function Period({ period, onPick }) {
  return html`
    <${Row} wrap>
      <${Note} kind="meta" inline>${S('period.label')}<//>
      <${Tabs} tone="filter" label=${S('period.label')} value=${period} onSelect=${onPick}
        items=${PRESETS.map(p => ({ value: p, label: S('period.' + p) }))} />
    <//>`;
}

/**
 * Section 01: whose money it is.
 *
 * The word is the gap rather than a number, because the biggest true statement about this page is
 * that one of the operator's two keys is spent where the node cannot count it. When that key is not
 * configured at all the word becomes the bill itself, which is then a complete answer.
 */
function WhatItCostsYou({ data, control, onAskProvider, asking }) {
  const money = data.whose_money || {};
  const keys = data.keys || {};
  const chat = keys.chat || {};
  const house = keys.house || {};
  const blind = chat.enabled && chat.metered_here === false;
  // The node route: the chat has no key of its own, its calls are in the rows below.
  const chatMetered = chat.enabled && chat.metered_here === true;

  const stamp = [
    `${data.from} → ${data.to}`,
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  /** The provider's answer for one key, or the reason there is none. */
  const spendValue = (k) => {
    if (!k.spend) return S('now.notAsked');
    if (!k.spend.ok) return k.spend.reason;
    return S('now.providerSays', { n: usd(k.spend.usage_usd) });
  };

  return html`
    <${Section} first id="adm-us-01" num="01" title=${S('now.title')} doors=${control}>
      <${Verdict}
        word=${blind ? S('now.wordBlind') : S('now.wordBill', { n: usd(money.house?.cost_usd) })}
        tone=${blind ? 'danger' : undefined}
        line=${blind ? S('now.lineBlind') : S('now.lineClear', { n: usd(money.own?.cost_usd) })}
        stamp=${stamp}
        doors=${html`<${Action} small tone="danger" disabled=${asking} onClick=${onAskProvider}>
          ${asking ? S('now.asking') : S('now.askProvider')}
        <//>`}>
        <${Readings} rows=${[
    {
      key: 'chat', name: S('now.chatKey'),
      why: chatMetered ? S('now.chatKeyMeteredWhy') : chat.enabled ? S('now.chatKeyWhy') : S('now.chatKeyOffWhy'),
      mark: chatMetered
        ? html`<${Badge} type="success" label=${S('now.metered')} />`
        : chat.enabled
          ? html`<${Badge} type="danger" label=${S('now.notMeasured')} />`
          : html`<${Badge} type="muted" label=${S('now.off')} />`,
      value: chatMetered ? S('now.chatInRows') : chat.spend ? spendValue(chat) : (chat.model || S('now.notAsked')),
    },
    {
      key: 'house', name: S('now.houseKey'), why: S('now.houseKeyWhy'),
      mark: html`<${Badge} type=${(money.house?.cost_usd || 0) > 0 ? 'warning' : 'success'} label=${usd(money.house?.cost_usd)} />`,
      value: house.spend
        ? spendValue(house)
        : S('now.housePeople', { n: num(money.house?.people || 0), of: num(money.accounts || 0) }),
    },
    {
      key: 'ceiling', name: S('now.ceiling'), why: S('now.ceilingWhy', { grant: usd(money.grant_usd) }),
      mark: html`<${Badge} type="muted" label=${S('now.ceilingChip')} />`,
      value: S('now.ceilingValue', { max: usd(money.ceiling_usd), drawn: usd(money.drawn_usd) }),
    },
    {
      key: 'own', name: S('now.ownKeys'), why: S('now.ownKeysWhy'),
      mark: html`<${Badge} type="info" label=${S('now.notYours')} />`,
      value: S('now.ownValue', { n: usd(money.own?.cost_usd), people: num(money.own?.people || 0) }),
    },
    {
      key: 'ledger', name: S('now.ledger'), why: S('now.ledgerWhy'), last: true,
      mark: html`<${Badge} type="muted" label=${S('now.allKeys')} />`,
      value: S('now.ledgerValue', { n: usd(money.ledger?.cost_usd), calls: num(money.ledger?.calls || 0) }),
    },
  ]} />
      <//>

      <${FigureStrip} wrap items=${[
    { key: 'bill', n: usd(money.house?.cost_usd), label: S('strip.yourBill'), sub: S('strip.yourBillSub') },
    {
      key: 'unmeasured', n: blind ? '1' : '0', tone: blind ? 'notice' : undefined, label: S('strip.unmeasured'),
      sub: blind ? S('strip.unmeasuredSub') : S('strip.unmeasuredNone'),
    },
    {
      key: 'ceiling', n: usd(money.ceiling_usd), label: S('strip.ceiling'),
      sub: S('strip.ceilingSub', { n: num(money.accounts || 0), grant: usd(money.grant_usd) }),
    },
    { key: 'all', n: usd(money.ledger?.cost_usd), tone: 'dim', label: S('strip.allKeys'), sub: S('strip.allKeysSub') },
  ]} />
    <//>`;
}

/** Section 06: what an agent can do with this, and the paste. */
function AskAi({ from, to }) {
  const paste = buildUsagePrompt({ url: getNodeUrl(), from, to });
  return html`
    <${Section} id="adm-us-06" num="06" title=${S('ai.title')}
      doors=${html`<${Action} small soft copy=${paste}>${S('ai.copy')}<//>`}>
      <${Beside} wide side=${html`<${SettingBox} label=${S('ai.label')} pre>${paste}<//>`}>
        <${Note} kind="lead">${S('ai.lead')}<//>
        <${Readings} rows=${[
    { key: 'read', name: S('ai.read'), why: S('ai.readWhy'), mark: null, value: 'aimeat_admin_usage' },
    { key: 'provider', name: S('ai.provider'), why: S('ai.providerWhy'), mark: null, value: 'ask_provider: true' },
    { key: 'own', name: S('ai.own'), why: S('ai.ownWhy'), mark: null, value: 'aimeat_usage_report', last: true },
  ]} />
      <//>
    <//>`;
}

export default function UsageTab() {
  const [period, setPeriod] = useState('30d');
  const [data, setData] = useState(null);
  const [calls, setCalls] = useState(null);
  const [house, setHouse] = useState(null);
  const [failed, setFailed] = useState(null);
  const [asking, setAsking] = useState(false);

  const load = useCallback(async (p) => {
    const range = rangeFor(p);
    const quiet = (err) => { swallowed('usage-tab: load', err); return null; };
    // The money read is the one that must succeed; the call stream and the per-owner house split
    // are extra detail, and a page that refuses to render because a side read failed is worse than
    // one that renders without that section.
    const [page, cs, ct, hs] = await Promise.all([
      api.getUsagePage(range.from, range.to).catch(quiet),
      api.getUsageSummary('surface', range.from, range.to).catch(quiet),
      api.getUsageSummary('tool', range.from, range.to).catch(quiet),
      api.getUsageHouse(range.from, range.to).catch(quiet),
    ]);
    if (page?.data) { setData(page.data); setFailed(null); }
    else setFailed(page?.error?.message || S('failed'));
    setCalls({ surface: cs?.data ?? null, tool: ct?.data ?? null });
    setHouse(hs?.data ?? null);
  }, []);

  useEffect(() => { load(period); }, [period, load]);
  // Spend follows everything an agent does here, so this tab follows every live update.
  useEffect(() => onLiveUpdate(null, () => load(period)), [period, load]);

  /**
   * The one outbound call this page makes, and only when pressed. It replaces the `keys` block
   * with the same block answered, so a failed ask leaves the page exactly as it was.
   */
  const askProvider = useCallback(async () => {
    setAsking(true);
    try {
      const r = await api.getUsageKeys();
      if (r?.data?.keys) setData(d => (d ? { ...d, keys: r.data.keys } : d));
    } catch (err) {
      swallowed('usage-tab: askProvider', err);
    } finally {
      setAsking(false);
    }
  }, []);

  if (!data) return failed ? html`<${ErrorBox} message=${failed} />` : html`<${Spinner} text=${S('loading')} />`;

  const control = html`<${Period} period=${period} onPick=${setPeriod} />`;

  return html`<${Fragment}>
    <${WhatItCostsYou} data=${data} control=${control} onAskProvider=${askProvider} asking=${asking} />
    <${WhereItWent} models=${data.models} />
    <${ByDay} days=${data.days} />
    <${WhoSpent} people=${data.people} houseSpenders=${house?.top_house_spenders} />
    <${WhatWasCalled} calls=${calls} />
    <${AskAi} from=${data.from} to=${data.to} />
  <//>`;
}
