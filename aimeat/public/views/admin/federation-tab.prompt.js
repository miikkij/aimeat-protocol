/**
 * @file federation-tab.prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The paste that hands this node's federation to the operator's own AI.
 *
 *   IT ASKS FOR WHAT COUNTING CANNOT TELL YOU. The page now states the counts, what is waiting, how
 *   far behind each peer is and how old the book is, so a prompt that asked for those would return
 *   what the operator can already see. What nobody gets without judgement is whether the shape of
 *   this federation is the one they intended: whether the peers they trust most are the ones with
 *   the most power here, whether anything is switched on that nobody remembers switching on, and
 *   whether the node is giving as much as it takes.
 *
 *   English, like every prompt here, while the page around it follows the reader's language.
 * @structure buildFederationPrompt({ url, peers, standing })
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */

/**
 * @param {{ url?: string, peers?: number, standing?: string }} opts
 * @returns {string}
 */
export function buildFederationPrompt({ url = '', peers = 0, standing = '' } = {}) {
  const where = url ? ` at ${url}` : '';
  const many = peers === 0
    ? 'It has no federation peers yet.'
    : peers === 1 ? 'It has one federation peer.' : `It has ${peers} federation peers.`;
  const word = standing ? ` The page calls the current state "${standing}".` : '';

  return `I run an AIMEAT node${where} and I am its operator. ${many}${word} Tell me whether the shape of this federation is the one I meant to build.

== 1. Read ==
  aimeat_admin_federation {}   the whole page in one read: standing, needs, peers, sign-in, offer, book
  aimeat_admin_config {}       this node's settings, including the federation ones
  aimeat_admin_stats {}        what this node holds, so you can judge what it could be offering
Start with aimeat_admin_federation. Read \`needs\` before the counts: it is the list of things that are waiting on me, and an empty list is a real answer worth stating.

== 2. Three things I probably have wrong ==
  - A peer that was added and never switched on. Adding connects nothing; somebody has to press Activate. Tell me if one is sitting there, and how long.
  - The sign-in policy. It is two decisions and both must say yes: the node-wide setting, and a switch on each peer. If \`signin.reaches_nobody\` is true I have a setting that looks configured and lets nobody in. If it is \`all_peers\`, say plainly how many accounts that actually is.
  - What this node gives. \`offer\` counts only things somebody ticked Federate on. If \`gives_nothing\` is true I am reading the federation and putting nothing back, which is almost never a decision anybody made on purpose.

== 3. Then use your judgement on the part I cannot count ==
  - Does the power each peer has here match how much I should trust it? A peer that may settle morsels and replicate memory is holding more than one that may only carry messages. Name any peer whose switches look more generous than its rung.
  - Is anything switched on that looks like it was switched on once for a test? Relay points outward, which is the one switch that lets this node forward traffic TO a peer rather than the other way round.
  - Is the federation book stale, and does it matter? It is a signed directory mirrored from the node that keeps it. If the version I run is newer than most of the book, say what that means for what I can rely on the others to understand.

== 4. One paragraph, then a short list ==
Open with whether anything needs me today, in one sentence. Then at most five items, each one a thing to do with the node it is about. If nothing needs me, say that first and stop; do not pad it out.

Do not change anything. Read, then tell me.`;
}
