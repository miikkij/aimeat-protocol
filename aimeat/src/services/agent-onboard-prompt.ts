/**
 * @file src/services/agent-onboard-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent door's prompt (aimeat_remake/12-ai-rekisteroi.md): the front-page button's
 *   payload. A person copies it into their own AI chat, and if that AI can make a POST request, it
 *   gets them an account without their touching the interface at all.
 *
 *   Node-served for the same reason as the other two: when a prompt turns out to mislead, the fix
 *   has to reach the copies people have already pasted into their chats.
 *
 *   The single most important line in it is the failure line. This prompt is handed to an AI whose
 *   abilities are unknown by definition — that is what it is testing — so it is told to say plainly
 *   and immediately when it cannot, and to send the person to register themselves. A model that
 *   describes what it would have done leaves someone waiting for an email that will never arrive.
 * @structure buildAgentOnboardPrompt(config, { lang })
 * @usage import { buildAgentOnboardPrompt } from '../services/agent-onboard-prompt.js';
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial (remake phase 4b).
 */
import type { AimeatConfig } from '../config.js';

type Lang = 'en' | 'fi';
const lang = (v?: string): Lang => (v === 'fi' ? 'fi' : 'en');

export function buildAgentOnboardPrompt(config: AimeatConfig, opts: { lang?: string } = {}): string {
    const l = lang(opts.lang);
    const node = config.baseUrl.replace(/\/+$/, '');
    const L: string[] = [];

    if (l === 'fi') {
        L.push('Puhu minulle suomea.');
        L.push('');
        L.push(`Haluan tilin AIMEAT-nimiseen palveluun osoitteessa ${node}, ja haluan että sinä hoidat sen`);
        L.push('puolestani. Tee nämä järjestyksessä.');
        L.push('');
        L.push(`1. Lue ${node}/llms.txt, niin tiedät mistä on kyse.`);
        L.push('');
        L.push('2. Kysy minulta **vain sähköpostiosoitteeni**. Älä kysy käyttäjänimeä äläkä salasanaa:');
        L.push('   minä valitsen ne itse selaimessa, koska käyttäjänimi on pysyvä.');
        L.push('');
        L.push('3. Tee tämä kutsu ja täytä omat tietosi rehellisesti:');
        L.push('');
        L.push(`     POST ${node}/v1/registration-invites`);
        L.push('     Content-Type: application/json');
        L.push('     {');
        L.push('       "email": "<osoite jonka annoin>",');
        L.push('       "agent": {');
        L.push('         "model":  "<mallisi nimi>",');
        L.push('         "vendor": "<kuka sinut teki>",');
        L.push('         "client": "<sovellus jossa keskustelemme juuri nyt>"');
        L.push('       }');
        L.push('     }');
        L.push('');
        L.push('4. Kerro minulle: viesti lähti, katso postilaatikkoosi ja paina siinä olevaa nappia.');
        L.push('   Kerro myös että viestissä näkyy mistä IP-osoitteesta ja millä tekoälyllä kutsu');
        L.push('   tehtiin, jotta näen sen tulleen sinulta.');
        L.push('');
        L.push('5. Kun olen valmis, kerro mitä seuraavaksi tapahtuu: valitsen käyttäjänimen, teen');
        L.push('   tervetuloamaton ja kytken sinut agentiksi kotiini. Varaudu siihen että joudumme');
        L.push('   konfiguroimaan MCP-konnektorin.');
        L.push('');
        L.push('**Jos et pysty tekemään tuota kutsua, sano se minulle heti ja suoraan.** Älä kuvaile');
        L.push('mitä olisit tehnyt. Kerro sen sijaan, missä sovelluksessa keskustelemme, ja neuvo minua');
        L.push(`rekisteröitymään itse osoitteessa ${node}. Se on täysin kunnollinen lopputulos; hiljainen`);
        L.push('epäonnistuminen ei ole, koska jään odottamaan viestiä joka ei koskaan tule.');
        return L.join('\n');
    }

    L.push(`I want an account on a service called AIMEAT at ${node}, and I want you to arrange it for`);
    L.push('me. Do these in order.');
    L.push('');
    L.push(`1. Read ${node}/llms.txt so you know what this is.`);
    L.push('');
    L.push('2. Ask me for **my email address only**. Do not ask for a username or a password: I pick');
    L.push('   those myself in the browser, because a username is permanent.');
    L.push('');
    L.push('3. Make this call, filling in your own details honestly:');
    L.push('');
    L.push(`     POST ${node}/v1/registration-invites`);
    L.push('     Content-Type: application/json');
    L.push('     {');
    L.push('       "email": "<the address I gave you>",');
    L.push('       "agent": {');
    L.push('         "model":  "<your model name>",');
    L.push('         "vendor": "<who made you>",');
    L.push('         "client": "<the app we are talking in right now>"');
    L.push('       }');
    L.push('     }');
    L.push('');
    L.push('4. Tell me: the message has been sent, check your inbox, press the button in it. Mention');
    L.push('   that the message shows the IP address and which AI made the call, so I can see it came');
    L.push('   from you.');
    L.push('');
    L.push('5. When I am done, tell me what happens next: I choose a username, make a welcome mat, and');
    L.push('   connect you as an agent to my home. Be ready to configure an MCP connector.');
    L.push('');
    L.push('**If you cannot make that call, say so immediately and plainly.** Do not describe what you');
    L.push('would have done. Instead tell me which app we are talking in, and send me to register');
    L.push(`myself at ${node}. That is a perfectly good outcome; a silent failure is not, because I`);
    L.push('will sit waiting for an email that never comes.');
    return L.join('\n');
}
