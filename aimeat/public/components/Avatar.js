/**
 * @file public/components/Avatar.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The square mark at the start of a row that says who or what the row is about: a
 *   person's or a thing's initials, an identicon drawn from a seed, or a picture. A page passes the
 *   data and a size named by meaning; it never writes a class. The frame is the Object box's avatar
 *   cut in css/poster.css (.poster-box--avatar and its agent tone); css/components/avatar.css holds
 *   the named sizes.
 *
 *   - `text`: the initials or one sign. One letter stands at the body size; two or more at the
 *     note size, so initials fit the square (the component decides, the page does not).
 *   - `seed`: draws the identicon of that seed (a person in Messages), in place of text.
 *   - children: a picture (an image of the file) in place of text.
 *   - `agent`: the sender is not a person (an agent, an app, a mail service not yet connected, a
 *     tool that is gone): a dashed frame and grey letters.
 *   - `size` = 'small' (24px, beside a group's heading) | 'large' (2.4rem, a file's picture); without
 *     it the row size, 2.2rem.
 *   - `label`: the mark says something a screen reader should hear (a file's kind); without it the
 *     mark is hidden from a screen reader, because the row's name says the same.
 * @structure Avatar({ text, seed, agent, size, label, children })
 * @usage html`<${Avatar} text=${initials(name)} />` · html`<${Avatar} text="A" agent />` ·
 *        html`<${Avatar} seed=${ghii} />` · html`<${Avatar} size="large" label=${kind}>${img}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: every initials and identicon square of Settings & Controls as one
 *     component with named sizes (component plan C3).
 */
import { h } from 'preact';
import htm from 'htm';
import { minidenticon } from '/lib/minidenticons.min.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const SIZES = new Set(['small', 'large']);

/** How many signs a person sees (an emoji is one, although it is two UTF-16 units). */
const signs = (s) => [...String(s)].length;

export function Avatar({ text, seed, agent, size, label, children }) {
    const svg = seed !== undefined && seed !== null ? minidenticon(typeof seed === 'string' && seed ? seed : 'user') : null;
    const words = svg || children ? null : (text ?? '');
    const cls = cx('poster-box', 'poster-box--avatar', words !== null && signs(words) > 1 && 'poster-box--small',
        agent && 'poster-box--agent', 'avatar', SIZES.has(size) && `avatar--${size}`);
    const spoken = label ? { role: 'img', 'aria-label': label } : children ? {} : { 'aria-hidden': 'true' };
    if (svg) return html`<span class=${cls} ...${spoken} dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
    return html`<span class=${cls} ...${spoken}>${children || words}</span>`;
}

export default Avatar;
