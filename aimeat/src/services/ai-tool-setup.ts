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
 *   AI_CLIENT_ALIASES / resolveAiClient() / decideBranch() / aiClientQuestionOptions() — the
 *   remake's branch decision, kept beside the list it reads rather than in the calling code.
 * @usage import { buildAiToolSetup } from '../services/ai-tool-setup.js';
 * @version-history
 *   v1.4.0 — 2026-08-17 — A model recommendation on every chat-app tool (claude.ai, Claude
 *     Desktop, ChatGPT, Grok, goose): pick the strongest model, thinking on. Watched in
 *     production: onboarding on a mid-tier default model wanders and stalls; the same steps on a
 *     strong model complete first try. The developer tools (Claude Code, Codex, Cursor, VS Code)
 *     carry no line — their users choose models deliberately already.
 *   v1.3.0 — 2026-08-16 — goose joins the table as the ninth tool. It has been a supported
 *     client since the connect adapter shipped (src/cli/connect/clients/goose.ts), so a person
 *     who chose it was told to configure something this page did not list. Free on its own
 *     tier: it is Apache-2.0 and brings its own model provider.
 *   v1.2.0 — 2026-08-07 — REMAKE phase 1: the alias map (what a model may call its own app →
 *     one of these eight ids) and the branch decision live here, next to the list, because an
 *     earlier draft put them in a five-row table of their own and that table would have dropped
 *     ChatGPT, Grok and Codex users into branch B for no reason. Each tool now states its
 *     `capability` ('yes' | 'plan-dependent') so a paid-tier requirement is asked about rather
 *     than assumed either way.
 *   v1.0.0 — 2026-07-31 — Moved here from public/views/profile/ai-tool-setup.js so the SPA and the
 *     Experience Center read one table instead of two copies.
 *   v1.1.0 — 2026-08-07 — claude.ai moved first and flagged `recommended` (UX-remake v3, K2):
 *     the free tier's single custom-connector slot is enough to start, and array order doubles
 *     as the default selection in the pickers.
 */
import type { AimeatConfig } from '../config.js';

export interface AiToolParam {
    /** The field label as the tool's own UI spells it. */
    label: string;
    /** What to put in it. Empty string means: leave the field empty, deliberately. */
    value: string;
    note?: string;
}

/**
 * Whether this app can open an MCP connection at all. Every tool in this table can — that is why
 * it is in the table — so the only distinction is whether a paid tier is required.
 * `plan-dependent` is a question to ask the person, never a reason to refuse them.
 */
export type McpCapability = 'yes' | 'plan-dependent';

export interface AiTool {
    id: string;
    label: string;
    /** The tool we point a first-timer at (K2: free tier's one connector slot is enough). */
    recommended?: boolean;
    mcp: {
        docs: string;
        steps: string[];
        /** A literal command line, when the tool is attached from a terminal instead of a form. */
        command?: string;
        params: AiToolParam[];
        /**
         * Whether the free tier can do this. Defaults to 'yes' when absent. Derived from `plans`
         * below and stated separately so the branch decision reads a value rather than parsing
         * a sentence written for a human.
         */
        capability?: McpCapability;
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
        // claude.ai first ON PURPOSE (UX-remake v3, K2): it is the recommended first path — the
        // free tier's single custom-connector slot is enough to start, and the array order is
        // also the default selection in every picker built on this table.
        {
            id: 'claude-web',
            label: 'claude.ai',
            recommended: true,
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
                note: s(l, 'Pick Opus 5 or better in the model menu and turn extended thinking on. The connection steps and the first conversations go right the first time on a strong model.',
                    'Valitse mallivalikosta Opus 5 tai parempi ja kytke laajennettu ajattelu päälle. Vahvalla mallilla kytkentä ja ensimmäiset keskustelut menevät kerralla oikein.'),
            },
            instructions: {
                where: s(l, 'Settings > General > Instructions for Claude (shown under Profile in some versions). Applies to every new conversation on the account.',
                    'Settings > General > Instructions for Claude (joissakin versioissa Profile-kohdan alla). Koskee jokaista uutta keskustelua tällä tilillä.'),
                docs: 'https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features',
            },
        },
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
                note: s(l, 'Pick Opus 5 or better in the model menu and turn extended thinking on. The connection steps and the first conversations go right the first time on a strong model.',
                    'Valitse mallivalikosta Opus 5 tai parempi ja kytke laajennettu ajattelu päälle. Vahvalla mallilla kytkentä ja ensimmäiset keskustelut menevät kerralla oikein.'),
            },
            instructions: {
                where: s(l, 'Settings > General > Instructions for Claude. Applies to every new conversation on the account.',
                    'Settings > General > Instructions for Claude. Koskee jokaista uutta keskustelua tällä tilillä.'),
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
                capability: 'plan-dependent',
                plans: s(l, 'Plus, Pro, Business, Enterprise and Education. Not on the free tier, and not in the apps: browser only.',
                    'Plus, Pro, Business, Enterprise ja Education. Ei ilmaisella tasolla eikä sovelluksissa: vain selaimessa.'),
                warn: s(l, 'OpenAI marks developer mode as being for people who understand the risk: it grants both read and write tools. Their own warning is worth reading before you switch it on.',
                    'OpenAI merkitsee developer moden niille jotka ymmärtävät riskin: se antaa sekä luku- että kirjoitustyökalut. Heidän oma varoituksensa kannattaa lukea ennen kuin kytket sen päälle.'),
                note: s(l, 'Use GPT-5.6 with thinking enabled. A strong model makes the setup and the first conversations go right the first time.',
                    'Käytä GPT-5.6:ta ajattelu päällä. Vahva malli vie kytkennän ja ensimmäiset keskustelut kerralla oikein.'),
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
            id: 'goose',
            label: 'goose',
            mcp: {
                docs: 'https://goose-docs.ai/docs/getting-started/using-extensions',
                steps: [
                    s(l, 'Let this node write the configuration for you: run `aimeat connect client goose --url <node URL> --owner <your handle>`. It adds the extension and keeps your token out of the file.',
                        'Anna tämän noden kirjoittaa konfiguraatio puolestasi: aja `aimeat connect client goose --url <noden osoite> --owner <tunnuksesi>`. Se lisää laajennuksen ja pitää tokenin poissa tiedostosta.'),
                    s(l, 'By hand instead: open the goose config file below and add an extension of type streamable_http with the values here.',
                        'Käsin sen sijaan: avaa alla oleva goose-konfiguraatiotiedosto ja lisää siihen laajennus, jonka tyyppi on streamable_http, alla olevilla arvoilla.'),
                    s(l, 'Start a session with `goose session` and ask it what AIMEAT tools it can see.',
                        'Käynnistä istunto komennolla `goose session` ja kysy siltä, mitkä AIMEAT-työkalut se näkee.'),
                ],
                command: 'aimeat connect client goose --url <node URL> --owner <your handle>',
                params: [
                    { label: s(l, 'Extension name', 'Laajennuksen nimi'), value: 'aimeat' },
                    {
                        label: s(l, 'Type', 'Tyyppi'), value: 'streamable_http',
                        note: s(l, 'goose calls HTTP transport streamable_http. SSE is a different, older setting and does not work here.',
                            'goose kutsuu HTTP-kuljetusta nimellä streamable_http. SSE on eri ja vanhempi asetus, eikä se toimi tässä.'),
                    },
                    { label: 'URL', value: mcpUrl },
                    {
                        label: s(l, 'Config file', 'Konfiguraatiotiedosto'),
                        value: '~/.config/goose/config.yaml',
                        note: s(l, 'On Windows the same file lives under the Block/goose folder in %APPDATA%.',
                            'Windowsissa sama tiedosto on %APPDATA%-kansion Block/goose-hakemistossa.'),
                    },
                ],
                note: s(l, 'Point goose at a strong reasoning model. DeepSeek v4 0813 via OpenRouter is a good pick, with reasoning enabled.',
                    'Osoita goose vahvaan päättelymalliin. Hyvä valinta on DeepSeek v4 0813 OpenRouterin kautta, päättely päällä.'),
            },
            instructions: {
                where: s(l, '.goosehints at the root of the project, which goose reads at the start of every session there. For something that should apply everywhere, use a recipe instead.',
                    '.goosehints projektin juuressa, jonka goose lukee siellä jokaisen istunnon alussa. Jos sääntö koskee kaikkea, käytä sen sijaan recipeä.'),
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
                capability: 'plan-dependent',
                plans: s(l, 'Paid tiers only. The node also has to be reachable from the public internet, so a node on localhost will not work here.',
                    'Vain maksullisilla tasoilla. Noden pitää lisäksi olla saavutettavissa julkisesta internetistä, joten localhostilla ajettava node ei toimi tässä.'),
                note: s(l, 'Pick Grok’s strongest model, with reasoning on. The cheap default model is where the setup goes wrong.',
                    'Valitse Grokin vahvin malli, päättely päällä. Halpa oletusmalli on se, jossa kytkentä menee pieleen.'),
            },
            instructions: {
                where: s(l, 'Open the mode menu next to the chat box, find Custom Instructions and click Customize. Applies to all your conversations.',
                    'Avaa chat-kentän vieressä oleva tilavalikko, etsi Custom Instructions ja klikkaa Customize. Koskee kaikkia keskustelujasi.'),
            },
        },
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// The branch decision (aimeat_remake/04-mcp-kyvykkyys.md)
//
// MCP capability belongs to the CLIENT APP, not the model. The same model is capable in Claude
// Desktop and incapable behind a web UI with no connectors, because the model does not open
// connections — the app it runs in does. So the deciding field is `ai-client`, and the eight ids
// above ARE the list of apps that can. Nothing here is a second table: this maps what a model may
// call its own app onto one of those eight.
// ─────────────────────────────────────────────────────────────────────────────

/** All ids in this table, for callers that need the set without building the localized list. */
export const AI_TOOL_IDS = [
    'claude-web', 'claude-desktop', 'claude-code', 'chatgpt', 'codex', 'cursor', 'vscode', 'grok',
    'goose',
] as const;
export type AiToolId = typeof AI_TOOL_IDS[number];

/** Which tools need a paid tier. Everything else in the table works on its free one. */
const PLAN_DEPENDENT: ReadonlySet<string> = new Set<string>(['chatgpt', 'grok']);

/**
 * What a model may claim about the app it is running in → which of the eight it is.
 *
 * Keys are NORMALIZED (lowercased, every non-alphanumeric removed), so one entry covers a family
 * of spellings: `claudeai` matches "claude.ai", "Claude AI" and "CLAUDE-AI" alike. Vendor names
 * are here too ("anthropic", "openai", "xai") because a model asked which app it is in commonly
 * answers with who made it.
 *
 * This map grows from the unknown names the funnel collects (onboarding.ai_model_detected), never
 * from guesses — the same rule as the table above.
 */
export const AI_CLIENT_ALIASES: Readonly<Record<string, AiToolId>> = {
    // claude.ai — the recommended first path, so bare "claude" resolves here.
    claude: 'claude-web',
    claudeai: 'claude-web',
    claudeweb: 'claude-web',
    claudecom: 'claude-web',
    anthropic: 'claude-web',
    anthropicclaude: 'claude-web',
    claudeaiweb: 'claude-web',
    // Claude Desktop
    claudedesktop: 'claude-desktop',
    claudedesktopapp: 'claude-desktop',
    claudeapp: 'claude-desktop',
    claudeformac: 'claude-desktop',
    claudeforwindows: 'claude-desktop',
    // Claude Code
    claudecode: 'claude-code',
    claudecodecli: 'claude-code',
    claudecli: 'claude-code',
    // ChatGPT
    chatgpt: 'chatgpt',
    chatgptweb: 'chatgpt',
    chatgptplus: 'chatgpt',
    chatgptpro: 'chatgpt',
    openai: 'chatgpt',
    openaichatgpt: 'chatgpt',
    gpt: 'chatgpt',
    gpt4: 'chatgpt',
    gpt4o: 'chatgpt',
    gpt5: 'chatgpt',
    gpt51: 'chatgpt',
    // goose — open source, Apache-2.0, now under the Linux Foundation's Agentic AI Foundation.
    goose: 'goose',
    blockgoose: 'goose',
    codenamegoose: 'goose',
    goosecli: 'goose',
    goosedesktop: 'goose',
    // Codex CLI
    codex: 'codex',
    codexcli: 'codex',
    openaicodex: 'codex',
    // Cursor
    cursor: 'cursor',
    cursorai: 'cursor',
    cursoride: 'cursor',
    cursoreditor: 'cursor',
    // VS Code / Copilot
    vscode: 'vscode',
    visualstudiocode: 'vscode',
    copilot: 'vscode',
    githubcopilot: 'vscode',
    vscodecopilot: 'vscode',
    copilotchat: 'vscode',
    // Grok
    grok: 'grok',
    grokcom: 'grok',
    xai: 'grok',
    xaigrok: 'grok',
} as const;

/** Lowercase, drop everything that is not a letter or digit. "Claude Web" and "claude.ai" collapse. */
export function normalizeAiClientClaim(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Aliases longest-first, so "claudecode" wins over "claude" in a containment match. */
const ALIASES_BY_LENGTH: ReadonlyArray<readonly [string, AiToolId]> =
    Object.entries(AI_CLIENT_ALIASES)
        .sort((a, b) => b[0].length - a[0].length) as ReadonlyArray<readonly [string, AiToolId]>;

export type AiClientResolution =
    | { kind: 'known'; id: AiToolId; capability: McpCapability; matched: string }
    /** Nothing matched, or nothing was claimed. NOT the same as "incapable" — see decideBranch. */
    | { kind: 'unknown'; claim: string | null };

/**
 * Resolve a model's claim about its own app to one of the eight ids.
 *
 * Two passes: an exact match on the normalized claim, then the longest alias CONTAINED in it —
 * models rarely answer with a bare app name ("Claude Sonnet 4.5 via claude.ai"), and refusing to
 * read those would push perfectly capable people into the "unknown" path for a phrasing habit.
 * Longest-first ordering is what keeps "…via claude code" from resolving as claude.ai.
 */
export function resolveAiClient(claim: string | null | undefined): AiClientResolution {
    const raw = typeof claim === 'string' ? claim.trim() : '';
    if (!raw) return { kind: 'unknown', claim: null };
    const norm = normalizeAiClientClaim(raw);
    if (!norm) return { kind: 'unknown', claim: raw };

    const exact = AI_CLIENT_ALIASES[norm];
    if (exact) return { kind: 'known', id: exact, capability: capabilityOf(exact), matched: norm };

    for (const [alias, id] of ALIASES_BY_LENGTH) {
        if (norm.includes(alias)) return { kind: 'known', id, capability: capabilityOf(id), matched: alias };
    }
    return { kind: 'unknown', claim: raw };
}

/** A tool's capability. Everything in the table can speak MCP; only the tier varies. */
export function capabilityOf(id: string): McpCapability {
    return PLAN_DEPENDENT.has(id) ? 'plan-dependent' : 'yes';
}

/** What the person still has to be asked, if anything. */
export type BranchQuestion = 'which-client' | 'paid-plan';

export type BranchDecision =
    | { branch: 'A'; reason: 'known-capable' | 'plan-confirmed' | 'unknown-defaults-to-a'; toolId?: AiToolId }
    /** The ONLY route to B: the person said they do not have the tier their app requires. */
    | { branch: 'B'; reason: 'plan-missing'; toolId: AiToolId }
    | { branch: 'ask'; question: BranchQuestion; toolId?: AiToolId };

/**
 * The branch, from what we know so far.
 *
 * The rule that shapes every line of this: **an app NAME can never send anyone to branch B.**
 * A wrong A costs one attempt. A wrong B tells someone whose tools were fine that their tools are
 * not good enough, and they have no way to argue. So:
 *   - a known app that needs no paid tier      → A
 *   - a known app that does                    → ask about the tier (not a refusal, a question)
 *   - an app we have never heard of, or none   → ask which app; if they cannot say, A anyway
 *
 * @param resolution  what resolveAiClient made of the model's claim
 * @param answers.hasPaidPlan  the person's answer to the tier question, once they have given one
 * @param answers.clientAnswer the person's answer to "which app did you talk in", once given.
 *   `other` and `dont-know` both mean: try A. If the connection then fails, B is where they land,
 *   having lost one attempt rather than being turned away on a guess.
 */
export function decideBranch(
    resolution: AiClientResolution,
    answers: { hasPaidPlan?: boolean; clientAnswer?: string } = {},
): BranchDecision {
    if (resolution.kind === 'unknown') {
        const ans = answers.clientAnswer?.trim();
        if (ans && ans !== 'other' && ans !== 'dont-know') {
            // They named an app. Read it through the same map — the answer is not privileged.
            const again = resolveAiClient(ans);
            if (again.kind === 'known') return decideBranch(again, { hasPaidPlan: answers.hasPaidPlan });
        }
        if (ans) return { branch: 'A', reason: 'unknown-defaults-to-a' };
        return { branch: 'ask', question: 'which-client' };
    }

    if (resolution.capability === 'yes') {
        return { branch: 'A', reason: 'known-capable', toolId: resolution.id };
    }
    // plan-dependent
    if (answers.hasPaidPlan === true) return { branch: 'A', reason: 'plan-confirmed', toolId: resolution.id };
    if (answers.hasPaidPlan === false) return { branch: 'B', reason: 'plan-missing', toolId: resolution.id };
    return { branch: 'ask', question: 'paid-plan', toolId: resolution.id };
}

/** One option in the "which app did you talk in?" question. */
export interface AiClientOption {
    id: string;
    label: string;
    recommended?: boolean;
    /** Present for real tools; absent for the two escape options. */
    plans?: string;
}

/**
 * The options for "Which app did you talk to the AI in?", built from the SAME table the branch
 * reads — a hardcoded second list here would be the exact drift the alias map exists to avoid.
 * The two trailing options are escapes, and both lead to branch A.
 */
export function aiClientQuestionOptions(config: AimeatConfig, opts: { lang?: string } = {}): AiClientOption[] {
    const l = lang(opts.lang);
    const tools = buildAiToolSetup(config, opts).map(tool => ({
        id: tool.id,
        label: tool.label,
        ...(tool.recommended ? { recommended: true } : {}),
        ...(tool.mcp.plans ? { plans: tool.mcp.plans } : {}),
    }));
    return [
        ...tools,
        { id: 'other', label: s(l, 'Something else', 'Jokin muu') },
        { id: 'dont-know', label: s(l, 'I am not sure', 'En ole varma') },
    ];
}
