/**
 * @file public/views/home/status-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The finished home's status pieces: the mailbox row, the fleet line, the chat door,
 *   what you have made (with stars and a fold), your apps, and the achievements strip. Split out of
 *   index.js when the status view grew past what one file should hold; index.js stays the
 *   orchestrator and this file owns what each piece looks like.
 *
 *   Two rules run through every piece. Nothing here renders when it has nothing to say — an empty
 *   inventory reads as broken. And at a real account's scale (30 shared spaces, 141 apps) nothing
 *   spills: the person stars what matters, the rest folds away, and the fold says how much it
 *   holds. The first version showed every chip it had, which on the developer's own account was
 *   the wall of noise this file exists to prevent.
 * @structure MailboxRow · FleetLine · ChatDoor · Things · FavoriteApps · Achievements
 * @usage import { MailboxRow, FleetLine, ChatDoor, Things, FavoriteApps, Achievements } from '/views/home/status-parts.js';
 * @version-history
 *   v1.1.0 — 2026-08-19 — Jouni's prod round: the mailbox opens ?tab=messages (tab=inbox was a
 *     guessed id that 404-redirected — a link I shipped unchecked), app chips say the app's NAME
 *     with the .html stripped, and FavoriteApps reads the complete own-apps list (index.js now
 *     paginates via services/apps listApps) so a >200-app node cannot page the owner's own apps
 *     out of existence.
 *   v1.0.0 — 2026-08-18 — Extracted ChatDoor/Things/Achievements from index.js; added the mailbox
 *     row (flag up when unread waits), the fleet line replacing the single-agent hero card, stars +
 *     fold on spaces and packages, the plain-language knowledge framing, and the favourite-apps row
 *     with the remembered saved/used switch.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { listRecents } from '/js/recents.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** How many unstarred rows a folded list shows before the fold. */
const FOLD_AFTER = 3;

/**
 * The mailbox on the wall: flag up when something unread waits, and one line saying how much.
 * Renders only when the count is known — a mailbox that cannot be read is not shown broken.
 */
export function MailboxRow({ mail }) {
  if (!mail) return null;
  const unread = mail.unread ?? 0;
  return html`
    <a class="koti-mailbox ${unread > 0 ? 'koti-mailbox--full' : ''}" href="/v1/profile?tab=messages">
      <span class="koti-mailbox-icon" aria-hidden="true">${unread > 0 ? '📬' : '📪'}</span>
      <span class="koti-mailbox-text">
        ${unread > 0
          ? tr('home.mail.unread', '{n} unread — go have a look').replace('{n}', String(unread))
          : tr('home.mail.empty', 'Mailbox — nothing new')}
      </span>
    </a>`;
}

/**
 * The fleet, as ONE line. The hero card this replaces surfaced the single WORST agent by name,
 * which on an 86-agent account made a snag the first sentence of the home. The line says how many
 * are home and how many need a look; the names live on the Agents tab, where looking happens.
 */
export function FleetLine({ agent }) {
  if (!agent) return null;
  const total = agent.total ?? 1;
  const problems = agent.problems ?? 0;
  const ok = problems === 0;
  return html`
    <a class="koti-fleet ${ok ? 'koti-fleet--ok' : 'koti-fleet--trouble'}" href="/v1/profile?tab=agents">
      <span class="koti-fleet-dot" aria-hidden="true"></span>
      <span>
        ${total === 1
          ? (ok
            ? tr('home.fleet.oneOk', 'Your agent is home and well.')
            : tr('home.fleet.oneTrouble', 'Your agent {name} needs a look.').replace('{name}', agent.name || ''))
          : (ok
            ? tr('home.fleet.allOk', '{total} agents home, all well.').replace('{total}', String(total))
            : tr('home.fleet.trouble', '{total} agents home · {n} need a look').replace('{total}', String(total)).replace('{n}', String(problems)))}
      </span>
    </a>`;
}

/**
 * One clear door to where the work actually happens, and WHICH MIND answers there. A person whose
 * own AI (Claude, ChatGPT...) is connected over MCP is told that; otherwise the house chat's model
 * is named, because "some AI" is exactly the vagueness people distrust. At most two platforms are
 * named — a five-name list with "Unknown" in it answered nothing.
 */
export function ChatDoor({ chatStatus, mcpNames }) {
  const names = (mcpNames ?? []).filter((n) => n && !/^unknown$/i.test(n));
  let ai = '';
  if (names.length === 1) {
    ai = tr('home.ai.viaMcp', '{names} is connected as your agent over MCP.').replace('{names}', names[0]);
  } else if (names.length > 1) {
    const shown = names.slice(0, 2).join(', ');
    const extra = names.length - 2;
    const list = extra > 0
      ? tr('home.ai.andMore', '{names} and {n} more').replace('{names}', shown).replace('{n}', String(extra))
      : shown;
    ai = tr('home.ai.viaMcpMany', '{names} are connected as your agents over MCP.').replace('{names}', list);
  } else if (chatStatus?.enabled && chatStatus?.model) {
    ai = tr('home.ai.houseModel', 'The house chat answers with {model}.').replace('{model}', chatStatus.model);
  }
  return html`
    <section class="koti-chatdoor">
      <div class="koti-chatdoor-text">
        <p class="koti-chatdoor-lede">
          ${tr('home.chatDoor.lede', 'Your agent is in the chat. Say what you need, and it gets to work.')}
        </p>
        ${ai && html`<p class="koti-chatdoor-ai">${ai}</p>`}
      </div>
      <a class="btn-primary koti-chatdoor-cta" href="/v1/chat">
        ${tr('home.chatDoor.cta', 'Continue in the chat')}
      </a>
    </section>`;
}

/**
 * One starrable, foldable chip list. Starred rows always show, then the newest unstarred up to the
 * fold; the fold names how many it hides. The star is the person's own mark, kept in home.prefs —
 * starring is how "always show this one" is said without a settings page.
 */
function ChipRow({ label, rows, starred, onStar, fold }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const isStar = (id) => starred.includes(id);
  const stars = rows.filter((r) => isStar(r.id));
  const rest = rows.filter((r) => !isStar(r.id));
  const shown = open ? [...stars, ...rest] : [...stars, ...rest.slice(0, Math.max(0, fold - stars.length))];
  const hidden = rows.length - shown.length;
  return html`
    <div class="koti-things-row koti-things-named">
      <span class="koti-things-cat">${label}</span>
      ${shown.map((r) => html`
        <span class="koti-thing koti-thing--named" key=${r.id}>
          <a class="koti-thing-door" href=${r.href}>
            <span class="koti-thing-label">${r.name}</span>
            ${typeof r.n === 'number' && r.n > 0 && html`<span class="koti-thing-n">${r.n}</span>`}
          </a>
          <button type="button" class="koti-star ${isStar(r.id) ? 'koti-star--on' : ''}"
            aria-pressed=${isStar(r.id)}
            title=${tr('home.things.star', 'Keep this one always visible')}
            onClick=${() => onStar(r.id)}>${isStar(r.id) ? '★' : '☆'}</button>
        </span>`)}
      ${hidden > 0 && html`
        <button type="button" class="koti-fold" onClick=${() => setOpen(true)}>
          ${tr('home.things.showAll', 'Show all ({n})').replace('{n}', String(rows.length))}
        </button>`}
      ${open && rows.length > fold && html`
        <button type="button" class="koti-fold" onClick=${() => setOpen(false)}>
          ${tr('home.things.showLess', 'Show less')}
        </button>`}
    </div>`;
}

/** Newest-first by the row's own updated stamp; rows with no stamp keep their input order. */
function byUpdated(rows) {
  return [...rows].sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0));
}

/**
 * What the person has made here. Counts as doors, then the shared spaces they belong to and the
 * knowledge they structured, BY NAME — a count says you have things somewhere, a name says which.
 * Every chip opens the thing itself, not a tab that merely contains it.
 */
export function Things({ usage, orgs, packages, prefs, onStar }) {
  const rows = [
    { n: usage?.counts?.apps?.used, key: 'home.things.apps', fallback: 'Apps', href: '/v1/profile?tab=apps' },
    { n: usage?.memory?.used_keys, key: 'home.things.memory', fallback: 'Notes and records', href: '/v1/profile?tab=memory' },
    { n: usage?.storage?.used_files, key: 'home.things.files', fallback: 'Files', href: '/v1/profile?tab=memory' },
  ].filter((r) => typeof r.n === 'number' && r.n > 0);
  const orgRows = byUpdated((orgs ?? []).map((o) => ({
    id: 'org:' + o.id, name: o.name, n: o.workspace_count, updatedAt: o.updatedAt,
    href: `/v1/profile?tab=organisms&org=${encodeURIComponent(o.id)}`,
  })));
  const pkgRows = byUpdated((packages ?? []).map((p) => ({
    id: 'pkg:' + p.key, name: p.name, updatedAt: p.updatedAt,
    href: '/v1/profile?tab=knowledge',
  })));
  if (!rows.length && !orgRows.length && !pkgRows.length) return null;
  const starred = prefs?.stars ?? [];
  return html`
    <section class="koti-things">
      <h2 class="koti-feed-title">${tr('home.things.title', 'What you have made')}</h2>
      ${rows.length > 0 && html`
        <div class="koti-things-row">
          ${rows.map((r) => html`
            <a class="koti-thing" key=${r.key} href=${r.href}>
              <span class="koti-thing-n">${r.n}</span>
              <span class="koti-thing-label">${tr(r.key, r.fallback)}</span>
            </a>`)}
        </div>`}
      <${ChipRow} label=${tr('home.things.organisms', 'Shared spaces')} rows=${orgRows}
        starred=${starred} onStar=${onStar} fold=${FOLD_AFTER} />
      ${pkgRows.length > 0 && html`
        <p class="koti-things-explain">
          ${tr('home.things.knowledgeExplain', 'Structured knowledge: what you have organised out of your AI chats, for your AIs, your apps and — when you choose — other people to use.')}
        </p>`}
      <${ChipRow} label=${tr('home.things.knowledge', 'Structured knowledge')} rows=${pkgRows}
        starred=${starred} onStar=${onStar} fold=${FOLD_AFTER} />
    </section>`;
}

/**
 * The apps the person actually reaches for. Favourites from the catalogue's own star (the
 * app-catalog.favorites record) when any exist; otherwise the newest of their own — by last save
 * (server, same everywhere) or last open (this device), and WHICH of those two is a remembered
 * choice, not a decision re-made per visit.
 */
export function FavoriteApps({ apps, favorites, owner, prefs, onMode }) {
  const mode = prefs?.appsRecency === 'used' ? 'used' : 'saved';
  const favRefs = favorites?.refs ?? [];
  const appUrl = (o, f) => `/v1/apps/${encodeURIComponent(o)}/${encodeURIComponent(f)}?mode=inline`;
  // A chip says the app's NAME. "archimate.html" on a chip reads as a file listing, not a home.
  const appName = (a, filename) =>
    String(a?.manifest?.name || a?.name || a?.title || filename || '').replace(/.html?$/i, '');
  let rows;
  let title = tr('home.apps.title', 'Your apps');
  if (favRefs.length > 0) {
    title = tr('home.apps.favTitle', 'Your favourite apps');
    rows = favRefs.map((ref) => {
      const [o, ...rest] = String(ref).split('/');
      const f = rest.join('/');
      const match = (apps ?? []).find((a) => (a.owner || a.owner_name) === o && a.filename === f);
      return { id: ref, name: match?.name || match?.title || f.replace(/\.html?$/, ''), href: appUrl(o, f) };
    });
  } else if (mode === 'used') {
    rows = listRecents(12).filter((r) => r.type === 'app').slice(0, 6).map((r) => {
      const [o, ...rest] = String(r.id).split('/');
      return { id: r.id, name: r.label || r.id, href: appUrl(o, rest.join('/')) };
    });
  } else {
    rows = byUpdated((apps ?? []).filter((a) => (a.owner || a.owner_name) === owner)
      .map((a) => ({ id: `${owner}/${a.filename}`, name: appName(a, a.filename), updatedAt: a.updated_at || a.created_at, href: appUrl(owner, a.filename) })))
      .slice(0, 6);
  }
  if (!rows.length) return null;
  return html`
    <section class="koti-things koti-apps">
      <h2 class="koti-feed-title">${title}</h2>
      <div class="koti-things-row">
        ${rows.map((r) => html`
          <a class="koti-thing koti-thing--named" key=${r.id} href=${r.href} target="_blank" rel="noopener">
            <span class="koti-thing-label">${r.name}</span>
          </a>`)}
        ${favRefs.length === 0 && html`
          <span class="koti-apps-mode" role="group" aria-label=${tr('home.apps.modeLabel', 'Which apps to show')}>
            <button type="button" class="koti-fold ${mode === 'saved' ? 'koti-fold--on' : ''}"
              onClick=${() => onMode('saved')}>${tr('home.apps.saved', 'Last saved')}</button>
            <button type="button" class="koti-fold ${mode === 'used' ? 'koti-fold--on' : ''}"
              onClick=${() => onMode('used')}>${tr('home.apps.used', 'Last opened')}</button>
          </span>`}
      </div>
    </section>`;
}

/**
 * What has been tried here, and the doors to what has not. Every row is DERIVED from the account's
 * real state (the funnel markers, the usage counts, the chat status) rather than stored — an
 * achievement that can drift from the thing it celebrates is a lie waiting to happen. The one
 * exception is the Experience Center, which the node cannot observe: its chip marks itself when
 * the person goes. Hidden entirely by the settings toggle (home.prefs.hideAchievements).
 */
export function Achievements({ state, usage, markers, chatStatus, orgs, packages, prefs, onTried }) {
  if (prefs?.hideAchievements) return null;
  const has = (k) => !!markers?.has(k);
  const list = [
    { id: 'mat', done: !!state.mat?.done, key: 'home.ach.mat', fallback: 'Welcome mat up', href: '/v1/home' },
    { id: 'agent', done: !!state.agent, key: 'home.ach.agent', fallback: 'Agent home', href: '/v1/profile?tab=agents' },
    { id: 'chat', done: has('onboarding.first_chat_turn'), key: 'home.ach.chat', fallback: 'First conversation', href: '/v1/chat' },
    { id: 'mcp', done: has('onboarding.first_mcp_call') || has('onboarding.hello_mcp'), key: 'home.ach.mcp', fallback: 'Your own AI connected', href: '/v1/profile?tab=mcp' },
    { id: 'ownkey', done: !!chatStatus?.has_own_key, key: 'home.ach.ownkey', fallback: 'Your own AI key', href: '/v1/profile?tab=generator' },
    { id: 'app', done: (usage?.counts?.apps?.used ?? 0) > 0, key: 'home.ach.app', fallback: 'App published', href: '/app-catalog.html' },
    { id: 'space', done: (orgs?.length ?? 0) > 0, key: 'home.ach.space', fallback: 'In a shared space', href: '/v1/profile?tab=organisms' },
    { id: 'knowledge', done: (packages?.length ?? 0) > 0, key: 'home.ach.knowledge', fallback: 'Knowledge package made', href: '/v1/profile?tab=knowledge' },
    { id: 'experience', done: !!prefs?.tried?.experience, key: 'home.ach.experience', fallback: 'Experience Center visited',
      href: 'https://experience-center.apps.aimeat.io', external: true },
  ];
  return html`
    <section class="koti-ach">
      <h2 class="koti-feed-title">${tr('home.ach.title', 'Achievements')}</h2>
      <div class="koti-things-row">
        ${list.map((a) => html`
          <a class="koti-ach-chip ${a.done ? 'koti-ach-chip--done' : ''}" key=${a.id} href=${a.href}
             target=${a.external ? '_blank' : undefined} rel=${a.external ? 'noopener' : undefined}
             onClick=${a.id === 'experience' && !a.done ? () => onTried('experience') : undefined}>
            <span class="koti-ach-mark" aria-hidden="true">${a.done ? '✓' : '·'}</span>
            ${tr(a.key, a.fallback)}
          </a>`)}
      </div>
    </section>`;
}
