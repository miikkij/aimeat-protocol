/**
 * @file src/routes/apps/access-code-page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The access-code page a browser gets for a protected app instead of raw ACCESS_DENIED
 *   JSON (the access-code page in front of a protected app, one of the pages the Backend rule lists as
 *   built in a handler). Moved unchanged out of routes/apps/read.ts, which had passed the 800-line
 *   limit; read.ts serves it.
 * @structure accessCodeUnlockPage(req, wrongCode, nonce?)
 * @usage res.type('html').send(accessCodeUnlockPage(req, wrongCode, res.locals.cspNonce));
 * @version-history
 *   v1.0.0 — 2026-10-25 — Moved unchanged from routes/apps/read.ts (max-file-lines). Its history up to
 *     here is read.ts v1.4.0 (2026-08-07, the unlock page) and v1.11.0 (2026-09-26, the hidden field
 *     with the eye).
 */
import { escapeHtml } from '../../utils/html-escape.js';

/**
 * The unlock page a BROWSER gets for a protected app instead of raw JSON: a code field that
 * resubmits the same URL as a plain GET, every non-code query param preserved as hidden inputs.
 * Minimal inline style (the global CSP allows 'unsafe-inline' styles). Bilingual by
 * Accept-Language; `wrongCode` distinguishes a bad code from a missing one.
 *
 * The code is typed hidden, and an eye inside the field shows and hides it (Jouni, 2026-09-26),
 * the same control the App Catalog uses for the code (app-catalog/js/secret-field.js). The eye needs
 * a few lines of script, which run under the response's CSP nonce; without a nonce the page leaves
 * the eye out and the field simply stays hidden.
 */
export function accessCodeUnlockPage(
    req: { path: string; query: Record<string, unknown>; headers: Record<string, unknown> },
    wrongCode: boolean,
    nonce?: string,
): string {
    const fi = String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fi');
    const esc = escapeHtml;
    const hidden = Object.entries(req.query)
        .filter(([k, v]) => k !== 'code' && typeof v === 'string')
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v as string)}">`)
        .join('');
    const t = fi
        ? {
            title: 'Tämä sovellus on suojattu koodilla',
            lead: 'Sovelluksen omistaja on asettanut pääsykoodin. Syötä koodi, niin sovellus aukeaa.',
            wrong: 'Koodi ei täsmännyt. Tarkista se ja yritä uudelleen.',
            label: 'Pääsykoodi', submit: 'Avaa sovellus', show: 'Näytä pääsykoodi', hide: 'Piilota pääsykoodi',
        }
        : {
            title: 'This app is protected by a code',
            lead: 'The app\'s owner set an access code. Enter it to open the app.',
            wrong: 'That code did not match. Check it and try again.',
            label: 'Access code', submit: 'Open the app', show: 'Show the access code', hide: 'Hide the access code',
        };
    const svg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + '<path d="M2 12c2.5-4.5 6-7 10-7s7.5 2.5 10 7c-2.5 4.5-6 7-10 7S4.5 16.5 2 12z"/><circle cx="12" cy="12" r="3"/>'
        + '<path class="off" d="M4 4l16 16"/></svg>';
    const eye = nonce
        ? `<button type="button" class="eye" id="eye" aria-controls="code" aria-pressed="false" aria-label="${esc(t.show)}" title="${esc(t.show)}">${svg}</button>`
        : '';
    const script = nonce
        ? `<script nonce="${esc(nonce)}">(function(){var b=document.getElementById('eye'),i=document.getElementById('code');`
            + `var s=${JSON.stringify(t.show)},h=${JSON.stringify(t.hide)};`
            + 'b.addEventListener(\'click\',function(){var on=i.type===\'password\';i.type=on?\'text\':\'password\';'
            + 'b.setAttribute(\'aria-pressed\',on?\'true\':\'false\');b.setAttribute(\'aria-label\',on?h:s);b.title=on?h:s;});})();</script>'
        : '';
    return `<!DOCTYPE html><html lang="${fi ? 'fi' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(t.title)}</title>
<style>body{box-sizing:border-box;font-family:system-ui,sans-serif;background:#FAFAF8;color:#1c1c1e;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem}
.card{background:#fff;border:1px solid #e3e3de;border-radius:12px;padding:2rem;max-width:420px;width:100%}
h1{font-size:1.15rem;margin:0 0 .5rem}p{font-size:.9rem;line-height:1.55;color:#555;margin:0 0 1rem}
.err{color:#c04b40}label{display:block;font-size:.8rem;color:#555;margin-bottom:.3rem}
.field{position:relative;margin-bottom:1rem}
input#code{width:100%;box-sizing:border-box;padding:.6rem 2.75rem .6rem .75rem;border:1px solid #ccc;border-radius:8px;font-size:1rem}
button[type=submit]{width:100%;padding:.7rem;border:0;border-radius:8px;background:#E8564A;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
.eye{position:absolute;right:2px;top:50%;transform:translateY(-50%);width:40px;height:34px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:#555;cursor:pointer;border-radius:6px}
.eye:hover,.eye[aria-pressed=true]{color:#1c1c1e}.eye:focus-visible{outline:2px solid #E8564A;outline-offset:2px}
.eye .off{display:none}.eye[aria-pressed=true] .off{display:inline}</style></head>
<body><div class="card"><h1>${esc(t.title)}</h1><p>${esc(t.lead)}</p>${wrongCode ? `<p class="err">${esc(t.wrong)}</p>` : ''}
<form method="GET" action="${esc(req.path)}">${hidden}<label for="code">${esc(t.label)}</label>
<div class="field"><input type="password" id="code" name="code" autocomplete="off" spellcheck="false" autofocus required>${eye}</div>
<button type="submit">${esc(t.submit)}</button></form></div>${script}</body></html>`;
}
