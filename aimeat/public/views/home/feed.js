/**
 * @file public/views/home/feed.js
 * @description What has happened on this home (aimeat_remake/06-koti-feed-suostumus.md), and the
 *   four rooms (07-nelja-huonetta.md).
 *
 *   The feed reads the same markers the operator funnel reads, so the screen and the numbers cannot
 *   tell two different stories about the same account. Its FIRST row exists before the person has
 *   done anything — the account being created is a real event, and an empty feed on a brand-new
 *   account reads as broken.
 *
 *   The rooms are ROOMS, never "paths". Each card carries a third line saying what happens FIRST if
 *   you go in, because without it they are four abstract words and a person picks by guessing. A
 *   card appears only for a room the node actually has (E11) — the server decides that and sends
 *   the list; this file renders what it is given.
 * @structure HomeFeed({ items }) · Rooms({ rooms, onEnter }) · FeedRow({ item }) · line · when
 * @usage import { HomeFeed, Rooms } from './feed.js';
 * @version-history
 *   v1.2.0 — 2026-08-17 — The card shows six rows and offers the rest. A feed that scrolls past a
 *     screen has stopped being a glance, and the record is now long enough to need its own page:
 *     history.js reads the full window and the archive, and shares FeedRow so the two cannot drift.
 *   v1.1.0 — 2026-08-16 — Quiet is information too: when nothing has happened for a few days the
 *     feed says so and offers the next move (the chat), because an empty stretch is the strongest
 *     hint to go make an event rather than wait for one.
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 6–7).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

import { CardMenu } from '/components/CardMenu.js';
import { listOpenItems, addOpenItem, switchOff } from '/js/services/open-items.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

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

/** After this many days without an event, the feed stops pretending silence is neutral. */
const QUIET_AFTER_DAYS = 3;

/** How many rows the home card shows before it offers the rest. */
const CARD_ROWS = 6;

/** One row. Shared by the card and the full view, so the two cannot drift in how they read. */
export function FeedRow({ item }) {
  const text = line(item);
  if (!text) return null;
  return html`
    <li class="koti-feed-item ${item.kind === 'agent_knocking' ? 'koti-feed-item-live' : ''}">
      <span class="koti-feed-dot" aria-hidden="true"></span>
      <div class="koti-feed-body">
        ${item.link
          ? html`<a class="koti-feed-line" href=${item.link}>${text}</a>`
          : html`<span class="koti-feed-line">${text}</span>`}
        <span class="koti-feed-when">${when(item.at)}</span>
      </div>
    </li>`;
}

export function HomeFeed({ items }) {
  if (!items || !items.length) return null;
  // Quiet is information too. The newest event's age decides: past the threshold, the feed opens
  // with an invitation to go make an event instead of a list that ends three days ago.
  const newestAt = items.reduce((m, it) => Math.max(m, Date.parse(it.at) || 0), 0);
  const quiet = newestAt > 0 && (Date.now() - newestAt) > QUIET_AFTER_DAYS * 86400000;
  const shown = items.filter(it => line(it));
  return html`
    <section class="koti-feed">
      <h2 class="koti-feed-title">${tr('home.feed.title', 'What has happened')}</h2>
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

/**
 * The rooms where "later" is a real answer, and the node-served prompt that belongs to each.
 *
 * A closed list on purpose. Adding one means claiming that putting that room off produces
 * something an AI can hand back — which is true here and is not true of reading your own post.
 */
/**
 * The rooms whose work is a real thing you can put off, and what an item made from one IS.
 *
 * `kind` is not decoration. An item born here used to arrive with kind null and the card's own
 * words as its title, and the skill that works these lists is forbidden to guess a kind from a
 * title — so every such item cost the person an interrogation before anything could happen. The
 * card knows what it makes. It says so.
 */
const SAVEABLE_ROOMS = {
  create: { promptRef: 'build-app', titleKey: 'home.rooms.create.title', kind: 'app' },
  organise: { promptRef: 'organism-setup', titleKey: 'home.rooms.organise.title', kind: 'organism' },
};

/**
 * The prompt block inside a room card: copy it now, look at it first, put it off, or hand it over.
 *
 * ONE primary control — "Copy the prompt" — with the state control beside it. That order is the
 * whole point: copying is what people came to do.
 *
 * The dots in the top right corner are the SAME control every other card uses (CardMenu), in the
 * same corner, and their colour is this room's state. One corner learned once, and then every card
 * in the product answers to it. What used to be here was a grey box repeating the card's own
 * heading with a "Copy the prompt" button under it, and a naked 10px dot floating in the whitespace
 * below that.
 *
 * The prompt is one of the menu's rows rather than a button of its own.
 */
function RoomMenu({ room }) {
  const cfg = SAVEABLE_ROOMS[room.id] ?? { promptRef: null, kind: null };
  const title = tr(`home.rooms.${room.id}.title`, room.id);
  const origin = `home.rooms.${room.id}`;
  const [prompt, setPrompt] = useState('');
  const [item, setItem] = useState(null);

  useEffect(() => {
    if (!cfg.promptRef) return undefined;
    let alive = true;
    apiGet(`/v1/prompts/${cfg.promptRef}`)
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('home/rooms: prompt fetch', e));
    return () => { alive = false; };
  }, [cfg.promptRef]);

  const find = useCallback(async () => {
    try {
      const list = await listOpenItems();
      setItem(list.find(i => i.origin === origin) ?? null);
    } catch (e) { swallowed('home/rooms: open items', e); }
  }, [origin]);

  useEffect(() => { find(); }, [find]);
  useEffect(() => {
    const handler = () => find();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [find]);

  const state = item?.status === 'working' ? 'working' : item ? 'open' : 'off';
  const actions = [
    // The copy row only exists for a room the node serves a prompt for. The dots themselves exist
    // on every card: the mat card tells a person "every card has them, always in that same corner",
    // and three of five rooms having none made that sentence false on its own screen.
    ...(prompt ? [{
      label: tr('home.rooms.copyPrompt', 'Copy this into your AI chat'),
      doneLabel: tr('home.rooms.copied', 'Copied — paste it in your AI chat'),
      done: true,
      run: async () => { try { await navigator.clipboard.writeText(prompt); } catch (e) { swallowed('home/rooms: copy', e); } },
    }] : []),
    {
      label: item
        ? tr('openItems.toggleOff', 'Take it off your open items')
        : tr('openItems.toggleOn', 'Put it on your open items'),
      run: async () => {
        if (item) { await switchOff(item.id); setItem(null); }
        else { setItem(await addOpenItem({ title, prompt_ref: cfg.promptRef, origin })); }
      },
    },
  ];

  return html`<${CardMenu} state=${state} actions=${actions} label=${title} />`;
}

export function Rooms({ rooms, onEnter }) {
  // No agent list here. A room card once offered "Give it to <name>" as one menu row per agent,
  // and on an account with seventy of them that is a wall of rows in a card about making an app.
  // Handing work to an agent belongs where the agents are, not inside a prompt.

  if (!rooms || !rooms.length) return null;
  return html`
    <section class="koti-rooms">
      <h2 class="koti-feed-title">${tr('home.rooms.title', 'What would you like to do?')}</h2>
      <div class="koti-rooms-grid">
        ${rooms.map(room => html`
          <a class="koti-room" key=${room.id} href=${room.url}
             onClick=${(e) => {
               // stopPropagation as well as preventDefault: the SPA has a delegated handler that
               // client-side-navigates any /v1/ link, and it would race this one — the card ended
               // up on the portal instead of its own destination.
               e.preventDefault();
               e.stopPropagation();
               onEnter(room);
             }}>
            <span class="koti-room-title">${tr(`home.rooms.${room.id}.title`, room.id)}</span>
            <span class="koti-room-what">${tr(`home.rooms.${room.id}.what`, '')}</span>
            ${/* The third line. Without it these are four abstract words and people pick at random. */''}
            <span class="koti-room-next">${tr(`home.rooms.${room.id}.next`, '')}</span>
            ${/* Two rooms only, on purpose: these are the ones where putting it off is a real
                 answer and the node already serves the prompt. `monetise` promises a UI journey
                 that produces no object, and `messages` is your own post — neither is something
                 an AI hands back later. */''}
            <${RoomMenu} room=${room} />
          </a>`)}
      </div>
    </section>`;
}
