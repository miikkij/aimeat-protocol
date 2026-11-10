/**
 * @file sdk-offline.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registry entry of aimeat-offline.js: an app keeps working, and opens, with no
 *   connection. Its own file because library-packs/sdk.ts is near its 800-line limit.
 * @structure OFFLINE_PACKS
 * @usage Spread into SDK_PACKS by library-packs/sdk.ts.
 * @version-history
 *   v1.0.0 — 2026-11-10 — Initial.
 */
import type { LibraryPack } from './types.js';

export const OFFLINE_PACKS: LibraryPack[] = [
  {
    id: 'aimeat-offline',
    kind: 'sdk',
    category: 'core',
    title: 'Works with no connection',
    description: 'The app opens and keeps working with no connection: its page is kept on the device, a person\'s data has a copy there, and changes wait in order until the node can be reached.',
    url: '/v1/libs/aimeat-offline.js',
    include: ['<script src="{{BASE_URL}}/v1/libs/aimeat-offline.js"></script>'],
    requires: ['aimeat-auth'],
    license: 'MIT',
    apiSurface: 'AIMEAT.offline',
    aiDoc: [
      'Use it when a person must be able to open the app and work in it on a train, in a cellar or on a plane, and have their changes reach the node later. It has four parts and each works alone. It does not sync for you: the app reads from the node, keeps what it read, and sends its own changes.',
      'THE PAGE OPENS WITH NO CONNECTION. Put <meta name="aimeat-offline" content="shell"> in the head and call AIMEAT.offline.shell.enable() at every start (it answers { ok: true, enabled: true, entries, first } or { ok: false, code, reason }; nothing throws). It works only at the app\'s own address (https://<name>.apps.<node>), where the node serves the worker /sw-offline.js. The worker keeps the page and the scripts, stylesheets, fonts and pictures the page loads, and answers them only when the node gives no answer: with a connection the person always gets the node\'s current version. No answer to a request the app makes in code (a session call, XHR) is ever kept, so no record is in it. shell.status() reads whether the page is kept; shell.disable() deletes the kept copy. An app that also uses aimeat-push keeps its notifications: the same worker carries them.',
      'WHO IS IT, WITH NO CONNECTION. Nobody can sign in while the node gives no answer. The sign-in library then names the person who signed in on this browser last: listen with AIMEAT.auth.on("offline", (who) => openCopyOf(who.owner)) and read AIMEAT.offline.identity() (the same value, or null). It is { owner, ghii, displayName, at }, a name and no credential: open the copy on the device for it, and send nothing until a session arrives. When the network returns the library restores the session by itself and "login" fires; if the node then says nobody is signed in, "logout" fires and the app closes the copy. With the Atelier shell, pass onOffline(who) to AIMEAT.atelier.app().',
      'A COPY ON THE DEVICE. const mine = AIMEAT.offline.copy("tasks", session.owner) gives get(key), set(key, value), kept(key) (when it was kept, ISO), remove(key), keys(), clear() and persistent() (false in a private window: the copy then lasts until the page closes, so say so). Values are plain data. Keep what you read from the node after every successful read, paint from the copy first at start, then read the node. Name the copy by the ACCOUNT, always: two people on one browser must never see each other\'s copy.',
      'CHANGES THAT WAIT. const q = AIMEAT.offline.queue({ name: "tasks", account: session.owner, send, group }) keeps an ordered list across reloads. q.push(change) adds one and tries to send. The queue calls YOUR send(batch) with the oldest change and the ones that follow it under the same group key (group: (change) => change.record), one batch at a time. Answer true when the batch is settled (it landed, or the node refused it and you told the person); answer false or throw when there was no answer at all, and everything stays and is tried again when the browser reports a network, on the next push and once after 20 seconds. q.items(), q.size(), q.drop(test), q.flush(), q.on(fn), q.state() -> { waiting, busy, reachable }. Give every change an id of its own that the receiver takes once: a reload between a send that landed and the list being saved sends that batch again. Show q.state().waiting to the person; a change that waits unseen is a change they think is saved.',
      'TWO PEOPLE CHANGE THE SAME RECORD. The queue does not decide that; the node does. Publish a record on the version you read (AIMEAT.organism.publishRecords with expected versions). When the node answers VERSION_CONFLICT, read the record again, apply your waiting change to the fresh record, and publish again; when the same field was changed on both sides, show both values and let the person choose. Never write a whole stale record over a newer one.',
      'ON SIGN-OUT call AIMEAT.offline.forget(session.owner): it deletes every copy and queue of that account on this device. If changes still wait and you want them sent at the next sign-in, keep them and say so. The kept page is the app\'s code and stays.',
    ].join('\n'),
    changelog: [{ version: '1.0.0', date: '2026-11-10', summary: 'shell (the kept page), identity(), copy() and queue().' }],
    tierHint: 'T1',
    interviewTriggers: ['offline', 'no connection', 'without internet', 'no network', 'on a train', 'airplane', 'field work', 'sync later', 'works offline', 'pwa'],
    sizeEstimate: '~9KB',
    status: 'preview',
    modelTier: 'needs-doc',
    promptGroup: 'core',
    promptTrack: 'atelier',
    promptLine: '- aimeat-offline.js — the app opens and keeps working with no connection: the kept page, a copy of data on the device, and changes that wait in order (`AIMEAT.offline`)',
  },
];
