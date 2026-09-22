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
 * @structure MailboxRow · YourTurn · FleetLine · ChatDoor · NamedRow · Things · FavoriteApps · Playbooks · TrustLine · Achievements
 * @usage import { MailboxRow, FleetLine, ChatDoor, Things, FavoriteApps, Achievements } from '/views/home/status-parts.js';
 * @version-history
 *   2026-09-22: Every status block is composed from the shared set (components/poster-parts.js),
 *     YourTurn included; folds and account data unchanged.
 *   2026-09-14: YourTurn — the threads whose last word was somebody else's. The mailbox row gives
 *     the unread count and that is a different question: unread is "you have not looked", this is
 *     "you looked and they are still waiting".
 *   2026-09-13: Compose the existing home shapes with shared poster classes.
 *   v1.5.0 — 2026-08-28 — The poster home: the mailbox and fleet lines carry their number as a
 *     big numeral (bigNumber() splits the translated sentence at its placeholder, so every
 *     language keeps its own word order), and the chat door is the coral band.
 *   v1.4.0 — 2026-08-23 — Jouni's second round on prod: the count tiles become the Assets row
 *     and the playbook pills the To-set-up row, so every row in a band hangs on the same label
 *     column; the em-dash (banned in every surface) is swept out of the fallback strings; the
 *     trust line gets its missing space before the How-this-works link.
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
import { Section, Stack, Columns, ListRow, StatRow, CheckItem, Steps, KeyValue, Toolbar, NumeralBand, Surface, Action, Text } from '/components/poster-parts.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** How many unstarred rows a folded list shows before the fold. */
const FOLD_AFTER = 3;

/**
 * A sentence with its number set big. The translated string keeps its placeholder until here, so
 * the numeral lands where that language puts it; a string without the placeholder renders as it is.
 */
function bigNumber(sentence, placeholder, value) {
  const at = sentence.indexOf(placeholder);
  if (at < 0) return sentence;
  return html`${sentence.slice(0, at)}<${Text} kind="number">${String(value)}<//>${sentence.slice(at + placeholder.length)}`;
}

/**
 * The mailbox on the wall: flag up when something unread waits, and one line saying how much.
 * Renders only when the count is known — a mailbox that cannot be read is not shown broken.
 */
export function MailboxRow({ mail }) {
  if (!mail) return null;
  const unread = mail.unread ?? 0;
  return html`
    <${StatRow} href="/v1/profile?tab=messages" tone=${unread > 0 ? 'coral' : 'plain'}>${unread > 0
      ? bigNumber(tr('home.mail.unread', '{n} unread, go have a look'), '{n}', unread)
      : tr('home.mail.empty', 'Mailbox: nothing new')}<//>`;
}

/**
 * The threads where the ball is in this person's court: the last word in each was somebody else's.
 *
 * WHY THIS IS NOT THE UNREAD COUNT, which the row above already gives. Unread says "you have not
 * looked"; this says "you looked and they are still waiting". They come apart the moment somebody
 * opens a message meaning to answer later, which is most of them. Asked for by a person whose home
 * page answers one question every morning — what do I have to decide today — and who had the count
 * and not the list.
 *
 * An agent's own threads are not here. They are the agent's correspondence, surfaced to the owner
 * read-only elsewhere; putting them in a list titled "waiting for your answer" would be asking a
 * person to answer mail that is not addressed to them.
 *
 * The line under a name is clamped to two lines (ListRow's preview), because the row is a pointer
 * into the mailbox and a long message would make five threads fill the screen the band summarises.
 */
export function YourTurn({ threads, max }) {
  const rows = (threads ?? []).slice(0, max ?? 5);
  if (!rows.length) return null;
  const hidden = (threads ?? []).length - rows.length;
  return html`
    <${Section} title=${tr('home.turn.title', 'Waiting for your answer')}>
      ${rows.map((r) => html`<${ListRow} key=${r.id} href="/v1/profile?tab=messages" name=${r.who} detail=${r.said} preview=${true} />`)}
      ${hidden > 0 && html`<${Text} tone="muted">${bigNumber(tr('home.turn.more', '{n} more are waiting'), '{n}', hidden)}<//>`}
    <//>`;
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
    <${StatRow} href="/v1/profile?tab=agents" light=${ok ? 'success' : 'danger'}>${total === 1
      ? (ok ? tr('home.fleet.oneOk', 'Your agent is home and well.')
        : tr('home.fleet.oneTrouble', 'Your agent {name} needs a look.').replace('{name}', agent.name || ''))
      : (ok ? bigNumber(tr('home.fleet.allOk', '{total} agents home, all well.'), '{total}', total)
        : bigNumber(tr('home.fleet.trouble', '{total} agents home · {n} need a look').replace('{n}', String(problems)), '{total}', total))}<//>`;
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
    <${NumeralBand} cut="diagonal" lead=${tr('home.chatDoor.lede', 'Your agent is in the chat. Say what you need, and it gets to work.')}
      actions=${html`<${Action} kind="primary" size="large" href="/v1/chat">${tr('home.chatDoor.cta', 'Continue in the chat')}<//>`}>
      ${ai && html`<${Text}>${ai}<//>`}
    <//>`;
}

/**
 * One named row: the category word in a fixed left column, the content on the right. Every row
 * under a band title goes through this frame (spaces, knowledge, apps, tried so far), which is
 * what makes them line up as a list instead of reading as separate clouds. `title` is the
 * explainer that rides on the label as a tooltip, when the word alone is not enough.
 */
export function NamedRow({ label, title, children }) {
  return html`
    <${KeyValue} label=${html`<span title=${title || undefined}>${label}</span>`}>
      <${Stack} direction="wrap" align="start">${children}<//>
    <//>`;
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
      ${shown.map(r => html`<${Stack} direction="horizontal" align="center" density="compact" key=${r.id}>
        <${Action} kind="text" href=${r.href}>${r.name}${typeof r.n === 'number' && r.n > 0 ? ' ' + r.n : ''}<//>
        <${Action} kind="tab" selected=${isStar(r.id)} label=${tr('home.things.star', 'Keep this one always visible')}
          onClick=${() => onStar(r.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
            <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1 6.2-5.6-2.9-5.6 2.9 1-6.2L3 9.6l6.2-.9Z"
              fill=${isStar(r.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" />
          </svg>
        <//>
      <//>`)}
      ${hidden > 0 && html`<${Action} onClick=${() => setOpen(true)}>${tr('home.things.showAll', 'Show all ({n})').replace('{n}', String(rows.length))}<//>`}
      ${open && rows.length > fold && html`<${Action} onClick=${() => setOpen(false)}>${tr('home.things.showLess', 'Show less')}<//>`}
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
  const explain = tr('home.things.knowledgeExplain', 'Structured knowledge: what you have organised out of your AI chats, for your AIs, your apps and, when you choose, other people to use.');
  return html`
    <${Section} title=${tr('home.things.title', 'What you have made')} size="large"><${Stack}>
      ${rows.length > 0 && html`<${NamedRow} label=${tr('home.things.assets', 'Assets')}>
        ${rows.map(r => html`<${Action} kind="text" key=${r.key} href=${r.href}><${Text} kind="number" size="small" tone="coral">${r.n}<//>${tr(r.key, r.fallback)}<//>`)}
      <//>`}
      <${ChipRow} label=${tr('home.things.organisms', 'Shared spaces')} rows=${orgRows} starred=${starred} onStar=${onStar} fold=${FOLD_AFTER} />
      <${ChipRow} label=${tr('home.things.knowledge', 'Structured knowledge')} title=${explain} rows=${pkgRows} starred=${starred} onStar=${onStar} fold=${FOLD_AFTER} />
      ${children}
      ${pkgRows.length > 0 && html`<${Text} tone="muted">${explain}<//>`}
    <//><//>`;
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
      ${noneOpened && html`<${Text} tone="muted">${tr('home.apps.noneOpened', 'Nothing opened on this device yet.')}<//>`}
      ${rows.map(r => html`<${Action} kind="text" key=${r.id} href=${r.href} target="_blank">${r.name}<//>`)}
      ${favRefs.length === 0 && html`<${Toolbar} label=${tr('home.apps.modeLabel', 'Which apps to show')} filters=${[
        {id:'saved',label:tr('home.apps.saved','Last saved'),selected:mode==='saved',onClick:()=>onMode('saved')},
        {id:'used',label:tr('home.apps.used','Last opened'),selected:mode==='used',onClick:()=>onMode('used')},
      ]} />`}
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
    <${Stack}>
      <${Text} tone="muted">${tr('home.playbooks.lead', 'Each one is a real thing you can do here, with the steps and the prompt that gets it done.')}<//>
      <${KeyValue} label=${tr('home.playbooks.row', 'To set up')}>
        ${playbooks.map((pb,i) => html`<${ListRow} key=${pb.id} number=${String(i+1).padStart(2,'0')} arrow=${true}
          name=${tr(`home.playbooks.${pb.id}.title`, pb.id)} selected=${open===pb.id}
          onOpen=${() => setOpen(open===pb.id ? null : pb.id)} />`)}
        ${tour && html`<${Action} href=${tour} target="_blank">${tr('home.playbooks.tour', 'Not sure what this can do? Take the tour →')}<//>`}
      <//>
      ${playbooks.filter(pb => pb.id===open).map(pb => html`<${Surface} kind="record" key=${pb.id}><${Stack}>
        <${Text}>${tr(`home.playbooks.${pb.id}.lead`, '')}<//>
        <${Steps} items=${Array.from({length:pb.steps},(_,i)=>tr(`home.playbooks.${pb.id}.step${i+1}`,''))} />
        ${pb.proof?.length > 0 && html`<${Text} tone="muted">${tr('home.playbooks.proof', 'Already running here:')}${' '}
          ${pb.proof.map((pr,i)=>html`<span key=${pr.name}>${i>0 ? ' · ' : ''}<${Action} kind="text" href=${pr.url} target="_blank">${pr.name}<//></span>`)}
        <//>`}
        <${Stack} direction="wrap">
          <${Action} kind="primary" onClick=${()=>askAgent(pb)}>${tr('home.playbooks.ask', 'Ask my agent')}<//>
          <${Action} onClick=${()=>copyPrompt(pb)}>${copied===pb.id ? tr('home.playbooks.copied', 'Copied. Paste it in your AI chat') : tr('home.playbooks.copy', 'Copy for my own AI')}<//>
        <//>
      <//><//>`)}
    <//>`;
}

/**
 * Two facts about how this place treats a person, at the bottom where a footer belongs: AI-made
 * content is labelled, and their data stays theirs. Stated as what the system DOES rather than as
 * a compliance badge — the claim we can prove is the stronger one anyway, and each half links to
 * the page that proves it.
 */
export function TrustLine() {
  return html`
    <${Section}><${Surface} tone="ink" density="roomy"><${Columns} collapse=${900}>
      <${Text}>${tr('home.trust.ai', 'AI-made content carries its label here, as the EU AI Act asks.')}${' '}
        <${Action} kind="text" href="/v1/transparency">${tr('home.trust.more', 'How this works →')}<//><//>
      <${Text}>${tr('home.trust.data', 'Your data is yours: export it or delete it, and nothing is shared until you share it.')}<//>
    <//><//><//>`;
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
    <${NamedRow} label=${tr('home.ach.title', 'Tried so far')}>
      ${list.map(a=>html`<${CheckItem} key=${a.id} done=${a.done} href=${a.href} target=${a.external ? '_blank' : undefined}
        onClick=${a.id==='experience'&&!a.done ? ()=>onTried('experience') : undefined}>${tr(a.key,a.fallback)}<//>`)}
    <//>`;
}
