/**
 * @file offline.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The offline page's script, external because the node CSP refuses inline script.
 *   Picks the language (localStorage 'aimeat-lang' → navigator.language → en), fills the page
 *   texts, and writes notes into the intake queue that the chat drains when the connection is
 *   back. The queue contract lives in /js/intake.js; the small writer copy below exists because
 *   this page must run with the network gone, where a module import is one request too many —
 *   sw.js pre-caches exactly this file and offline.html, nothing else.
 * @structure language table → text fill → IndexedDB writer → save/retry/online handlers
 * @usage <script src="/offline.js"></script> (from /offline.html only)
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial: offline notice + note box feeding the intake queue.
 */
(function () {
  var STRINGS = {
    en: {
      title: 'No connection',
      lead: 'AIMEAT.IO is an online application, and the connection is gone right now. You can still leave a note: it continues into your chat the moment the connection returns.',
      placeholder: 'Write here…',
      save: 'Queue it',
      retry: 'Try again',
      saved: 'Saved. It continues into your chat when the connection returns.',
      queued: 'Queued: ',
      empty: 'Nothing to save yet.',
    },
    fi: {
      title: 'Ei yhteyttä',
      lead: 'AIMEAT.IO toimii verkossa, eikä yhteyttä juuri nyt ole. Voit silti jättää viestin: se jatkaa chattiisi heti, kun yhteys palaa.',
      placeholder: 'Kirjoita tähän…',
      save: 'Laita jonoon',
      retry: 'Yritä uudelleen',
      saved: 'Tallessa. Viesti jatkaa chattiisi, kun yhteys palaa.',
      queued: 'Jonossa: ',
      empty: 'Ei vielä mitään tallennettavaa.',
    },
    es: {
      title: 'Sin conexión',
      lead: 'AIMEAT.IO funciona en línea y ahora mismo no hay conexión. Aun así puedes dejar una nota: seguirá a tu chat en cuanto vuelva la conexión.',
      placeholder: 'Escribe aquí…',
      save: 'Poner en cola',
      retry: 'Reintentar',
      saved: 'Guardado. Seguirá a tu chat cuando vuelva la conexión.',
      queued: 'En cola: ',
      empty: 'Todavía no hay nada que guardar.',
    },
  };
  var lang = (function () {
    try {
      var stored = localStorage.getItem('aimeat-lang');
      if (stored && STRINGS[stored]) return stored;
      var nav = (navigator.language || '').slice(0, 2);
      return STRINGS[nav] ? nav : 'en';
     
    } catch (err) {
      void err;
      return 'en';
    }
  })();
  var T = STRINGS[lang];
  var note = /** @type {HTMLTextAreaElement} */ (document.getElementById('note'));
  document.documentElement.lang = lang;
  document.getElementById('t-title').textContent = T.title;
  document.getElementById('t-lead').textContent = T.lead;
  note.placeholder = T.placeholder;
  document.getElementById('save').textContent = T.save;
  document.getElementById('retry').textContent = T.retry;

  // The intake queue's writer half — the contract lives in /js/intake.js, which this offline
  // document cannot import. Same db, same store, same item shape.
  function withStore(mode, run) {
    return new Promise(function (resolve, reject) {
      var open = indexedDB.open('aimeat-intake', 1);
      open.onupgradeneeded = function () {
        if (!open.result.objectStoreNames.contains('items')) {
          open.result.createObjectStore('items', { autoIncrement: true });
        }
      };
      open.onerror = function () { reject(open.error); };
      open.onsuccess = function () {
        var tx = open.result.transaction('items', mode);
        var out = run(tx.objectStore('items'));
        tx.oncomplete = function () { resolve(out && out.result); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }

  var statusEl = document.getElementById('status');
  function showCount() {
    withStore('readonly', function (store) { return store.count(); })
      .then(function (n) { if (n > 0) statusEl.textContent = T.queued + n; })
       
      .catch(function (err) { void err; });
  }
  showCount();

  document.getElementById('save').addEventListener('click', function () {
    var text = note.value.trim();
    if (!text) { statusEl.textContent = T.empty; return; }
    withStore('readwrite', function (store) {
      return store.add({ at: new Date().toISOString(), source: 'offline', text: text });
    }).then(function () {
      note.value = '';
      statusEl.textContent = T.saved;
      setTimeout(showCount, 1200);
     
    }).catch(function (err) {
      void err;
      statusEl.textContent = T.empty;
    });
  });

  document.getElementById('retry').addEventListener('click', function () { location.reload(); });
  // The moment the browser says the network is back, go — to the chat, which drains the queue.
  window.addEventListener('online', function () { location.replace('/v1/chat'); });
})();
