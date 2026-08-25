/**
 * @file public/views/surface/block-map.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Block id to the component that draws it. The other half of the registry declared in
 *   src/services/surface-layout/, and the only place the two halves meet.
 *
 *   THIS FILE IS ONE OF A PAIR, AND THE PAIR IS CHECKED BY INVOCATION. A block declared on the
 *   server with nothing here is a block an operator can add that renders nothing; an entry here with
 *   no declaration is a component no layout can ever reach. test/unit/surface-block-parity.test.ts
 *   calls blockFor() for every declared id and mounts what comes back, rather than reading either
 *   file's source — this repo learned inside an hour that a source scan is wrong in both directions.
 *
 *   Every value is a LOADER, not a component, so a page pulls in only what it actually shows: a
 *   member's home never loads the front page's app wall.
 * @structure BLOCKS · blockFor
 * @usage const load = BLOCKS['home.feed']; const Component = await load();
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */

/**
 * Id → () => Promise<Component>. Keep the keys sorted the way the registry declares them: common
 * first, then home, then portal, so a reader can hold the two files side by side.
 */
export const BLOCKS = {
  // ── Shared ──
  'common.freeform': () => import('/views/surface/freeform.js').then(m => m.FreeformBlock),

  // ── A member's home ──
  'home.nameplate': () => import('/views/surface/blocks-home.js').then(m => m.NameplateBlock),
  'home.mat': () => import('/views/surface/blocks-home.js').then(m => m.MatBlock),
  'home.mailbox': () => import('/views/surface/blocks-home.js').then(m => m.MailboxBlock),
  'home.chat-door': () => import('/views/surface/blocks-home.js').then(m => m.ChatDoorBlock),
  'home.fleet': () => import('/views/surface/blocks-home.js').then(m => m.FleetBlock),
  'home.things': () => import('/views/surface/blocks-home.js').then(m => m.ThingsBlock),
  'home.playbooks': () => import('/views/surface/blocks-home.js').then(m => m.PlaybooksBlock),
  'home.achievements': () => import('/views/surface/blocks-home.js').then(m => m.AchievementsBlock),
  'home.feed': () => import('/views/surface/blocks-home.js').then(m => m.FeedBlock),
  'home.open-items': () => import('/views/surface/blocks-home.js').then(m => m.OpenItemsBlock),
  'home.install-cta': () => import('/views/surface/blocks-home.js').then(m => m.InstallCtaBlock),
  'home.trust': () => import('/views/surface/blocks-home.js').then(m => m.TrustBlock),
  'home.steps': () => import('/views/surface/blocks-home.js').then(m => m.StepsBlock),

  // ── The node's front page ──
  'portal.welcome-door': () => import('/views/surface/blocks-portal.js').then(m => m.WelcomeDoorBlock),
  'portal.pitch': () => import('/views/surface/blocks-portal.js').then(m => m.PitchBlock),
  'portal.wish': () => import('/views/surface/blocks-portal.js').then(m => m.WishBlock),
  'portal.build-invite': () => import('/views/surface/blocks-portal.js').then(m => m.BuildInviteBlock),
  'portal.connect-invite': () => import('/views/surface/blocks-portal.js').then(m => m.ConnectInviteBlock),
  'portal.changelog': () => import('/views/surface/blocks-portal.js').then(m => m.ChangelogBlock),
  'portal.gallery': () => import('/views/surface/blocks-portal.js').then(m => m.GalleryBlock),
  'portal.totals': () => import('/views/surface/blocks-portal.js').then(m => m.TotalsBlock),
  'portal.hero': () => import('/views/surface/blocks-portal.js').then(m => m.HeroBlock),
  'portal.agent-prompt': () => import('/views/surface/blocks-portal.js').then(m => m.AgentPromptBlock),
  'portal.ask-ai': () => import('/views/surface/blocks-portal.js').then(m => m.AskAiBlock),
  'portal.stats': () => import('/views/surface/blocks-portal.js').then(m => m.StatsBlock),
  'portal.transparency': () => import('/views/surface/blocks-portal.js').then(m => m.TransparencyBlock),
  'portal.text': () => import('/views/surface/blocks-portal.js').then(m => m.PortalTextBlock),
  'portal.board': () => import('/views/surface/blocks-portal.js').then(m => m.PortalBoardBlock),
};

/**
 * The component for a block id, or null when this browser has none.
 *
 * `common.band` is deliberately absent: a band is not a component, it is the renderer's own grouping
 * of the blocks inside it, drawn by the renderer itself.
 */
export async function blockFor(id) {
  const load = BLOCKS[id];
  if (!load) return null;
  return (await load()) ?? null;
}
