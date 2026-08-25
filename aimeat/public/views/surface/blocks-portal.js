/**
 * @file public/views/surface/blocks-portal.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every block of the node's public front page, as the engine mounts it. Thin adapters
 *   over the components that already made up views/landing.js, so an operator arranging the page is
 *   arranging the real sections rather than a second set built to be arrangeable.
 *
 *   THE PITCH, THE HERO AND THE TRANSPARENCY LINE ARE MARKUP, NOT COMPONENTS. They were three lines
 *   inline in landing.js. They are written out here rather than extracted into landing-*.js files of
 *   their own, because a file holding one paragraph is a worse answer than the paragraph.
 *
 *   Two blocks read node content the operator wrote: portal.text shows a `portal/*` record, which is
 *   the old {{memory:...}} tag as a block, and portal.board shows a board's recent posts. Both are
 *   node-published and both are public, which is what lets them be read without a session.
 * @structure WelcomeDoorBlock · PitchBlock · WishBlock · BuildInviteBlock · ConnectInviteBlock ·
 *   ChangelogBlock · GalleryBlock · TotalsBlock · HeroBlock · AgentPromptBlock · AskAiBlock ·
 *   StatsBlock · TransparencyBlock · PortalTextBlock · PortalBoardBlock
 * @usage Reached through views/surface/block-map.js, never imported directly by a view.
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useShared } from '/views/surface/shared-read.js';
import { Markdown } from '/components/Markdown.js';
import { Gallery, StatsPanel } from '/views/landing-wall.js';
import { BuildInvite } from '/views/landing-builder.js';
import { WishBox, ConnectInvite, BuildHero } from '/views/landing-doors.js';
import { BuildAgentPrompt, AskYourAI } from '/views/landing-prompts.js';
import NodeTotals from '/views/landing-node-totals.js';
import NodeChangeLog from '/views/landing-changelog.js';
import { WelcomeDoor } from '/views/home/welcome-door.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const nav = (ctx) => ctx?.navigate ?? (() => { });

export function WelcomeDoorBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  return html`<${WelcomeDoor} onNavigate=${nav(ctx)} />`;
}

// The pitch line and the wish box were ONE section until the front page became a layout, where each
// is a block an operator can keep or drop on its own. They keep the same frame so they still line
// up under each other; landing.css drops the second one's top margin so the pair still reads as one
// unit. Splitting them without the frame left the line at the page's full width and the box
// centred, which is visible at a glance and was.
export function PitchBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { title }) {
  return html`
    <section class="ld-pitch">
      <p class="ld-pitch-line">
        ${title || tr('landing.pitch', 'AIMEAT — the Linux of AI. An open, federated, self-hosted AI operating system, and everything in it is yours.')}
      </p>
    </section>`;
}

export function WishBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  return html`
    <section class="ld-pitch">
      <${WishBox} navigate=${nav(ctx)} />
      <p class="ld-pitch-lead">
        ${tr('landing.wishLead', 'Say what you need and press GO. You land in a chat that starts building it with you; new here, you make an account on the way and lose nothing you typed.')}
      </p>
    </section>`;
}

export function BuildInviteBlock() {
  return html`<${BuildInvite} />`;
}

export function ConnectInviteBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  return html`<${ConnectInvite} onNavigate=${nav(ctx)} />`;
}

export function ChangelogBlock() {
  return html`<${NodeChangeLog} />`;
}

export function GalleryBlock() {
  return html`<${Gallery} />`;
}

export function TotalsBlock() {
  return html`<${NodeTotals} />`;
}

export function HeroBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  return html`<${BuildHero} onNavigate=${nav(ctx)} />`;
}

export function AgentPromptBlock() {
  return html`<${BuildAgentPrompt} />`;
}

export function AskAiBlock() {
  return html`<${AskYourAI} />`;
}

export function StatsBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  return html`<${StatsPanel} navigate=${nav(ctx)} />`;
}

export function TransparencyBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { ctx }) {
  const navigate = nav(ctx);
  return html`
    <p class="ld-transline">
      ${tr('landing.transLine', 'Content a model wrote here carries a record of how it was made, and a label where a person reads it.')}
      ${' '}
      <a href="/v1/transparency" onClick=${(e) => { e.preventDefault(); navigate('/v1/transparency'); }}>
        ${tr('landing.transCta', 'How this node marks AI content →')}
      </a>
    </p>`;
}

/** A passage the operator keeps as a portal record. The {{memory:...}} tag, as a block. */
export function PortalTextBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {}, title }) {
  const key = typeof props.key === 'string' ? props.key.trim() : '';
  const { data } = useShared(`portal-text:${key}`, key ? `/v1/memory/__site__/${encodeURIComponent(key)}` : '',
    ['site'], (d) => (typeof d?.value === 'string' ? d.value : ''));
  if (!data) return null;
  return html`
    <section class="sf-portal-text">
      ${title ? html`<h2 class="sf-band-title">${title}</h2>` : ''}
      <${Markdown} text=${data} />
    </section>`;
}

/** The latest posts from one board. Only system and public boards ever answer. */
export function PortalBoardBlock(/** @type {{ ctx?: any, props?: Record<string, any>, title?: string, text?: string, blockKey?: string }} */ { props = {}, title }) {
  const slug = typeof props.slug === 'string' ? props.slug.trim() : '';
  const limit = Number.isFinite(props.limit) ? props.limit : 5;
  const { data } = useShared(`portal-board:${slug}`, slug ? `/v1/boards/${encodeURIComponent(slug)}/posts?limit=${limit}` : '',
    ['boards'], (d) => (d?.posts ?? d?.items ?? []));
  if (!data?.length) return null;
  return html`
    <section class="sf-portal-board">
      ${title ? html`<h2 class="sf-band-title">${title}</h2>` : ''}
      <div class="board-posts">
        ${data.slice(0, limit).map((p) => html`
          <article class="board-post" key=${p.id}>
            <h3>${p.title}</h3>
            ${p.created_at ? html`<time datetime=${p.created_at}>${String(p.created_at).slice(0, 10)}</time>` : ''}
            <p>${p.body}</p>
          </article>`)}
      </div>
    </section>`;
}
