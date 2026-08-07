/**
 * @file src/services/welcome-mat-prompt.ts
 * @description The welcome mat prompt (aimeat_remake/03-welcome-mat.md): the first thing a person
 *   does here, in their own AI chat, before anything technical is connected. Copy the prompt →
 *   paste it into your chat → paste the answer back into the box.
 *
 *   Served from the node like /v1/prompts/build-app rather than shipped in the SPA, because this
 *   prompt IS the gate: how many attempts a mat takes is the direct measure of its quality, and
 *   when the funnel says it is too hard it has to be fixable from the server — including for the
 *   copies people have already carried into their chats.
 *
 *   Two variants. The full one asks for a page with metadata. The SHORT one asks only for a
 *   heading and a few paragraphs, and it exists because a weaker model that fails the full prompt
 *   must still have a way through — the gate is "you have an AI and you understand copy-paste",
 *   not "your AI can follow a six-point spec".
 * @structure buildWelcomeMatPrompt(config, { lang, variant, displayName })
 * @usage
 *   import { buildWelcomeMatPrompt } from '../services/welcome-mat-prompt.js';
 *   const prompt = buildWelcomeMatPrompt(config, { lang: 'fi' });
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 2).
 */
import type { AimeatConfig } from '../config.js';
import { WELCOME_MAT_BEGIN, WELCOME_MAT_END } from './welcome-mat-parse.js';

type Lang = 'en' | 'fi';
const lang = (v?: string): Lang => (v === 'fi' ? 'fi' : 'en');

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
    const L: string[] = [];

    if (l === 'fi') {
        L.push('Puhu minulle suomea.');
        L.push('');
        L.push('Teen itselleni digitaalisen kodin AIMEAT-nimiseen palveluun. AIMEAT on paikka, jossa');
        L.push('ihminen pitää oman muistinsa, omat tekoälyagenttinsa ja itse tekemänsä työkalut yhdessä');
        L.push('paikassa, ja tekoäly pääsee niihin käsiksi suoraan. Kodin ensimmäinen asia on');
        L.push('tervetuloamatto: yksi sivu, joka kertoo kuka minä olen ja mitä aion siellä tehdä.');
        L.push('');
        L.push('Kirjoita minulle se sivu.');
        L.push('');
        if (variant === 'full') {
            L.push('Anna vastaus **yhtenä HTML-tiedostona yhdessä koodilohkossa**, jotta voin kopioida sen');
            L.push('kerralla. Aloita lohko rivillä');
            L.push(`  ${WELCOME_MAT_BEGIN}`);
            L.push('ja päätä se riviin');
            L.push(`  ${WELCOME_MAT_END}`);
            L.push('');
            L.push('Kirjoita <head>-osaan nämä kentät ja täytä ne **omasta itsestäsi**, sen mukaan mikä');
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
            L.push('käydään — esimerkiksi claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code tai Grok.');
            L.push('Se ratkaisee, mitä minulle näytetään seuraavaksi. Jos et ole varma, kirjoita paras');
            L.push('arviosi; minulta kysytään se vielä erikseen.');
            L.push('');
            L.push('`ai-can-mcp` tarkoittaa: osaako tämä sovellus liittää itsensä ulkoiseen');
            L.push('MCP-palvelimeen (konnektoriin). Kerro rehellisesti mitä tiedät.');
            L.push('');
        } else {
            L.push('Anna vastaus **yhtenä HTML-tiedostona yhdessä koodilohkossa**. Pidä se lyhyenä:');
            L.push('otsikko ja kaksi tai kolme kappaletta riittää.');
            L.push('');
        }
        L.push('Sivun sisältö:');
        L.push(who ? `- otsikossa minun nimeni: ${who}` : '- otsikossa minun nimeni (kysy se minulta, jos et tiedä sitä)');
        L.push('- muutama lause siitä, mitä minä aion AIMEATissa tehdä');
        L.push('- sivu saa näyttää juuri siltä kuin haluat: värit, typografia ja rakenne ovat sinun');
        L.push('');
        L.push('Kirjoita sivu niin, että se toimii yksin: kaikki tyylit `<style>`-lohkossa samassa');
        L.push('tiedostossa, ja tekstiä käyttäen kuvien sijaan. Sivu näytetään eristetyssä kehyksessä,');
        L.push('joka lataa vain sen mitä tiedostossa itsessään on.');
        L.push('');
        L.push('Kun olet valmis, sano minulle: kopioi koko koodilohko ja liitä se AIMEATin laatikkoon.');
        L.push('');
        L.push(`Palvelun osoite, jos haluat katsoa: ${node}`);
        return L.join('\n');
    }

    L.push('I am making myself a digital home on a service called AIMEAT. AIMEAT is a place where a');
    L.push('person keeps their own memory, their own AI agents and the tools they build in one place,');
    L.push('and where an AI can reach all of it directly. The first thing a home gets is a welcome');
    L.push('mat: one page saying who I am and what I intend to do there.');
    L.push('');
    L.push('Write me that page.');
    L.push('');
    if (variant === 'full') {
        L.push('Give the answer as **one HTML file in one code block**, so I can copy it in a single');
        L.push('go. Begin the block with the line');
        L.push(`  ${WELCOME_MAT_BEGIN}`);
        L.push('and end it with the line');
        L.push(`  ${WELCOME_MAT_END}`);
        L.push('');
        L.push('Put these fields in the <head>, and fill them in **about yourself** — which AI you');
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
        L.push('happening in — for example claude.ai, ChatGPT, Claude Desktop, Cursor, VS Code or');
        L.push('Grok. It decides what I am shown next. If you are unsure, give your best guess; I');
        L.push('will be asked about it separately as well.');
        L.push('');
        L.push('`ai-can-mcp` means: can this app attach itself to an external MCP server (a');
        L.push('connector)? Say what you actually know.');
        L.push('');
    } else {
        L.push('Give the answer as **one HTML file in one code block**. Keep it short: a heading and');
        L.push('two or three paragraphs is plenty.');
        L.push('');
    }
    L.push('What goes on the page:');
    L.push(who ? `- my name in the heading: ${who}` : '- my name in the heading (ask me for it if you do not know it)');
    L.push('- a few sentences about what I intend to do on AIMEAT');
    L.push('- the page may look exactly how you want: colours, type and layout are yours');
    L.push('');
    L.push('Write the page so it stands alone: all styling in a `<style>` block in the same file,');
    L.push('and text in place of images. The page is shown in an isolated frame that loads only what');
    L.push('the file itself contains.');
    L.push('');
    L.push('When you are done, tell me to copy the whole code block and paste it into the box on');
    L.push('AIMEAT.');
    L.push('');
    L.push(`The service address, if you want to look: ${node}`);
    return L.join('\n');
}
