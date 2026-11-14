/**
 * @file install-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one holder of the browser's install offer for the SPA.
 *
 *   A browser never proposes installing on its own: Chrome buries desktop install under
 *   ⋮ → "Cast, save and share" → "Install page as app", and everything else shows nothing at all.
 *   What a Chromium browser DOES do is fire `beforeinstallprompt` once, early, when the page passes
 *   the installability criteria. This module is imported by spa.html's main module so that listener
 *   exists before the event fires; the event is held here, and any view can then render its own
 *   "install" affordance and open the browser's real install dialog with promptInstall().
 *
 *   Only Chromium fires the event. iOS installs through Share → Add to Home Screen only, so the UI
 *   layer shows a hint there instead of a button; a browser with neither (desktop Firefox) gets no
 *   affordance, because instructions that end nowhere are worse than silence.
 * @structure
 *   installAvailable/isInstalled/isIos — what the UI may offer · promptInstall() — open the real
 *   dialog (one-shot per event) · onInstallChange(cb) — re-render hook · dismissInstall/
 *   installDismissed — the person said not now, remembered per browser (per `id` when one is given) ·
 *   installAs({ manifest, title }) — while a page is shown, what installing it installs
 * @usage
 *   import { installAvailable, promptInstall, onInstallChange } from '/js/install-prompt.js';
 *   useEffect(() => installAs({ manifest: '/manifest-apps.json', title: 'Apps' }), []);
 * @version-history
 *   v1.1.0 — 2026-11-14 — installAs(): a page installs as an app of its own (the App Catalog, so a
 *     phone's home screen opens straight to the apps). It points the page's manifest link at its own
 *     manifest while the page is shown, and the browser hands over a new offer for it. The "not now"
 *     is kept per `id`, so declining one offer does not hide the other. Additive.
 *   v1.0.0 — 2026-08-16 — Initial: capture-early holder + prompt + dismissal.
 */

const DISMISS_KEY = 'aimeat-install-dismissed';
const listeners = new Set();

let deferred = null;
let installed = false;

function notify() {
    for (const cb of listeners) cb();
}

// Registered at import time — spa.html imports this module statically, so the listener exists
// before the browser decides installability and fires the one event there will be.
if (typeof window !== 'undefined') {
    installed = window.matchMedia?.('(display-mode: standalone)').matches
        || /** @type {{ standalone?: boolean }} */ (window.navigator).standalone === true;
    window.addEventListener('beforeinstallprompt', (e) => {
        // Held for our own UI — WITHOUT preventDefault. The event fires on every page, but the
        // card renders only where a view mounts it (Home, the chat): cancelling here would
        // suppress the browser's own offer everywhere else and show nothing in its place, which
        // is how "Banner not shown: preventDefault() called" ended up in the console. Both offers
        // may exist; whichever the person meets first installs the same app.
        deferred = e;
        notify();
    });
    window.addEventListener('appinstalled', () => {
        deferred = null;
        installed = true;
        notify();
    });
}

/** The browser has handed over an install offer we can open on demand. */
export function installAvailable() {
    return deferred !== null;
}

/** Already running as an installed app (or installed from this page just now). */
export function isInstalled() {
    return installed;
}

/** An iOS browser: no event ever, Share → Add to Home Screen is the only path. */
export function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

/**
 * Open the browser's real install dialog. One-shot: the event can be used once, so it is released
 * here whatever the person answers. Returns 'accepted' | 'dismissed' | 'unavailable'.
 */
export async function promptInstall() {
    if (!deferred) return 'unavailable';
    const offer = deferred;
    deferred = null;
    notify();
    offer.prompt();
    const choice = await offer.userChoice;
    return choice?.outcome ?? 'dismissed';
}

/** Re-render hook: called when the offer arrives, is used, or the app gets installed. */
export function onInstallChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/**
 * While a page is shown, installing it installs `manifest` (a web-app manifest with an `id` and a
 * `start_url` of its own), named `title` on iOS, whose Add to Home Screen reads the meta tag. The
 * offer the browser held belonged to the manifest before, so it is let go; a Chromium browser reads
 * the changed link and hands over a new one. Returns the function that puts the site's own back:
 * a useEffect's cleanup.
 */
export function installAs({ manifest, title }) {
    if (typeof document === 'undefined') return () => {};
    const link = document.querySelector('link[rel="manifest"]');
    const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    const before = { href: link?.getAttribute('href'), title: meta?.getAttribute('content') };
    const swap = (href, name) => {
        if (link && href && link.getAttribute('href') !== href) {
            link.setAttribute('href', href);
            deferred = null;
            notify();
        }
        if (meta && name) meta.setAttribute('content', name);
    };
    swap(manifest, title);
    return () => swap(before.href, before.title);
}

/** "Not now", remembered per browser so the suggestion does not nag; per `id` for a page's own offer. */
export function dismissInstall(id) {
    try {
        localStorage.setItem(id ? `${DISMISS_KEY}:${id}` : DISMISS_KEY, '1');
     
    } catch (err) { void err; }
    notify();
}

export function installDismissed(id) {
    let stored = null;
    try {
        stored = localStorage.getItem(id ? `${DISMISS_KEY}:${id}` : DISMISS_KEY);
    } catch (err) {
        // Storage blocked: not dismissed is the answer that keeps the offer visible.
        void err;
    }
    return stored === '1';
}
