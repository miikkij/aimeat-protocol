/**
 * @file intake.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The intake queue: things captured OUTSIDE a working session, waiting for the chat.
 *
 *   Two producers write here. The service worker stores what arrives through the OS share sheet
 *   (share_target in manifest.json — a share POST cannot carry the owner's JWT, so the bytes wait
 *   client-side until an authenticated page picks them up). The offline page stores notes a person
 *   writes while there is no connection. One consumer drains it: the chat view, which turns every
 *   queued item into composer content the person reviews and sends themselves — nothing here is
 *   submitted anywhere on its own.
 *
 *   THE DB CONTRACT (this file is its one canonical description — sw.js and offline.html carry
 *   their own small copies of the open/add code because a classic worker and an offline document
 *   cannot import an ES module):
 *     database 'aimeat-intake' v1, object store 'items' (autoIncrement).
 *     item: { at: ISO string, source: 'share' | 'offline',
 *             title?: string, text?: string, url?: string,
 *             files?: [{ name: string, type: string, blob: Blob }] }
 *
 * @structure readIntake() — all queued items, oldest first · clearIntake() — empty the store ·
 *   intakeText(item) — one item's text parts joined for a composer draft
 * @usage
 *   import { readIntake, clearIntake, intakeText } from '/js/intake.js';
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial: share-target + offline-note queue, drained by the chat.
 */

const DB_NAME = 'aimeat-intake';
const STORE = 'items';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) {
                req.result.createObjectStore(STORE, { autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Every queued item, oldest first. Resolves [] where IndexedDB is unavailable (private mode). */
export async function readIntake() {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    } catch {
        // No IndexedDB means nothing could have been queued on this browser either.
        // eslint-disable-next-line aimeat/no-silent-catch -- empty store and empty answer are the same thing
        return [];
    }
}

/** Empty the queue — called by the consumer AFTER it has taken the items over. */
export async function clearIntake() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/** One item's text parts (title, text, url), joined for a composer draft. '' when it was files-only. */
export function intakeText(item) {
    return [item.title, item.text, item.url]
        .map((part) => (part || '').trim())
        .filter(Boolean)
        .join('\n');
}
