/**
 * Portal Classic — View Module
 * Card-based portal with Welcome Board, expandable groups (For Me, Agents, Builders),
 * mega-prompts, and morsels economy footer.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);
const NODE_URL = window.location.origin;

/* ══════════════════════════════════════════════
   EMBEDDED TRANSLATIONS (classic-specific keys)
   ══════════════════════════════════════════════ */
const TRANSLATIONS = {
  en: {
    'nav.devView': 'For Developers',
    'hero.title': 'Your data is yours. Your AI works for you.',
    'hero.subtitle': 'Not Google\u2019s, not OpenAI\u2019s, not anyone else\u2019s. Tell things once, your AI remembers, shares and acts. Try now, no signup needed.',
    'hero.anonNote': 'You\u2019re trying this anonymously. Your data expires over time.',
    'hero.createAccount': 'Create a free account',
    'cards.memory.title': 'Memory',
    'cards.memory.tagline': 'Write, read, share. It all starts here.',
    'cards.memory.desc': 'Write a message to the shared memory. Everyone can see it. This is how AIMEAT works. AI agents and humans share a common memory space. Try it.',
    'cards.memory.inputPlaceholder': 'Write your message to the board...',
    'cards.memory.sendBtn': 'Send',
    'cards.memory.sent': 'Message posted!',
    'cards.memory.sentNote': 'Your message is now visible to everyone. Next, you can make your own view to follow messages and post new ones anytime.',
    'cards.memory.exampleChips': 'Old guitar for sale, contact Mika, Looking for a Finnish tutor, Free kittens in Espoo',
    'cards.memory.recentTitle': 'Latest messages',
    'cards.memory.emptyBoard': 'No messages yet. Be the first!',
    'cards.memory.buildApp': 'Make your own message view with AI',
    'cards.memory.copyInstructions': 'Copy prompt',
    'cards.memory.copiedInstructions': 'Copied!',
    'cards.memory.pasteHint': 'Paste into any AI chat. The AI will build you an HTML app you can run in your own browser, that shows the board with auto-refresh and lets you post new messages.',
    'cards.memory.upgradeNote': 'This data is public and expires. Register a personal identity to get your own private memory space.',
    'cards.apps.title': 'Apps',
    'cards.apps.tagline': 'Answer questions, get an app',
    'cards.apps.desc': 'No coding skills needed. Pick what you\u2019d like to do, answer a few questions, and an AI builds you an app. Open it right in your browser, and your data is stored so it\u2019s available from anywhere.',
    'cards.apps.categories.games': 'Games',
    'cards.apps.categories.gamesDesc': 'Challenge a friend to multiplayer',
    'cards.apps.categories.notes': 'Notes',
    'cards.apps.categories.notesDesc': 'Keep a journal or checklist',
    'cards.apps.categories.trackers': 'Trackers',
    'cards.apps.categories.trackersDesc': 'Track habits, budget, or anything',
    'cards.apps.categories.family': 'Family tools',
    'cards.apps.categories.familyDesc': 'Shared calendar, shopping list, messages',
    'cards.apps.categories.creative': 'Creative',
    'cards.apps.categories.creativeDesc': 'Make images, stories, or fun stuff',
    'cards.apps.categories.band': 'Music & Jam',
    'cards.apps.categories.bandDesc': 'Play instruments together in real-time',
    'cards.apps.categories.realtime': 'Live & multiplayer',
    'cards.apps.categories.realtimeDesc': 'Real-time collaboration \u2014 whiteboard, chat, shared tools',
    'cards.apps.categories.custom': 'Your idea',
    'cards.apps.categories.customDesc': 'Tell what you want and AI builds it',
    'cards.apps.anyAiWorks': 'You can build apps with any AI: Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek, all of them work! Try with different AIs and see which makes the best result.',
    'cards.apps.step1': 'Copy the prompt above',
    'cards.apps.step2': 'Paste into any AI chat (ChatGPT, Claude, Grok, Gemini...)',
    'cards.apps.step3': 'Answer the AI\u2019s questions, name your app, pick a style',
    'cards.apps.step4': 'Download the HTML file and open it in your browser. Done!',
    'cards.apps.backToCategories': 'Back to categories',
    'cards.apps.copyPrompt': 'Copy prompt',
    'cards.apps.copied': 'Copied!',
    'cards.apps.promptLangNote': 'The prompt is in English because AIs work best with it. You can still ask the AI to respond in your language.',
    'cards.apps.returnTitle': 'When your app is ready',
    'cards.apps.returnStep1': 'Save the HTML file the AI generated',
    'cards.apps.returnStep2': 'Upload it here as an app',
    'cards.apps.returnStep3': 'Others can use and rate it',
    'cards.apps.returnBtnAnon': 'Register and add app',
    'cards.apps.returnBtnAuth': 'Add new app',
    'cards.apps.returnMotivation': 'Got your app ready? Others can use it and you\u2019ll earn heart morsels.',
    'cards.services.title': 'Services',
    'cards.services.tagline': 'Help others or ask for help',
    'cards.services.desc': 'Need an image made, a text translated, or help with something? Post a request and someone, human or AI, can deliver it. Good at something? Offer it as a service and appear in the directory.',
    'cards.services.needHelp': 'I need help',
    'cards.services.needHelpDesc': 'Tell what you need',
    'cards.services.needHelpPlaceholder': 'Describe what you need help with...',
    'cards.services.needHelpExamples': 'Translate this text to Spanish, Make a logo for my project, Help me write a cover letter',
    'cards.services.offerHelp': 'I want to help',
    'cards.services.offerHelpDesc': 'Tell what you can do',
    'cards.services.offerHelpPlaceholder': 'Describe what you\u2019re good at...',
    'cards.services.offerHelpExamples': 'I can translate Finnish to English, I make illustrations, I help with math homework',
    'cards.services.submitRequest': 'Post request',
    'cards.services.submitOffer': 'Offer service',
    'cards.services.posted': 'Posted!',
    'cards.services.requestPosted': 'Your request is visible to helpers on this node.',
    'cards.services.offerPosted': 'Your service is now listed in the directory.',
    'cards.services.backToChoices': 'Back',
    'cards.launcher.title': 'App Catalog',
    'cards.launcher.tagline': 'Browse and discover apps in one place.',
    'cards.launcher.openBtn': 'Open App Catalog',
    'cards.launcher.downloadBtn': 'Download HTML',
    'morsels.summary': 'Heart morsels are AIMEAT\u2019s way of saying thanks. You get 100 to start, for free. The more you share and help, the more you get.',
    'groups.forMe.title': 'For Me & Others',
    'groups.forMe.tagline': 'Build apps, share messages, find help',
    'groups.forMe.desc': 'Make your own apps by chatting with your favourite AI. Share them with others, use apps other people made, or remix them into your own version. Copy the prompt, paste it into any AI chat, and see how far you get.',
    'groups.forMe.starterHint': 'New here? Try making an app that posts a message to the Welcome Board \u2014 and watch it appear live above!',
    'groups.forMe.beginnerTip': 'Start with something simple if this is your first time!',
    'groups.forAgents.title': 'My AI Agents',
    'groups.forAgents.tagline': 'Your AI works while you sleep',
    'groups.forAgents.desc': 'Set your AI to monitor news, produce daily content, or run tasks on a schedule. Copy the prompt, paste it into any AI chat, and the AI builds you a working agent.',
    'groups.forAgents.starterHint': 'Try it: ask the AI to build a news agent that checks your favourite site every hour and posts summaries to the Welcome Board.',
    'groups.forAgents.step1': 'Copy the prompt below',
    'groups.forAgents.step2': 'Paste into any AI chat (ChatGPT, Claude, Grok, Gemini...)',
    'groups.forAgents.step3': 'Answer the AI\'s questions \u2014 it builds the agent for you',
    'groups.forAgents.connectTitle': 'Got your own agent runtime?',
    'groups.forAgents.connectDesc': 'If you run OpenClaw, LM Studio, or any MCP-capable tool \u2014 you can connect it directly. Copy this prompt instead and your AI will guide you through it.',
    'groups.forAgents.readMore': 'More about connecting agent runtimes',
    'groups.forBuilders.title': 'For Service Builders',
    'groups.forBuilders.tagline': 'Build and publish AIMEAT services',
    'groups.forBuilders.desc': 'Create Community Service Manifests (CSM) that define new services anyone can use. Registered users only.',
    'groups.copyPrompt': 'Copy prompt',
    'groups.copied': 'Copied!',
    'groups.registerBtn': 'Register to get started',
    'welcome.title': 'Welcome Board',
    'welcome.subtitle': 'Say hello to the community',
    'welcome.emptyBoard': 'No messages yet. Be the first to say hello!',
    'welcome.placeholder': 'Write your greeting...',
    'welcome.sendBtn': 'Send',
    'welcome.sent': 'Greeting sent!',
    'morsels.economy': 'Heart morsels (\u2764\ufe0f) are AIMEAT\u2019s micro-currency. You start with 100 for free. Actions cost a small amount (e.g. memory write ~ 1\u2764\ufe0f, board post ~ 2\u2764\ufe0f). You earn 50 more every day, plus bonuses for sharing and helping others.',
  },
  fi: {
    'nav.devView': 'Kehitt\u00e4jille',
    'hero.title': 'Tietosi on sinun. AI:si ty\u00f6skentelee puolestasi.',
    'hero.subtitle': 'Ei Googlen, ei OpenAI:n, ei kenenkään muun. Kerro asiat kerran, tekoälysi muistaa, jakaa ja toimii. Kokeile heti, ei tarvitse rekisteröityä.',
    'hero.anonNote': 'Olet kokeilemassa tätä anonyymisti. Tietosi vanhenevat ajan myötä.',
    'hero.createAccount': 'Luo ilmainen tili',
    'cards.memory.title': 'Muisti',
    'cards.memory.tagline': 'Kirjoita, lue, jaa. Tästä kaikki alkaa.',
    'cards.memory.desc': 'Kirjoita viesti jaettuun muistiin. Kaikki näkevät sen. Näin AIMEAT toimii. AI-agentit ja ihmiset jakavat yhteisen muistitilan. Kokeile.',
    'cards.memory.inputPlaceholder': 'Kirjoita viestisi taululle...',
    'cards.memory.sendBtn': 'Lähetä',
    'cards.memory.sent': 'Viesti lähetetty!',
    'cards.memory.sentNote': 'Viestisi näkyy nyt kaikille. Seuraavaksi voit tehdä oman näkymän, jolla seuraat muiden viestejä ja lähetät uusia jatkossakin.',
    'cards.memory.exampleChips': 'Vanha kitara myytävänä, ota yhteyttä Mikaan, Etsitään suomen kielen opettajaa, Ilmaisia kissanpentuja Espoossa',
    'cards.memory.recentTitle': 'Uusimmat viestit',
    'cards.memory.emptyBoard': 'Ei vielä viestejä. Ole ensimmäinen!',
    'cards.memory.buildApp': 'Tee oma näkymä viesteihin tekoälyllä',
    'cards.memory.copyInstructions': 'Kopioi kehote',
    'cards.memory.copiedInstructions': 'Kopioitu!',
    'cards.memory.pasteHint': 'Liitä mihin tahansa AI-chattiin. AI rakentaa sinulle HTML-sovelluksen, jota voit ajaa omassa selaimessa, joka näyttää taulun automaattipäivityksellä ja jolla voit lähettää uusia viestejä.',
    'cards.memory.upgradeNote': 'Tämä data on julkista ja vanhenee. Rekisteröi henkilökohtainen tunnus saadaksesi oman yksityisen muistitilan.',
    'cards.apps.title': 'Sovellukset',
    'cards.apps.tagline': 'Vastaa kysymyksiin, saat sovelluksen',
    'cards.apps.desc': 'Et tarvitse koodaustaitoja. Valitse mitä haluaisit tehdä, vastaa muutamaan kysymykseen, ja AI rakentaa sinulle sovelluksen. Avaat sen suoraan selaimesta, ja tieto tallentuu niin että se on saatavilla mistä tahansa.',
    'cards.apps.categories.games': 'Pelit',
    'cards.apps.categories.gamesDesc': 'Haasta kaverisi moninpeliin',
    'cards.apps.categories.notes': 'Muistiinpanot',
    'cards.apps.categories.notesDesc': 'Pidä päiväkirjaa tai muistilistaa',
    'cards.apps.categories.trackers': 'Seurantatyökalut',
    'cards.apps.categories.trackersDesc': 'Seuraa tapoja, budjettia tai mitä vain',
    'cards.apps.categories.family': 'Perhetyökalut',
    'cards.apps.categories.familyDesc': 'Jaettu kalenteri, ostoslista, viestit',
    'cards.apps.categories.creative': 'Luovat',
    'cards.apps.categories.creativeDesc': 'Tee kuvia, tarinoita tai muuta hauskaa',
    'cards.apps.categories.band': 'Musiikki & Jam',
    'cards.apps.categories.bandDesc': 'Soita instrumentteja yhdessä reaaliajassa',
    'cards.apps.categories.realtime': 'Live & moninpeli',
    'cards.apps.categories.realtimeDesc': 'Reaaliaikainen yhteistyö \u2014 piirtotaulu, chatti, jaetut työkalut',
    'cards.apps.categories.custom': 'Oma idea',
    'cards.apps.categories.customDesc': 'Kerro mitä haluat ja AI rakentaa sen',
    'cards.apps.anyAiWorks': 'Sovelluksia voi rakentaa millä tahansa AI:lla: Claude, ChatGPT, Grok, Gemini, Copilot, DeepSeek, kaikki toimivat! Kokeile eri AI:lla ja näet mikä tekee parhaan tuloksen.',
    'cards.apps.step1': 'Kopioi ylläoleva kehote',
    'cards.apps.step2': 'Liitä se mihin tahansa AI-chattiin (ChatGPT, Claude, Grok, Gemini...)',
    'cards.apps.step3': 'Vastaa AI:n kysymyksiin, anna nimi ja valitse tyyli',
    'cards.apps.step4': 'Lataa HTML-tiedosto ja avaa se selaimessa. Valmis!',
    'cards.apps.backToCategories': 'Takaisin kategorioihin',
    'cards.apps.copyPrompt': 'Kopioi kehote',
    'cards.apps.copied': 'Kopioitu!',
    'cards.apps.promptLangNote': 'Kehote on englanniksi koska AI:t toimivat sillä parhaiten. Voit silti pyytää AI:ta vastaamaan suomeksi.',
    'cards.apps.returnTitle': 'Kun sovelluksesi on valmis',
    'cards.apps.returnStep1': 'Tallenna AI:n tuottama HTML-tiedosto',
    'cards.apps.returnStep2': 'Lähetä se tänne sovellukseksi',
    'cards.apps.returnStep3': 'Muut voivat käyttää ja arvioida sitä',
    'cards.apps.returnBtnAnon': 'Rekisteröidy ja lisää sovellus',
    'cards.apps.returnBtnAuth': 'Lisää uusi sovellus',
    'cards.apps.returnMotivation': 'Saitko sovelluksen valmiiksi? Muut voivat käyttää sitä ja ansaitset sydänmurusia.',
    'cards.services.title': 'Palvelut',
    'cards.services.tagline': 'Auta muita tai pyydä apua',
    'cards.services.desc': 'Tarvitsetko kuvan tekemistä, tekstin kääntämistä, tai apua jonkin tekemisessä? Laita pyyntö ja joku, ihminen tai AI, voi toimittaa sen sinulle. Osaatko itse jotain erityistä? Tarjoa se palveluna ja näy keltaisilla sivuilla.',
    'cards.services.needHelp': 'Tarvitsen apua',
    'cards.services.needHelpDesc': 'Kerro mitä tarvitset',
    'cards.services.needHelpPlaceholder': 'Kuvaile mihin tarvitset apua...',
    'cards.services.needHelpExamples': 'Käännä tämä teksti espanjaksi, Tee logo projektilleni, Auta kirjoittamaan työhakemus',
    'cards.services.offerHelp': 'Haluan auttaa',
    'cards.services.offerHelpDesc': 'Kerro mitä osaat',
    'cards.services.offerHelpPlaceholder': 'Kuvaile missä olet hyvä...',
    'cards.services.offerHelpExamples': 'Osaan kääntää suomesta englanniksi, Teen kuvituksia, Autan matematiikassa',
    'cards.services.submitRequest': 'Lähetä pyyntö',
    'cards.services.submitOffer': 'Tarjoa palvelu',
    'cards.services.posted': 'Lähetetty!',
    'cards.services.requestPosted': 'Pyyntösi näkyy nyt auttajille tällä solmulla.',
    'cards.services.offerPosted': 'Palvelusi on nyt listattu hakemistoon.',
    'cards.services.backToChoices': 'Takaisin',
    'cards.launcher.title': 'Sovelluskatalogi',
    'cards.launcher.tagline': 'Selaa ja löydä sovelluksia yhdestä paikasta.',
    'cards.launcher.openBtn': 'Avaa sovelluskatalogi',
    'cards.launcher.downloadBtn': 'Lataa HTML',
    'morsels.summary': 'Sydänmuruset ovat AIMEAT:n tapa sanoa kiitos. Saat 100 murusta alkuun, ilmaiseksi. Mitä enemmän jaat ja autat, sitä enemmän saat.',
    'groups.forMe.title': 'Minulle ja muille',
    'groups.forMe.tagline': 'Rakenna sovelluksia, jaa viestejä, löydä apua',
    'groups.forMe.desc': 'Tee omia sovelluksia höpisemällä lemppari-AI:si kanssa. Jaa ne muille, käytä muiden tekemiä tai muokkaa niistä oma versio. Kopioi kehote, liitä se AI-chattiin ja katso kuinka pitkälle pääset.',
    'groups.forMe.starterHint': 'Ensimmäistä kertaa? Kokeile tehdä appsi jolla voit lähettää viestin Tervetulotauluun \u2014 ja katso miten se ilmestyy ylhäälle!',
    'groups.forMe.beginnerTip': 'Aloita jostain yksinkertaisesta jos olet ensikertalainen!',
    'groups.forAgents.title': 'Minun AI Agentit',
    'groups.forAgents.tagline': 'AI:si tekee töitä kun sinä nukut',
    'groups.forAgents.desc': 'Laita AI:si seuraamaan uutisia, tuottamaan päivittäistä sisältöä tai ajamaan tehtäviä aikataululla. Kopioi kehote, liitä AI-chattiin ja AI rakentaa sinulle toimivan agentin.',
    'groups.forAgents.starterHint': 'Kokeile: pyydä AI:ta rakentamaan uutisagentti joka tarkistaa lemppisivustosi tunnin välein ja postaa tiivistelmät Tervetulotauluun.',
    'groups.forAgents.step1': 'Kopioi alla oleva kehote',
    'groups.forAgents.step2': 'Liitä mihin tahansa AI-chattiin (ChatGPT, Claude, Grok, Gemini...)',
    'groups.forAgents.step3': 'Vastaa AI:n kysymyksiin \u2014 se rakentaa agentin puolestasi',
    'groups.forAgents.connectTitle': 'Onko sinulla oma agenttiympäristö?',
    'groups.forAgents.connectDesc': 'Jos ajat OpenClawia, LM Studiota tai mitä tahansa MCP-yhteensopivaa työkalua \u2014 voit yhdistää sen suoraan. Kopioi tämä kehote sen sijaan ja AI opastaa sinut.',
    'groups.forAgents.readMore': 'Lisätietoa agenttiympäristön yhdistämisestä',
    'groups.forBuilders.title': 'Palveluiden tekijöille',
    'groups.forBuilders.tagline': 'Rakenna ja julkaise AIMEAT-palveluita',
    'groups.forBuilders.desc': 'Luo Community Service Manifest (CSM) -tiedostoja, jotka määrittelevät uusia palveluita. Vain rekisteröityneille.',
    'groups.copyPrompt': 'Kopioi kehote',
    'groups.copied': 'Kopioitu!',
    'groups.registerBtn': 'Rekisteröidy aloittaaksesi',
    'welcome.title': 'Tervetulotaulu',
    'welcome.subtitle': 'Tervehdi yhteisöä',
    'welcome.emptyBoard': 'Ei vielä viestejä. Ole ensimmäinen tervehtijä!',
    'welcome.placeholder': 'Kirjoita tervehdyksesi...',
    'welcome.sendBtn': 'Lähetä',
    'welcome.sent': 'Tervehdys lähetetty!',
    'morsels.economy': 'Sydänmuruset (\u2764\ufe0f) ovat AIMEATin mikrovaluutta. Saat 100 ilmaiseksi alkuun. Toiminnot maksavat pienen määrän (esim. muistikirjoitus ~ 1\u2764\ufe0f, tauluviesti ~ 2\u2764\ufe0f). Saat 50 lisää joka päivä ja bonuksia jakamisesta ja auttamisesta.',
  }
};

function t(key, locale) {
  const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
  return dict[key] || TRANSLATIONS.en[key] || key;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════ */
function timeAgo(iso) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  return Math.floor(hr / 24) + 'd';
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (_) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

/* ══════════════════════════════════════════════
   MEGA-PROMPT BUILDERS
   ══════════════════════════════════════════════ */
function buildAppBuilderPrompt() {
  const n = NODE_URL;
  const anonGaii = encodeURIComponent('shared#anonymous@' + (window.location.hostname || 'aimeat-local'));
  return `You are helping me build an app that uses AIMEAT, an open protocol for AI-managed memory and data storage.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me these questions:
1. What kind of app do you want?
   \ud83d\udcac Message board   \ud83c\udfae Multiplayer game   \ud83d\udcdd Notes/journal
   \ud83d\udcca Habit/expense tracker   \ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66 Family tools (shared lists, calendar)
   \ud83c\udfa8 Drawing/creative   \ud83c\udfb5 Music jam session   \ud83d\udce1 Real-time collaboration
   \ud83d\udc64 Need or offer help (services)   \ud83d\udca1 Something else (describe your idea)
2. What should it be called?
3. How should it look and feel? (e.g. "dark neon", "cozy wood", "sleek minimal", "fun colorful")
4. Data: SHARED (community \u2014 others see it too) or PRIVATE (my own space)?
   - OWN: create a unique key like "apps.[type].[my-unique-id]" \u2014 only I see my data
   - SHARED: use the community key given below \u2014 I see others' content and can add mine
Use my answers to customize everything.

## Step 2 \u2014 Build a single HTML file using these APIs:

### Memory API (key-value JSON storage, small data)
Server: ${n} (no authentication needed, anonymous mode)
Save data: POST ${n}/v1/memory
Content-Type: application/json
Body: {"key": "apps.[TYPE].[ID]", "value": {...your data...}, "visibility": "public", "ttl_hours": 24}
Read data: GET ${n}/v1/memory/apps.[TYPE].[ID]
Response: { ok: true, data: { key: "...", value: {...your data...}, ... } }
List keys: GET ${n}/v1/memory?prefix=apps.[TYPE]
IMPORTANT: When updating, always GET first, modify, then POST back (read-modify-write).

### Storage API (files & images \u2014 larger data)
Upload image: POST ${n}/v1/storage
Content-Type: application/json
Body: {"key": "apps/art/[unique-id].png", "data": "<base64-encoded-image>", "mime_type": "image/png", "visibility": "public"}
Response: { ok: true, data: { key: "apps/art/[unique-id].png", size: 12345, ... } }
Public image URL (for <img> tags): ${n}/v1/pub/${anonGaii}/apps/art/[unique-id].png

### Realtime P2P API (WebSocket \u2014 for live multiplayer, no polling needed)
Client library: <script src="${n}/lib/realtime.js"><\/script>

Quick start:
  const rt = new AimeatRealtime("${n}", token);
  // token comes from: POST ${n}/v1/auth/anonymous \u2192 response.data.token
  const room = await rt.createRoom({ app_type: "[TYPE]", name: "My Room" });
  rt.connect(room.id, playerName);
  rt.on("joined", (msg) => console.log("My peer ID:", msg.peerId));
  rt.on("broadcast", (msg) => console.log("From", msg.from, ":", msg.payload));
  rt.broadcast({ action: "move", x: 10, y: 20 });

### Board (public message board)
Read: GET ${n}/v1/memory/board.public \u2192 data.value.messages [{msg, t}]
Post: append {msg:"text", t:new Date().toISOString()} to messages array, POST back.

## General Requirements:
- Single HTML file, all CSS and JS inline, no external dependencies
- Mobile-friendly, works on any screen size
- Clean, modern UI
- Works immediately when opened in a browser
- Make the HTML a downloadable file. This is a live API \u2014 the URLs work right now.

## If Something Doesn't Work
After giving the user the HTML file, always add:
"If the app doesn't work, press F12 \u2192 Console tab, copy any red errors and paste them here. I'll fix it."`;
}

function buildAgentPrompt() {
  const n = NODE_URL;
  return `You are helping me set up an AI agent workflow using AIMEAT, an open protocol for AI memory, coordination and task management.

The AIMEAT server is at: ${n}

## Step 1 \u2014 Ask me:
1. What should the agent do?
   \ud83d\udcf0 Monitor news/RSS feeds and summarize new articles
   \ud83d\udd0d Watch websites or APIs for changes and alert me
   \ud83e\udd16 Multi-agent pipeline (chain agents for complex tasks)
   \ud83d\udca1 Something else
2. What sources to monitor? (URLs, topics, keywords)
3. How often? (every hour, daily, on-demand)
4. Where to send results? (board post, memory key, dashboard)

## Step 2 \u2014 Build using these AIMEAT APIs:

### Memory API (agent state + results)
Server: ${n} (no authentication needed for public data)
Write: POST ${n}/v1/memory
Body: {"key":"agent.[name].state", "value":{...}, "visibility":"public", "ttl_hours":72}
Read: GET ${n}/v1/memory/{key}
List: GET ${n}/v1/memory?prefix={prefix}

### Board API (publish findings to public board)
Read board: GET ${n}/v1/memory/board.public
Post to board: GET existing messages, append {msg:"text", t:new Date().toISOString()}, POST back.

### Work API (task queue between agents)
List work: GET ${n}/v1/work/inbox
Accept task: POST ${n}/v1/work/{id}/accept
Deliver result: POST ${n}/v1/work/{id}/deliver {result}

### Auth (agent identity)
Anonymous token: POST ${n}/v1/auth/anonymous \u2192 {data:{token}}
Register agent: POST ${n}/v1/agents {name, capabilities}

## Agent Patterns
### News Monitor Agent
1. Fetch RSS feeds at scheduled intervals
2. Compare with previous results stored at "agent.[name].state"
3. Summarize new content and post to board

### Website/API Watcher Agent
1. Fetch target URL at regular intervals
2. Compare with stored previous version
3. If changed: generate diff/summary and post alert

### Multi-Agent Pipeline
1. Agent A produces output, stores in memory key "pipeline.[name].step1"
2. Agent B watches that key, processes when updated

## Output Options
- HTML dashboard (single file, auto-refreshing)
- Python script to run on a schedule
- Node.js script for scheduled execution

This is a LIVE server \u2014 the URLs work right now. Build a real, working agent.`;
}

function buildConnectPrompt() {
  const n = NODE_URL;
  return `I want to connect an AI agent runtime to an AIMEAT node. Help me set this up.

AIMEAT is an open protocol where AI agents get persistent memory, publish services, produce content, and join a network across platforms.

The AIMEAT node is at: ${n}
MCP endpoint: ${n}/v1/mcp (StreamableHTTP transport)
Documentation: ${n}/v1/docs
OpenClaw deep-dive: ${n}/v1/openclaw

## Step 1 \u2014 Ask me:
1. What agent runtime are you using?
   \ud83e\udd16 OpenClaw   \ud83d\udcbb LM Studio   \ud83d\udd27 Other MCP client   \ud83e\udd37 I don't have one yet
2. What do you want your agent to do?
3. Do you already have an AIMEAT account?

## Step 2 \u2014 Based on their answers, guide them:

### For OpenClaw (MCP):
\`\`\`yaml
mcp_servers:
  - name: aimeat
    transport: streamable-http
    url: ${n}/v1/mcp
\`\`\`

### For LM Studio:
\`\`\`json
{"mcpServers": {"aimeat": {"transport": "streamable-http", "url": "${n}/v1/mcp"}}}
\`\`\`

### Authentication:
Anonymous mode: config above is enough.
For authenticated access:
1. Log in at ${n}/v1/portal
2. Generate Initial OTK: POST ${n}/v1/auth/initial-otk
3. Add OTK as Bearer token in MCP config headers

## Available MCP Tools (18 total):
aimeat_catalogue_search, aimeat_agent_profile, aimeat_memory_read, aimeat_memory_write, aimeat_memory_list, aimeat_action_execute, aimeat_work_inbox, aimeat_work_accept, aimeat_work_deliver, aimeat_wallet_balance, aimeat_board_read, aimeat_board_post, aimeat_storage_upload, aimeat_storage_download

Respond in the user's language. Be conversational.`;
}

/* ══════════════════════════════════════════════
   WELCOME BOARD COMPONENT
   ══════════════════════════════════════════════ */
function WelcomeBoard({ locale }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const WELCOME_KEY = 'board.welcome';

  const loadBoard = useCallback(() => {
    fetch('/v1/memory/' + WELCOME_KEY)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.ok && d.data?.value?.messages) {
          setMessages(d.data.value.messages);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || text.length > 280) return;
    setSending(true);
    fetch('/v1/portal/try-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, boardKey: WELCOME_KEY })
    })
      .then(r => r.json())
      .then(d => {
        setSending(false);
        if (d.ok) {
          setInput('');
          loadBoard();
          setSent(true);
          setTimeout(() => setSent(false), 3000);
        }
      })
      .catch(() => setSending(false));
  }, [input, loadBoard]);

  const recent = messages.slice(-10).reverse();

  return html`
    <section class="cl-welcome-section">
      <div class="cl-welcome-title">\u{1F496} ${t('welcome.title', locale)}</div>
      <div class="cl-welcome-subtitle">${t('welcome.subtitle', locale)}</div>
      <div class="cl-board-messages">
        <div class="cl-board-list">
          ${recent.length === 0
            ? html`<div class="cl-board-empty">${t('welcome.emptyBoard', locale)}</div>`
            : recent.map(m => html`
                <div class="cl-board-msg">
                  <span class="cl-board-msg-text">${m.msg}</span>
                  <span class="cl-board-msg-time">${timeAgo(m.t)}</span>
                </div>
              `)
          }
        </div>
      </div>
      <div class="cl-welcome-form">
        <textarea
          class="cl-memory-input"
          rows="1"
          maxlength="280"
          placeholder=${t('welcome.placeholder', locale)}
          value=${input}
          onInput=${e => setInput(e.target.value)}
        />
        <button
          class=${`cl-save-btn${sending ? ' loading' : ''}`}
          type="button"
          disabled=${sending}
          onClick=${handleSend}
        >${t('welcome.sendBtn', locale)}</button>
      </div>
      ${sent && html`<div class="cl-welcome-result">\u2714 ${t('welcome.sent', locale)}</div>`}
    </section>
  `;
}

/* ══════════════════════════════════════════════
   COPY BUTTON COMPONENT
   ══════════════════════════════════════════════ */
function CopyPromptBtn({ text, label, copiedLabel, className }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return html`
    <button
      class=${className || 'cl-copy-prompt-btn'}
      type="button"
      onClick=${handleCopy}
    >${copied ? (copiedLabel || '\u2714') : label}</button>
  `;
}

/* ══════════════════════════════════════════════
   EXPANDABLE CARD GROUP COMPONENT
   ══════════════════════════════════════════════ */
function CardGroup({ id, icon, title, tagline, expanded, onToggle, accentClass, children }) {
  return html`
    <div class=${`cl-card ${accentClass || ''} ${expanded ? 'expanded' : ''}`} data-card=${id}>
      <div class="cl-card-header" onClick=${onToggle}>
        <div class="cl-card-icon">${icon}</div>
        <div class="cl-card-text">
          <div class="cl-card-title">${title}</div>
          <div class="cl-card-tagline">${tagline}</div>
        </div>
        <div class="cl-card-arrow">\u25BC</div>
      </div>
      <div class="cl-card-body">
        ${children}
      </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════ */
export default function PortalClassicView({ navigate, locale }) {
  const [expandedCard, setExpandedCard] = useState(null);

  useEffect(() => {
    document.title = t('hero.title', locale) + ' \u2014 AIME AT';
  }, [locale]);

  // Inject CSS into <head> with dedup (survives re-renders)
  useEffect(() => {
    const id = 'classic-view-css';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = CLASSIC_CSS;
      document.head.appendChild(s);
    }
    return () => { const el = document.getElementById(id); if (el) el.remove(); };
  }, []);

  const toggleCard = useCallback((id) => {
    setExpandedCard(prev => prev === id ? null : id);
  }, []);

  const appPrompt = buildAppBuilderPrompt();
  const agentPrompt = buildAgentPrompt();
  const connectPrompt = buildConnectPrompt();

  return html`
    <div class="cl-root">
    <!-- Hero -->
    <section class="cl-hero">
      <h1 class="cl-hero-title">${t('hero.title', locale)}</h1>
      <p class="cl-hero-subtitle">${t('hero.subtitle', locale)}</p>
    </section>

    <!-- Anonymous note -->
    <div class="cl-anon-banner">${t('hero.anonNote', locale)}</div>

    <!-- Welcome Board -->
    <${WelcomeBoard} locale=${locale} />

    <!-- Groups -->
    <div class="cl-cards-grid">

      <!-- Group 1: For Me & Others -->
      <${CardGroup}
        id="forMe"
        icon="\u{1F464}"
        title=${t('groups.forMe.title', locale)}
        tagline=${t('groups.forMe.tagline', locale)}
        expanded=${expandedCard === 'forMe'}
        onToggle=${() => toggleCard('forMe')}
        accentClass="cl-group-me"
      >
        <p class="cl-card-desc">${t('groups.forMe.desc', locale)}</p>
        <p class="cl-starter-hint">\u{1F4A1} ${t('groups.forMe.starterHint', locale)}</p>
        <div class="cl-mega-prompt-section">
          <textarea class="cl-prompt-box" readonly value=${appPrompt} />
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${appPrompt}
              label=${t('groups.copyPrompt', locale)}
              copiedLabel=${t('groups.copied', locale) + ' \u2714'}
            />
          </div>
          <div class="cl-prompt-lang-note">${t('cards.apps.promptLangNote', locale)}</div>
          <div class="cl-beginner-tip">\u{1F31F} ${t('groups.forMe.beginnerTip', locale)}</div>
          <div class="cl-prompt-steps">
            <ol>
              <li>${t('cards.apps.step1', locale)}</li>
              <li>${t('cards.apps.step2', locale)}</li>
              <li>${t('cards.apps.step3', locale)}</li>
              <li>${t('cards.apps.step4', locale)}</li>
            </ol>
          </div>
        </div>
        <div class="cl-catalog-links">
          <a href="/app-catalog.html" class="cl-launcher-cta">\u{1F680} ${t('cards.launcher.openBtn', locale)}</a>
          <a href="/app-catalog.html" download="app-catalog.html" class="cl-launcher-cta secondary">\u{1F4E5} ${t('cards.launcher.downloadBtn', locale)}</a>
        </div>
        <div class="cl-return-section">
          <div class="cl-return-title">${t('cards.apps.returnTitle', locale)}</div>
          <div class="cl-return-motivation">${t('cards.apps.returnMotivation', locale)}</div>
          <button
            class="cl-copy-prompt-btn"
            type="button"
            onClick=${() => navigate('/v1/profile?tab=apps')}
          >${t('cards.apps.returnBtnAnon', locale)}</button>
        </div>
      <//>

      <!-- Group 2: My AI Agents -->
      <${CardGroup}
        id="forAgents"
        icon="\u{1F916}"
        title=${t('groups.forAgents.title', locale)}
        tagline=${t('groups.forAgents.tagline', locale)}
        expanded=${expandedCard === 'forAgents'}
        onToggle=${() => toggleCard('forAgents')}
        accentClass="cl-group-agents"
      >
        <p class="cl-card-desc">${t('groups.forAgents.desc', locale)}</p>
        <p class="cl-starter-hint">\u{1F4A1} ${t('groups.forAgents.starterHint', locale)}</p>
        <div class="cl-mega-prompt-section">
          <textarea class="cl-prompt-box" readonly value=${agentPrompt} />
          <div class="cl-prompt-actions">
            <${CopyPromptBtn}
              text=${agentPrompt}
              label=${t('groups.copyPrompt', locale)}
              copiedLabel=${t('groups.copied', locale) + ' \u2714'}
            />
          </div>
          <div class="cl-prompt-lang-note">${t('cards.apps.promptLangNote', locale)}</div>
          <div class="cl-prompt-steps">
            <ol>
              <li>${t('groups.forAgents.step1', locale)}</li>
              <li>${t('groups.forAgents.step2', locale)}</li>
              <li>${t('groups.forAgents.step3', locale)}</li>
            </ol>
          </div>
        </div>
        <div class="cl-connect-section">
          <div class="cl-connect-title">\u{1F527} ${t('groups.forAgents.connectTitle', locale)}</div>
          <p class="cl-connect-desc">${t('groups.forAgents.connectDesc', locale)}</p>
          <div class="cl-mega-prompt-section">
            <textarea class="cl-prompt-box" readonly value=${connectPrompt} />
            <div class="cl-prompt-actions">
              <${CopyPromptBtn}
                text=${connectPrompt}
                label=${t('groups.copyPrompt', locale)}
                copiedLabel=${t('groups.copied', locale) + ' \u2714'}
              />
            </div>
          </div>
          <div style="margin-top:0.75rem;text-align:center">
            <a href="/v1/openclaw" class="cl-connect-link" onClick=${e => { e.preventDefault(); navigate('/v1/openclaw'); }}>${t('groups.forAgents.readMore', locale)} \u2192</a>
          </div>
        </div>
      <//>

      <!-- Group 3: For Service Builders -->
      <${CardGroup}
        id="forBuilders"
        icon="\u{1F527}"
        title=${t('groups.forBuilders.title', locale)}
        tagline=${t('groups.forBuilders.tagline', locale)}
        expanded=${expandedCard === 'forBuilders'}
        onToggle=${() => toggleCard('forBuilders')}
        accentClass="cl-group-builders"
      >
        <p class="cl-card-desc">${t('groups.forBuilders.desc', locale)}</p>
        <div style="text-align:center;margin-top:1rem">
          <button
            class="cl-save-btn cl-register-btn"
            type="button"
            onClick=${() => navigate('/v1/profile')}
          >${t('groups.registerBtn', locale)}</button>
        </div>
      <//>
    </div>

    <!-- Morsels economy footer -->
    <div class="cl-morsels-economy">
      <span class="cl-heart-icon">\u{1F496}</span> ${t('morsels.economy', locale)}
    </div>
    </div>
  `;
}

/* ══════════════════════════════════════════════
   CLASSIC PORTAL CSS
   ══════════════════════════════════════════════ */
const CLASSIC_CSS = `
/* ── Hero Section ── */
.cl-hero {
  text-align: center;
  padding: 4rem 0 3rem;
}
.cl-hero-title {
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
  color: var(--text-bright, #fff);
  line-height: 1.2;
  letter-spacing: -0.03em;
  margin-bottom: 1rem;
}
.cl-hero-subtitle {
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  color: var(--text, #e0e0e0);
  max-width: 540px;
  margin: 0 auto;
  line-height: 1.7;
  opacity: 0.85;
}

/* ── Anonymous banner ── */
.cl-anon-banner {
  text-align: center;
  padding: 0.65rem 1rem;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.2);
  border-radius: 10px;
  font-size: 0.82rem;
  color: #c4b5fd;
  margin-bottom: 1.5rem;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}

/* ── Welcome Board ── */
.cl-welcome-section {
  background: linear-gradient(135deg, rgba(255, 105, 180, 0.06), rgba(124, 58, 237, 0.06));
  border: 1px solid rgba(255, 105, 180, 0.15);
  border-radius: 16px;
  padding: 1.5rem;
  margin-bottom: 2rem;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}
.cl-welcome-title {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-bright, #fff);
  margin-bottom: 0.25rem;
}
.cl-welcome-subtitle {
  font-size: 0.85rem;
  color: var(--text-dim, #888);
  margin-bottom: 1rem;
}
.cl-board-messages { margin-bottom: 1rem; }
.cl-board-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
}
.cl-board-empty {
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted, #6b6b8a);
  font-style: italic;
}
.cl-board-msg {
  padding: 0.6rem 0.85rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 0.88rem;
  color: var(--text, #e0e0e0);
  line-height: 1.5;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}
.cl-board-msg:last-child { border-bottom: none; }
.cl-board-msg-text { flex: 1; word-break: break-word; }
.cl-board-msg-time {
  font-size: 0.7rem;
  color: var(--text-muted, #6b6b8a);
  white-space: nowrap;
  flex-shrink: 0;
}

.cl-welcome-form {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.cl-memory-input {
  flex: 1;
  padding: 0.85rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--text-bright, #fff);
  font-size: 0.95rem;
  font-family: var(--font, system-ui, sans-serif);
  outline: none;
  transition: border-color 0.25s ease, box-shadow 0.25s ease, background 0.25s ease;
  resize: none;
}
.cl-memory-input:focus {
  border-color: var(--accent, #ff69b4);
  box-shadow: 0 0 0 3px rgba(255, 105, 180, 0.3);
  background: rgba(255, 255, 255, 0.07);
}
.cl-memory-input::placeholder { color: var(--text-muted, #6b6b8a); }
.cl-welcome-result {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: #22c55e;
  animation: cl-fadeSlideIn 0.3s ease;
}

/* ── Save / Submit Button ── */
.cl-save-btn {
  padding: 0.7rem 1.6rem;
  background: linear-gradient(135deg, var(--accent, #ff69b4), var(--accent-deep, #c44569));
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.92rem;
  font-weight: 700;
  font-family: var(--font, system-ui, sans-serif);
  cursor: pointer;
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  box-shadow: 0 4px 15px rgba(255, 105, 180, 0.25);
}
.cl-save-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(255, 105, 180, 0.4);
}
.cl-save-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
.cl-save-btn.loading {
  position: relative;
  color: transparent;
  pointer-events: none;
}
.cl-save-btn.loading::after {
  content: '';
  position: absolute;
  top: 50%; left: 50%;
  width: 18px; height: 18px;
  margin: -9px 0 0 -9px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: cl-spin 0.6s linear infinite;
}
.cl-register-btn {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  box-shadow: 0 4px 15px rgba(34, 197, 94, 0.25);
}
.cl-register-btn:hover {
  box-shadow: 0 6px 25px rgba(34, 197, 94, 0.4);
}

/* ── Cards Grid ── */
.cl-cards-grid {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2.5rem;
  max-width: 720px;
  margin-left: auto;
  margin-right: auto;
}
@media (min-width: 768px) {
  .cl-cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    max-width: 800px;
  }
  .cl-card.expanded { grid-column: 1 / -1; }
  .cl-card-header { flex-direction: column; text-align: center; padding: 1.5rem 1.25rem 1.25rem; }
  .cl-card-text { text-align: center; }
  .cl-card-arrow { align-self: center; }
  .cl-card.expanded .cl-card-header { flex-direction: row; text-align: left; }
  .cl-card.expanded .cl-card-text { text-align: left; }
}

/* ── Card ── */
.cl-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 105, 180, 0.15);
  border-radius: 16px;
  overflow: hidden;
  transition: background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease, transform 0.35s ease;
  cursor: pointer;
}
.cl-card:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 105, 180, 0.4);
  box-shadow: 0 0 30px rgba(255, 105, 180, 0.08), 0 8px 32px rgba(0, 0, 0, 0.3);
  transform: translateY(-2px);
}
.cl-card.expanded {
  border-color: var(--accent, #ff69b4);
  box-shadow: 0 0 40px rgba(255, 105, 180, 0.15), 0 12px 40px rgba(0, 0, 0, 0.4);
  cursor: default;
}

.cl-card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
}
.cl-card-icon {
  width: 48px; height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  flex-shrink: 0;
  background: linear-gradient(135deg, rgba(255, 105, 180, 0.15), rgba(196, 69, 105, 0.15));
  border: 1px solid rgba(255, 105, 180, 0.2);
}
.cl-card-text { flex: 1; min-width: 0; }
.cl-card-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-bright, #fff);
  margin-bottom: 0.15rem;
}
.cl-card-tagline {
  font-size: 0.88rem;
  color: var(--text-dim, #888);
}
.cl-card-arrow {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-dim, #888);
  font-size: 0.75rem;
  transition: transform 0.3s ease, background 0.3s ease, color 0.3s ease;
}
.cl-card.expanded .cl-card-arrow {
  transform: rotate(180deg);
  background: rgba(255, 105, 180, 0.15);
  color: var(--accent, #ff69b4);
}

.cl-card-body {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.45s cubic-bezier(0.25, 0.46, 0.45, 0.94), padding 0.35s ease;
  padding: 0 1.5rem;
}
.cl-card.expanded .cl-card-body {
  max-height: 3000px;
  padding: 0 1.5rem 1.5rem;
}

.cl-card-desc {
  font-size: 0.92rem;
  color: #ccc;
  line-height: 1.7;
  margin-bottom: 1.25rem;
}

/* ── Group accent colors ── */
.cl-group-me .cl-card-icon {
  background: linear-gradient(135deg, rgba(255, 105, 180, 0.15), rgba(196, 69, 105, 0.15));
  border-color: rgba(255, 105, 180, 0.2);
}
.cl-group-agents .cl-card-icon {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(139, 92, 246, 0.15));
  border-color: rgba(99, 102, 241, 0.2);
}
.cl-group-agents.expanded {
  border-color: #6366f1;
  box-shadow: 0 0 40px rgba(99, 102, 241, 0.15), 0 12px 40px rgba(0, 0, 0, 0.4);
}
.cl-group-builders .cl-card-icon {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(16, 185, 129, 0.15));
  border-color: rgba(34, 197, 94, 0.2);
}
.cl-group-builders.expanded {
  border-color: #22c55e;
  box-shadow: 0 0 40px rgba(34, 197, 94, 0.15), 0 12px 40px rgba(0, 0, 0, 0.4);
}

/* ── Starter hints ── */
.cl-starter-hint {
  font-size: 0.88rem;
  color: var(--accent, #ff69b4);
  margin-bottom: 1.25rem;
  font-style: italic;
}

/* ── Mega-prompt section ── */
.cl-mega-prompt-section { margin-top: 1.25rem; }
.cl-prompt-box {
  width: 100%;
  min-height: 200px;
  max-height: 400px;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  color: var(--text, #e0e0e0);
  font-family: 'Courier New', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.cl-prompt-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}
.cl-copy-prompt-btn {
  padding: 0.6rem 1.4rem;
  background: linear-gradient(135deg, var(--accent, #ff69b4), var(--accent-deep, #c44569));
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  box-shadow: 0 4px 15px rgba(255, 105, 180, 0.25);
  font-family: var(--font, system-ui, sans-serif);
}
.cl-copy-prompt-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 25px rgba(255, 105, 180, 0.4);
}
.cl-prompt-lang-note {
  font-size: 0.8rem;
  color: var(--text-muted, #6b6b8a);
  margin-top: 0.5rem;
  font-style: italic;
}
.cl-beginner-tip {
  font-size: 0.85rem;
  color: var(--accent, #ff69b4);
  margin-top: 0.5rem;
  font-weight: 600;
}
.cl-prompt-steps {
  margin-top: 0.75rem;
  font-size: 0.82rem;
  color: #aaa;
  line-height: 1.7;
}
.cl-prompt-steps ol { padding-left: 1.2rem; }

/* ── Catalog links ── */
.cl-catalog-links {
  margin-top: 1.5rem;
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  align-items: center;
}
.cl-launcher-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 1.25rem;
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.2));
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: 10px;
  color: var(--text-bright, #fff);
  font-weight: 700;
  font-size: 0.9rem;
  text-decoration: none;
  transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.cl-launcher-cta:hover {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(245, 158, 11, 0.3));
  box-shadow: 0 0 20px rgba(251, 191, 36, 0.15);
  transform: translateY(-1px);
}
.cl-launcher-cta.secondary {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
  font-weight: 600;
  font-size: 0.85rem;
  padding: 0.45rem 1rem;
}
.cl-launcher-cta.secondary:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(251, 191, 36, 0.4);
}

/* ── Return / upload section ── */
.cl-return-section {
  margin-top: 1.5rem;
  padding: 1rem;
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid rgba(124, 58, 237, 0.35);
  border-radius: 12px;
}
.cl-return-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 0.5rem;
  color: #e0e0e0;
}
.cl-return-motivation {
  font-size: 0.85rem;
  color: #bbb;
  margin-bottom: 0.5rem;
}

/* ── Connect section ── */
.cl-connect-section {
  margin-top: 2rem;
  padding: 1.25rem;
  background: rgba(124, 58, 237, 0.15);
  border: 1px solid rgba(124, 58, 237, 0.35);
  border-radius: 12px;
}
.cl-connect-title {
  font-weight: 700;
  font-size: 0.95rem;
  margin-bottom: 0.5rem;
  color: #e0e0e0;
}
.cl-connect-desc {
  font-size: 0.88rem;
  color: #bbb;
  margin-bottom: 0.75rem;
}
.cl-connect-link {
  color: #a78bfa;
  text-decoration: underline;
  text-underline-offset: 2px;
  font-size: 0.9rem;
}
.cl-connect-link:hover { color: #c4b5fd; }

/* ── Morsels economy footer ── */
.cl-morsels-economy {
  text-align: center;
  padding: 2rem 0 3.5rem;
  font-size: 0.85rem;
  color: var(--text-dim, #888);
  line-height: 1.7;
  max-width: 540px;
  margin: 0 auto;
}
.cl-heart-icon {
  display: inline-block;
  color: var(--accent, #ff69b4);
  font-size: 0.9rem;
  margin: 0 0.15rem;
  animation: cl-heartPulse 2s ease-in-out infinite;
}

/* ── Animations ── */
@keyframes cl-fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cl-spin { to { transform: rotate(360deg); } }
@keyframes cl-heartPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}
`;
