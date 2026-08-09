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
 * @structure HomeFeed({ items }) · Rooms({ rooms, onEnter })
 * @usage import { HomeFeed, Rooms } from './feed.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phases 6–7).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { reachableAgents, handToAgent } from '/js/services/open-items.js';
import { OpenItemToggle } from '/components/OpenItemToggle.js';
import { apiGet } from '/js/api.js';
import { PromptCard } from '/components/PromptCard.js';
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

/** The sentence for one row. Built from a key so the node never decides which language to speak. */
function line(item) {
  const d = item.data || {};
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
    default:
      return '';
  }
}

export function HomeFeed({ items }) {
  if (!items || !items.length) return null;
  return html`
    <section class="koti-feed">
      <h2 class="koti-feed-title">${tr('home.feed.title', 'What has happened')}</h2>
      <ul class="koti-feed-list">
        ${items.map((item, i) => html`
          <li class="koti-feed-item ${item.kind === 'agent_knocking' ? 'koti-feed-item-live' : ''}" key=${i}>
            <span class="koti-feed-dot" aria-hidden="true"></span>
            <div class="koti-feed-body">
              ${item.link
                ? html`<a class="koti-feed-line" href=${item.link}>${line(item)}</a>`
                : html`<span class="koti-feed-line">${line(item)}</span>`}
              <span class="koti-feed-when">${when(item.at)}</span>
            </div>
          </li>`)}
      </ul>
    </section>`;
}

/**
 * The rooms where "later" is a real answer, and the node-served prompt that belongs to each.
 *
 * A closed list on purpose. Adding one means claiming that putting that room off produces
 * something an AI can hand back — which is true here and is not true of reading your own post.
 */
const SAVEABLE_ROOMS = {
  create: { promptRef: 'build-app', titleKey: 'home.rooms.create.title' },
  organise: { promptRef: 'organism-setup', titleKey: 'home.rooms.organise.title' },
};

/**
 * The prompt block inside a room card: copy it now, look at it first, put it off, or hand it over.
 *
 * ONE primary control — "Copy the prompt" — with the state control beside it. That order is the
 * whole point: copying is what people came to do.
 *
 * The state control is the SAME component used everywhere else (OpenItemToggle), in the same place
 * both directions: switch it on here and it is on your open items, come back to this card and
 * switch it off and it is not. It replaced a menu row reading "save for later", which promised a
 * queue things go into and never come out of.
 *
 * The body starts hidden. A room card is a card, and "show the prompt" is one of the three rows.
 */
function RoomPrompt({ room, agents }) {
  const cfg = SAVEABLE_ROOMS[room.id];
  const [prompt, setPrompt] = useState('');

  // Fetched when the card appears, so the primary button stays ONE click. The text is never stored
  // in the intent — only its name — so this is also the only place it is ever read from.
  useEffect(() => {
    let alive = true;
    apiGet(`/v1/prompts/${cfg.promptRef}`)
      .then(r => { if (alive) setPrompt(r?.data?.prompt || ''); })
      .catch(e => swallowed('home/rooms: prompt fetch', e));
    return () => { alive = false; };
  }, [cfg.promptRef]);

  if (!prompt) return null;

  return html`
    <div class="koti-room-actions">
    <${PromptCard}
      label=${tr(`home.rooms.${room.id}.title`, room.id)}
      prompt=${prompt}
      className="btn-outline"
      copyLabel=${tr('home.rooms.copyPrompt', 'Copy the prompt')}
      copiedLabel=${tr('home.rooms.copied', 'Copied — paste it in your AI chat')}
      showPrompt=${false}
      extraActions=${[]}
      agents=${agents}
      onGiveToAgent=${(a) => handToAgent(
        { id: null, title: tr(`home.rooms.${room.id}.title`, room.id), prompt_ref: cfg.promptRef },
        a,
      )} />
    <${OpenItemToggle}
      title=${tr(`home.rooms.${room.id}.title`, room.id)}
      promptRef=${cfg.promptRef}
      origin=${`home.rooms.${room.id}`}
      size="sm" />
    </div>`;
}

export function Rooms({ rooms, onEnter }) {
  // Who could take this off your hands. Empty is the normal case and simply hides that row —
  // offering a name that never drains a queue is a graveyard.
  const [agents, setAgents] = useState([]);
  useEffect(() => {
    let alive = true;
    reachableAgents()
      .then(list => { if (alive) setAgents(list); })
      .catch(e => swallowed('home/rooms: agents', e));
    return () => { alive = false; };
  }, []);

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
            ${SAVEABLE_ROOMS[room.id] && html`<${RoomPrompt} room=${room} agents=${agents} />`}
          </a>`)}
      </div>
    </section>`;
}
