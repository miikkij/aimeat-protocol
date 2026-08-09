/**
 * @file src/services/open-items-prompt.ts
 * @description The prompt a person copies out of the header to work their open items in their own
 *   AI chat.
 *
 *   IT DOES NOT CONTAIN THE ITEMS. They go stale the moment they are copied, and a person who
 *   pastes yesterday's list gets an AI confidently working on things they already dealt with. It
 *   tells the chat WHERE to read them, so what the chat sees is what is on the list right now.
 *
 *   Served from the node rather than hardcoded in the page, for the reason every prompt here is:
 *   a correction reaches the copies people have already carried into their chats. That is worth
 *   more here than anywhere, because this is the prompt that teaches an AI how to behave with
 *   somebody's own list.
 *
 *   Two lines are load-bearing and they pull against each other on purpose. The GO line stops an AI
 *   reading the list and simply starting; the draft-first line stops it doing the opposite, which is
 *   what actually happened on the first real run — five rounds of questions, nothing written, and
 *   every answer lost when the session ended. Ask twice, then produce something.
 * @structure buildOpenItemsPrompt(config, opts)
 * @usage
 *   import { buildOpenItemsPrompt } from '../services/open-items-prompt.js';
 *   const prompt = buildOpenItemsPrompt(config, { lang: 'fi' });
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. One prompt for the whole list (P16), naming the skill so the
 *     chat can fetch the current instructions rather than relying on this text staying right.
 */
import type { AimeatConfig } from '../config.js';
import { OPEN_ITEMS_KEY } from './open-items.js';

/** The skill that carries the per-kind detail. Named here so the chat can go and read it. */
export const OPEN_ITEMS_SKILL = 'node:aimeat-open-items';

export function buildOpenItemsPrompt(
    config: AimeatConfig, opts: { lang?: string } = {},
): string {
    const fi = opts.lang === 'fi';
    const node = config.nodeId;

    if (fi) {
        return [
            `Käytän AIMEAT-solmua ${node} ja haluan käydä läpi avoimet asiani kanssasi.`,
            '',
            'Tee tässä järjestyksessä:',
            '',
            `1. Hae ohjeesi: aimeat_skill_get skillille "${OPEN_ITEMS_SKILL}". Siinä on ajantasainen`,
            '   ohje siitä miten kutakin lajia käsitellään. Noudata sitä tämän tekstin sijaan jos ne',
            '   ovat ristiriidassa.',
            `2. Lue listani: aimeat_memory_read avaimella "${OPEN_ITEMS_KEY}" ja owner_scope=true.`,
            '   Arvo on objekti jonka "items"-taulukossa ovat avoimet asiani.',
            '3. Kerro minulle mitä siellä on omin sanoin. Ei JSONia, ei taulukkoa. Jos jokin on ollut',
            '   auki kauan, kysy onko se yhä ajankohtainen.',
            '4. Kysy mistä aloitetaan. Jos kohteen laji on tyhjä, kysy **mikä se on** ennen kuin',
            '   kysyt mitään muuta: monen kohteen otsikko on sen kortin teksti jota klikkasin, eikä',
            '   kerro sisällöstä. Vasta sen jälkeen kysy laajuus.',
            '5. **Kaksi kysymyskierrosta, sitten kirjoitat luonnoksen.** Luonnos menee organismiini',
            '   heti, ei GO:n jälkeen: luonnos ei ole tekemistä. Se mitä et tiedä ei ole kysymys',
            '   minulle vaan AVOIN-rivi luonnoksessa.',
            '6. Kerro mitä aiot tehdä, ja **odota että sanon GO. Älä tee mitään ennen sitä.**',
            '',
            'Kun jokin on hoidettu, ota se pois listalta: lue avain, poista se kohde items-taulukosta,',
            'ja kirjoita takaisin aimeat_memory_write-kutsulla owner_scope=true ja expected_version',
            'sillä versiolla jonka luit. Jos saat VERSION_CONFLICT, lue uudestaan ja yritä uudelleen:',
            'joku muu ehti väliin, eikä hänen muutostaan saa yliajaa.',
            '',
            'Jos jokin kohta on iso oma työnsä, kuten applikaation rakentaminen, älä yritä tehdä sitä',
            'tämän keskustelun lomassa. Sano se, ja ohjaa minut tekemään se omana työnään oikeassa',
            'järjestyksessä.',
        ].join('\n');
    }

    return [
        `I use the AIMEAT node ${node} and I want to go through my open items with you.`,
        '',
        'Do this in order:',
        '',
        `1. Fetch your instructions: aimeat_skill_get for the skill "${OPEN_ITEMS_SKILL}". It carries`,
        '   the current per-kind detail. Follow it over this text wherever they disagree.',
        `2. Read my list: aimeat_memory_read with the key "${OPEN_ITEMS_KEY}" and owner_scope=true.`,
        '   The value is an object whose "items" array is my open items.',
        '3. Tell me what is on it in your own words. No JSON, no table. If something has been open a',
        '   long time, ask whether it still matters.',
        '4. Ask which one to start with. If its kind is empty, ask **what it is** before anything',
        '   else: many items carry the words of the card I clicked rather than anything about their',
        '   content. Only then ask at what depth.',
        '5. **Two rounds of questions, then you write the draft.** It goes into my organism straight',
        '   away, not after GO: a draft is not doing. What you do not know is not a question for me,',
        '   it is an OPEN line in the draft.',
        '6. Tell me what you are about to do, and **wait until I say GO. Do nothing before that.**',
        '',
        'When something is finished, take it off the list: read the key, remove that item from the',
        'items array, and write it back with aimeat_memory_write using owner_scope=true and',
        'expected_version set to the version you read. On VERSION_CONFLICT, read again and retry —',
        'somebody else got there first and their change must not be overwritten.',
        '',
        'If an item is a large piece of work in its own right, such as building an application, do',
        'not try to do it in the middle of this conversation. Say so, and steer me into doing it as',
        'its own piece of work in the right order.',
    ].join('\n');
}
