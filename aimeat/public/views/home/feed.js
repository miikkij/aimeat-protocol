/**
 * @file public/views/home/feed.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What has happened on this home (aimeat_remake/06-koti-feed-suostumus.md).
 *
 *   The feed reads the same markers the operator funnel reads, so the screen and the numbers cannot
 *   tell two different stories about the same account. Its FIRST row exists before the person has
 *   done anything — the account being created is a real event, and an empty feed on a brand-new
 *   account reads as broken.
 * @structure HomeFeed({ items }) · FeedRow({ item }) · line · when
 * @usage import { HomeFeed } from './feed.js';
 * @version-history
 *   v2.2.0 — 2026-08-23 — HomeFeed takes `band`: on the finished home it is one of the ruled
 *     bands (.koti-band), on the onboarding home it keeps its own gap. Title class is the band's.
 *   v2.1.0 — 2026-08-18 — The list becomes a timeline: kindCategory() maps every kind onto six
 *     colours (made / agent work / trouble / money / access / system) and the row carries its
 *     category as a class, so the home card and the history page colour their dots from one rule.
 *   v2.0.0 — 2026-08-18 — The four room cards (Rooms, RoomMenu) are gone with the home's turn into
 *     a status view: the choosing the rooms staged is carried by the chat now, and a component no
 *     screen renders is a copy waiting to drift. The feed, the only part of the finished home a
 *     real owner called inviting, is what this file is.
 *   v1.2.0 — 2026-08-17 — The card shows six rows and offers the rest. A feed that scrolls past a
 *     screen has stopped being a glance, and the record is now long enough to need its own page:
 *     history.js reads the full window and the archive, and shares FeedRow so the two cannot drift.
 *   v1.1.0 — 2026-08-16 — Quiet is information too: when nothing has happened for a few days the
 *     feed says so and offers the next move (the chat), because an empty stretch is the strongest
 *     hint to go make an event rather than wait for one.
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 6–7).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A short, human "when". Exact timestamps are for logs; a feed answers "recently or not". */
function when(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const min = Math.floor(ms / 60000);
  if (min < 1) return tr('home.feed.justNow', 'just now');
  if (min < 60) return tr('home.feed.minutesAgo', '{n} min ago').replace('{n}', String(min));
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return tr('home.feed.hoursAgo', '{n} h ago').replace('{n}', String(hrs));
  const days = Math.floor(hrs / 24);
  return tr('home.feed.daysAgo', '{n} d ago').replace('{n}', String(days));
}

/**
 * The sentence for one row. Built from a key so the node never decides which language to speak.
 *
 * AN APP'S OWN KIND IS NOT TRANSLATED, AND MUST NOT BE INVENTED. `app:{appId}:{kind}` is a key only
 * the app knows the wording for; the node has no string for it and guessing one would put words in
 * somebody else's mouth. So the row says which app recorded it and what it called the thing, and
 * the app passes `app` in `data` when its display name differs from its id. Dropping these instead
 * would make every row an app wrote invisible, which is the opposite of why apps can write here.
 */
export function line(item) {
  const d = item.data || {};
  if (typeof item.kind === 'string' && item.kind.startsWith('app:')) {
    const [, appId, ...rest] = item.kind.split(':');
    const what = rest.join(':').replace(/_/g, ' ').trim();
    const who = d.app || appId;
    return what ? `${who}: ${what}` : who;
  }
  switch (item.kind) {
    case 'account_created':
      return tr('home.feed.accountCreated', 'Your home exists.');
    case 'welcome_mat':
      return tr('home.feed.welcomeMat', 'You made your welcome mat. Look at it.');
    case 'agent_knocking':
      return tr('home.feed.agentKnocking', 'Your agent is knocking at the door.');
    case 'agent_connected':
      return d.name
        ? tr('home.feed.agentConnectedNamed', '{name} is home.').replace('{name}', d.name)
        : tr('home.feed.agentConnected', 'Your agent is home.');
    case 'home_initialized':
      return tr('home.feed.homeReady', 'Your home is up and running.');
    case 'room_entered':
      return tr(`home.rooms.${d.room}.entered`, 'You started something new.');

    // ── Recorded events (services/account-events.ts). Same contract as the derived rows above:
    // the server sends a key, the sentence is built here, so the node never decides which
    // language the person reads.
    case 'agent_removed':
      return tr('home.feed.agentRemoved', '{name} is no longer connected.').replace('{name}', d.agent || d.name || '');
    case 'agent_task_done':
      return d.title
        ? tr('home.feed.taskDoneTitled', '{agent} finished: {title}').replace('{agent}', d.agent || '').replace('{title}', d.title)
        : tr('home.feed.taskDone', '{agent} finished a task.').replace('{agent}', d.agent || '');
    case 'agent_task_failed':
      return d.title
        ? tr('home.feed.taskFailedTitled', '{agent} could not finish: {title}').replace('{agent}', d.agent || '').replace('{title}', d.title)
        : tr('home.feed.taskFailed', '{agent} could not finish a task.').replace('{agent}', d.agent || '');
    case 'app_published':
      return tr('home.feed.appPublished', 'You published {name}.').replace('{name}', d.name || '');
    case 'app_updated':
      return tr('home.feed.appUpdated', 'You updated {name}.').replace('{name}', d.name || '');
    case 'workspace_record_published':
      return tr('home.feed.recordPublished', 'You published {name}.').replace('{name}', d.name || '');
    case 'organism_joined':
      return tr('home.feed.organismJoined', 'You joined {name}.').replace('{name}', d.name || '');
    case 'organism_left':
      return tr('home.feed.organismLeft', 'You left {name}.').replace('{name}', d.name || '');
    case 'organism_member_joined':
      return tr('home.feed.memberJoined', '{who} joined {name}.').replace('{who}', d.who || '').replace('{name}', d.name || '');
    case 'skill_installed':
      return d.agent
        ? tr('home.feed.skillInstalledFor', '{agent} can now do {name}.').replace('{agent}', d.agent).replace('{name}', d.name || '')
        : tr('home.feed.skillInstalled', 'You installed the skill {name}.').replace('{name}', d.name || '');
    case 'extension_installed':
      return tr('home.feed.extensionInstalled', 'You installed the extension {name}.').replace('{name}', d.name || '');
    case 'payment_received':
      return tr('home.feed.paymentReceived', 'You were paid {amount}.').replace('{amount}', d.amount || '');
    case 'payment_sent':
      return tr('home.feed.paymentSent', 'You paid {amount}.').replace('{amount}', d.amount || '');
    case 'contract_started':
      return tr('home.feed.contractStarted', 'A contract started: {name}.').replace('{name}', d.name || '');
    case 'contract_ended':
      return tr('home.feed.contractEnded', 'A contract ended: {name}.').replace('{name}', d.name || '');
    case 'app_granted':
      return tr('home.feed.appGranted', 'You gave {name} access.').replace('{name}', d.name || '');
    case 'app_revoked':
      return tr('home.feed.appRevoked', 'You took {name} access away.').replace('{name}', d.name || '');
    case 'ai_budget_reached':
      return tr('home.feed.aiBudgetReached', 'Your AI budget for the day is used up.');

    // Workflows
    case 'workflow_created':
      return tr('home.feed.workflowCreated', 'You created the workflow {name}.').replace('{name}', d.name || '');
    case 'workflow_updated':
      return tr('home.feed.workflowUpdated', 'You changed the workflow {name}.').replace('{name}', d.name || '');
    case 'workflow_deleted':
      return tr('home.feed.workflowDeleted', 'You deleted the workflow {name}.').replace('{name}', d.name || '');
    case 'workflow_run_started':
      return tr('home.feed.workflowRunStarted', '{name} started running.').replace('{name}', d.name || '');
    case 'workflow_run_finished':
      return tr('home.feed.workflowRunFinished', '{name} finished its run.').replace('{name}', d.name || '');
    case 'workflow_run_failed':
      return tr('home.feed.workflowRunFailed', '{name} stopped without finishing.').replace('{name}', d.name || '');

    // Apps doing work
    case 'app_tool_first_use':
      return tr('home.feed.toolFirstUse', '{app} used {tool} for the first time.')
        .replace('{app}', d.app || '').replace('{tool}', d.tool || '');
    case 'app_tool_paid':
      return tr('home.feed.toolPaid', '{app} paid {amount} to use {tool}.')
        .replace('{app}', d.app || '').replace('{amount}', d.amount || '').replace('{tool}', d.tool || '');

    // Money
    case 'checkout_completed':
      return tr('home.feed.checkoutCompleted', 'You bought {what} for {amount}.')
        .replace('{what}', d.what || '').replace('{amount}', d.amount || '');
    case 'checkout_cancelled':
      return tr('home.feed.checkoutCancelled', 'You cancelled a purchase.');

    // AI
    case 'ai_spend_daily':
      return tr('home.feed.aiSpendDaily', 'AI cost you {amount} on {day}.')
        .replace('{amount}', d.amount || '').replace('{day}', d.day || '');
    case 'ai_key_changed':
      return tr('home.feed.aiKeyChanged', 'You set your AI key.');
    case 'ai_settings_changed':
      return tr('home.feed.aiSettingsChanged', 'You changed your AI settings: {changed}.').replace('{changed}', d.changed || '');

    // Consent
    case 'consent_granted':
      return tr('home.feed.consentGranted', 'You gave {who} access to {what}.')
        .replace('{who}', d.who || '').replace('{what}', d.what || '');
    case 'consent_revoked':
      return tr('home.feed.consentRevoked', 'You took {who} access to {what} away.')
        .replace('{who}', d.who || '').replace('{what}', d.what || '');
    default:
      // A kind this build does not know renders nothing rather than a blank bullet — a row with no
      // sentence reads as a broken feed, and an older client meeting a newer server should degrade
      // to silence, not to damage.
      return '';
  }
}

/**
 * Which of six colours one event kind carries on the timeline. Categories, not kinds: a person
 * scanning the trunk asks "did my agents work, did anything break, did money move" — not which of
 * forty kinds a dot is. An app's own kind (app:*) is an app doing work, so it reads as agent work.
 */
export function kindCategory(kind) {
  const k = String(kind || '');
  if (k.startsWith('app:')) return 'agent';
  if (['welcome_mat', 'app_published', 'app_updated', 'workspace_record_published',
    'workflow_created', 'workflow_updated', 'workflow_deleted', 'skill_installed',
    'extension_installed'].includes(k)) return 'made';
  if (['agent_connected', 'agent_knocking', 'agent_task_done', 'workflow_run_started',
    'workflow_run_finished', 'app_tool_first_use'].includes(k)) return 'agent';
  if (['agent_task_failed', 'workflow_run_failed', 'ai_budget_reached', 'checkout_cancelled',
    'agent_removed'].includes(k)) return 'trouble';
  if (['payment_received', 'payment_sent', 'checkout_completed', 'app_tool_paid', 'ai_spend_daily',
    'contract_started', 'contract_ended'].includes(k)) return 'money';
  if (['consent_granted', 'consent_revoked', 'app_granted', 'app_revoked', 'organism_joined',
    'organism_left', 'organism_member_joined'].includes(k)) return 'access';
  return 'system';
}

/** After this many days without an event, the feed stops pretending silence is neutral. */
const QUIET_AFTER_DAYS = 3;

/** How many rows the home card shows before it offers the rest. */
const CARD_ROWS = 6;

/** One row. Shared by the card and the full view, so the two cannot drift in how they read. */
export function FeedRow({ item }) {
  const text = line(item);
  if (!text) return null;
  return html`
    <li class="koti-feed-item koti-feed-item--${kindCategory(item.kind)} ${item.kind === 'agent_knocking' ? 'koti-feed-item-live' : ''}">
      <span class="koti-feed-dot" aria-hidden="true"></span>
      <div class="koti-feed-body">
        ${item.link
          ? html`<a class="koti-feed-line" href=${item.link}>${text}</a>`
          : html`<span class="koti-feed-line">${text}</span>`}
        <span class="koti-feed-when">${when(item.at)}</span>
      </div>
    </li>`;
}

/** `band`: on the finished home the feed is one of the ruled bands; the onboarding home has none. */
export function HomeFeed({ items, band }) {
  if (!items || !items.length) return null;
  // Quiet is information too. The newest event's age decides: past the threshold, the feed opens
  // with an invitation to go make an event instead of a list that ends three days ago.
  const newestAt = items.reduce((m, it) => Math.max(m, Date.parse(it.at) || 0), 0);
  const quiet = newestAt > 0 && (Date.now() - newestAt) > QUIET_AFTER_DAYS * 86400000;
  const shown = items.filter(it => line(it));
  return html`
    <section class="koti-feed ${band ? 'koti-band' : ''}">
      <h2 class="koti-band-title">${tr('home.feed.title', 'What has happened')}</h2>
      ${quiet && html`
        <a class="koti-feed-quiet" href="/v1/chat">
          ${tr('home.feed.quiet', 'Quiet here lately. Shall we make something happen? Open the chat and say what you need.')}
        </a>`}
      <ul class="koti-feed-list">
        ${shown.slice(0, CARD_ROWS).map((item, i) => html`<${FeedRow} item=${item} key=${i} />`)}
      </ul>
      ${/* The card is a glance, not an archive. The door to everything only appears when there IS
           more than a glance — a "see all" under six rows offers a page that shows the same six. */''}
      ${shown.length > CARD_ROWS && html`
        <a class="koti-feed-more" href="/v1/home?history=1">
          ${tr('home.feed.seeAll', 'See everything that has happened')}
        </a>`}
    </section>`;
}
