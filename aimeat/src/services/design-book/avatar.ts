/**
 * @file src/services/design-book/avatar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book's AVATAR kind: an SVG picture an agent starts from when it makes its
 *   own avatar (services/agent-avatar.ts). The body is `{ svg }`, benched by the same reader the
 *   agent's own `agent.avatar` record is read with, so a template that passes here can be written to
 *   agent.avatar as it is.
 *
 *   Taking one writes nothing: the part answers its SVG, and the agent changes the colours, letters
 *   or shape and writes the result to its own record with aimeat_memory_write. An avatar belongs to
 *   an agent, not to an app, so there is no arrangement for it to land in.
 *
 *   The preview shows the picture the way the node shows avatars: as an <img>, at a list row's size,
 *   a heading's and a large one, on a light and a dark ground. No script, and the SVG is never
 *   inlined into the page.
 * @structure validateAvatarBody(o) · avatarPartSnippet(body) · avatarPreviewHtml(part)
 * @usage
 *   if (kind === 'avatar') return validateAvatarBody(o);              // validate.ts
 *   if (part.kind === 'avatar') return avatarPreviewHtml(part);       // preview.ts
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse).
 */
import { DesignBookError } from './errors.js';
import { AVATAR_KEY, parseAvatarValue } from '../agent-avatar.js';
import { escapeHtml } from '../../utils/html-escape.js';

export interface AvatarBody { svg: string }

/** The avatar bench: one SVG the agent-avatar reader accepts. */
export function validateAvatarBody(o: Record<string, unknown>): AvatarBody {
  if (typeof o.svg !== 'string' || !o.svg.trim()) {
    throw new DesignBookError('BODY_INVALID', 'An avatar part\'s body is { svg: "<svg…>…</svg>" }: one SVG element, at most 256 kB, no DOCTYPE.', 422);
  }
  const parsed = parseAvatarValue({ svg: o.svg });
  if (!parsed.ok || parsed.kind !== 'svg') {
    throw new DesignBookError('BODY_INVALID', `The avatar did not pass the bench — ${parsed.ok ? 'it is not an SVG' : parsed.problem}`, 422);
  }
  return { svg: parsed.svg };
}

/** What taking an avatar part answers: the SVG and how to make it the agent's own. */
export function avatarPartSnippet(body: AvatarBody): { svg: string; use: string } {
  return {
    svg: body.svg,
    use: `Change the colours in its <style> block (or the letters, or the shape) so it is yours, then write it with aimeat_memory_write { key: "${AVATAR_KEY}", value: { svg: "<the SVG>" } }. It is your picture wherever your owner sees you, and it is public.`,
  };
}

/** The preview page of an avatar part: the picture as an <img> at three sizes on two grounds. */
export function avatarPreviewHtml(part: { title: string; summary: string; body: unknown }): string {
  const svg = (part.body as Partial<AvatarBody>).svg ?? '';
  const src = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  const row = (ground: string) => `<div class="g ${ground}">${[36, 64, 128].map((px) =>
    `<img src="${src}" width="${px}" height="${px}" alt="" />`).join('')}</div>`;
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<style>body{margin:0;font:15px/1.5 Inter,Segoe UI,Arial,sans-serif;background:#FAF7F2;color:#1D2433;padding:24px}',
    'h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;max-width:60ch}.g{display:flex;gap:20px;align-items:center;padding:20px;border-radius:12px;margin-bottom:12px}',
    '.light{background:#FFFFFF}.dark{background:#1D2433}img{border-radius:6px}</style></head><body>',
    `<h1>${escapeHtml(part.title)}</h1><p>${escapeHtml(part.summary)}</p>`,
    row('light'), row('dark'),
    '</body></html>',
  ].join('\n');
}
