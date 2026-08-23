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
 * @structure MailboxRow · FleetLine · ChatDoor · NamedRow · Things · FavoriteApps · Playbooks · TrustLine · Achievements
 * @usage import { MailboxRow, FleetLine, ChatDoor, Things, FavoriteApps, Achievements } from '/views/home/status-parts.js';
 * @version-history
 *   v1.3.0 — 2026-08-23 — The home reads as bands. Things IS the "what you have made" band and
 *     takes the apps row as its child; every named row (spaces, knowledge, apps, tried-so-far)
 *     goes through one NamedRow frame — label left, content right — so they line up as a list;
 *     the knowledge explainer leaves the middle of the list for a tooltip on its label and one
 *     line at the band's foot; Achievements becomes a row inside the setup band (index.js),
 *     titled "Tried so far", instead of a fourth section nobody was looking for. Found on the
 *     way: "Last opened" on a device with no recents hid the whole apps row, switch included, so
 *     the remembered choice had no way back; the row now stays and says so.
 *   v1.2.0 — 2026-08-19 — Playbooks (folded outcomes with steps, live proof and both roads: the
 *     agent or your own AI) and TrustLine (AI labelling + data ownership, stated as what the
 *     system does).
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
import { swallowed } from '/js/swallowed.js';

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
 * One named row: the category word in a fixed left column, the content on the right. Every row
 * under a band title goes through this frame (spaces, knowledge, apps, tried so far), which is
 * what makes them line up as a list instead of reading as separate clouds. `title` is the
 * explainer that rides on the label as a tooltip, when the word alone is not enough.
 */
export function NamedRow({ label, title, className, children }) {
  return html`
    <div class="koti-row ${className || ''}">
      <span class="koti-things-cat koti-row-label" title=${title || undefined}>${label}</span>
      <div class="koti-things-row koti-row-body">${children}</div>
    </div>`;
}

/**
 * One starrable, foldable chip list. Starred rows always show, then the newest unstarred up to the
 * fold; the fold names how many it hides. The star is the person's own mark, kept in home.prefs —
 * starring is how "always show this one" is said without a settings page.
 */
function ChipRow({ label, title, rows, starred, onStar, fold }) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  const isStar = (id) => starred.includes(id);
  const stars = rows.filter((r) => isStar(r.id));
  const rest = rows.filter((r) => !isStar(r.id));
  const shown = open ? [...stars, ...rest] : [...stars, ...rest.slice(0, Math.max(0, fold - stars.length))];
  const hidden = rows.length - shown.length;
  return html`
    <${NamedRow} label=${label} title=${title}>
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
    <//>`;
}

/** Newest-first by the row's own updated stamp; rows with no stamp keep their input order. */
function byUpdated(rows) {
  return [...rows].sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0));
}

/**
 * What the person has made here: the "what you have made" BAND. Counts as doors, then the shared
 * spaces they belong to and the knowledge they structured, BY NAME — a count says you have things
 * somewhere, a name says which. Every chip opens the thing itself, not a tab that merely contains
 * it. `children` is the apps row (FavoriteApps), rendered as the last named row so the band is one
 * list; the knowledge explainer closes the band rather than cutting the list in half.
 */
export function Things({ usage, orgs, packages, prefs, onStar, children }) {
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
  const explain = tr('home.things.knowledgeExplain', 'Structured knowledge: what you have organised out of your AI chats, for your AIs, your apps and — when you choose — other people to use.');
  return html`
    <section class="koti-band koti-things">
      <h2 class="koti-band-title">${tr('home.things.title', 'What you have made')}</h2>
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
      <${ChipRow} label=${tr('home.things.knowledge', 'Structured knowledge')} title=${explain} rows=${pkgRows}
        starred=${starred} onStar=${onStar} fold=${FOLD_AFTER} />
      ${children}
      ${pkgRows.length > 0 && html`<p class="koti-things-explain">${explain}</p>`}
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
  // "Last opened" on a device that has opened nothing yet used to return null here, and with the
  // row went the switch that could bring "last saved" back: the choice was remembered and the
  // way out was gone. The row stays, says so, and keeps its switch.
  const noneOpened = !rows.length && favRefs.length === 0 && mode === 'used';
  if (!rows.length && !noneOpened) return null;
  // A named row inside the "what you have made" band (Things renders it as its child), in line
  // with the spaces and the knowledge above it rather than a section of its own.
  return html`
    <${NamedRow} label=${title}>
      ${noneOpened && html`<span class="koti-apps-none">${tr('home.apps.noneOpened', 'Nothing opened on this device yet.')}</span>`}
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
    <//>`;
}

/**
 * The playbooks: named outcomes, folded away until asked for.
 *
 * FOLDED IS THE POINT. The four rooms this replaces sat open at the top of the home and were
 * removed for it; a menu of things you have not done is noise until you go looking for one. So the
 * section is a heading and a row of names, and only the one you open shows its steps, its proof and
 * its two roads: hand it to the agent in the chat, or take the prompt to your own AI.
 *
 * The words come from locale keys the server never sees (home.playbooks.<id>.*), the availability
 * from the server (a playbook this node cannot deliver never arrives), and the proof links from the
 * node's own subdomain mappings.
 */
export function Playbooks({ playbooks, tour }) {
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(null);
  if (!playbooks?.length) return null;
  const askAgent = (pb) => {
    const ask = tr(`home.playbooks.${pb.id}.ask`, tr(`home.playbooks.${pb.id}.title`, pb.id));
    // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the pre-filled line
    try { sessionStorage.setItem('aimeat.wish', ask); } catch { /* the chat simply opens empty */ }
    window.location.href = '/v1/chat';
  };
  const copyPrompt = async (pb) => {
    try {
      const r = await fetch(`/v1/prompts/playbook/${encodeURIComponent(pb.id)}?format=txt`);
      await navigator.clipboard.writeText(await r.text());
      setCopied(pb.id);
      setTimeout(() => setCopied(null), 2500);
    } catch (e) { swallowed('playbooks: copy', e); }
  };
  // The band title ("What would you like to set up?") is the band's, drawn by index.js, so the
  // tried-so-far row beside this one sits under the same heading.
  return html`
    <div class="koti-pb">
      <p class="koti-pb-lead">${tr('home.playbooks.lead', 'Each one is a real thing you can do here, with the steps and the prompt that gets it done.')}</p>
      <div class="koti-things-row">
        ${playbooks.map((pb) => html`
          <button type="button" key=${pb.id}
            class="koti-fold ${open === pb.id ? 'koti-fold--on' : ''}"
            aria-expanded=${open === pb.id}
            onClick=${() => setOpen(open === pb.id ? null : pb.id)}>
            ${tr(`home.playbooks.${pb.id}.title`, pb.id)}
          </button>`)}
        ${tour && html`<a class="koti-pb-tour" href=${tour} target="_blank" rel="noopener">
          ${tr('home.playbooks.tour', 'Not sure what this can do? Take the tour →')}</a>`}
      </div>
      ${playbooks.filter((pb) => pb.id === open).map((pb) => html`
        <div class="koti-pb-open" key=${pb.id}>
          <p class="koti-pb-what">${tr(`home.playbooks.${pb.id}.lead`, '')}</p>
          <ol class="koti-pb-steps">
            ${Array.from({ length: pb.steps }, (_, i) => tr(`home.playbooks.${pb.id}.step${i + 1}`, ''))
              .filter(Boolean)
              .map((step, i) => html`<li key=${i}>${step}</li>`)}
          </ol>
          ${pb.proof?.length > 0 && html`
            <p class="koti-pb-proof">
              ${tr('home.playbooks.proof', 'Already running here:')}${' '}
              ${pb.proof.map((pr, i) => html`
                <${'span'} key=${pr.name}>${i > 0 ? ' · ' : ''}<a href=${pr.url} target="_blank" rel="noopener">${pr.name}</a><//>`)}
            </p>`}
          <div class="koti-pb-actions">
            ${/* The wish rail the landing page already uses (sessionStorage 'aimeat.wish'): the chat
                  drains it INTO THE COMPOSER and the person presses send themselves. A ?ask= query
                  param would have been a second contract, and the chat reads no such thing — a
                  button that navigates somewhere unprepared is the defect this avoids. */''}
            <button type="button" class="btn-primary" onClick=${() => askAgent(pb)}>
              ${tr('home.playbooks.ask', 'Ask my agent')}
            </button>
            <button type="button" class="btn-outline" onClick=${() => copyPrompt(pb)}>
              ${copied === pb.id
                ? tr('home.playbooks.copied', 'Copied — paste it in your AI chat')
                : tr('home.playbooks.copy', 'Copy for my own AI')}
            </button>
          </div>
        </div>`)}
    </div>`;
}

/**
 * Two facts about how this place treats a person, at the bottom where a footer belongs: AI-made
 * content is labelled, and their data stays theirs. Stated as what the system DOES rather than as
 * a compliance badge — the claim we can prove is the stronger one anyway, and each half links to
 * the page that proves it.
 */
export function TrustLine() {
  return html`
    <section class="koti-trust">
      <p>${tr('home.trust.ai', 'AI-made content carries its label here, as the EU AI Act asks.')}
        <a href="/v1/transparency">${tr('home.trust.more', 'How this works →')}</a></p>
      <p>${tr('home.trust.data', 'Your data is yours: export it or delete it, and nothing is shared until you share it.')}</p>
    </section>`;
}

/**
 * What has been tried here, and the doors to what has not. Every row is DERIVED from the account's
 * real state (the funnel markers, the usage counts, the chat status) rather than stored — an
 * achievement that can drift from the thing it celebrates is a lie waiting to happen. The one
 * exception is the Experience Center, which the node cannot observe: its chip marks itself when
 * the person goes. Hidden entirely by the settings toggle (home.prefs.hideAchievements).
 *
 * A named row ("Tried so far") inside the setup band, under the playbooks: what has been tried
 * and what has not is the same subject as what you could set up, and as a section of its own it
 * was a fourth heading nobody was looking for.
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
    <${NamedRow} label=${tr('home.ach.title', 'Tried so far')} className="koti-ach">
      ${list.map((a) => html`
        <a class="koti-ach-chip ${a.done ? 'koti-ach-chip--done' : ''}" key=${a.id} href=${a.href}
           target=${a.external ? '_blank' : undefined} rel=${a.external ? 'noopener' : undefined}
           onClick=${a.id === 'experience' && !a.done ? () => onTried('experience') : undefined}>
          <span class="koti-ach-mark" aria-hidden="true">${a.done ? '✓' : '·'}</span>
          ${tr(a.key, a.fallback)}
        </a>`)}
    <//>`;
}
