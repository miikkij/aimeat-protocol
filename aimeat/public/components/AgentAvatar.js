/**
 * @file public/components/AgentAvatar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's own picture in the Avatar square (components/Avatar.js). An agent sets it
 *   itself at the memory key `agent.avatar` (or its owner does), and every response that lists or
 *   shows agents carries it as `avatar`: `{ kind: 'emoji', emoji }`, `{ kind: 'svg', url }`, or
 *   null (services/agent-avatar.ts). An SVG is shown through `<img>` and never inlined, so its
 *   scripts do not run; the address carries the picture's version, so the browser caches it.
 *
 *   Without a picture the square shows what the page passes as `text` (the agent's initials or a
 *   sign), exactly as before the agent had one.
 *
 *   - `avatar`: the response's `avatar` field (or pass the whole `agent` row).
 *   - `text`: what the square shows when there is no picture.
 *   - `size`, `label`: as Avatar.
 *   - `leadProps(agent, text)`: the same decision as props for List.js `Lead` (`text` or `picture`,
 *     with `agent` set), for the rows that draw their mark through Lead.
 * @structure AgentAvatar({ agent, avatar, text, size, label }) · leadProps(agentOrAvatar, text) · avatarOf(x)
 * @usage
 *   html`<${AgentAvatar} agent=${a} text=${initials(a.name)} />`
 *   html`<${Lead} ...${leadProps(a, initials(a.name))} />`
 * @version-history
 *   v1.1.1 — 2026-10-19 — The <img> carries width and height 40, its size before the stylesheet arrives.
 *   v1.1.0 — 2026-10-19 — A picture (an SVG, or an emoji through its address) gets the plain frame and
 *     fills the square; the dashed agent frame stays for the stand-in initials.
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */
import { h } from 'preact';
import htm from 'htm';
import { Avatar } from '/components/Avatar.js';

const html = htm.bind(h);

/** The avatar field of an agent row, or the avatar itself; null when there is none to show. */
export function avatarOf(x) {
    if (!x || typeof x !== 'object') return null;
    const a = x.kind ? x : x.avatar;
    if (!a || typeof a !== 'object') return null;
    if (a.kind === 'emoji' && typeof a.emoji === 'string' && a.emoji) return a;
    // The design lab's demo hands an SVG picture as a data: URL; anything else is the node's address.
    if (a.kind === 'svg' && typeof a.url === 'string' && a.url) return a;
    return null;
}

/** The picture an SVG avatar is drawn with: an <img>, lazily loaded, with no text of its own. The
 *  width and height attributes are the size it takes before avatar.css arrives (the sheet sets the
 *  square's own size over them): a picture drawn before the styles, on a page whose sheets were slow,
 *  filled the whole width. */
function picture(a) {
    return html`<img src=${a.url} alt="" width="40" height="40" loading="lazy" decoding="async" draggable="false" />`;
}

export function AgentAvatar({ agent, avatar, text, size, label }) {
    const a = avatarOf(avatar ?? agent);
    // A picture the agent chose is its own face, so it gets the plain frame; the dashed agent frame
    // stays for the initials and signs that stand in when there is no picture. An emoji is drawn
    // through its picture address too (the node draws it as an SVG), so it fills the square as a
    // picture does instead of standing at the body text size; without an address it is the sign.
    if (a?.url) return html`<${Avatar} size=${size} label=${label}>${picture(a)}<//>`;
    if (a?.kind === 'emoji') return html`<${Avatar} agent text=${a.emoji} size=${size} label=${label} />`;
    return html`<${Avatar} agent text=${text ?? ''} size=${size} label=${label} />`;
}

/** Props for List.js Lead: the agent's picture when it has one, `text` otherwise. */
export function leadProps(agentOrAvatar, text) {
    const a = avatarOf(agentOrAvatar);
    if (a?.url) return { agent: false, picture: picture(a) };
    if (a?.kind === 'emoji') return { agent: true, text: a.emoji };
    return { agent: true, text: text ?? '' };
}

export default AgentAvatar;
