/**
 * @file landing.js
 * @description Logged-out front page, the showroom (2026-08-28): the hero with the wish box as the
 *   one action → live counters as its evidence → the wall of published apps with its introduction
 *   → the store (when this node has one) → the safety list → the two rooms → what shipped lately →
 *   the last word. A signed-in visitor arriving at the site's ROOT is forwarded to their start
 *   page; /v1/portal is the front page itself and never forwards anyone. No protocol terms
 *   (GHII/GAII/CSM/federation) above the fold; a working result does the selling.
 *
 *   THE ORDER IS THE OPERATOR'S NOW. The page is a layout rendered by views/surface/renderer.js
 *   from the blocks this node declares, and the built-in layout is the order below — so a node
 *   nobody has configured looks unchanged. The tree in this file is the FALLBACK, kept because this
 *   is the door an anonymous visitor arrives at and a blank front page is the worst thing that can
 *   happen on the node.
 *
 *   Each section lives in its own sibling: landing-showroom.js (hero, wall introduction, last
 *   word), landing-showroom-rooms.js (store, safety list, rooms), landing-wall.js (the wall),
 *   landing-node-totals.js, landing-changelog.js. The blocks the showroom order no longer lists
 *   (landing-doors.js, landing-builder.js, landing-prompts.js, home/welcome-door.js) are still in
 *   the block catalogue for an operator to put back.
 * @structure default export Landing({ navigate })
 * @usage routed at /v1/portal (and '/' for browsers) by spa.html
 * @version-history
 *   v6.1.0 — 2026-08-28 — The page renders nothing until the layout answer arrives (or fails):
 *     the fallback tree used to mount every block once before the layout mounted them again,
 *     so the counters, the wall and the log each fetched twice on every arrival.
 *   v6.0.0 — 2026-08-28 — The showroom. The front page is a demo floor for the store: the wish
 *     box is the one action, the counters are its first evidence, the wall keeps its place, and
 *     the store section (gated on AIMEAT_SITE_STORE_URL), the safety list, the two rooms and the
 *     "built with itself" log follow. The fallback tree here mirrors DEFAULT_LAYOUTS.portal.
 *   v5.6.0 — 2026-08-27 — The arrival forward is decided by the PATH, not by a per-tab flag: only
 *     the site's root forwards a signed-in person, and /v1/portal always shows the front page. The
 *     flag was set by every in-app click and never cleared, so the brand link showed this page in
 *     one tab and the home in another, and nobody could say which they would get.
 *   v5.5.0 — 2026-08-26 — The front page renders through the surface layout engine, so an operator
 *     can arrange it. The built-in layout is this file's own order, and this file's tree stays as
 *     the fallback for the one case that matters: the layout could not be read at all.
 *   v5.4.0 — 2026-08-26 — Pure extraction, no behaviour change: the page was at 789 of its 800
 *     allowed lines, so StatsPanel + Gallery moved to landing-wall.js, the generator and its
 *     invitation to landing-builder.js, and the wish box, connect invitation and hero to
 *     landing-doors.js. This file keeps the arrival redirect and the section order.
 *   v5.3.0 — 2026-08-16 — The wish box: one field under the pitch line where a visitor says what
 *     they need. Signed in it lands in the chat composer (never auto-sent); signed out it survives
 *     registration and lands in the same place. A ?wish= in the URL (the wiifm page's GO box
 *     submits here) rides the same rail. Key: sessionStorage 'aimeat.wish', drained by chat.js.
 *   v5.2.0 — 2026-08-16 — The arrival redirect asks the node where this account lands instead of
 *     sending everyone to /v1/profile. The server has decided that since the remake, and this page
 *     ignored it, so an account created on the new path still arrived at the old one.
 *   v5.1.0 — 2026-08-01 — One line above the footer about how this node marks AI-generated
 *     content, linking /v1/transparency (TARGET-058 Phase 10). One line and no more: the page
 *     that states the limits properly is the one it links to.
 *   v5.0.0 — 2026-07-30 — TARGET-056: order reversed. The generator led the page's value and
 *     sat below a wall of other people's work; it is first now, with the three steps above it
 *     and the live counters directly under it as its evidence. The ownership question moved
 *     below them, because it answers a question a visitor only has after seeing the thing work.
 *     Hero keeps ONE primary button (four of equal weight asked for a choice before there was
 *     enough to choose from); the rest are one quiet line. Its old copy button was dropped as a
 *     duplicate of the generator's, now directly above it.
 *   v4.0.0 — 2026-07-28 — Hero states the fork (owner or tenant) with three entrances: build,
 *     business, own node. The Experience Center line and every other app reference now come
 *     from siteLinks, so a node that is not aimeat.io renders without them. The build button
 *     waits for the node's canonical prompt instead of copying the in-file fallback, which
 *     predates research-first and the T1/T2/T3 tiers. ASK_AI_PROMPT facts corrected: the old
 *     block claimed "hosting is the only subscription" (untrue against the price list and the
 *     EXCHANGE fee) and framed federation as cross-company work sharing.
 *   v2.2.0 — 2026-07-16 — Build-app prompt fetched from the canonical GET /v1/prompts/build-app
 *     (registry-generated libraries + capability packs; kills the landing's 5th drifting copy);
 *     the hand-built text remains only as the offline fallback. Template block via shared helper.
 *   v1.0.0 — 2026-06-10 — Initial: landing/portal split (owner spec).
 *   v1.1.0 — 2026-06-16 — Add BuildAppPrompt section: copyable Generate App Prompt from app-catalog.
 *   v1.2.0 — 2026-06-16 — Embed PublicActivityFeed (3 real-time tabs) after the proof gallery.
 *   v1.3.0 — 2026-06-16 — Move PublicActivityFeed directly under the hero; remove the now-redundant
 *     one-line Ticker (the full feed supersedes it).
 *   v2.0.0 — 2026-06-16 — Reward-first restructure (owner spec): new Hero (newspaper-framed
 *     Sanomat teaser — designed masthead card now, real screenshot when one exists — + two CTAs)
 *     replaces the text hero; gallery moved up; 3 audience path cards dropped (the two hero CTAs
 *     are the fork); AskYourAI + StatsPanel moved below the build loop.
 *   v2.1.0 — 2026-06-17 — Add BuildAgentPrompt: a copy-paste "build an agent in 10 minutes" prompt
 *     for the local crewaimeat fleet (Ollama/Gemma, no keys); Hero "Get your own →" now points to
 *     the desktop installer GitHub Release (was /v1/pricing).
 *   v3.0.0 — 2026-06-20 — Value-first hero: replace the Sanomat newspaper Hero with BuildHero
 *     (copy the build prompt → your AI builds you an app you own + publish); the gallery becomes a
 *     LIVE wall of the real apps people published here (manifest-driven from /v1/apps).
 *   v3.1.0 — 2026-06-20 — Wall: fixed 3-up grid + filter search; cards show author + publish
 *     date/time. Hero subline adds "let your agents keep it running" (Sanomat as the example).
 *   v3.2.0 — 2026-06-20 — H-2: wall cards open published apps in a sandboxed opaque-origin
 *     iframe (openAppSandboxed) instead of a top-level apex ?mode=inline link.
 *   v3.3.0 — 2026-06-20 — Replace PublicActivityFeed (read as broken when empty) with NodeTotals:
 *     cumulative "this node has X" counters (apps/organisms/agents+online/knowledge/downloads).
 *   v3.4.0 — 2026-07-14 — Footer GitHub link: fix href to the real repo
 *     (github.com/miikkij/aimeat-protocol) + add the GitHub Octocat mark.
 *   v3.5.0 — 2026-07-17 — Hero gains an Experience Center line (the hands-on academy at
 *     experience-center.apps.aimeat.io) under the two CTAs.
 *   v3.6.0 — 2026-07-31 — ManagedEnvNote above each of the three copy buttons (build-app full,
 *     build-agent and ask-your-AI compact): what a company-managed AI tool's untrusted-source
 *     notice means and the three routes round it. A security team met that notice cold and did
 *     not continue. No prompt text changed anywhere.
 *   v3.7.0 — 2026-08-08 — BuildAppPrompt's copy button is the shared <CopyButton> (with the new
 *     `disabled` prop, which the async-loaded prompt needs) instead of a hand-rolled
 *     navigator.clipboard handler; labels come from common.copyPrompt / common.copied. The
 *     misnamed .ld-gen-copy — which also dressed step 3's "Register and add your app" anchor,
 *     not a copy control at all — is now .ld-gen-action. No prompt text changed.
 */
import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { getLocale } from '/js/i18n.js';
import { apiGet } from '/js/api.js';
import { SurfaceRenderer, useSurfaceLayout } from '/views/surface/renderer.js';
import NodeTotals from './landing-node-totals.js';
import NodeChangeLog from './landing-changelog.js';
import { Gallery } from './landing-wall.js';
import { storeWish, hasStoredWish } from './landing-doors.js';
import { ShowroomHero, WallIntro, ShowroomClose } from './landing-showroom.js';
import { StoreSection, TrustList, Rooms } from './landing-showroom-rooms.js';
import { storeHref } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

export default function Landing({ navigate }) {
  const surface = useSurfaceLayout('portal');

  // A signed-in person arriving at the site's ROOT (bookmark, external link, the bare address) goes
  // straight to their start page. This same view at /v1/portal is the front page itself, reached on
  // purpose (a footer link, the address bar), and it never forwards anyone: otherwise a signed-in
  // person could never see this page at all. The two are told apart by the PATH. A per-tab flag
  // used to make this decision, set by every in-app click and never cleared, so the same brand
  // click showed this page in one tab and the home in another.
  //
  // Signing in while standing on this page always moves on: without that, the sign-in modal
  // closed and the visitor was left looking at the same marketing page with no sign that anything
  // had happened.
  //
  // WHERE it forwards to is the node's answer, not this file's: the start page the person chose,
  // or the home when they have chosen nothing. The home is also the fallback when the answer does
  // not arrive, because it is where everyone lands by default anyway.
  useEffect(() => {
    const landingFor = async () => {
      try {
        const res = await apiGet('/v1/home/ui-track');
        return res?.data?.landing || '/v1/home';
      } catch (err) {
        // Not knowing where to send someone is not a reason to leave them on the marketing page.
        console.warn('[landing] could not read where this account lands:', err.message);
        return '/v1/home';
      }
    };
    const check = () => {
      try {
        const raw = localStorage.getItem('aimeat_session');
        if (raw && JSON.parse(raw)?.jwt) {
          // A wish waiting in this tab outranks the usual landing: the person said what they
          // need, so they arrive in the chat where the composer is already holding it.
          if (hasStoredWish()) { navigate('/v1/chat'); return true; }
          landingFor().then((path) => navigate(path));
          return true;
        }
      // eslint-disable-next-line aimeat/no-silent-catch -- stay on landing
      } catch { /* stay on landing */ }
      return false;
    };
    // A wish arriving in the URL (the wiifm page's GO box submits here) is stored before the
    // arrival check runs, so a signed-in visitor rides straight through to the chat with it.
    try {
      const urlWish = new URLSearchParams(window.location.search).get('wish')?.trim();
      if (urlWish) storeWish(urlWish);
    } catch (err) { swallowed('landing: url wish', err); }
    const atRoot = window.location.pathname === '/';
    if (atRoot && check()) return undefined;
    const onAuth = () => check();
    window.addEventListener('aimeat-auth-change', onAuth);
    return () => window.removeEventListener('aimeat-auth-change', onAuth);
    // navigate is a router prop; this is a deliberate mount-only "redirect on arrival"
    // check that must not re-run (and re-redirect) if navigate's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The front page is a layout the operator can arrange. The server answers with the built-in one
  // when nobody has configured this node, so the ordinary case needs no decision here.
  //
  // THE FALLBACK BELOW IS NOT DEAD CODE. This is the door an anonymous visitor arrives at, and a
  // page that renders nothing because one fetch failed is the worst outcome on the whole node. If
  // the layout cannot be read, the sections render in the order this file has always used.
  if (!surface.failed && surface.layout) {
    return html`
      <div class="ld">
        <${SurfaceRenderer}
          layout=${surface.layout}
          freeform=${surface.freeform}
          ctx=${{ navigate }}
          locale=${getLocale()} />
      </div>`;
  }

  // Nothing yet, on purpose, while the layout is on its way. The fallback used to render here in
  // the meantime and every block fetched its data, then the layout arrived and the same blocks
  // mounted again and fetched again: the counters, the wall and the log each cost two requests on
  // every arrival (three for the counters, with the live update). The answer takes a few
  // milliseconds; a blank page for that long is invisible, a doubled page load is not.
  if (!surface.failed && !surface.ready) return html`<div class="ld"></div>`;

  // The showroom order, the same one DEFAULT_LAYOUTS.portal declares on the server: the store
  // section is the one part that depends on configuration (a node without a store has no prices to
  // show), and the fallback reads the same site link the block registry gates on.
  return html`
    <div class="ld">
      <!-- 0. The hero: the claim, the wish box as the one action, three quieter doors, the
              showroom picture. -->
      <${ShowroomHero} navigate=${navigate} />

      <!-- 1. Live counters, directly under the claim, as its first evidence. -->
      <${NodeTotals} />

      <!-- 2. What the wall is, then the wall itself: the best thing on this page for showing the
              place is alive. -->
      <${WallIntro} />
      <${Gallery} />

      <!-- 3. Loved the demo? Take one home. Only when this node has a store to send people to. -->
      ${storeHref() ? html`<${StoreSection} fromPrice="19 €/mo"
        tiers="Solo: 19 · Team: 59 · Office: 99 · Own machine: 179 · Compliance: 369 · Managed: from 2 000" />` : ''}

      <!-- 4. Safe is a list, not a word; it ends with how this node marks AI content. -->
      <${TrustList} navigate=${navigate} />

      <!-- 5. The two rooms: the incubator and the clubhouse. -->
      <${Rooms} />

      <!-- 6. Built with itself, every day, and the log that proves it. -->
      <${NodeChangeLog} />

      <!-- 7. The last word, and the way back up to the wish box. -->
      <${ShowroomClose} />

      ${/* The footer this page used to carry (Docs, Run your own node, GitHub, For developers,
            AI transparency) is the shell's SiteFooter now — spa.html renders it under every
            public view, so there is one footer to edit rather than three. */''}
    </div>
  `;
}
