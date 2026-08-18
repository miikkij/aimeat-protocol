/**
 * @file public/contact-picker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The apex contact picker (TARGET-063 phase 3). An app opens this page as a POPUP; the
 *   owner picks one person; the node mints a handle bound to (this owner, this app, that contact)
 *   and the handle plus a label goes back to the opener. The list itself never leaves this page.
 *
 *   The opener's origin is taken from `window.opener` via the `origin` query parameter the app
 *   passed AND is re-derived server-side into a published app before anything is minted, so a page
 *   that lies about who opened it gets a handle for the app it actually is, or none at all. The
 *   result is posted to that one origin, never broadcast.
 * @usage Served at /contact-picker.html; opened by an app with ?origin=<its own origin>.
 * @version-history
 *   v1.0.0 — 2026-08-17 — Initial.
 */
(function () {
  var params = new URLSearchParams(location.search);
  var appOrigin = params.get('origin') || '';
  var bodyEl = document.getElementById('body');
  var filterEl = /** @type {HTMLInputElement} */ (document.getElementById('filter'));
  var subtitleEl = document.getElementById('subtitle');
  var footEl = document.getElementById('foot');

  var fi = (navigator.language || '').toLowerCase().indexOf('fi') === 0;
  var T = fi ? {
    title: 'Valitse kontakti',
    subtitle: 'Sovellus pyytää saada kirjoittaa yhdelle osoitekirjasi henkilölle. Se ei näe listaasi eikä osoitetta, ja viestin lähettää AIMEAT.',
    filter: 'Suodata…',
    empty: 'Osoitekirjassasi ei ole vielä ketään, jolla on tallennettu sähköpostiosoite. Lisää henkilö profiilisi Kontaktit-välilehdellä.',
    signIn: 'Kirjaudu ensin sisään AIMEATiin tässä selaimessa ja avaa tämä ikkuna uudelleen.',
    noOpener: 'Tämä sivu avataan sovelluksesta. Sovellus ei kertonut mistä se avattiin, joten mitään ei voi antaa sille.',
    failed: 'Valinta ei onnistunut.',
    cancel: 'Peruuta',
    foot: 'Valinta on voimassa kymmenen minuuttia. Voit perua sen poistamalla kontaktin.',
  } : {
    title: 'Choose a contact',
    subtitle: 'An app is asking to write to ONE person in your address book. It never sees your list or their address, and AIMEAT sends the message.',
    filter: 'Filter…',
    empty: 'Nobody in your address book has a saved email address yet. Add a person on the Contacts tab of your profile.',
    signIn: 'Sign in to AIMEAT in this browser first, then open this window again.',
    noOpener: 'This page is opened by an app. The app did not say where it was opened from, so nothing can be handed to it.',
    failed: 'Could not make that choice.',
    cancel: 'Cancel',
    foot: 'A choice lasts ten minutes. Removing the contact cancels it.',
  };

  document.getElementById('title').textContent = T.title;
  subtitleEl.textContent = T.subtitle;
  filterEl.placeholder = T.filter;
  footEl.textContent = T.foot;

  function say(cls, text) {
    bodyEl.innerHTML = '';
    var p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    bodyEl.appendChild(p);
  }

  if (!appOrigin) { say('error-msg', T.noOpener); return; }

  // The SPA's session, same key and same origin. A standalone apex page reads it exactly as the
  // agent-consent page does; there is no second session and no new way to get one.
  var token = '';
  try {
    var raw = localStorage.getItem('aimeat_session');
    if (raw) token = (JSON.parse(raw) || {}).jwt || (JSON.parse(raw) || {}).token || '';
    // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable session is the same answer as no session, and the page already says what to do about that.
  } catch { token = ''; }
  if (!token) { say('empty', T.signIn); return; }

  var all = [];

  function post(result) {
    try {
      if (window.opener) window.opener.postMessage({ type: 'aimeat_contact_pick', result: result }, appOrigin);
        // eslint-disable-next-line aimeat/no-silent-catch -- the opener closing first is a normal end to this flow, not a failure: there is nobody left to tell, and the window closes either way.
    } catch { /* the opener went away */ }
    window.close();
  }

  function choose(contact) {
    fetch('/v1/contacts/handles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ contact_id: contact.contact_id, app_origin: appOrigin }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.data && j.data.handle) post({ ok: true, handle: j.data.handle, contact: j.data.contact });
        else say('error-msg', (j && j.error && j.error.message) || T.failed);
      })
      .catch(function (err) { say('error-msg', T.failed + ' (' + err + ')'); });
  }

  function render() {
    var needle = (filterEl.value || '').trim().toLowerCase();
    var shown = all.filter(function (c) {
      if (!needle) return true;
      return (c.display_name || '').toLowerCase().indexOf(needle) >= 0
        || (c.contact_id || '').toLowerCase().indexOf(needle) >= 0;
    });
    bodyEl.innerHTML = '';
    if (!shown.length) { say('empty', T.empty); return; }
    var list = document.createElement('div');
    list.className = 'list';
    shown.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'item';
      var label = document.createElement('span');
      label.className = 'item-label';
      // textContent, never innerHTML: a contact name is text the owner typed.
      label.textContent = c.display_name || c.contact_id;
      var via = document.createElement('span');
      via.className = 'item-via';
      via.textContent = c.kind === 'mail' ? 'email' : 'inbox';
      b.appendChild(label);
      b.appendChild(via);
      b.addEventListener('click', function () { choose(c); });
      list.appendChild(b);
    });
    bodyEl.appendChild(list);
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'link';
    cancel.textContent = T.cancel;
    cancel.addEventListener('click', function () { post({ ok: false, error: 'cancelled' }); });
    bodyEl.appendChild(cancel);
  }

  filterEl.addEventListener('input', render);

  fetch('/v1/contacts', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var list = (j && j.data && j.data.contacts) || [];
      // Only somebody the node can actually write to is offered. A contact with no saved address
      // would be a choice the handle mint refuses — a control that can never work.
      all = list.filter(function (c) { return !!c.email; });
      render();
    })
    .catch(function (err) { say('error-msg', T.failed + ' (' + err + ')'); });
})();
