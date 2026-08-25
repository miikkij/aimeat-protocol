/**
 * @file public/views/surface/blocks-home.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every block of a member's home, as the engine mounts it. Each one is a thin adapter
 *   around a component that already existed in views/home/: it fetches what that component needs and
 *   nothing else, and subscribes to the domains that can change it.
 *
 *   THE COMPONENTS ARE UNCHANGED. This file is the wiring, not a rewrite. The home's own rules stay
 *   where they were written — a block with nothing to say renders nothing, a busy account's chips
 *   fold rather than spill — because those live inside the components these adapters mount.
 *
 *   WHAT THIS CHANGES IS WHEN THINGS ARE READ. The old home ran eleven requests through one loader
 *   and re-ran all eleven on any SSE event whatsoever. Here a mailbox arriving re-reads the mailbox.
 * @structure NameplateBlock · MatBlock · MailboxBlock · ChatDoorBlock · FleetBlock · ThingsBlock ·
 *   PlaybooksBlock · AchievementsBlock · FeedBlock · OpenItemsBlock · InstallCtaBlock · TrustBlock ·
 *   SettingsDoorBlock · StepsBlock
 * @usage Reached through views/surface/block-map.js, never imported directly by a view.
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useShared } from '/views/surface/shared-read.js';
import { useHomeState } from '/views/surface/home-state.js';
import {
  MailboxRow, FleetLine, ChatDoor, Things, FavoriteApps, Playbooks, TrustLine, Achievements,
} from '/views/home/status-parts.js';
import { HomeHeader } from '/views/home/header.js';
import { HomeFeed } from '/views/home/feed.js';
import { OpenItemsList } from '/components/OpenItemsList.js';
import { InstallCta } from '/components/InstallCta.js';
import { listApps } from '/js/services/apps.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// ── The person ──

export function NameplateBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  const { state } = useHomeState();
  if (!state) return null;
  return html`<${HomeHeader}
    name=${state.displayName}
    owner=${state.owner}
    identity=${ctx?.session?.ghii ?? state.ghii}
    onOpenSettings=${ctx?.openSettings} />`;
}

export function SettingsDoorBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  // The dialog itself is mounted by the view that owns the page, because it is a modal over the
  // whole surface rather than a thing in the flow. This block is the way in.
  if (!ctx?.openSettings) return null;
  return html`
    <p class="sf-settings-door">
      <button type="button" class="btn-ghost" onClick=${ctx.openSettings}>
        ${tr('home.settings.open', 'Settings')}
      </button>
    </p>`;
}

// ── What they have ──

export function MatBlock() {
  const { state } = useHomeState();
  const url = state?.mat?.standaloneUrl || state?.mat?.url;
  if (!url) return null;
  return html`
    <p class="koti-mat-line">
      ${tr('home.webpage', 'Your webpage, made by your AI:')}${' '}
      <a href=${url} target="_blank" rel="noopener">${url}</a>
    </p>`;
}

export function MailboxBlock() {
  const { data } = useShared('mail', '/v1/messages/inbox?per_page=1', ['messages'],
    (d) => ({ unread: d?.unread ?? 0 }));
  if (!data) return null;
  return html`<${MailboxRow} mail=${data} />`;
}

export function FleetBlock() {
  const { state } = useHomeState();
  if (!state?.agent) return null;
  return html`<${FleetLine} agent=${state.agent} />`;
}

export function ChatDoorBlock() {
  const { data: chatStatus } = useShared('chat-status', '/v1/chat/status', ['chat']);
  const { data: instances } = useShared('chat-instances', '/v1/chat-instances', ['instances'],
    (d) => [...new Set((d?.chat_instances ?? [])
      .filter((i) => String(i.id || '').startsWith('mcp-'))
      .map((i) => String(i.platform || '').replace(/^mcp-/, '')).filter(Boolean)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1)))]);
  return html`<${ChatDoor} chatStatus=${chatStatus} mcpNames=${instances ?? []} />`;
}

/**
 * The inventory band. It keeps the apps row as its CHILD rather than splitting into four blocks:
 * every row goes through one label-left frame, and that alignment is what makes the band read as a
 * list. Four independent blocks at one weight is the wall of noise the bands were introduced to fix.
 */
export function ThingsBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {} }) {
  const rows = Array.isArray(props.rows) && props.rows.length
    ? props.rows
    : ['assets', 'organisms', 'knowledge', 'apps'];

  const { state } = useHomeState();
  const owner = state?.owner ?? '';

  const { data: usage } = useShared('usage', '/v1/owner/usage', ['memory', 'files', 'apps']);
  const { data: orgs } = useShared('organisms', owner ? `/v1/organisms?member=${encodeURIComponent(owner)}&include=counts` : '',
    ['organisms'], (d) => (d?.organisms ?? d?.items ?? []).map((o) => ({
      id: o.id, name: o.name || o.id, workspace_count: o.workspace_count,
      updatedAt: o.updated_at || o.updatedAt,
    })));
  const { data: packages } = useShared('knowledge', '/v1/knowledge/tab', ['knowledge', 'memory'],
    (d) => (d?.packages ?? []).filter((p) => String(p.key || '').endsWith('/manifest'))
      .map((p) => ({ key: p.key, name: p.value?.name || p.value?.title || p.key.split('/')[1], updatedAt: p.updated_at })));
  const { data: prefs } = useShared('home-prefs', '/v1/memory/home.prefs?soft=1', ['memory'],
    (d) => (d?.exists === false ? {} : (d?.value ?? {})));
  const { data: favorites } = useShared('app-favorites', '/v1/memory/app-catalog.favorites?soft=1', ['memory'],
    (d) => (d?.exists === false ? { refs: [] } : (d?.value ?? { refs: [] })));

  const showApps = rows.includes('apps');

  // The complete list, paginated: one 200-row page once paged a busy node's owner out of their own
  // apps entirely. Not through useShared because listApps walks pages rather than being one GET.
  const [ownApps, setOwnApps] = useState([]);
  useEffect(() => {
    if (!owner || !showApps) return undefined;
    let live = true;
    // No owner filter here: listApps walks EVERY page and FavoriteApps picks this person's out.
    // One 200-row page once let a busy node page the owner's own apps out of the row entirely.
    listApps()
      .then((list) => { if (live) setOwnApps(Array.isArray(list) ? list : []); })
      .catch((err) => { swallowed('surface: own apps', err); });
    return () => { live = false; };
  }, [owner, showApps]);

  return html`
    <${Things}
      usage=${rows.includes('assets') ? usage : null}
      orgs=${rows.includes('organisms') ? (orgs ?? []) : []}
      packages=${rows.includes('knowledge') ? (packages ?? []) : []}
      prefs=${prefs ?? {}}>
      ${showApps ? html`<${FavoriteApps}
        apps=${ownApps ?? []} favorites=${favorites ?? { refs: [] }}
        owner=${owner} prefs=${prefs ?? {}} />` : ''}
    <//>`;
}

// ── What they could set up ──

export function PlaybooksBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {} }) {
  const { playbooks } = useHomeState();
  if (!playbooks?.length) return null;
  const tour = typeof props.tourUrl === 'string' && props.tourUrl ? props.tourUrl : '';
  return html`<${Playbooks} playbooks=${playbooks} tour=${tour} />`;
}

export function AchievementsBlock() {
  const { state } = useHomeState();
  const { data: usage } = useShared('usage', '/v1/owner/usage', ['memory', 'files', 'apps']);
  const { data: markers } = useShared('onboarding-markers', '/v1/memory?prefix=onboarding.', ['memory'],
    (d) => new Set((d?.items ?? d?.entries ?? []).map((m) => m.key)));
  const { data: chatStatus } = useShared('chat-status', '/v1/chat/status', ['chat']);
  const owner = state?.owner ?? '';
  const { data: orgs } = useShared('organisms', owner ? `/v1/organisms?member=${encodeURIComponent(owner)}&include=counts` : '', ['organisms']);
  const { data: packages } = useShared('knowledge', '/v1/knowledge/tab', ['knowledge', 'memory']);
  const { data: prefs } = useShared('home-prefs', '/v1/memory/home.prefs?soft=1', ['memory'],
    (d) => (d?.exists === false ? {} : (d?.value ?? {})));

  if (!state || prefs?.hideAchievements) return null;
  return html`<${Achievements}
    state=${state} usage=${usage} markers=${markers} chatStatus=${chatStatus}
    orgs=${orgs ?? []} packages=${packages ?? []} prefs=${prefs ?? {}} />`;
}

// ── What has happened ──

export function FeedBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {} }) {
  const limit = Number.isFinite(props.limit) ? props.limit : 6;
  const { data } = useShared('home-feed', '/v1/home/feed', ['home'], (d) => d?.items ?? []);
  if (!data?.length) return null;
  return html`<${HomeFeed} items=${data.slice(0, limit)} band=${true} />`;
}

export function OpenItemsBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {} }) {
  const maxAgeDays = Number.isFinite(props.maxAgeDays) ? props.maxAgeDays : 7;
  return html`<${OpenItemsList} maxAgeDays=${maxAgeDays} />`;
}

// ── Chrome that is not chrome any more ──

export function InstallCtaBlock() {
  return html`<${InstallCta} />`;
}

export function TrustBlock() {
  return html`<${TrustLine} />`;
}

/**
 * The setup path a new person walks. ONE block, and its inside is not arrangeable: the branch logic
 * moves the agent step from second to third, the dimmed steps are numbered by position, and the
 * write-once funnel markers are set inside those components. An operator may drop it or put their
 * own words around it; reordering its insides is not something the schema can express.
 */
export function StepsBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  const render = ctx?.renderSteps;
  return typeof render === 'function' ? render() : null;
}
