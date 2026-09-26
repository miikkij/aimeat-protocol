/**
 * @file public/components/HowTo.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A short written how-to for one platform: a small heading, numbered steps with the
 *   commands to type in coral typewriter letters, a link to a runtime. The words are HTML a developer
 *   wrote into the code (the connect guide's per-platform steps in
 *   views/profile/agents/connect-prompts.js PLATFORMS), never anything a user or an agent supplied:
 *   the component draws exactly that string. A page passes the text; it never writes a class. The
 *   look is css/components/how-to.css.
 * @structure HowTo({ html })
 * @usage html`<${HowTo} html=${PLATFORMS[activePlat]} />`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the Agents page's "no Node.js?" platform steps (profile.css
 *     .platform-content) as a component (page group G1a).
 */
import { h } from 'preact';
import htm from 'htm';

const html = htm.bind(h);

/** @param {{ html: string }} props — developer-written HTML only (see the file's description). */
export function HowTo({ html: text }) {
  // SAFE: callers pass hardcoded developer constants, not user input (see @description).
  return html`<div class="how-to" dangerouslySetInnerHTML=${{ __html: text || '' }}></div>`;
}

export default HowTo;
