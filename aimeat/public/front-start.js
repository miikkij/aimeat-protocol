/**
 * @file front-start.js
 * @description The only script of the front page (front-start.html and front-start.fi.html).
 *   Every part degrades to the static HTML, which carries the first slogan, the first chat
 *   scenario's question and all three audience panels:
 *   1. The hero slogan changes every six seconds, through the page language's list. Not with
 *      reduced motion, and not while the tab is hidden.
 *   2. The chat demo plays one of three scenarios; the chips pick one and "Show again" replays it.
 *   3. The audience tabs show one panel at a time.
 *   4. A signed-in visitor gets a "Your home" link (/v1/home) in place of "Sign in". No
 *      automatic redirect: this page is the public front page, and a signed-in visitor may
 *      still want to read it. A guest's "Sign in" opens the sign-in dialog of the auth lib.
 *   5. The EN/FI link stores the person's pick, so the front page at / keeps it on this device.
 *   6. Sections fade in once as they scroll into view.
 *   An ES module (type="module", deferred by the browser) for its one import, showLoginModal from
 *   /js/services/auth.js, which itself imports nothing; the page has no importmap and needs none.
 * @version-history
 *   v2.1.0 - 2026-11-06 - "Sign in" opens the sign-in dialog on this page instead of going to
 *     /v1/portal (Jouni: the dialog opens at once). A finished sign-in goes to /v1/home.
 *   v2.0.0 - 2026-11-06 - The etusivu-mock v1.4.0 design: slogans, chat demo and audience tabs
 *     replace the level picker and the copy button. Parts 4 and 5 are unchanged.
 *   v1.1.0 - 2026-11-02 - The EN/FI link stores the pick (Jouni: the person can change the language).
 *   v1.0.0 - 2026-10-21 - Initial: level picker (scrolls its answer into view on a phone, quote
 *     marks by language), copy button, signed-in link.
 */
import { showLoginModal } from '/js/services/auth.js';

(function () {
  'use strict';

  var FI = document.documentElement.lang === 'fi';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('js');

  // 1. Hero slogans. The first one is the h1 in the HTML.
  var SLOGANS = {
    fi: [
      "Tekoäly hoitaa tehtävät. Sinä päätät suunnan.",
      "Sinulta suunta. Tekoälyltä vauhti.",
      "Anna tehtävät tekoälylle. Pidä päätökset itselläsi.",
      "Työt saa jakaa. Viimeinen sana pysyy sinulla.",
      "Tekoälylle työlista. Sinulle viimeinen sana.",
      "Sinä sanot minne. Tekoäly auttaa perille.",
      "Palkkaa älyä. Pysy pomona.",
      "Ohjat sinulla. Hevosvoimat tekoälyllä.",
      "Koneelle työhaalarit. Sinulle valtikka.",
      "Koneella on työvuoro. Sinulla on veto-oikeus.",
      "Tekoäly hoitaa rutiinit. Sinulle jää aikaa olennaiseen.",
      "Vähemmän rutiineja. Enemmän aikaa omille ideoille.",
      "Anna tekoälylle töitä. Jätä itsellesi aikaa.",
      "Tekoälylle tehtävät. Sinulle tilaa hengittää.",
      "Työlista lyhenee. Ilta pitenee.",
      "Tekoälyllä on tehtävä. Sinulla on elämä.",
      "Anna koneelle kiire. Ota itsellesi aikaa.",
      "Tekoäly käy kierroksilla. Sinä käyt kävelyllä.",
      "Tekoälyn apua. Sinun näköistä jälkeä.",
      "Enemmän apua. Yhtä paljon sinua.",
      "Tekoäly tekee osansa. Sinä jätät jälkesi.",
      "Oma ajatus. Enemmän voimaa.",
      "Sinun tyylisi. Enemmän käsiä.",
      "Tekoälyltä vauhti. Sinulta luonne.",
      "Tekoäly saa kynän. Käsiala pysyy sinun.",
      "Kone tekee rivejä. Sinä annat niille äänen.",
      "Sinun pääsi. Nyt lisäkäsillä.",
      "Monista voimasi. Säilytä omituisuutesi.",
      "Sinä tuot idean. Tekoäly auttaa toteuttamaan.",
      "Oma idea. Apua ensimmäiseen versioon.",
      "Hyvä idea päässä. Ensimmäinen versio käsissä.",
      "Vähemmän ”pitäisi joskus”. Enemmän ”tästä se alkaa”.",
      "Sinä saat idean. Tekoäly saa töitä.",
      "Sinä kysyt ”mitä jos”. Tekoäly auttaa kokeilemaan.",
      "Tekoäly töihin. Ideat jaloilleen.",
      "Ajatuksesi saivat kädet.",
      "Ideasi muutti pois pöytälaatikosta.",
      "Pieni tiimi. Tekoäly mukana tekemässä.",
      "Sinun osaamisesi. Enemmän apuvoimia.",
      "Yritys voi olla pieni. Suunnitelmat saavat olla suuria.",
      "Pieni porukka. Enemmän mahdollisuuksia.",
      "Sinä olet koko firma. Kaikkea ei tarvitse tehdä yksin.",
      "Tekoäly työpariksi. Sinulle tilaa yrittää.",
      "Toinen käsipari. Ilman toista kahvikuppia.",
      "Lisää apua työpöydälle. Lisäämättä tuoleja.",
      "Firman ainoa ihminen. Ei enää sen ainoa tekijä.",
      "Yksi nimi ovessa. Enemmän apua sen takana.",
      "Tekoäly auttaa työssä. Sinä keskityt olennaiseen.",
      "Vähemmän hoidettavaa. Enemmän tilaa ajatella.",
      "Anna tekoälylle lista. Anna ajatuksille tilaa.",
      "Tekoäly hoitaa osansa. Päähäsi mahtuu muutakin.",
      "Kaiken ei tarvitse asua päässäsi.",
      "Työlista koneelle. Tilaa omille ajatuksille.",
      "Vähemmän välilehtiä päässä.",
      "Sulje pari välilehteä. Myös päästäsi.",
      "Pääkonttorisi soitti. Se pyysi apuvoimia.",
      "Rutiinit muuttivat koneelle. Päähän jäi tilaa.",
      "Hyvä idea ansaitsee apuvoimia.",
      "Oma visio. Enemmän voimaa toteuttaa.",
      "Sinä nostat rimaa. Tekoäly ryhtyy hommiin.",
      "Ajattele isosti. Anna tekoälylle tekemistä.",
      "Anna haaveelle nimi. Anna tekoälylle tehtävä.",
      "Ideasi voi olla suuri. Ensimmäinen tehtävä pieni.",
      "Suuret suunnitelmat kaipaavat työhanskoja.",
      "Laita mahdottomalta kuulostava työlistalle.",
      "Pää pilvissä. Tekoälyn kädet savessa.",
      "Sinä rakennat pilvilinnoja. Tekoäly piirtää portaat.",
      "Tekoäly auttaa. Sinun harkintasi ratkaisee.",
      "Tekoälyltä vaihtoehdot. Sinulta päätös.",
      "Hyvä apuri antaa tilaa omalle järjelle.",
      "Tekoäly saa ehdottaa. Sinä saat kysyä miksi.",
      "Älyä käytössä. Harkinta mukana.",
      "Koneeltakin saa kysyä: miksi?",
      "Tekoäly saa haastaa. Sinä saat sanoa vastaan.",
      "Tekoäly ehdottaa. Sinun ei tarvitse nyökätä.",
      "Tekoäly puhuu sujuvasti. Sinä saat keskeyttää.",
      "Tekoäly avuksesi. Sinun ehdoillasi.",
      "Sinun työsi. Sinun tapasi.",
      "Valitse työkalut. Pidä oma suunta.",
      "Oma tavoite ensin. Työkalu sen mukaan.",
      "Työkalut saavat vaihtua. Ajatus on sinun.",
      "Pidä kiinni tavoitteesta. Pidä vaihtoehdot auki.",
      "Oma tahto. Monta tapaa toteuttaa.",
      "Työkalulle tehtävä. Itsellesi valinnanvara."
    ],
    en: [
      "AI handles the tasks. You set the direction.",
      "You set the course. AI brings the speed.",
      "Hand tasks to AI. Keep the decisions yours.",
      "Work can be shared. The final word stays yours.",
      "A to-do list for AI. The last word for you.",
      "You say where. AI helps you get there.",
      "Hire intelligence. Stay the boss.",
      "You hold the reins. AI brings the horsepower.",
      "Overalls for the machine. The crown for you.",
      "The machine is on shift. You hold the veto.",
      "AI handles the routines. You keep time for what matters.",
      "Fewer routines. More time for your own ideas.",
      "Give AI the work. Leave yourself the time.",
      "Tasks for AI. Room to breathe for you.",
      "The to-do list shrinks. The evening grows.",
      "AI has a job. You have a life.",
      "Give the rush to the machine. Take time for yourself.",
      "AI runs at full tilt. You go for a walk.",
      "Help from AI. Results that still look like you.",
      "More help. Just as much of you.",
      "AI does its part. You leave your mark.",
      "Your idea. More power behind it.",
      "Your style. More hands.",
      "Speed from AI. Character from you.",
      "AI gets the pen. The handwriting stays yours.",
      "The machine writes the lines. You give them a voice.",
      "Your mind. Now with extra hands.",
      "Multiply your power. Keep your quirks.",
      "You bring the idea. AI helps make it real.",
      "Your idea. Help with the first version.",
      "A good idea in your head. A first version in your hands.",
      "Less “someday I should.” More “this is where it starts.”",
      "You get the idea. AI gets the work.",
      "You ask “what if.” AI helps you try it.",
      "Put AI to work. Get ideas on their feet.",
      "Your thoughts just got hands.",
      "Your idea moved out of the drawer.",
      "A small team. AI in the making with you.",
      "Your expertise. More helping hands.",
      "The company can be small. The plans can be big.",
      "A small crew. More possibilities.",
      "You are the whole company. You don’t have to do it all alone.",
      "AI as a work partner. Room for you to build.",
      "An extra pair of hands. Without an extra coffee cup.",
      "More help at the desk. Without more chairs.",
      "The only person in the firm. No longer its only maker.",
      "One name on the door. More help behind it.",
      "AI helps with the work. You focus on what matters.",
      "Less to juggle. More room to think.",
      "Give AI the list. Give your thoughts space.",
      "AI handles its share. Your head has room for more.",
      "Not everything has to live in your head.",
      "To-do list to the machine. Space for your own thoughts.",
      "Fewer tabs open in your head.",
      "Close a few tabs. In your head, too.",
      "Your headquarters called. It asked for backup.",
      "Routines moved to the machine. Your head got space.",
      "A good idea deserves backup.",
      "Your vision. More power to make it real.",
      "You raise the bar. AI gets to work.",
      "Think big. Give AI something to do.",
      "Give the dream a name. Give AI a task.",
      "Your idea can be big. The first task can be small.",
      "Big plans need work gloves.",
      "Put the “impossible” on the to-do list.",
      "Head in the clouds. AI’s hands in the dirt.",
      "You build castles in the air. AI draws the stairs.",
      "AI helps. Your judgment decides.",
      "Options from AI. The decision from you.",
      "A good helper leaves room for your own sense.",
      "AI may suggest. You may ask why.",
      "Intelligence in use. Judgment along for the ride.",
      "You’re allowed to ask the machine: why?",
      "AI may push back. You may push back too.",
      "AI suggests. You don’t have to nod along.",
      "AI speaks fluently. You’re allowed to interrupt.",
      "AI at your side. On your terms.",
      "Your work. Your way.",
      "Choose the tools. Keep your own direction.",
      "Your goal first. The tool follows.",
      "Tools may change. The idea stays yours.",
      "Hold the goal. Keep options open.",
      "Your will. Many ways to get there.",
      "A task for the tool. Choice for you."
    ]
  };

  var slogans = SLOGANS[FI ? 'fi' : 'en'];
  var slot = $('#slogan');
  var dots = $('#slogan-dots');
  var DOTS = 12;
  var sIdx = 0;

  // The second sentence of a two-sentence slogan is the sun-coloured half.
  function paintSlogan(text) {
    var m = /^(.+?[.!?])\s+(.+)$/.exec(text);
    slot.textContent = '';
    if (m) slot.appendChild(document.createTextNode(m[1] + ' '));
    var sun = document.createElement('span');
    sun.textContent = m ? m[2] : text;
    slot.appendChild(sun);
  }
  function paintDots() {
    $$('#slogan-dots i').forEach(function (el, i) { el.classList.toggle('on', i === sIdx % DOTS); });
  }
  if (slot && dots && !reduced) {
    for (var d = 0; d < DOTS; d++) dots.appendChild(document.createElement('i'));
    paintDots();
    setInterval(function () {
      if (document.hidden) return;
      sIdx = (sIdx + 1) % slogans.length;
      slot.classList.add('out');
      setTimeout(function () { paintSlogan(slogans[sIdx]); paintDots(); slot.classList.remove('out'); }, 280);
    }, 6000);
  }

  // 2. Chat demo. The names in it are invented.
  var SCENARIOS = FI ? [
    { me: 'Käy kontaktini läpi. Ketä lähestyn tällä viikolla, ja miksi? Auta kirkastamaan tavoite.',
      ai: 'Kävin CADENCEssa läpi 48 kontaktia. Viisi ehdotusta ja perusteet alla. Mitään ei lähde ennen kuin hyväksyt.',
      h: 'CADENCE · seuraavat askeleet',
      rows: [['Acme Oy · päättäjä', 'tarjous auki'], ['NordSoft · sopimus päättyy', 'soita ensin'], ['Tavoite', 'kirkastettu']],
      trail: ['Tekoälyn ehdotus merkitty', 'Hyväksyjä: sinä', 'Muisti: yhteinen'] },
    { me: 'Käynnistä agentti: ehdota seurantaviestit ja valmistele muistiot. Älä lähetä mitään.',
      ai: 'Agentti on valmis. 3 muistiota on luonnoksina ja 2 kalenteriehdotusta odottaa hyväksyntääsi.',
      h: 'Agentti · odottaa sinua',
      rows: [['Muistiot', '3 luonnosta'], ['Kalenteri', '2 ehdotusta'], ['Lähtevät viestit', '0, lukittu']],
      trail: ['Ketju: muisti → agentti → jono', 'Malli merkitty'] },
    { me: 'Tee SAFEREACHiin viestiluonnos NordSoftille ja kirjaa peruste. Älä lähetä ennen hyväksyntää.',
      ai: 'Luonnos on jonossa. Peruste: sopimus päättyy ensi kvartaalilla. Viesti lähtee vasta, kun painat Hyväksy.',
      h: 'SAFEREACH · hyväksyntäjono',
      rows: [['Vastaanottaja', 'NordSoft'], ['Peruste', 'kirjattu'], ['Tila', 'odottaa hyväksyntää']],
      trail: ['Päätösloki tallessa', 'Tekoälyn osuus merkitty'] }
  ] : [
    { me: 'Go through my contacts. Who should I approach this week, and why? Help me sharpen the goal.',
      ai: 'I went through 48 contacts in CADENCE. Five suggestions and the reasons are below. Nothing goes out before you approve it.',
      h: 'CADENCE · next steps',
      rows: [['Acme Ltd · decision maker', 'quote open'], ['NordSoft · contract ends', 'call first'], ['Goal', 'sharpened']],
      trail: ['AI suggestion labelled', 'Approver: you', 'Memory: shared'] },
    { me: 'Start an agent: suggest the follow-ups and prepare the briefs. Send nothing.',
      ai: 'The agent is ready. 3 briefs are drafts and 2 calendar suggestions wait for your approval.',
      h: 'Agent · waiting for you',
      rows: [['Briefs', '3 drafts'], ['Calendar', '2 suggestions'], ['Outgoing messages', '0, locked']],
      trail: ['Chain: memory → agent → queue', 'Model labelled'] },
    { me: 'Draft a message to NordSoft in SAFEREACH and record the reason. Do not send it before I approve.',
      ai: 'The draft is in the queue. Reason: the contract ends next quarter. It goes out only when you press Approve.',
      h: 'SAFEREACH · approval queue',
      rows: [['Recipient', 'NordSoft'], ['Reason', 'recorded'], ['Status', 'waiting for approval']],
      trail: ['Decision log kept', 'AI part labelled'] }
  ];

  var stage = $('#stage');
  var timers = [];
  var current = 0;
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  function later(ms, fn) { timers.push(setTimeout(fn, reduced ? 0 : ms)); }
  function play(i) {
    current = i;
    timers.forEach(clearTimeout);
    timers = [];
    stage.textContent = '';
    $$('#chips button').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-s') === i)); });
    var s = SCENARIOS[i];
    var me = el('div', 'msg me', s.me);
    var typing = el('div', 'typing');
    typing.appendChild(el('i')); typing.appendChild(el('i')); typing.appendChild(el('i'));
    var ai = el('div', 'msg ai', s.ai);
    var card = el('div', 'appcard');
    card.appendChild(el('h4', '', s.h));
    s.rows.forEach(function (r) {
      var row = el('div', 'row');
      row.appendChild(el('span', '', r[0]));
      row.appendChild(el('b', '', r[1]));
      card.appendChild(row);
    });
    var trail = el('div', 'trail');
    s.trail.forEach(function (t) { trail.appendChild(el('b', '', t)); });
    card.appendChild(trail);
    stage.appendChild(me);
    later(150, function () { me.classList.add('show'); });
    if (!reduced) later(900, function () { stage.appendChild(typing); });
    later(2200, function () {
      if (typing.parentNode) typing.parentNode.removeChild(typing);
      stage.appendChild(ai);
      requestAnimationFrame(function () { ai.classList.add('show'); });
    });
    later(3100, function () { stage.appendChild(card); requestAnimationFrame(function () { card.classList.add('show'); }); });
  }
  if (stage) {
    $$('#chips button').forEach(function (b) { b.addEventListener('click', function () { play(+b.getAttribute('data-s')); }); });
    var replay = $('#replay');
    if (replay) replay.addEventListener('click', function () { play(current); });
    play(0);
  }

  // 3. Audience tabs.
  var tabs = $$('#tabs [role="tab"]');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (other) {
        var on = other === tab;
        other.setAttribute('aria-selected', String(on));
        other.tabIndex = on ? 0 : -1;
        var panel = document.getElementById(other.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
    });
  });

  // 4. Signed-in visitor: a link home instead of "Sign in". A guest's "Sign in" opens the node's
  //    sign-in dialog on this page (the auth lib, /v1/libs/aimeat-auth.js, which also has the
  //    register tab); /v1/portal stays the link's address for a browser without the lib.
  var enter = document.getElementById('fs-enter');
  var signedIn = false;
  try {
    var raw = localStorage.getItem('aimeat_session');
    signedIn = !!(raw && JSON.parse(raw).jwt);
  } catch (err) { console.warn('[front-start] session not readable, staying a guest:', err.message); }
  if (enter && signedIn) {
    enter.textContent = FI ? 'Kotiisi' : 'Your home';
    enter.setAttribute('href', '/v1/home');
  }
  if (enter && !signedIn) {
    enter.addEventListener('click', function (e) {
      // The dialog speaks the stored language; the page the person is reading is the better guess.
      try { localStorage.setItem('aimeat-lang', document.documentElement.lang); } catch (err) {
        console.warn('[front-start] storage refused the language, the dialog uses its own pick:', err.message);
      }
      var shown = showLoginModal({
        redirect: '/v1/home',
        onLogin: function () { window.location.assign('/v1/home'); }
      });
      // Without the auth lib the link's own address (/v1/portal) opens the sign-in page instead.
      if (shown) e.preventDefault();
    });
  }

  // 5. The EN/FI link is the person's pick: the address / keeps it on this device.
  $$('.fs-lang').forEach(function (link) {
    link.addEventListener('click', function () {
      var year = ';path=/;max-age=31536000;SameSite=Lax';
      document.cookie = 'aimeat-lang=' + link.getAttribute('lang') + year;
      document.cookie = 'aimeat-lang-chosen=1' + year;
    });
  });

  // 6. Sections fade in once.
  var reveals = $$('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    reveals.forEach(function (r) { io.observe(r); });
  } else {
    reveals.forEach(function (r) { r.classList.add('in'); });
  }
})();
