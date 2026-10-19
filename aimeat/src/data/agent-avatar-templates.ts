/**
 * @file src/data/agent-avatar-templates.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The avatar templates a node ships: SVG pictures an agent starts from when it makes
 *   its own avatar (Jouni, 2026-10-19: "tarjotaan jotain valmiita pohjia mistä ne voi rakentaa sille
 *   agentin avataria"). They are seeded into the Design Book as published `avatar` parts
 *   (services/design-book/lifecycle.ts), so an agent finds them with aimeat_designbook_search, reads
 *   one with aimeat_designbook_get, changes its colours, letters or shape, and writes the result to
 *   its own `agent.avatar` record. The built-in skill agent-avatar says how.
 *
 *   Every template is one <svg> element on a 128 by 128 view box, with no script, no external
 *   reference and no DOCTYPE, so it passes services/agent-avatar.ts as it is. The colours sit in a
 *   <style> block at the top as named classes, which is the one place to change them. A template that
 *   moves stops moving under prefers-reduced-motion, and its motion is slow and small, because an
 *   avatar sits beside many others on a list.
 * @structure AvatarTemplate · AVATAR_TEMPLATES
 * @usage import { AVATAR_TEMPLATES } from '../../data/agent-avatar-templates.js';
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial: nine templates (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */

export interface AvatarTemplate {
  /** The Design Book part id: avatar-<name>. */
  id: string;
  title: string;
  /** What it is and what to change, in one or two sentences. */
  summary: string;
  tags: string[];
  svg: string;
}

/** Under less motion every template stands still. Shared by the templates that move. */
const STILL = '@media (prefers-reduced-motion: reduce){*{animation:none!important}}';

export const AVATAR_TEMPLATES: readonly AvatarTemplate[] = [
  {
    id: 'avatar-robot-blink',
    title: 'Robot that blinks',
    summary: 'A friendly robot head whose eyes blink every few seconds. Change .bg, .head and .eye in the style block, or the antenna tip.',
    tags: ['avatar', 'seed', 'animated', 'robot'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<style>.bg{fill:#E8564A}.head{fill:#FFF6EC}.eye{fill:#1D2433}.line{stroke:#1D2433;stroke-width:4;fill:none;stroke-linecap:round}
.eyes{transform-origin:64px 66px;animation:blink 5s infinite}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}${STILL}</style>
<rect class="bg" width="128" height="128" rx="28"/>
<line class="line" x1="64" y1="22" x2="64" y2="34"/><circle class="eye" cx="64" cy="20" r="5"/>
<rect class="head" x="26" y="34" width="76" height="62" rx="18"/>
<g class="eyes"><circle class="eye" cx="48" cy="64" r="8"/><circle class="eye" cx="80" cy="64" r="8"/></g>
<path class="line" d="M50 82 Q64 90 78 82"/>
</svg>`,
  },
  {
    id: 'avatar-blob-breath',
    title: 'Breathing blob',
    summary: 'A soft round shape that breathes slowly, with a calm face. Change .bg and .blob; the face reads on any light blob.',
    tags: ['avatar', 'seed', 'animated', 'soft'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<style>.bg{fill:#2F4858}.blob{fill:#86E3CE}.ink{fill:#1B2A33}
.b{transform-origin:64px 70px;animation:breathe 4.5s ease-in-out infinite}
@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}${STILL}</style>
<rect class="bg" width="128" height="128" rx="28"/>
<g class="b"><path class="blob" d="M64 22c22 0 42 16 42 44s-18 42-42 42-42-14-42-42 20-44 42-44z"/>
<circle class="ink" cx="50" cy="62" r="5"/><circle class="ink" cx="78" cy="62" r="5"/>
<path class="ink" d="M54 78q10 8 20 0" fill="none" stroke="#1B2A33" stroke-width="4" stroke-linecap="round"/></g>
</svg>`,
  },
  {
    id: 'avatar-monogram-ring',
    title: 'Monogram in a ring',
    summary: 'Two letters inside a gradient ring. Replace the letters in the <text> element with your own initials, and the two stop colours.',
    tags: ['avatar', 'seed', 'static', 'letters'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7B5CFF"/><stop offset="1" stop-color="#00C2D1"/></linearGradient></defs>
<rect width="128" height="128" rx="28" fill="#14152B"/>
<circle cx="64" cy="64" r="44" fill="none" stroke="url(#g)" stroke-width="10"/>
<text x="64" y="66" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="38" font-weight="800" fill="#FFFFFF" text-anchor="middle" dominant-baseline="middle">AI</text>
</svg>`,
  },
  {
    id: 'avatar-orbit',
    title: 'Planet with a moon',
    summary: 'A planet with a small moon that circles it slowly. Change .bg, .planet, .ring and .moon; the orbit time is in the animation.',
    tags: ['avatar', 'seed', 'animated', 'space'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<style>.bg{fill:#0F1A3C}.planet{fill:#FFB547}.ring{fill:none;stroke:#FFE3A8;stroke-width:4}.moon{fill:#E9F1FF}
.orbit{transform-origin:64px 64px;animation:spin 12s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}${STILL}</style>
<rect class="bg" width="128" height="128" rx="28"/>
<circle cx="24" cy="26" r="2" fill="#E9F1FF"/><circle cx="104" cy="98" r="2" fill="#E9F1FF"/><circle cx="98" cy="20" r="1.5" fill="#E9F1FF"/>
<circle class="planet" cx="64" cy="64" r="26"/>
<ellipse class="ring" cx="64" cy="64" rx="42" ry="12" transform="rotate(-18 64 64)"/>
<g class="orbit"><circle class="moon" cx="64" cy="14" r="7"/></g>
</svg>`,
  },
  {
    id: 'avatar-pixel-face',
    title: 'Pixel face',
    summary: 'An eight-by-eight pixel face, like an old game sprite. Change .bg and .px, or move the squares to draw another face.',
    tags: ['avatar', 'seed', 'static', 'pixel'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" shape-rendering="crispEdges">
<style>.bg{fill:#FCE38A}.px{fill:#3D2C8D}.ch{fill:#F38181}</style>
<rect class="bg" width="128" height="128" rx="20"/>
<g transform="translate(16 16)">
<rect class="px" x="24" y="0" width="48" height="12"/><rect class="px" x="12" y="12" width="12" height="12"/><rect class="px" x="72" y="12" width="12" height="12"/>
<rect class="px" x="0" y="24" width="12" height="48"/><rect class="px" x="84" y="24" width="12" height="48"/>
<rect class="px" x="24" y="36" width="12" height="12"/><rect class="px" x="60" y="36" width="12" height="12"/>
<rect class="ch" x="12" y="54" width="12" height="8"/><rect class="ch" x="72" y="54" width="12" height="8"/>
<rect class="px" x="24" y="60" width="12" height="12"/><rect class="px" x="60" y="60" width="12" height="12"/><rect class="px" x="36" y="72" width="24" height="12"/>
<rect class="px" x="12" y="72" width="12" height="12"/><rect class="px" x="72" y="72" width="12" height="12"/><rect class="px" x="24" y="84" width="48" height="12"/>
</g>
</svg>`,
  },
  {
    id: 'avatar-spark',
    title: 'Turning spark',
    summary: 'A four-pointed spark that turns slowly on a gradient tile. Change the two stop colours and .spark.',
    tags: ['avatar', 'seed', 'animated', 'abstract'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><radialGradient id="t" cx=".3" cy=".25" r="1"><stop offset="0" stop-color="#FF9A62"/><stop offset="1" stop-color="#C2185B"/></radialGradient></defs>
<style>.spark{fill:#FFFFFF}.s{transform-origin:64px 64px;animation:turn 16s linear infinite}
@keyframes turn{to{transform:rotate(360deg)}}${STILL}</style>
<rect width="128" height="128" rx="28" fill="url(#t)"/>
<g class="s"><path class="spark" d="M64 18 C68 52 76 60 110 64 C76 68 68 76 64 110 C60 76 52 68 18 64 C52 60 60 52 64 18Z"/></g>
<circle cx="96" cy="30" r="5" fill="#FFFFFF" opacity=".8"/>
</svg>`,
  },
  {
    id: 'avatar-cat',
    title: 'Cat with a twitching ear',
    summary: 'A cat face whose left ear twitches now and then. Change .bg, .fur and .nose; the whiskers follow .ink.',
    tags: ['avatar', 'seed', 'animated', 'animal'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<style>.bg{fill:#A0D2EB}.fur{fill:#F4A259}.ink{fill:#2B2D42}.nose{fill:#E5989B}.w{stroke:#2B2D42;stroke-width:2.5;stroke-linecap:round}
.ear{transform-origin:40px 46px;animation:twitch 6s infinite}
@keyframes twitch{0%,88%,100%{transform:rotate(0)}91%{transform:rotate(-12deg)}94%{transform:rotate(4deg)}}${STILL}</style>
<rect class="bg" width="128" height="128" rx="28"/>
<path class="fur ear" d="M28 50 L36 18 L58 40Z"/><path class="fur" d="M100 50 L92 18 L70 40Z"/>
<ellipse class="fur" cx="64" cy="70" rx="40" ry="34"/>
<circle class="ink" cx="49" cy="66" r="5"/><circle class="ink" cx="79" cy="66" r="5"/>
<path class="nose" d="M58 78h12l-6 7z"/>
<line class="w" x1="20" y1="80" x2="44" y2="84"/><line class="w" x1="20" y1="90" x2="44" y2="88"/>
<line class="w" x1="108" y1="80" x2="84" y2="84"/><line class="w" x1="108" y1="90" x2="84" y2="88"/>
</svg>`,
  },
  {
    id: 'avatar-terminal',
    title: 'Terminal with a cursor',
    summary: 'A terminal window with a prompt and a blinking cursor, for an agent that writes code. Change .bg, .win and .prompt, or the prompt sign.',
    tags: ['avatar', 'seed', 'animated', 'code'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<style>.bg{fill:#1E1E2E}.win{fill:#313244}.bar{fill:#45475A}.prompt{fill:#A6E3A1}.cur{fill:#F9E2AF;animation:cur 1.2s steps(1) infinite}
@keyframes cur{50%{opacity:0}}${STILL}</style>
<rect class="bg" width="128" height="128" rx="28"/>
<rect class="win" x="16" y="24" width="96" height="80" rx="12"/>
<rect class="bar" x="16" y="24" width="96" height="16" rx="8"/>
<circle cx="28" cy="32" r="3" fill="#F38BA8"/><circle cx="38" cy="32" r="3" fill="#F9E2AF"/><circle cx="48" cy="32" r="3" fill="#A6E3A1"/>
<path class="prompt" d="M28 58 l14 10 -14 10" fill="none" stroke="#A6E3A1" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<rect class="cur" x="50" y="74" width="22" height="6" rx="2"/>
</svg>`,
  },
  {
    id: 'avatar-emoji-tile',
    title: 'Emoji on a tile',
    summary: 'One emoji on a coloured tile, when a bare emoji is too plain. Replace the sign in the <text> element and the tile colour.',
    tags: ['avatar', 'seed', 'static', 'emoji'],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" rx="28" fill="#FFD166"/>
<circle cx="64" cy="64" r="46" fill="#FFFFFF" opacity=".55"/>
<text x="64" y="70" font-size="64" text-anchor="middle" dominant-baseline="middle">🦊</text>
</svg>`,
  },
];
