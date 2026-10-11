/**
 * @file ai-tool-setup.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   Sources. The menu paths and plans marked 2026-10-11 were checked on that day against the vendor's
 *   own pages; the rest were verified 2026-07-31 (MODEL_RECOMMENDATION.reviewedOn is the date the
 *   model names were checked, and moves only when they are):
 *   - Claude connectors (2026-10-11) https://claude.com/docs/connectors/custom/add-unlisted and
 *     https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 *   - Claude personalization https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features
 *   - Claude Code MCP https://code.claude.com/docs/en/mcp
 *   - ChatGPT (2026-10-11) https://developers.openai.com/api/docs/guides/custom-mcp-server and
 *     https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
 *   - Codex MCP (2026-10-11) https://developers.openai.com/codex/mcp
 *   - Cursor MCP (2026-10-11) https://cursor.com/docs/mcp and https://cursor.com/pricing
 *   - VS Code MCP https://code.visualstudio.com/docs/agent-customization/mcp-servers
 *   - Grok connectors https://docs.x.ai/grok/connectors
 *   - Mistral (2026-10-11) https://docs.mistral.ai/le-chat/knowledge-integrations/connectors/mcp-connectors
 *   - LM Studio (2026-10-11) https://lmstudio.ai/docs/app/mcp and https://lmstudio.ai/changelog/lmstudio-v0.4.10
 *   - Gemini CLI (2026-10-11) https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md
 *   - Perplexity (2026-10-11) https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors
 *   - OpenClaw (2026-10-11) https://docs.openclaw.ai/cli/mcp/transports
 *   - Copilot Studio (2026-10-11) https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
 * @structure buildAiToolSetup(config, { lang }) -> AiTool[] (strings already localized, URLs
 *   already resolved against this node's base URL). The branch decision that reads this list
 *   (aliases, resolveAiClient, decideBranch, the question options) is in ai-tool-branch.ts.
 * @usage import { buildAiToolSetup } from '../services/ai-tool-setup.js';
 * @version-history
 *   v1.8.0 — 2026-10-11 — One table: docs/aiplatforms/ is gone, and its checked facts are here.
 *     New tools: Mistral (Le Chat, now Vibe), LM Studio, Gemini CLI, Perplexity, OpenClaw and Copilot
 *     Studio. Corrected against each vendor's own documentation on 2026-10-11: claude.ai and Claude
 *     Desktop add a connector under Customize > Connectors, and the dialog may ask for an OAuth client
 *     choice; ChatGPT adds a custom MCP server from chatgpt.com/plugins (or Settings > Apps > Advanced
 *     settings > Developer mode on Business, Enterprise and Edu), with read and write tools on
 *     Business, Enterprise and Edu and read-only tools on Pro; Cursor's MCP is on its paid plans and
 *     it takes SSE as well; Codex signs in with `codex mcp login`. The vendor addresses are listed
 *     above. The branch decision moved unchanged to ai-tool-branch.ts (max-file-lines).
 *   v1.7.0 — 2026-09-29 — `mcp.install.app` on Claude Code, Cursor and VS Code: the desktop app,
 *     which attaches those three in one click with no terminal and no file. The offer and its
 *     fixed download addresses live in services/desktop-app-offer.ts.
 *   v1.6.1 — 2026-09-18 — The model names in the three setup notes come from
 *     services/model-recommendation.ts, which also carries the "verified" date below.
 *   v1.6.0 — 2026-09-18 — A name two apps share (Gemini, Microsoft Copilot) raises ONE question,
 *     `which-variant`, and the person's answer decides: the Gemini app goes to B, Gemini CLI to A.
 *     Neither name was known before, so such a person lost one attempt down the MCP road before
 *     the prompt-driven road opened. The file's rule is kept and tested: a name, the person's or
 *     a model's, never reaches B. The answer travels in the existing `client` field. Ruled by the
 *     developer in the instruction review.
 *   v1.5.0 — 2026-08-27 — `mcp.install` on Claude Code, VS Code and Cursor: the one-click link and
 *     the config file GET /v1/connect/mcp.json serves. Both come from services/mcp-install.ts, so
 *     what this table advertises and what that route hands over cannot drift. The steps stay: a
 *     link is blocked often enough, and a person who wants to read the file before saving it is
 *     not doing anything wrong. The VS Code `code --add-mcp` line gains the explicit
 *     `"type":"http"` its own config format requires, matching the file and the link.
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
import { MODEL_RECOMMENDATION as MODEL } from './model-recommendation.js';
import { MCP_INSTALL_SCRIPT_OS, mcpConfigFile, mcpInstallLink, mcpInstallScript, type McpInstallClientId } from './mcp-install.js';
import { desktopAppOffer, type DesktopAppOffer } from './desktop-app-offer.js';

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

/**
 * The short way in, for the clients that have one: a link that installs the server in one click,
 * and a configuration file this node serves ready to save.
 *
 * It sits BESIDE the steps rather than replacing them. The steps are what a person falls back on
 * when the link is blocked, when they are on a machine where the client is not installed, or when
 * they want to see what is being written before it is written. Both are always true at once.
 */
export interface AiToolInstall {
    /** Opens the client with the server pre-filled. Absent for a client with no such link. */
    link?: { label: string; href: string; note: string };
    /** The client's own config file, from GET /v1/connect/mcp.json. Carries no credential. */
    file?: { label: string; url: string; filename: string; where: string };
    /**
     * A script a person double-clicks, from GET /v1/connect/install: one per desktop, for the
     * client that has a one-line command and no install link (Claude Code). Absent for the rest.
     */
    scripts?: { os: 'windows' | 'mac'; label: string; url: string; filename: string; note: string }[];
    /** The desktop app, which attaches this tool in one click (services/desktop-app-offer.ts). */
    app?: DesktopAppOffer;
}

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
        /** The one-click link and the ready-made config file, for the clients that have them. */
        install?: AiToolInstall;
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

export type Lang = 'en' | 'fi';
export const lang = (v?: string): Lang => (v === 'fi' ? 'fi' : 'en');
/** Pick one of the two languages. Written as a helper so every string below reads as a pair. */
export const s = (l: Lang, en: string, fi: string) => (l === 'fi' ? fi : en);

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
    /**
     * The short way in for one client. The shapes and the link format live in mcp-install.ts, which
     * the download route reads too, so what this table advertises and what that route serves cannot
     * drift apart. Only the words are written here.
     */
    const install = (id: McpInstallClientId, where: string, linkLabel?: string): AiToolInstall => {
        const href = mcpInstallLink(id, mcpUrl);
        const { filename } = mcpConfigFile(id, mcpUrl);
        // The double-click scripts, for the client that has them. The route decides which client
        // that is (mcp-install.ts), so a client this table lists can never advertise a script the
        // route refuses to serve.
        const scripts = MCP_INSTALL_SCRIPT_OS.flatMap((os) => {
            const sc = mcpInstallScript(id, os, mcpUrl);
            if (!sc) return [];
            return [{
                os,
                label: os === 'windows'
                    ? s(l, 'Windows: download the install script', 'Windows: lataa asennusskripti')
                    : s(l, 'Mac: download the install script', 'Mac: lataa asennusskripti'),
                url: `${node}/v1/connect/install?client=${id}&os=${os}`,
                filename: sc.filename,
                note: os === 'windows'
                    ? s(l, 'Double-click the file: it runs the one command and waits for a key so you can read the result.',
                        'Kaksoisklikkaa tiedostoa: se ajaa yhden komennon ja odottaa näppäintä, jotta ehdit lukea tuloksen.')
                    : s(l, 'Double-click the file. If the Mac refuses a downloaded script, right-click it and choose Open, once.',
                        'Kaksoisklikkaa tiedostoa. Jos Mac ei suostu avaamaan ladattua skriptiä, klikkaa sitä hiiren oikealla ja valitse Open, kerran.'),
            }];
        });
        return {
            ...(href && linkLabel ? {
                link: {
                    label: linkLabel,
                    href,
                    note: s(l, 'The client asks you to confirm, then the sign-in opens in your browser.',
                        'Sovellus pyytää vahvistuksen, ja kirjautuminen avautuu sen jälkeen selaimessa.'),
                },
            } : {}),
            ...(scripts.length ? { scripts } : {}),
            // The three clients this helper serves are exactly the three the desktop app writes.
            app: desktopAppOffer(l),
            file: {
                label: s(l, `Download ${filename}`, `Lataa ${filename}`),
                url: `${node}/v1/connect/mcp.json?client=${id}`,
                filename,
                where,
            },
        };
    };

    const oauthParam = (): AiToolParam => ({
        label: 'Advanced settings: OAuth Client ID / Client Secret',
        value: '',
        note: s(l, 'Leave both empty. This node registers the client automatically (RFC 7591), so there is nothing to paste. If the dialog asks instead which OAuth client to use, keep the default (Use Claude’s published identity) or choose Register automatically: both work here.',
            'Jätä molemmat tyhjiksi. Tämä node rekisteröi asiakkaan automaattisesti (RFC 7591), joten liitettävää ei ole. Jos ikkuna kysyy sen sijaan, mitä OAuth-asiakasta käytetään, pidä oletus (Use Claude’s published identity) tai valitse Register automatically: kumpikin toimii tässä.'),
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
                    s(l, 'Open claude.ai and go to Customize, then Connectors.',
                        'Avaa claude.ai ja mene kohtaan Customize ja sieltä Connectors.'),
                    s(l, 'Click Add custom connector.', 'Klikkaa Add custom connector.'),
                    s(l, 'Fill the fields with the values below and click Add.',
                        'Täytä kentät alla olevilla arvoilla ja klikkaa Add.'),
                    s(l, 'Sign in to this node in the tab that opens, with your own account.',
                        'Kirjaudu tähän nodeen avautuvassa välilehdessä omalla tililläsi.'),
                    s(l, 'Start a NEW conversation.', 'Aloita UUSI keskustelu.'),
                ],
                params: [nameParam(), { label: 'Remote MCP server URL', value: mcpUrl }, oauthParam()],
                plans: s(l, 'Free, Pro, Max, Team and Enterprise. A free account can hold one custom connector, which is enough for this. On Team and Enterprise an owner adds it under Organization settings > Connectors > Add > Custom > Web, and until they do, you cannot. This server must be reachable from the public internet.',
                    'Free, Pro, Max, Team ja Enterprise. Ilmaisella tilillä voi olla yksi oma konnektori, mikä riittää tähän. Team- ja Enterprise-tileillä omistaja lisää sen kohdassa Organization settings > Connectors > Add > Custom > Web, ja ennen sitä sinä et voi. Tämän palvelimen pitää olla saavutettavissa julkisesta internetistä.'),
                note: s(l, `Pick ${MODEL.claude} or better in the model menu and turn extended thinking on. The connection steps and the first conversations go right the first time on a strong model.`,
                    `Valitse mallivalikosta ${MODEL.claude} tai parempi ja kytke laajennettu ajattelu päälle. Vahvalla mallilla kytkentä ja ensimmäiset keskustelut menevät kerralla oikein.`),
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
                    s(l, 'Open Claude Desktop and go to Customize, then Connectors.',
                        'Avaa Claude Desktop ja mene kohtaan Customize ja sieltä Connectors.'),
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
                note: s(l, `Pick ${MODEL.claude} or better in the model menu and turn extended thinking on. The connection steps and the first conversations go right the first time on a strong model.`,
                    `Valitse mallivalikosta ${MODEL.claude} tai parempi ja kytke laajennettu ajattelu päälle. Vahvalla mallilla kytkentä ja ensimmäiset keskustelut menevät kerralla oikein.`),
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
                install: install('claude-code',
                    s(l, 'Save it as .mcp.json at the root of a project. Claude Code offers the server to whoever opens that project, and it can be committed: there is nothing private in it.',
                        'Tallenna se nimellä .mcp.json projektin juureen. Claude Code tarjoaa palvelinta jokaiselle joka avaa projektin, ja tiedoston voi committoida: siinä ei ole mitään yksityistä.')),
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
                docs: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
                steps: [
                    s(l, 'Open ChatGPT in a browser. The desktop and mobile apps cannot do this.',
                        'Avaa ChatGPT selaimessa. Työpöytä- ja mobiilisovellukset eivät tähän pysty.'),
                    s(l, 'Go to chatgpt.com/plugins, click + and choose Add custom MCP server. On Business, Enterprise and Edu the way in can also be Settings > Apps > Advanced settings: turn Developer mode on, then Apps > Create.',
                        'Mene osoitteeseen chatgpt.com/plugins, klikkaa + ja valitse Add custom MCP server. Business-, Enterprise- ja Edu-tileillä reitti voi olla myös Settings > Apps > Advanced settings: kytke Developer mode päälle ja valitse sitten Apps > Create.'),
                    s(l, 'Fill the fields with the values below and choose OAuth as the authentication. The URL must end in /v1/mcp; without the path it will not connect.',
                        'Täytä kentät alla olevilla arvoilla ja valitse tunnistautumiseksi OAuth. Osoitteen pitää päättyä /v1/mcp; ilman polkua se ei yhdistä.'),
                    s(l, 'Confirm with I understand and want to continue, then Create as a plugin, and complete the sign-in.',
                        'Vahvista valinnalla I understand and want to continue, valitse sitten Create as a plugin ja vie kirjautuminen loppuun.'),
                    s(l, 'Start a new conversation and call it with @AIMEAT.',
                        'Aloita uusi keskustelu ja kutsu se kirjoittamalla @AIMEAT.'),
                ],
                params: [
                    { label: 'Name', value: 'AIMEAT' },
                    { label: 'Server URL', value: mcpUrl },
                    {
                        label: 'Authentication', value: 'OAuth',
                        note: s(l, 'This node registers the client itself (RFC 7591), so there is no client ID or secret to paste.',
                            'Tämä node rekisteröi asiakkaan itse (RFC 7591), joten asiakastunnusta tai salaisuutta ei tarvitse liittää.'),
                    },
                ],
                capability: 'plan-dependent',
                plans: s(l, 'Business, Enterprise and Edu: read and write tools (OpenAI calls it a beta). Pro: tools that only read. OpenAI’s pages do not say whether Plus or the free tier can add one. Browser only, not in the apps.',
                    'Business, Enterprise ja Edu: luku- ja kirjoitustyökalut (OpenAI kutsuu sitä betaksi). Pro: vain lukevat työkalut. OpenAI:n sivut eivät kerro, voiko Plus- tai ilmaisella tasolla lisätä palvelimen. Vain selaimessa, ei sovelluksissa.'),
                warn: s(l, 'OpenAI marks a custom MCP server as being for people who understand the risk: a server can carry tools that write as well as read. Their own warning is worth reading before you confirm it.',
                    'OpenAI merkitsee oman MCP-palvelimen niille, jotka ymmärtävät riskin: palvelimella voi olla myös kirjoittavia työkaluja. Heidän oma varoituksensa kannattaa lukea ennen kuin vahvistat sen.'),
                note: s(l, `Use ${MODEL.chatgpt} with thinking enabled. A strong model makes the setup and the first conversations go right the first time.`,
                    `Käytä mallia ${MODEL.chatgpt} ajattelu päällä. Vahva malli vie kytkennän ja ensimmäiset keskustelut kerralla oikein.`),
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
                    s(l, 'Run codex mcp login aimeat and complete the sign-in in the browser.',
                        'Aja codex mcp login aimeat ja vie kirjautuminen loppuun selaimessa.'),
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
                note: s(l, 'Codex CLI, the Codex extension in your editor and the ChatGPT desktop app share this configuration, so the server is added once for all three.',
                    'Codex CLI, editorin Codex-laajennus ja ChatGPT:n työpöytäsovellus käyttävät samaa konfiguraatiota, joten palvelin lisätään kerran kaikille kolmelle.'),
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
                    s(l, 'By hand instead: open the Customize page in the sidebar and add an MCP server with the values below, or save the file below as mcp.json.',
                        'Käsin sen sijaan: avaa sivupalkista Customize-sivu ja lisää MCP-palvelin alla olevilla arvoilla, tai tallenna alla oleva tiedosto nimellä mcp.json.'),
                ],
                install: install('cursor',
                    s(l, 'Save it as mcp.json in the .cursor folder of your home directory, or in .cursor inside a project to keep it to that project.',
                        'Tallenna se nimellä mcp.json kotihakemistosi .cursor-kansioon, tai projektin .cursor-kansioon jos haluat sen vain siihen projektiin.'),
                    s(l, 'Add to Cursor', 'Lisää Cursoriin')),
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    {
                        label: s(l, 'Transport', 'Kuljetus'), value: 'HTTP',
                        note: s(l, 'Streamable HTTP. Cursor also takes SSE and stdio; this node speaks HTTP.',
                            'Streamable HTTP. Cursor tukee myös SSE:tä ja stdiota; tämä node puhuu HTTP:tä.'),
                    },
                    { label: 'URL', value: mcpUrl },
                ],
                capability: 'plan-dependent',
                plans: s(l, 'Paid plans (Individual and up). Cursor’s free Hobby plan does not list MCP.',
                    'Maksulliset tasot (Individual ja ylemmät). Cursorin ilmainen Hobby-taso ei sisällä MCP:tä.'),
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
                command: `code --add-mcp '{"name":"aimeat","type":"http","url":"${mcpUrl}"}'`,
                install: install('vscode',
                    s(l, 'Save it as .vscode/mcp.json in a project. For every project at once, run MCP: Open User Configuration and put the same servers block in the file it opens.',
                        'Tallenna se projektiin nimellä .vscode/mcp.json. Kaikkiin projekteihin kerralla: aja MCP: Open User Configuration ja lisää sama servers-lohko avautuvaan tiedostoon.'),
                    s(l, 'Add to VS Code', 'Lisää VS Codeen')),
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
        {
            id: 'mistral',
            label: 'Mistral Le Chat (Vibe)',
            mcp: {
                docs: 'https://docs.mistral.ai/vibe/work/connectors',
                steps: [
                    s(l, 'Open Le Chat, now called Vibe, in a browser and open Connectors in the sidebar.',
                        'Avaa Le Chat, jonka nimi on nyt Vibe, selaimessa ja avaa sivupalkista Connectors.'),
                    s(l, 'Click + Add Connector and open the Custom MCP Connector tab.',
                        'Klikkaa + Add Connector ja avaa välilehti Custom MCP Connector.'),
                    s(l, 'Fill the fields with the values below and click Connect. Le Chat finds the sign-in by itself: complete it in the window that opens.',
                        'Täytä kentät alla olevilla arvoilla ja klikkaa Connect. Le Chat löytää kirjautumisen itse: vie se loppuun avautuvassa ikkunassa.'),
                    s(l, 'In a conversation, open Tools (+ or /) and turn the connector on.',
                        'Avaa keskustelussa Tools (+ tai /) ja kytke konnektori päälle.'),
                ],
                params: [
                    {
                        label: 'Connector name', value: 'aimeat',
                        note: s(l, 'No spaces or special characters.', 'Ei välilyöntejä eikä erikoismerkkejä.'),
                    },
                    { label: 'Server URL', value: mcpUrl },
                    { label: 'Description', value: '', note: s(l, 'Optional.', 'Vapaaehtoinen.') },
                ],
                plans: s(l, 'Free, Pro and Student: the account owner adds it. On a team plan an administrator adds it. This server must answer over HTTPS with a valid certificate.',
                    'Free, Pro ja Student: tilin omistaja lisää sen. Tiimitasolla sen lisää ylläpitäjä. Tämän palvelimen pitää vastata HTTPS:llä ja voimassa olevalla varmenteella.'),
            },
            instructions: {
                where: s(l, 'Context > Instructions in the sidebar. Applies to every new conversation; a Project has instructions of its own under Instructions > Customize.',
                    'Sivupalkista Context > Instructions. Koskee jokaista uutta keskustelua; projektilla on omat ohjeensa kohdassa Instructions > Customize.'),
                docs: 'https://docs.mistral.ai/vibe/work/custom-instructions',
            },
        },
        {
            id: 'lmstudio',
            label: 'LM Studio',
            mcp: {
                docs: 'https://lmstudio.ai/docs/app/mcp',
                steps: [
                    s(l, 'Open LM Studio 0.4.10 or later (earlier versions connect but cannot sign in).',
                        'Avaa LM Studio 0.4.10 tai uudempi (vanhemmat yhdistävät mutta eivät osaa kirjautua).'),
                    s(l, 'In the Program tab of the right-hand sidebar, click Install, then Edit mcp.json.',
                        'Klikkaa oikean sivupalkin Program-välilehdellä Install ja sitten Edit mcp.json.'),
                    s(l, 'Add the server below under mcpServers and save. LM Studio loads it when the file is saved.',
                        'Lisää alla oleva palvelin kohtaan mcpServers ja tallenna. LM Studio lataa sen, kun tiedosto tallennetaan.'),
                    s(l, 'Complete the sign-in in the browser that opens, then chat with a model that can call tools.',
                        'Vie kirjautuminen loppuun avautuvassa selaimessa ja keskustele sitten mallin kanssa, joka osaa kutsua työkaluja.'),
                ],
                params: [
                    { label: s(l, 'The entry in mcp.json', 'Merkintä tiedostossa mcp.json'), value: `"aimeat": { "url": "${mcpUrl}" }` },
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    { label: 'url', value: mcpUrl },
                    {
                        label: s(l, 'Config file', 'Konfiguraatiotiedosto'), value: '~/.lmstudio/mcp.json',
                        note: s(l, 'On Windows, %USERPROFILE%\\.lmstudio\\mcp.json.', 'Windowsissa %USERPROFILE%\\.lmstudio\\mcp.json.'),
                    },
                ],
                note: s(l, 'LM Studio runs the model on your own computer, so the answers are only as good as that model. Pick the largest model that runs well and calls tools.',
                    'LM Studio ajaa mallia omalla tietokoneellasi, joten vastaukset ovat niin hyviä kuin se malli. Valitse suurin malli, joka toimii sujuvasti ja osaa kutsua työkaluja.'),
            },
            instructions: {
                where: s(l, 'The System Prompt of a chat (Ctrl+E, on a Mac Cmd+E). Save it as a preset to use it again in other chats.',
                    'Keskustelun System Prompt (Ctrl+E, Macissa Cmd+E). Tallenna se esiasetukseksi (preset), niin voit käyttää sitä muissakin keskusteluissa.'),
                docs: 'https://lmstudio.ai/docs/app/presets',
            },
        },
        {
            id: 'gemini-cli',
            label: 'Gemini CLI',
            mcp: {
                docs: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md',
                steps: [
                    s(l, 'Run the command below in a terminal. -s user makes it available in all your projects; without it the server is added to the current project only.',
                        'Aja alla oleva komento terminaalissa. -s user tuo sen kaikkiin projekteihisi; ilman sitä palvelin lisätään vain nykyiseen projektiin.'),
                    s(l, 'Start gemini and type /mcp auth aimeat, then complete the sign-in in the browser.',
                        'Käynnistä gemini ja kirjoita /mcp auth aimeat, ja vie sitten kirjautuminen loppuun selaimessa.'),
                    s(l, 'Run gemini mcp list and check that the node is listed.',
                        'Aja gemini mcp list ja tarkista että node on listalla.'),
                ],
                command: `gemini mcp add -s user --transport http aimeat ${mcpUrl}`,
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    {
                        label: 'httpUrl', value: mcpUrl,
                        note: s(l, 'In ~/.gemini/settings.json the field is httpUrl. The field url means SSE, which this node does not speak.',
                            'Tiedostossa ~/.gemini/settings.json kentän nimi on httpUrl. Kenttä url tarkoittaa SSE:tä, jota tämä node ei puhu.'),
                    },
                ],
            },
            instructions: {
                where: s(l, 'GEMINI.md at the root of the project, which Gemini CLI reads with every prompt. For all your projects at once, ~/.gemini/GEMINI.md.',
                    'GEMINI.md projektin juuressa, jonka Gemini CLI lukee jokaisen kehotteen mukana. Kaikkiin projekteihin kerralla: ~/.gemini/GEMINI.md.'),
                docs: 'https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md',
            },
        },
        {
            id: 'perplexity',
            label: 'Perplexity',
            mcp: {
                docs: 'https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors',
                steps: [
                    s(l, 'Open Account settings > Connectors.', 'Avaa Account settings > Connectors.'),
                    s(l, 'Click + Custom connector and choose Remote.', 'Klikkaa + Custom connector ja valitse Remote.'),
                    s(l, 'Fill the fields with the values below and complete the sign-in.',
                        'Täytä kentät alla olevilla arvoilla ja vie kirjautuminen loppuun.'),
                ],
                params: [
                    nameParam(),
                    { label: 'MCP Server URL', value: mcpUrl },
                    {
                        label: 'Client ID / Client Secret', value: '',
                        note: s(l, 'Leave both empty. This node registers the client itself (RFC 7591).',
                            'Jätä molemmat tyhjiksi. Tämä node rekisteröi asiakkaan itse (RFC 7591).'),
                    },
                ],
                capability: 'plan-dependent',
                plans: s(l, 'Perplexity files custom connectors under its Enterprise features, and its page does not say whether Pro or Free can add one. This server must be reachable from the public internet.',
                    'Perplexity luettelee omat konnektorit Enterprise-ominaisuuksiinsa, eikä sen sivu kerro, voiko Pro- tai ilmaisella tasolla lisätä sellaisen. Tämän palvelimen pitää olla saavutettavissa julkisesta internetistä.'),
            },
            instructions: {
                where: s(l, 'Settings > Personalization > Custom instructions for your account; a Project has its own instructions in its settings (the gear beside its title).',
                    'Settings > Personalization > Custom instructions koko tilillesi; projektilla on omat ohjeensa sen asetuksissa (ratas otsikon vieressä).'),
                docs: 'https://www.perplexity.ai/help-center/en/articles/10352993-account-settings',
            },
        },
        {
            id: 'openclaw',
            label: 'OpenClaw',
            mcp: {
                docs: 'https://docs.openclaw.ai/cli/mcp/transports',
                steps: [
                    s(l, 'Run the command below where OpenClaw runs.', 'Aja alla oleva komento siellä, missä OpenClaw toimii.'),
                    s(l, 'Run openclaw mcp login aimeat and complete the sign-in in the browser.',
                        'Aja openclaw mcp login aimeat ja vie kirjautuminen loppuun selaimessa.'),
                ],
                command: `openclaw mcp set aimeat '{"url":"${mcpUrl}","transport":"streamable-http","auth":"oauth"}'`,
                params: [
                    { label: s(l, 'Server name', 'Palvelimen nimi'), value: 'aimeat' },
                    { label: 'url', value: mcpUrl },
                    { label: 'transport', value: 'streamable-http' },
                    { label: 'auth', value: 'oauth' },
                ],
                note: s(l, 'OpenClaw runs on your own computer or server and brings its own model; use a strong one that calls tools well.',
                    'OpenClaw toimii omalla tietokoneellasi tai palvelimellasi ja tuo oman mallinsa; käytä vahvaa mallia, joka kutsuu työkaluja hyvin.'),
            },
            instructions: {
                where: s(l, 'AGENTS.md in the agent’s workspace (by default ~/.openclaw/workspace), which OpenClaw loads at the start of every session.',
                    'AGENTS.md agentin työtilassa (oletuksena ~/.openclaw/workspace), jonka OpenClaw lataa jokaisen istunnon alussa.'),
                docs: 'https://docs.openclaw.ai/concepts/agent-workspace',
            },
        },
        {
            id: 'copilot-studio',
            label: 'Microsoft Copilot Studio',
            mcp: {
                docs: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent',
                steps: [
                    s(l, 'Open the agent in Copilot Studio and go to Tools > Add a tool > New tool > Model Context Protocol.',
                        'Avaa agentti Copilot Studiossa ja valitse Tools > Add a tool > New tool > Model Context Protocol.'),
                    s(l, 'Give the server URL below, choose OAuth 2.0 and Dynamic discovery, and create the tool.',
                        'Anna alla oleva palvelimen osoite, valitse OAuth 2.0 ja Dynamic discovery ja luo työkalu.'),
                    s(l, 'Sign in to this node when the connection asks, then publish the agent again.',
                        'Kirjaudu tähän nodeen, kun yhteys sitä pyytää, ja julkaise agentti sitten uudelleen.'),
                ],
                params: [
                    { label: 'Server name', value: 'AIMEAT' },
                    { label: 'Server URL', value: mcpUrl },
                    {
                        label: 'Authentication', value: 'OAuth 2.0: Dynamic discovery',
                        note: s(l, 'This node registers the client itself (RFC 7591).', 'Tämä node rekisteröi asiakkaan itse (RFC 7591).'),
                    },
                ],
                capability: 'plan-dependent',
                plans: s(l, 'Access to Copilot Studio through your organization. This connects an agent you build there, not the Copilot app itself. This server must be reachable from the public internet.',
                    'Pääsy Copilot Studioon organisaatiosi kautta. Tämä liittää siellä rakentamasi agentin, ei itse Copilot-sovellusta. Tämän palvelimen pitää olla saavutettavissa julkisesta internetistä.'),
            },
            instructions: {
                where: s(l, 'The agent’s Overview page > Instructions > Edit. Publish the agent again for the change to apply.',
                    'Agentin Overview-sivu > Instructions > Edit. Julkaise agentti uudelleen, jotta muutos tulee voimaan.'),
                docs: 'https://learn.microsoft.com/en-us/microsoft-copilot-studio/authoring-instructions',
            },
        },
    ];
}

