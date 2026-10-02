/**
 * @file src/services/welcome-mat-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The welcome mat prompt (aimeat_remake/03-welcome-mat.md): the first thing a person
 *   does here, in their own AI chat, before anything technical is connected. Copy the prompt →
 *   paste it into your chat → paste the answer back into the box.
 *
 *   Since 2026-10-03 the prompt is the PROFILE INTERVIEW: the person's AI asks them about their work,
 *   what they need, what gets in the way, the work they repeat and what is unclear, and then writes
 *   a one-page business card from the answers. The card reads well to a person and carries a
 *   machine-readable profile for AIs (schema.org Person JSON-LD and a short "For AIs" section). It
 *   is still stored as the portfolio by POST /v1/home/welcome-mat, so the paste flow, the markers
 *   and the ai-* fields that decide the branch are unchanged (Jouni, 2026-10-03, decision
 *   decision-a-newcomer-s-first-result-is-their-profile-made-in-an-interv). The connected road does
 *   the same interview through the skill aimeat-guided-journey; the two must ask the same things.
 *
 *   Served from the node like /v1/prompts/build-app rather than shipped in the SPA, because this
 *   prompt IS the gate: how many attempts a mat takes is the direct measure of its quality, and
 *   when the funnel says it is too hard it has to be fixable from the server — including for the
 *   copies people have already carried into their chats.
 *
 *   The full variant also asks for the interview's answers in a private block in the <head>
 *   (`<script type="application/json" id="aimeat-profile">`, services/welcome-mat-parse.ts
 *   PROFILE_BLOCK_ID). The paste writes them into the person's `journey.state` and removes the
 *   block before the page is stored, so the copy-prompt road keeps the answers the connected road
 *   writes with aimeat_memory_write.
 *
 *   Two variants. The full one asks for the whole card with metadata. The SHORT one asks three
 *   questions and a heading with a few paragraphs, and it exists because a weaker model that fails
 *   the full prompt must still have a way through — the gate is "you have an AI and you understand
 *   copy-paste", not "your AI can follow a six-point spec".
 * @structure buildWelcomeMatPrompt(config, { lang, variant, displayName })
 * @usage
 *   import { buildWelcomeMatPrompt } from '../services/welcome-mat-prompt.js';
 *   const prompt = buildWelcomeMatPrompt(config, { lang: 'fi' });
 * @version-history
 *   v2.1.0 — 2026-10-03 — The full variant asks for the private profile block with the interview's
 *     answers; a Spanish prompt (es), composed in Spanish with the same structure.
 *   v2.0.0 — 2026-10-03 — The prompt is the profile interview, and the page is a business card with
 *     a schema.org Person block and a "For AIs" section. Markers and ai-* fields unchanged.
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */
import type { AimeatConfig } from '../config.js';
import { WELCOME_MAT_BEGIN, WELCOME_MAT_END, PROFILE_BLOCK_ID } from './welcome-mat-parse.js';

type Lang = 'en' | 'fi' | 'es';
const lang = (v?: string): Lang => (v === 'fi' || v === 'es' ? v : 'en');
const BUILDERS = { en: english, fi: finnish, es: spanish } as const;

/**
 * The private profile block, with the five answers described in the prompt's own language. The
 * keys are the journey.state fields (services/journey-state.ts PROFILE_FIELDS) and stay English.
 */
function profileBlockLines(say: { work: string; needs: string; challenges: string; repetitive: string; unclear: string }): string[] {
    return [
        `  <script type="application/json" id="${PROFILE_BLOCK_ID}">`,
        `  {"work": "${say.work}", "needs": "${say.needs}",`,
        `   "challenges": "${say.challenges}", "repetitive": "${say.repetitive}",`,
        `   "unclear": "${say.unclear}"}`,
        '  </script>',
    ];
}

export type WelcomeMatVariant = 'full' | 'short';

export interface WelcomeMatPromptOpts {
    lang?: string;
    /** 'short' is the one offered after a failed paste. */
    variant?: WelcomeMatVariant;
    /** The person's display name, folded in so the page is about someone rather than about nobody. */
    displayName?: string;
}

/**
 * Build the prompt. Written in positive form throughout (docs/coding-guidelines/prompt-writing.md):
 * every line says what to produce. A prompt that lists prohibitions gets a page that reads like a
 * disclaimer, and this page is the first thing anyone sees of the person.
 */
export function buildWelcomeMatPrompt(config: AimeatConfig, opts: WelcomeMatPromptOpts = {}): string {
    const l = lang(opts.lang);
    const variant: WelcomeMatVariant = opts.variant === 'short' ? 'short' : 'full';
    const node = config.baseUrl.replace(/\/+$/, '');
    const who = (opts.displayName ?? '').trim();
    return BUILDERS[l](variant, node, who).join('\n');
}

function finnish(variant: WelcomeMatVariant, node: string, who: string): string[] {
    const L: string[] = [];
    L.push('Puhu minulle suomea.');
    L.push('');
    L.push('Teen itselleni oman paikan AIMEAT-nimiseen palveluun. AIMEATissa pidän yhdessä paikassa sen,');
    L.push('mitä tiedän ja mitä teen, ja oma tekoälyni voi tehdä siellä töitä puolestani. Ensimmäiseksi');
    L.push('teen sinne profiilini: yhden sivun käyntikortin, jota ihmiset lukevat ja jonka myös muiden');
    L.push('ihmisten tekoälyt osaavat lukea.');
    L.push('');
    L.push('Haastattele minua ensin ja kirjoita sivu sitten.');
    L.push('');
    L.push('1. Kysy minulta nämä asiat yksi kerrallaan omin sanoin. Kun vastaan, kerro yhdellä virkkeellä,');
    L.push('   mitä kuulit, ja kysy vasta sitten seuraava.');
    L.push(who ? `   - Nimeni on ${who}. Mitä teet?` : '   - Mikä on nimesi, ja mitä teet?');
    if (variant === 'full') {
        L.push('   - Millainen on tavallinen viikkosi: mihin aikasi enimmäkseen menee?');
        L.push('   - Mitä yrität saada juuri nyt aikaan?');
        L.push('   - Mikä hankaloittaa työtäsi, tai mikä jää usein tekemättä?');
        L.push('   - Mitä teet yhä uudelleen ja antaisit mielelläsi jonkun muun hoidettavaksi?');
        L.push('   - Mikä tuntuu juuri nyt epäselvältä tai monimutkaiselta?');
        L.push('   - Mitä muiden ihmisten ja heidän tekoälyjensä kannattaa tietää sinusta: mitä tarjoat,');
        L.push('     mitä etsit ja miten sinut tavoittaa?');
    } else {
        L.push('   - Mitä yrität saada juuri nyt aikaan?');
        L.push('   - Miten sinut tavoittaa?');
    }
    L.push('2. Kirjoita lyhyt yhteenveto vastauksistani ja anna minun korjata se.');
    L.push('3. Kirjoita sitten käyntikorttini yhdeksi HTML-sivuksi.');
    L.push('');
    if (variant === 'full') {
        L.push('Sivun sisältö:');
        L.push('- otsikossa nimeni, yksi rivi siitä mitä teen, muutama lyhyt osio minun sanoillani ja');
        L.push('  yhteystietoni');
        L.push('- <head>-osaan <script type="application/ld+json"> -lohko, jossa on schema.org-muotoinen');
        L.push('  Person: name, jobTitle, description, knowsAbout, skills sekä tarpeen mukaan makesOffer');
        L.push('  tai seeks');
        L.push('- lyhyt osio otsikolla "Tekoälyille": tavallisin virkkein kuka olen, mitä tarjoan, mitä');
        L.push('  etsin ja miten jonkun toisen puolesta toimiva tekoäly ottaa minuun yhteyttä');
        L.push('- vain se, minkä kerroin ja hyväksyin. Haasteeni, toistuvat työni ja epäselvät asiat jäävät');
        L.push('  pois sivulta, ellen pyydä niitä sinne.');
        L.push('- ulkoasun saat valita itse. Sivun pitää toimia puhelimessa sekä vaalealla että tummalla');
        L.push('  taustalla.');
        L.push('');
        L.push('Anna vastaus **yhtenä HTML-tiedostona yhdessä koodilohkossa**, jotta voin kopioida sen');
        L.push('kerralla. Aloita lohko rivillä');
        L.push(`  ${WELCOME_MAT_BEGIN}`);
        L.push('ja päätä se riviin');
        L.push(`  ${WELCOME_MAT_END}`);
        L.push('');
        L.push('Kirjoita <head>-osaan myös nämä kentät ja täytä ne **omasta itsestäsi**, sen mukaan mikä');
        L.push('tekoäly sinä olet ja missä sovelluksessa sinä nyt pyörit:');
        L.push('');
        L.push('  <meta name="aimeat-welcome-mat" content="1">');
        L.push(`  <meta name="aimeat-author-says" content="${who || 'nimeni'}">`);
        L.push('  <meta name="ai-model" content="mallisi nimi">');
        L.push('  <meta name="ai-vendor" content="kuka mallin teki">');
        L.push('  <meta name="ai-client" content="sovellus jossa keskustelemme juuri nyt">');
        L.push('  <meta name="ai-can-mcp" content="yes tai no">');
        L.push('');
        L.push('Näistä `ai-client` on tärkein: se on sen sovelluksen nimi, jossa tämä keskustelu');
        L.push('käydään, esimerkiksi claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code tai Grok.');
        L.push('Se ratkaisee, mitä minulle näytetään seuraavaksi. Jos et ole varma, kirjoita paras');
        L.push('arviosi; minulta kysytään se vielä erikseen.');
        L.push('');
        L.push('`ai-can-mcp` tarkoittaa: osaako tämä sovellus liittää itsensä ulkoiseen');
        L.push('MCP-palvelimeen (konnektoriin). Kerro rehellisesti mitä tiedät.');
        L.push('');
        L.push('Kirjoita lopuksi <head>-osaan vielä yksi lohko haastattelun vastauksista. Kirjoita se');
        L.push('täsmälleen tällä tavalla ja vaihda kuvausten tilalle omat sanani:');
        L.push('');
        L.push(...profileBlockLines({
            work: 'mitä teen', needs: 'mitä minun pitää saada aikaan', challenges: 'mikä hankaloittaa työtäni',
            repetitive: 'mitä teen yhä uudelleen', unclear: 'mikä on minulle epäselvää',
        }));
        L.push('');
        L.push('AIMEAT tallentaa vastaukset vain minun nähtäväkseni ja poistaa lohkon ennen kuin sivu');
        L.push('näytetään kenellekään. Kirjoita lohkoon siis kaikki hyväksymäni vastaukset, myös ne, jotka');
        L.push('jäävät pois sivulta. Kirjoita jokainen vastaus yhdelle riville, ja jätä tyhjäksi ("")');
        L.push('kysymys, johon en vastannut.');
        L.push('');
    } else {
        L.push('Pidä sivu lyhyenä: otsikossa nimeni ja sen alla kaksi tai kolme kappaletta vastauksistani.');
        L.push('Anna vastaus **yhtenä HTML-tiedostona yhdessä koodilohkossa**.');
        L.push('');
    }
    L.push('Kirjoita sivu niin, että se toimii yksin: kaikki tyylit `<style>`-lohkossa samassa');
    L.push('tiedostossa, ja tekstiä käyttäen kuvien sijaan. Sivu näytetään eristetyssä kehyksessä,');
    L.push('joka lataa vain sen mitä tiedostossa itsessään on.');
    L.push('');
    L.push('Kun olet valmis, sano minulle: kopioi koko koodilohko ja liitä se AIMEATin laatikkoon.');
    L.push('Sen jälkeen AIMEAT näyttää sivun omassa osoitteessani.');
    L.push('');
    L.push(`Palvelun osoite, jos haluat katsoa: ${node}`);
    return L;
}

function english(variant: WelcomeMatVariant, node: string, who: string): string[] {
    const L: string[] = [];
    L.push('Talk to me in the language I use with you.');
    L.push('');
    L.push('I am setting up my own place on a service called AIMEAT. AIMEAT keeps what I know and what');
    L.push('I make in one place, and my own AI can work there for me. The first thing I make there is my');
    L.push('profile: a one-page business card that people read and that other people\'s AIs can read too.');
    L.push('');
    L.push('Interview me first, then write the page.');
    L.push('');
    L.push('1. Ask me these, one question at a time, in your own words. After each answer, say back in');
    L.push('   one sentence what you heard, then ask the next one.');
    L.push(who ? `   - My name is ${who}. What do you do?` : '   - What should I call you, and what do you do?');
    if (variant === 'full') {
        L.push('   - What does a normal week look like: what takes most of your time?');
        L.push('   - What are you trying to get done right now?');
        L.push('   - What gets in the way, or keeps slipping?');
        L.push('   - What do you do again and again that you would gladly hand to someone else?');
        L.push('   - What feels unclear or complicated to you at the moment?');
        L.push('   - What should other people, and their AIs, know about you: what you offer, what you');
        L.push('     look for, and how to reach you?');
    } else {
        L.push('   - What are you trying to get done right now?');
        L.push('   - How can people reach you?');
    }
    L.push('2. Write a short summary of my answers and let me correct it.');
    L.push('3. Then write my business card as one HTML page.');
    L.push('');
    if (variant === 'full') {
        L.push('What goes on the page:');
        L.push('- a heading with my name, one line on what I do, a few short sections in my words, and');
        L.push('  how to reach me');
        L.push('- in the <head>, a <script type="application/ld+json"> block with a schema.org Person:');
        L.push('  name, jobTitle, description, knowsAbout, skills, and makesOffer or seeks where they fit');
        L.push('- a short section headed "For AIs" (in my language): in plain sentences, who I am, what I');
        L.push('  offer, what I look for, and how an AI acting for someone else should contact me');
        L.push('- only what I said and approved. My challenges, my repeated work and what is unclear to me');
        L.push('  stay off the page unless I ask for them to be on it.');
        L.push('- the look is yours to choose. The page must read well on a phone, in light and dark mode.');
        L.push('');
        L.push('Give the answer as **one HTML file in one code block**, so I can copy it in a single');
        L.push('go. Begin the block with the line');
        L.push(`  ${WELCOME_MAT_BEGIN}`);
        L.push('and end it with the line');
        L.push(`  ${WELCOME_MAT_END}`);
        L.push('');
        L.push('Put these fields in the <head> as well, and fill them in **about yourself**: which AI you');
        L.push('are, and which app you are running in right now:');
        L.push('');
        L.push('  <meta name="aimeat-welcome-mat" content="1">');
        L.push(`  <meta name="aimeat-author-says" content="${who || 'my name'}">`);
        L.push('  <meta name="ai-model" content="your model name">');
        L.push('  <meta name="ai-vendor" content="who made you">');
        L.push('  <meta name="ai-client" content="the app we are talking in right now">');
        L.push('  <meta name="ai-can-mcp" content="yes or no">');
        L.push('');
        L.push('`ai-client` is the important one: it is the name of the app this conversation is');
        L.push('happening in, for example claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code or');
        L.push('Grok. It decides what I am shown next. If you are unsure, give your best guess; I');
        L.push('will be asked about it separately as well.');
        L.push('');
        L.push('`ai-can-mcp` means: can this app attach itself to an external MCP server (a');
        L.push('connector)? Say what you actually know.');
        L.push('');
        L.push('Last, put one more block in the <head> with my interview answers. Write it exactly like');
        L.push('this, with my own words in place of the descriptions:');
        L.push('');
        L.push(...profileBlockLines({
            work: 'what I do', needs: 'what I need to get done', challenges: 'what gets in my way',
            repetitive: 'the work I repeat', unclear: 'what is unclear to me',
        }));
        L.push('');
        L.push('AIMEAT keeps these answers private to me and removes this block before anyone sees the');
        L.push('page. So put every answer I approved in the block, also the ones that stay off the page.');
        L.push('Write each answer on one line, and write "" for a question I did not answer.');
        L.push('');
    } else {
        L.push('Keep the page short: my name in the heading and two or three paragraphs from my answers.');
        L.push('Give the answer as **one HTML file in one code block**.');
        L.push('');
    }
    L.push('Write the page so it stands alone: all styling in a `<style>` block in the same file,');
    L.push('and text in place of images. The page is shown in an isolated frame that loads only what');
    L.push('the file itself contains.');
    L.push('');
    L.push('When you are done, tell me to copy the whole code block and paste it into the box on');
    L.push('AIMEAT. AIMEAT then shows me the page at my own address.');
    L.push('');
    L.push(`The service address, if you want to look: ${node}`);
    return L;
}

/** Composed in Spanish (es-419, tú), with the same steps and fields as the other two. */
function spanish(variant: WelcomeMatVariant, node: string, who: string): string[] {
    const L: string[] = [];
    L.push('Háblame en español.');
    L.push('');
    L.push('Estoy creando mi propio espacio en un servicio llamado AIMEAT. En AIMEAT guardo en un solo');
    L.push('lugar lo que sé y lo que hago, y mi propia IA puede trabajar ahí por mí. Lo primero que hago');
    L.push('ahí es mi perfil: una tarjeta de presentación de una página que leen las personas y que');
    L.push('también pueden leer las IA de otras personas.');
    L.push('');
    L.push('Primero entrevístame y después escribe la página.');
    L.push('');
    L.push('1. Hazme estas preguntas una por una, con tus propias palabras. Cuando responda, resume en');
    L.push('   una frase lo que entendiste y solo entonces haz la siguiente.');
    L.push(who ? `   - Me llamo ${who}. ¿A qué te dedicas?` : '   - ¿Cómo te llamas y a qué te dedicas?');
    if (variant === 'full') {
        L.push('   - ¿Cómo es una semana normal para ti: en qué se te va la mayor parte del tiempo?');
        L.push('   - ¿Qué estás tratando de lograr ahora mismo?');
        L.push('   - ¿Qué te complica el trabajo, o qué se te queda sin hacer a menudo?');
        L.push('   - ¿Qué haces una y otra vez y con gusto dejarías en manos de otra persona?');
        L.push('   - ¿Qué te parece confuso o complicado en este momento?');
        L.push('   - ¿Qué conviene que sepan de ti otras personas y sus IA: qué ofreces, qué buscas y');
        L.push('     cómo contactarte?');
    } else {
        L.push('   - ¿Qué estás tratando de lograr ahora mismo?');
        L.push('   - ¿Cómo te pueden contactar?');
    }
    L.push('2. Escribe un resumen corto de mis respuestas y déjame corregirlo.');
    L.push('3. Luego escribe mi tarjeta de presentación como una sola página HTML.');
    L.push('');
    if (variant === 'full') {
        L.push('Lo que va en la página:');
        L.push('- un encabezado con mi nombre, una línea sobre lo que hago, algunas secciones cortas con');
        L.push('  mis palabras y cómo contactarme');
        L.push('- en el <head>, un bloque <script type="application/ld+json"> con un objeto Person de');
        L.push('  schema.org: name, jobTitle, description, knowsAbout, skills, y makesOffer o seeks donde');
        L.push('  corresponda');
        L.push('- una sección corta con el título "Para las IA": en frases sencillas, quién soy, qué');
        L.push('  ofrezco, qué busco y cómo debe contactarme una IA que actúa en nombre de otra persona');
        L.push('- solo lo que dije y aprobé. Mis dificultades, mi trabajo repetitivo y lo que no tengo');
        L.push('  claro quedan fuera de la página, a menos que te pida incluirlos.');
        L.push('- el diseño lo eliges tú. La página debe verse bien en el celular, con fondo claro y');
        L.push('  con fondo oscuro.');
        L.push('');
        L.push('Entrega la respuesta como **un solo archivo HTML en un solo bloque de código**, para que');
        L.push('pueda copiarlo de una vez. Empieza el bloque con la línea');
        L.push(`  ${WELCOME_MAT_BEGIN}`);
        L.push('y termínalo con la línea');
        L.push(`  ${WELCOME_MAT_END}`);
        L.push('');
        L.push('Pon también estos campos en el <head> y llénalos con datos **sobre ti**: qué IA eres y');
        L.push('en qué aplicación estás funcionando ahora mismo:');
        L.push('');
        L.push('  <meta name="aimeat-welcome-mat" content="1">');
        L.push(`  <meta name="aimeat-author-says" content="${who || 'mi nombre'}">`);
        L.push('  <meta name="ai-model" content="el nombre de tu modelo">');
        L.push('  <meta name="ai-vendor" content="quién te creó">');
        L.push('  <meta name="ai-client" content="la aplicación en la que estamos hablando ahora">');
        L.push('  <meta name="ai-can-mcp" content="yes o no">');
        L.push('');
        L.push('`ai-client` es el más importante: es el nombre de la aplicación donde ocurre esta');
        L.push('conversación, por ejemplo claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code o Grok.');
        L.push('De eso depende lo que me muestran después. Si tienes dudas, escribe tu mejor estimación;');
        L.push('también me lo van a preguntar aparte.');
        L.push('');
        L.push('`ai-can-mcp` significa: ¿esta aplicación puede conectarse a un servidor MCP externo (un');
        L.push('conector)? Di lo que realmente sabes.');
        L.push('');
        L.push('Por último, pon en el <head> un bloque más con mis respuestas de la entrevista. Escríbelo');
        L.push('exactamente así y cambia las descripciones por mis propias palabras:');
        L.push('');
        L.push(...profileBlockLines({
            work: 'lo que hago', needs: 'lo que necesito lograr', challenges: 'lo que me complica el trabajo',
            repetitive: 'el trabajo que repito', unclear: 'lo que no tengo claro',
        }));
        L.push('');
        L.push('AIMEAT guarda estas respuestas solo para mí y quita el bloque antes de que nadie vea la');
        L.push('página. Así que escribe en el bloque todas las respuestas que aprobé, también las que');
        L.push('quedan fuera de la página. Escribe cada respuesta en una sola línea, y deja "" en las');
        L.push('preguntas que no respondí.');
        L.push('');
    } else {
        L.push('Haz la página corta: mi nombre en el encabezado y debajo dos o tres párrafos con mis');
        L.push('respuestas. Entrega la respuesta como **un solo archivo HTML en un solo bloque de código**.');
        L.push('');
    }
    L.push('Escribe la página para que funcione sola: todos los estilos en un bloque `<style>` en el');
    L.push('mismo archivo, y texto en lugar de imágenes. La página se muestra en un marco aislado que');
    L.push('solo carga lo que contiene el propio archivo.');
    L.push('');
    L.push('Cuando termines, dime: copia todo el bloque de código y pégalo en el cuadro de AIMEAT.');
    L.push('Después AIMEAT me muestra la página en mi propia dirección.');
    L.push('');
    L.push(`La dirección del servicio, por si quieres verla: ${node}`);
    return L;
}
