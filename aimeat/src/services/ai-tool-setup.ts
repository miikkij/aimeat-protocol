/**
 * @file ai-tool-setup.ts
 * @description The canonical per-tool setup table: for each AI tool, how to attach THIS node over
 *   MCP, and where that tool keeps its persistent instructions field. Served from the node so
 *   every surface reads the same answer.
 *
 *   It lives here rather than in the SPA because the second consumer cannot import from the first:
 *   the Experience Center is a standalone published app on its own origin. A copy in each would
 *   drift, and drifting setup instructions are worse than none — the reader follows them, fails,
 *   and concludes the product is broken rather than the page stale.
 *
 *   Every step is something to CLICK or TYPE, with the literal UI label, and every field a form
 *   asks for is listed with the value to put in it, including the ones to leave empty (a blank
 *   OAuth field reads as a missing step otherwise). Each tool carries its vendor's own doc URL, so
 *   a reader can check rather than trust, and so the page degrades honestly when a vendor moves
 *   their UI.
 *
 *   Sources, all verified 2026-07-31:
 *   - Claude connectors https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 *   - Claude personalization https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features
 *   - Claude Code MCP https://code.claude.com/docs/en/mcp
 *   - ChatGPT developer mode https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
 *   - Codex MCP https://developers.openai.com/codex/mcp
 *   - Cursor MCP https://cursor.com/docs/mcp
 *   - VS Code MCP https://code.visualstudio.com/docs/agent-customization/mcp-servers
 *   - Grok connectors https://docs.x.ai/grok/connectors
 * @structure buildAiToolSetup(config, { lang }) -> AiTool[] (strings already localized, URLs
 *   already resolved against this node's base URL)
 * @usage import { buildAiToolSetup } from '../services/ai-tool-setup.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Moved here from public/views/profile/ai-tool-setup.js so the SPA and the
 *     Experience Center read one table instead of two copies.
 */
import type { AimeatConfig } from '../config.js';

export interface AiToolParam {
    /** The field label as the tool's own UI spells it. */
    label: string;
    /** What to put in it. Empty string means: leave the field empty, deliberately. */
    value: string;
    note?: string;
}

export interface AiTool {
    id: string;
    label: string;
    mcp: {
        docs: string;
        steps: string[];
        /** A literal command line, when the tool is attached from a terminal instead of a form. */
        command?: string;
        params: AiToolParam[];
        /** Which plans can do this at all — the most common reason setup fails. */
        plans?: string;
        /** A caution that belongs to the tool, not to us. */
        warn?: string;
        note?: string;
    };
    instructions: {
        where: string;
        docs?: string;
    };
}

type Lang = 'en' | 'fi';
const lang = (v?: string): Lang => (v === 'fi' ? 'fi' : 'en');
/** Pick one of the two languages. Written as a helper so every string below reads as a pair. */
const s = (l: Lang, en: string, fi: string) => (l === 'fi' ? fi : en);

export function buildAiToolSetup(config: AimeatConfig, opts: { lang?: string } = {}): AiTool[] {
    const l = lang(opts.lang);
    const node = config.baseUrl.replace(/\/+$/, '');
    const mcpUrl = `${node}/v1/mcp`;

    const nameParam = (): AiToolParam => ({
        label: 'Name',
        value: 'AIMEAT',
        note: s(l, 'Free text. It is only the label you will see in the connector list.',
            'Vapaa teksti. Se on vain nimi jonka näet konnektorilistassa.'),
    });
    const oauthParam = (): AiToolParam => ({
        label: 'Advanced settings: OAuth Client ID / Client Secret',
        value: '',
        note: s(l, 'Leave both empty. This node registers the client automatically (RFC 7591), so there is nothing to paste.',
            'Jätä molemmat tyhjiksi. Tämä node rekisteröi asiakkaan automaattisesti (RFC 7591), joten liitettävää ei ole.'),
    });

    return [
        {
            id: 'claude-desktop',
            label: 'Claude Desktop',
            mcp: {
                docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
                steps: [
                    s(l, 'Open Claude Desktop, click your initials in the bottom left, and choose Settings.',
                        'Avaa Claude Desktop, klikkaa nimikirjaimiasi vasemmasta alakulmasta ja valitse Settings.'),
                    s(l, 'Open Connectors.', 'Avaa Connectors.'),
                    s(l, 'Click Add custom connector.', 'Klikkaa Add custom connector.'),
                    s(l, 'Fill the fields with the values below and click Add.',
                        'Täytä kentät alla olevilla arvoilla ja klikkaa Add.'),
                    s(l, 'A browser tab opens for sign-in. Sign in to this node with your own account and approve the access it asks for.',
                        'Selaimeen avautuu välilehti kirjautumista varten. Kirjaudu tähän nodeen omalla tililläsi ja hyväksy pyydetty pääsy.'),
                    s(l, 'Start a NEW conversation. A chat that was already open does not get the tools.',
                        'Aloita UUSI keskustelu. Jo auki ollut chat ei saa työkaluja.'),
                ],
                params: [nameParam(), { label: 'Remote MCP server URL', value: mcpUrl }, oauthParam()],
                plans: s(l, 'Free, Pro, Max, Team and Enterprise. A free account can hold exactly one custom connector, which is enough for this.',
                    'Free, Pro, Max, Team ja Enterprise. Ilmaisella tilillä voi olla tasan yksi oma konnektori, mikä riittää tähän.'),
            },
            instructions: {
                where: s(l, 'Settings > General > Instructions for Claude. Applies to every new conversation on the account.',
                    'Settings > General > Instructions for Claude. Koskee jokaista uutta keskustelua tällä tilillä.'),
                docs: 'https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features',
            },
        },
        {
            id: 'claude-web',
            label: 'claude.ai',
            mcp: {
                docs: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
                steps: [
                    s(l, 'Open claude.ai and go to Settings, then Connectors. On Pro and Max the path is Customize > Connectors.',
                        'Avaa claude.ai, mene kohtaan Settings ja sieltä Connectors. Pro- ja Max-tasoilla polku on Customize > Connectors.'),
                    s(l, 'Click + and then Add custom connector.', 'Klikkaa + ja sitten Add custom connector.'),
                    s(l, 'Fill the fields with the values below and click Add.',
                        'Täytä kentät alla olevilla arvoilla ja klikkaa Add.'),
                    s(l, 'Sign in to this node in the tab that opens, with your own account.',
                        'Kirjaudu tähän nodeen avautuvassa välilehdessä omalla tililläsi.'),
                    s(l, 'Start a NEW conversation.', 'Aloita UUSI keskustelu.'),
                ],
                params: [nameParam(), { label: 'Remote MCP server URL', value: mcpUrl }, oauthParam()],
                plans: s(l, 'Free, Pro, Max, Team and Enterprise. On Team and Enterprise an owner adds it under Organization settings > Connectors > Add > Custom > Web, and until they do, you cannot.',
                    'Free, Pro, Max, Team ja Enterprise. Team- ja Enterprise-tileillä omistaja lisää sen kohdassa Organization settings > Connectors > Add > Custom > Web, ja ennen sitä sinä et voi.'),
            },
            instructions: {
                where: s(l, 'Settings > General > Instructions for Claude (shown under Profile in some versions). Applies to every new conversation on the account.',
                    'Settings > General > Instructions for Claude (joissakin versioissa Profile-kohdan alla). Koskee jokaista uutta keskustelua tällä tilillä.'),
                docs: 'https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features',
            },
        },
        {
            id: 'claude-code',
            label: 'Claude Code (CLI)',
            mcp: {
                docs: 'https://code.claude.com/docs/en/mcp',
                steps: [
                    s(l, 'Run the command below in a terminal. Add -s user to make it available in all your projects; without it the server is added for the current project only.',
                        'Aja alla oleva komento terminaalissa. Lisää -s user jos haluat sen kaikkiin projekteihisi; ilman sitä palvelin lisätään vain nykyiseen projektiin.'),
                    s(l, 'Run claude mcp list. The node should show as Connected. Needs authentication means the sign-in has not been completed yet.',
                        'Aja claude mcp list. Noden pitäisi näkyä tilassa Connected. Needs authentication tarkoittaa että kirjautumista ei ole viety loppuun.'),
                    s(l, 'Inside Claude Code, type /mcp to see the server and its tool count.',
                        'Claude Coden sisällä kirjoita /mcp, niin näet palvelimen ja sen työkalujen määrän.'),
                ],
                command: `claude mcp add --transport http aimeat ${mcpUrl}`,
                params: [
                    {
                        label: '--transport', value: 'http',
                        note: s(l, 'Streamable HTTP. In JSON config the same transport is also spelled streamable-http.',
                            'Streamable HTTP. JSON-konfiguraatiossa sama kuljetus kirjoitetaan myös muodossa streamable-http.'),
                    },
                    {
                        label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat',
                        note: s(l, 'Your own choice. It is the name you will see in /mcp.',
                            'Oma valintasi. Se on nimi jonka näet /mcp-listassa.'),
                    },
                    { label: 'URL', value: mcpUrl },
                    {
                        label: '-s / --scope', value: 'local | project | user',
                        note: s(l, 'local is the default (this project, only you). user makes it available in all your projects. project writes it into .mcp.json and shares it with the team.',
                            'local on oletus (tämä projekti, vain sinä). user tuo sen kaikkiin projekteihisi. project kirjoittaa sen .mcp.json-tiedostoon ja jakaa tiimille.'),
                    },
                ],
            },
            instructions: {
                where: s(l, 'CLAUDE.md at the root of the project. Claude Code reads it at the start of every session. For all your projects at once, ~/.claude/CLAUDE.md.',
                    'CLAUDE.md projektin juuressa. Claude Code lukee sen jokaisen istunnon alussa. Kaikkiin projekteihin kerralla: ~/.claude/CLAUDE.md.'),
                docs: 'https://code.claude.com/docs/en/memory',
            },
        },
        {
            id: 'chatgpt',
            label: 'ChatGPT',
            mcp: {
                docs: 'https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt',
                steps: [
                    s(l, 'Open ChatGPT in a browser. The desktop and mobile apps cannot do this.',
                        'Avaa ChatGPT selaimessa. Työpöytä- ja mobiilisovellukset eivät tähän pysty.'),
                    s(l, 'Settings > Security and login: turn Developer mode on. In a workspace the switch is under Workspace settings > Permissions & Roles.',
                        'Settings > Security and login: kytke Developer mode päälle. Työtilassa kytkin on kohdassa Workspace settings > Permissions & Roles.'),
                    s(l, 'Open the connector list and create a new developer-mode app.',
                        'Avaa konnektorilista ja luo uusi developer-mode-sovellus.'),
                    s(l, 'Fill the fields with the values below. The URL must end in /v1/mcp; without the path it will not connect.',
                        'Täytä kentät alla olevilla arvoilla. Osoitteen pitää päättyä /v1/mcp; ilman polkua se ei yhdistä.'),
                    s(l, 'Complete the sign-in, then start a new conversation and enable the connector in it.',
                        'Vie kirjautuminen loppuun, aloita sitten uusi keskustelu ja ota konnektori siinä käyttöön.'),
                ],
                params: [
                    { label: 'Name', value: 'AIMEAT' },
                    { label: 'Description', value: s(l, 'My AIMEAT node: memory, organisms, tasks', 'Oma AIMEAT-node: muisti, organismit, tehtävät') },
                    { label: 'MCP server URL', value: mcpUrl },
                ],
                plans: s(l, 'Plus, Pro, Business, Enterprise and Education. Not on the free tier, and not in the apps: browser only.',
                    'Plus, Pro, Business, Enterprise ja Education. Ei ilmaisella tasolla eikä sovelluksissa: vain selaimessa.'),
                warn: s(l, 'OpenAI marks developer mode as being for people who understand the risk: it grants both read and write tools. Their own warning is worth reading before you switch it on.',
                    'OpenAI merkitsee developer moden niille jotka ymmärtävät riskin: se antaa sekä luku- että kirjoitustyökalut. Heidän oma varoituksensa kannattaa lukea ennen kuin kytket sen päälle.'),
            },
            instructions: {
                where: s(l, 'Settings > Personalization > Custom instructions, in the field for what ChatGPT should know about you.',
                    'Settings > Personalization > Custom instructions, kenttään jossa kysytään mitä ChatGPT:n tulisi tietää sinusta.'),
            },
        },
        {
            id: 'codex',
            label: 'Codex CLI',
            mcp: {
                docs: 'https://developers.openai.com/codex/mcp',
                steps: [
                    s(l, 'Run the command below in a terminal. It writes the server into ~/.codex/config.toml.',
                        'Aja alla oleva komento terminaalissa. Se kirjoittaa palvelimen tiedostoon ~/.codex/config.toml.'),
                    s(l, 'Run codex mcp list and check that the node is listed.',
                        'Aja codex mcp list ja tarkista että node on listalla.'),
                ],
                command: `codex mcp add aimeat --url ${mcpUrl}`,
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    { label: 'URL', value: mcpUrl },
                    {
                        label: s(l, 'Config file', 'Konfiguraatiotiedosto'), value: '~/.codex/config.toml',
                        note: s(l, 'For one project only, .codex/config.toml in the project (trusted projects only).',
                            'Vain yhteen projektiin: .codex/config.toml projektissa (vain luotetut projektit).'),
                    },
                ],
                note: s(l, 'Codex versions differ in how remote servers are given on the command line. If the command is rejected, run codex mcp --help and check the flag name, or write the server straight into config.toml.',
                    'Codexin versiot eroavat siinä miten etäpalvelin annetaan komentorivillä. Jos komento ei kelpaa, aja codex mcp --help ja tarkista lipun nimi, tai kirjoita palvelin suoraan config.toml-tiedostoon.'),
            },
            instructions: {
                where: s(l, 'AGENTS.md at the root of the project. Codex reads it before it starts working, and it travels with the repository.',
                    'AGENTS.md projektin juuressa. Codex lukee sen ennen kuin aloittaa työn, ja se kulkee repositorion mukana.'),
                docs: 'https://developers.openai.com/codex/concepts/customization',
            },
        },
        {
            id: 'cursor',
            label: 'Cursor',
            mcp: {
                docs: 'https://cursor.com/docs/mcp',
                steps: [
                    s(l, 'Use the one-click install button on this node’s connect page: it opens Cursor and pre-fills everything.',
                        'Käytä tämän noden connect-sivun yhden klikkauksen asennusnappia: se avaa Cursorin ja täyttää kaiken valmiiksi.'),
                    s(l, 'Cursor asks for confirmation. Accept it, and complete the sign-in in the browser.',
                        'Cursor pyytää vahvistuksen. Hyväksy se ja vie kirjautuminen loppuun selaimessa.'),
                    s(l, 'By hand instead: Settings > MCP > Add new MCP server, transport HTTP, with the values below.',
                        'Käsin sen sijaan: Settings > MCP > Add new MCP server, kuljetus HTTP, alla olevilla arvoilla.'),
                ],
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    {
                        label: s(l, 'Transport', 'Kuljetus'), value: 'HTTP',
                        note: s(l, 'Cursor supports HTTP and stdio. SSE and mcp-remote do not work.',
                            'Cursor tukee HTTP:tä ja stdiota. SSE ja mcp-remote eivät toimi.'),
                    },
                    { label: 'URL', value: mcpUrl },
                ],
            },
            instructions: {
                where: s(l, 'AGENTS.md at the root of the project, or Cursor Settings > Rules for a rule that applies to every project.',
                    'AGENTS.md projektin juuressa, tai Cursor Settings > Rules jos haluat säännön joka koskee kaikkia projekteja.'),
            },
        },
        {
            id: 'vscode',
            label: 'VS Code (Copilot)',
            mcp: {
                docs: 'https://code.visualstudio.com/docs/agent-customization/mcp-servers',
                steps: [
                    s(l, 'Open the Command Palette (Ctrl+Shift+P, on a Mac Cmd+Shift+P) and run MCP: Add Server.',
                        'Avaa komentopaletti (Ctrl+Shift+P, Macissa Cmd+Shift+P) ja aja MCP: Add Server.'),
                    s(l, 'Choose HTTP as the type, then give the values below.',
                        'Valitse tyypiksi HTTP ja anna sitten alla olevat arvot.'),
                    s(l, 'Choose Global to make it available everywhere, or Workspace to write it into .vscode/mcp.json in this project.',
                        'Valitse Global jos haluat sen kaikkialle, tai Workspace jos se kirjoitetaan tämän projektin .vscode/mcp.json-tiedostoon.'),
                    s(l, 'Complete the sign-in in the browser, then open Agent mode and check the node is in the tool list.',
                        'Vie kirjautuminen loppuun selaimessa, avaa sitten Agent mode ja tarkista että node on työkalulistassa.'),
                ],
                command: `code --add-mcp '{"name":"aimeat","url":"${mcpUrl}"}'`,
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    { label: 'URL', value: mcpUrl },
                    {
                        label: s(l, 'Config file', 'Konfiguraatiotiedosto'), value: '.vscode/mcp.json',
                        note: s(l, 'Workspace scope. For your user profile, run MCP: Open User Configuration.',
                            'Workspace-taso. Omaan käyttäjäprofiiliisi: aja MCP: Open User Configuration.'),
                    },
                ],
            },
            instructions: {
                where: s(l, 'AGENTS.md at the root of the project, or .github/copilot-instructions.md, which Copilot reads in every chat in that repository.',
                    'AGENTS.md projektin juuressa, tai .github/copilot-instructions.md, jonka Copilot lukee jokaisessa kyseisen repositorion chatissa.'),
            },
        },
        {
            id: 'grok',
            label: 'Grok',
            mcp: {
                docs: 'https://docs.x.ai/grok/connectors',
                steps: [
                    s(l, 'Open grok.com/connectors.', 'Avaa grok.com/connectors.'),
                    s(l, 'Click New Connector and choose Custom.', 'Klikkaa New Connector ja valitse Custom.'),
                    s(l, 'Give the MCP server URL below and complete the sign-in it asks for.',
                        'Anna alla oleva MCP-palvelimen osoite ja vie pyydetty kirjautuminen loppuun.'),
                ],
                params: [
                    { label: 'Name', value: 'AIMEAT' },
                    { label: 'MCP server URL', value: mcpUrl },
                ],
                plans: s(l, 'Paid tiers only. The node also has to be reachable from the public internet, so a node on localhost will not work here.',
                    'Vain maksullisilla tasoilla. Noden pitää lisäksi olla saavutettavissa julkisesta internetistä, joten localhostilla ajettava node ei toimi tässä.'),
            },
            instructions: {
                where: s(l, 'Open the mode menu next to the chat box, find Custom Instructions and click Customize. Applies to all your conversations.',
                    'Avaa chat-kentän vieressä oleva tilavalikko, etsi Custom Instructions ja klikkaa Customize. Koskee kaikkia keskustelujasi.'),
            },
        },
    ];
}
