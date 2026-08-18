/**
 * @file hello-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Hello MCP: the one observable sign that a user's MCP connection actually works.
 *   The connection fails SILENTLY today. No error, no warning: the AI drifts out of sync and the
 *   user concludes the product is mediocre. Three of three successful onboardings needed the
 *   founder present; the one attempt without him (an outside security team) ended in the user
 *   leaving. This module removes the founder from that path.
 *
 *   The whole mechanism is one memory key. The user pastes ONE prompt into their AI chat; running
 *   it writes `onboarding.hello_mcp`. The key exists or it does not, and that is the entire pass
 *   condition. No state machine, no multi-step flow, no self-report: a user cannot claim to be
 *   connected, only their AI can prove it by writing through the connection.
 *
 *   KEY and PROMPT are exported from the same module on purpose. If the prompt told the AI to
 *   write one key while the checker looked for another, the feature would fail in exactly the
 *   silent way it exists to prevent.
 *
 *   The key lands in the AGENT's namespace (`claude#alice@node`), not the owner's, because the
 *   AI writes it over its own MCP session. The check still works from the owner's browser as a
 *   single lookup: GET /v1/memory/:key broadens to owner-scope (GHII + agents + eco apps) for
 *   owner sessions. That is what keeps the check to one call with no aggregation.
 * @structure HELLO_MCP_KEY · buildHelloMcpPrompt() · buildOrganismSetupPrompt() ·
 *   buildInstructionBlocks() (CLAUDE.md · AGENTS.md · chat instructions field)
 * @usage import { HELLO_MCP_KEY, buildHelloMcpPrompt } from '../services/hello-mcp.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial. Key + proof prompt + organism-setup prompt + instruction
 *     blocks generated from an organism's real structure.
 *   v1.1.0 — 2026-08-04 — Instruction block gates saving on the user's ask or approval and states
 *     that in-conversation instructions override the block. A persistent "write results there"
 *     read as a standing order to auto-save mid-conversation, over the user's protests.
 */
import type { AimeatConfig } from '../config.js';

/**
 * The pass condition. A constant, and deliberately a boring one: it is typed into a prompt by
 * hand-adjacent machinery and a typo here is a silent failure. Never rename it. Anyone who has
 * already passed would silently un-pass, which is the exact bug class this feature exists for.
 */
export const HELLO_MCP_KEY = 'onboarding.hello_mcp';

type Lang = 'en' | 'fi';

const lang = (v?: string): Lang => (v === 'fi' ? 'fi' : 'en');

/**
 * The proof prompt. The user pastes this into their AI chat immediately after connecting, before
 * anything else. Running it writes HELLO_MCP_KEY through the MCP connection.
 *
 * Written so a failure is loud: the AI is told to say plainly that the tools are missing rather
 * than describing what it would have done. A confident summary of imaginary work is the failure
 * mode that made people distrust the product.
 */
export function buildHelloMcpPrompt(config: AimeatConfig, opts: { lang?: string } = {}): string {
    const l = lang(opts.lang);
    const node = config.baseUrl.replace(/\/+$/, '');
    const L: string[] = [];

    if (l === 'fi') {
        L.push('Puhu minulle suomea.');
        L.push('');
        L.push(`Olet kytketty AIMEAT-nodeeni (${node}) MCP:n yli. Tarkistetaan toimiiko kytkös, ennen kuin teemme mitään muuta.`);
        L.push('');
        L.push('Tee tasan tämä:');
        L.push('');
        L.push(`1. Kirjoita muistiin avain \`${HELLO_MCP_KEY}\` (AIMEAT-työkalu \`aimeat_memory_write\`) tällä arvolla:`);
        L.push('   {"ok": true, "at": "<tämänhetkinen aika ISO-8601-muodossa>", "tool": "<mikä AI ja mikä sovellus olet>"}');
        L.push('2. Lue sama avain takaisin ja näytä minulle mitä sinne tallentui.');
        L.push('3. Kerro yhdellä rivillä minkä nimisenä agenttina kirjoitit sen.');
        L.push('');
        L.push('Jos sinulla EI ole AIMEAT-työkaluja käytettävissä tässä keskustelussa, sano se suoraan');
        L.push('yhdellä lauseella äläkä tee mitään muuta. Älä kuvaile mitä tekisit, äläkä kirjoita');
        L.push('koodia joka tekisi sen. Minun pitää tietää heti jos kytkös ei ole olemassa.');
    } else {
        L.push('Talk to me in the language I use with you.');
        L.push('');
        L.push(`You are connected to my AIMEAT node (${node}) over MCP. Before we do anything else, let us check that the connection actually works.`);
        L.push('');
        L.push('Do exactly this:');
        L.push('');
        L.push(`1. Write the memory key \`${HELLO_MCP_KEY}\` (AIMEAT tool \`aimeat_memory_write\`) with this value:`);
        L.push('   {"ok": true, "at": "<the current time in ISO-8601>", "tool": "<which AI and which app you are>"}');
        L.push('2. Read the same key back and show me what was stored.');
        L.push('3. Tell me in one line the agent name you wrote it as.');
        L.push('');
        L.push('If you do NOT have AIMEAT tools available in this conversation, say so plainly in one');
        L.push('sentence and do nothing else. Do not describe what you would do, and do not write code');
        L.push('that would do it. I need to know immediately if the connection is not there.');
    }
    return L.join('\n');
}

/**
 * Step 4: the user's own AI creates their personal organism over MCP. The user watches it appear
 * in the UI, which is the point: the first thing the connection does is produce something visible.
 *
 * The prompt asks what the organism is FOR when the user has not said, because an organism named
 * after nothing collects nothing. `purpose` carries the user's own words when they gave them.
 */
export function buildOrganismSetupPrompt(config: AimeatConfig, opts: { lang?: string; purpose?: string } = {}): string {
    const l = lang(opts.lang);
    const node = config.baseUrl.replace(/\/+$/, '');
    const purpose = (opts.purpose || '').trim().slice(0, 400);
    const L: string[] = [];

    if (l === 'fi') {
        L.push('Puhu minulle suomea.');
        L.push('');
        L.push(`Olet kytketty AIMEAT-nodeeni (${node}) MCP:n yli. Perusta minulle oma organismi.`);
        L.push('');
        L.push('Organismi on jaettu tila jossa minä, sinä ja muut agenttini työskentelemme saman');
        L.push('aineiston päällä: muistiinpanot, dokumentit, tehtävät ja päätökset pysyvät siellä');
        L.push('keskustelujen välillä, ja jokainen agentti lukee ne samasta paikasta.');
        L.push('');
        if (purpose) {
            L.push(`Käyttötarkoitus omin sanoin: "${purpose}"`);
            L.push('');
            L.push('1. Ehdota tuon perusteella organismille nimi ja 1-2 workspacea, ja kysy hyväksynkö.');
        } else {
            L.push('1. Kysy ensin YHDESSÄ viestissä: mihin käytän tätä (työ, projekti, oppiminen,');
            L.push('   yritys, jokin muu), ja onko mukana muita ihmisiä vai vain minä ja agenttini.');
            L.push('   Odota vastaustani. Ehdota sitten nimi ja 1-2 workspacea, ja kysy hyväksynkö.');
        }
        L.push('2. Kun hyväksyn, luo organismi ja sen workspacet AIMEAT-työkaluilla');
        L.push('   (`aimeat_organism_create`, `aimeat_workspace_create`).');
        L.push('3. Kirjoita organismiin yksi lyhyt dokumentti joka kertoo mihin se on ja miten sitä');
        L.push('   käytetään. Se on ensimmäinen asia jonka seuraava agentti lukee.');
        L.push('4. Kerro minulle organismin id ja nimi, ja sano että se näkyy nyt profiilini');
        L.push('   Organismit-välilehdellä.');
        L.push('');
        L.push('Älä keksi sisältöä puolestani. Jos et tiedä jotain, kysy.');
    } else {
        L.push('Talk to me in the language I use with you.');
        L.push('');
        L.push(`You are connected to my AIMEAT node (${node}) over MCP. Set up my own organism.`);
        L.push('');
        L.push('An organism is a shared space where I, you and my other agents work on the same');
        L.push('material: notes, documents, tasks and decisions stay there between conversations,');
        L.push('and every agent reads them from the same place.');
        L.push('');
        if (purpose) {
            L.push(`What I want it for, in my own words: "${purpose}"`);
            L.push('');
            L.push('1. Based on that, propose a name and 1-2 workspaces, and ask me to approve.');
        } else {
            L.push('1. First ask me, in ONE message: what I will use this for (work, a project,');
            L.push('   learning, a company, something else), and whether other people are involved');
            L.push('   or just me and my agents. Wait for my answer. Then propose a name and 1-2');
            L.push('   workspaces, and ask me to approve.');
        }
        L.push('2. Once I approve, create the organism and its workspaces with the AIMEAT tools');
        L.push('   (`aimeat_organism_create`, `aimeat_workspace_create`).');
        L.push('3. Write one short document into it saying what it is for and how it is used. That');
        L.push('   is the first thing the next agent will read.');
        L.push('4. Tell me the organism id and name, and say that it now shows in the Organisms tab');
        L.push('   of my profile.');
        L.push('');
        L.push('Do not invent content on my behalf. If you do not know something, ask.');
    }
    return L.join('\n');
}

export interface InstructionBlockInput {
    /** Organism id, carried into the block so an AI can address it without asking. */
    orgId: string;
    orgName: string;
    /** Workspaces as the overview reports them: real structure, never a template. */
    workspaces: Array<{ id: string; name?: string; description?: string; spaces?: string[] }>;
    /** The organism's own overview markdown, when the caller has it. */
    summary?: string;
}

export interface InstructionBlocks {
    /** The shared body every format wraps. */
    body: string;
    claudeMd: string;
    agentsMd: string;
    /** Paste target: the AI chat's own settings/instructions field. */
    chatInstructions: string;
    /** Where each format goes, in the caller's language. */
    placement: { claudeMd: string; agentsMd: string; chatInstructions: string };
}

/**
 * The instruction block a user pastes into their AI's persistent instructions. It is generated
 * from the organism's ACTUAL structure (ids, workspaces, spaces) rather than a template, so an
 * AI reading it knows where things live before it asks.
 *
 * What it buys, stated plainly in the block itself because the user is pasting it on trust: the
 * chat starts every session already knowing the current state instead of being told it again;
 * work lands where the other agents look; and the same context does not have to be re-sent as
 * tokens in every conversation.
 */
export function buildInstructionBlocks(
    config: AimeatConfig,
    input: InstructionBlockInput,
    opts: { lang?: string } = {},
): InstructionBlocks {
    const l = lang(opts.lang);
    const node = config.baseUrl.replace(/\/+$/, '');
    const B: string[] = [];

    const wsLines = (input.workspaces || []).map((w) => {
        const spaces = (w.spaces || []).filter(Boolean);
        const desc = (w.description || '').replace(/\s+/g, ' ').trim().slice(0, 140);
        const bits = [`  - ${w.name || w.id} (\`${w.id}\`)`];
        if (desc) bits.push(`: ${desc}`);
        if (spaces.length) bits.push(` [${spaces.slice(0, 8).join(', ')}]`);
        return bits.join('');
    });

    if (l === 'fi') {
        B.push(`## AIMEAT: ${input.orgName}`);
        B.push('');
        B.push(`Työskentelen AIMEAT-nodella ${node}. Organismi \`${input.orgId}\` ("${input.orgName}") on`);
        B.push('se paikka jossa työni asuu: muistiinpanot, dokumentit, tehtävät ja päätökset.');
        B.push('');
        if (wsLines.length) {
            B.push('Workspacet:');
            B.push(...wsLines);
            B.push('');
        }
        B.push('Kun sinulla on AIMEAT-työkalut käytössä:');
        B.push(`- Lue tilanne organismista ennen kuin oletat mitään: \`aimeat_organism_overview\` id:llä \`${input.orgId}\`.`);
        B.push('- Tallentaminen on minun päätökseni. Kirjoita organismiin kahdessa tilanteessa: kun pyydän');
        B.push('  tallentamaan, tai kun ehdotat tietyn tuloksen tallentamista ja hyväksyn ehdotuksen.');
        B.push('  Kesken keskustelun et tallenna mitään omin päin.');
        B.push('- Kun tallennat, tallenna organismiin eikä vain tähän keskusteluun. Muut agenttini lukevat sen samasta paikasta.');
        B.push('- Käytä olemassa olevaa workspacea ja rakennetta. Kysy ennen kuin luot uusia.');
        B.push('- Älä keksi sisältöä puolestani. Jos jokin puuttuu, kysy.');
        B.push('- Se mitä sanon keskustelussa voittaa tämän ohjeen. Jos pyydän tallentamaan vähemmän tai');
        B.push('  en ollenkaan, noudata sitä koko keskustelun ajan.');
        B.push('');
        B.push('Kun työkaluja ei ole, sano se suoraan äläkä kuvaile mitä tekisit.');
    } else {
        B.push(`## AIMEAT: ${input.orgName}`);
        B.push('');
        B.push(`I work on the AIMEAT node ${node}. The organism \`${input.orgId}\` ("${input.orgName}") is`);
        B.push('where my work lives: notes, documents, tasks and decisions.');
        B.push('');
        if (wsLines.length) {
            B.push('Workspaces:');
            B.push(...wsLines);
            B.push('');
        }
        B.push('When you have AIMEAT tools available:');
        B.push(`- Read the current state before assuming anything: \`aimeat_organism_overview\` with id \`${input.orgId}\`.`);
        B.push('- Saving is my decision. Write into the organism in two situations: when I ask you to');
        B.push('  save something, or when you propose saving a specific result and I approve.');
        B.push('  Mid-conversation you save nothing on your own.');
        B.push('- When you do save, save into the organism, not only into this conversation. My other agents read it from the same place.');
        B.push('- Use the workspaces and structure that already exist. Ask before creating new ones.');
        B.push('- Do not invent content on my behalf. If something is missing, ask.');
        B.push('- What I say in the conversation wins over this block. If I ask you to save less or not');
        B.push('  at all, honor that for the rest of the conversation.');
        B.push('');
        B.push('When the tools are not available, say so plainly and do not describe what you would do.');
    }

    const body = B.join('\n');

    const placement = l === 'fi'
        ? {
            claudeMd: 'Projektin juureen tiedostoon CLAUDE.md. Claude Code lukee sen joka istunnossa.',
            agentsMd: 'Projektin juureen tiedostoon AGENTS.md. Codex, Cursor ja muut agenttityökalut lukevat sen.',
            chatInstructions: 'AI-chatin asetuksiin, instructions- tai custom instructions -kenttään. Koskee kaikkia keskusteluja, ei vain yhtä projektia.',
        }
        : {
            claudeMd: 'Into CLAUDE.md at the root of your project. Claude Code reads it every session.',
            agentsMd: 'Into AGENTS.md at the root of your project. Codex, Cursor and other agent tools read it.',
            chatInstructions: 'Into your AI chat settings, the instructions or custom instructions field. It applies to every conversation, not just one project.',
        };

    return {
        body,
        claudeMd: body,
        agentsMd: body,
        chatInstructions: body.replace(/^## /, '').replace(/\n## /g, '\n'),
        placement,
    };
}
