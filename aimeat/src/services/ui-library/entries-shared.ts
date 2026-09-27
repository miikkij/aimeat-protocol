/**
 * @file src/services/ui-library/entries-shared.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the shared components whose sheets were in css/components/
 *   before the home's and the chat's parts joined them: the corner menu, the Markdown renderer, the
 *   AI label, the voice recorder and the rest. Catalogued as they are; nothing about them moved. The
 *   purpose half only; facts.generated.ts carries what the files say.
 * @structure SHARED_ENTRIES
 * @usage import { SHARED_ENTRIES } from './entries-shared.js';
 * @version-history
 *   v1.5.2 — 2026-09-27 — OwnAimeat names its module (components/OwnAimeat.js) and the words it takes
 *     (the catalogue pass, operator family).
 *   v1.5.1 — 2026-09-27 — InstructionBlock draws its own names from instruction-block.css (formerly
 *     .ib-* in hello-mcp.css; a move); its entry id follows its sheet (hello-mcp → instruction-block).
 *   v1.5.0 — 2026-09-26 — Markdown's small cut (.md-body--small, `small`), Jouni's decision "Small reader".
 *   v1.4.0 — 2026-09-26 — A removable tag's x is the Tag's remove mark (.poster-chip-x), coral while the pointer is on the tag (Jouni's decision "Remove mark", a unification).
 *   v1.3.0 — 2026-09-26 — A message is the chat's turn (components/Turn.js classes): your words bold on the sun, the other side's beside the pale coral spine, the name above the words, the time and the read marks under them with Copy and Listen, the other six actions behind one ⋯ (CardMenu inline); an agent's options are the chat's choices. The frame, the picture beside the other side, the action pill and the Chat tab's bubbles, pairing lines and small reader go; a suggested reply waiting for approval keeps its dashed box (a unification: Jouni's decision "Message").
 *   v1.2.0 — 2026-09-26 — TagList names its removable tag (.tag-removable, .tag-x), whose rules moved into tags.css unchanged (UI consolidation phase 5, a move).
 *   v1.1.0 — 2026-09-23 — DataMap deleted with its code (Jouni's decision).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntryWritten } from './types.js';

export const SHARED_ENTRIES: UiEntryWritten[] = [
    {
        id: 'card-menu', name: 'CardMenu', kind: 'component', status: 'active',
        summary: 'The dots in the top right corner of a card, and the menu they open. The same menu can open from a line of words drawn as the action link, and its list can stand in the poster frame (the ink frame with the sun shadow).',
        module: '/components/CardMenu.js', sheet: '/css/components/card-menu.css',
        data: {
            shape: 'CardMenu({ state, actions, label, onOpened, inline, word, framed, disabled })',
            fields: {
                state: "'off', 'open' or 'working': the colour of the dots",
                actions: '[{ label, run, done, doneLabel, danger } | { divider: true }]: the rows; done shows doneLabel (else "Done") for a moment, danger is the menu row\'s danger tone, a divider draws a line between two groups',
                label: 'what the dots are, for a screen reader and the tooltip; with word, the tooltip of the words', onOpened: 'called the first time it opens',
                inline: "'start' or 'end': the dots in a line of words, the menu opening from that edge",
                word: 'the words the menu opens from, drawn as the action link in their own line instead of the dots; the menu opens from their right edge unless inline says \'start\'',
                framed: 'the list in the poster frame: the ink frame with the sun shadow, 6px off what opened it',
                disabled: 'the dots or the words cannot be pressed now (an export the menu started is running)',
            },
        },
        useFor: ['Acting on one card: always the same corner, on every card.', 'The actions of one message that do not fit its line (Messages).',
            'A page\'s small menu of acts that opens from a line of words ("Backups and imports").'],
        variants: [
            { name: 'inline', class: 'card-menu--inline', prop: 'inline', when: 'the dots in a line of words, not in a card\'s corner' },
            { name: 'word', prop: 'word', when: 'the menu opens from words drawn as the action link, not from the dots' },
            { name: 'framed', class: 'card-menu-list--framed', prop: 'framed', when: 'the opened list in the ink frame with the sun shadow' },
            { name: 'disabled', prop: 'disabled', when: 'the dots or the words cannot be pressed while what the menu started runs' },
        ],
        example: { state: 'open', label: 'Your welcome mat', actions: [{ label: 'Take it off your open items' }] },
        note: 'word, framed and disabled came with appcat on 2026-09-27: together they replaced the old app catalogue\'s "Backups and imports" (.cat-word #backup-btn) and the menu it opened (.backup-menu).',
    },
    {
        id: 'markdown', name: 'Markdown', kind: 'component', status: 'active',
        summary: 'Rendered Markdown as a readable document: headings, tables, code, quotes, lists and links, sanitised.',
        module: '/components/Markdown.js', sheet: '/css/components/markdown.css',
        data: { shape: 'Markdown({ text, onWikiLink, small })', fields: { text: 'the Markdown source', onWikiLink: 'handler for [[wiki]] links, when the page has them', small: 'the small cut, for a small place in Settings' } },
        useFor: ['Anything an agent or a person wrote in Markdown: an agent turn, a document, an operator passage.'],
        variants: [{ name: 'small', class: 'md-body--small', when: 'a small place in Settings (an agent\'s README, a task\'s memory value or description, an organism\'s README, a record field, the structure map, an app\'s setup guide): the headings a step larger than the words (Jouni\'s decision "Small reader")' }],
        example: { text: '## Hello\n\nA **bold** word and a [link](https://aimeat.io).' },
    },
    {
        id: 'ai-label', name: 'AiLabel', kind: 'component', status: 'active',
        summary: 'The one visible AI label on content that has a provenance record, and the notice that a person is talking to an AI.',
        module: '/components/ai-label.js', sheet: '/css/components/ai-label.css',
        data: {
            shape: 'AiLabel({ record, recordUrl, variant, class }) · AiInteractionNotice({ titleKey, bodyKey, recordUrl, class })',
            fields: { record: 'the provenance record', recordUrl: 'where the full record is', variant: "'inline' (default) or another cut", titleKey: 'the notice title key', bodyKey: 'the notice body key' },
        },
        useFor: ['Content made with AI that carries a record (EU AI Act, Article 50), and the start of a conversation with an AI.'],
        variants: [],
        example: { variant: 'inline', recordUrl: '/v1/provenance/abc' },
    },
    {
        id: 'voice-recorder', name: 'VoiceRecorder', kind: 'component', status: 'active',
        summary: 'A record button and its active state: a pulsing dot, the elapsed time, a level meter, stop and cancel.',
        module: '/components/VoiceRecorder.js', sheet: '/css/components/voice-recorder.css',
        data: { shape: 'VoiceRecorder({ onRecorded, maxSeconds, disabled, label, className })', fields: { onRecorded: 'called with the recorded file', maxSeconds: 'the longest recording', disabled: 'cannot record now', label: 'the button words', className: 'the button class' } },
        useFor: ['Speaking instead of typing: the chat composer, the inbox, the transcription test.'],
        variants: [],
        example: { maxSeconds: 300, className: 'btn-outline' },
    },
    {
        id: 'image-deliverable', name: 'ImageDeliverable', kind: 'component', status: 'active',
        summary: 'Size-capped image thumbnails that open on click, and the loading and failure chips, fetched with the session when the file is private.',
        module: '/components/ImageDeliverable.js', sheet: '/css/components/image-deliverable.css',
        data: { shape: 'ImageView({ desc }) · ImageStrip({ images, alt }) · DeliverableBody({ value, alt, format })', fields: { desc: '{ url, alt }', images: 'a list of descs', value: 'a deliverable that may hold images' } },
        useFor: ['A picture in a task result, a memory, an offer, a workflow or a chat attachment.'],
        variants: [],
        example: { desc: { url: '/v1/storage/photo.png', alt: 'photo.png' } },
    },
    {
        id: 'install-cta', name: 'InstallCta', kind: 'component', status: 'active',
        summary: 'The "install this as an app" suggestion: a slim row a person can dismiss.',
        module: '/components/InstallCta.js', sheet: '/css/components/install-cta.css',
        data: { shape: 'InstallCta({ compact })', fields: { compact: 'the tighter cut for the chat column' } },
        useFor: ['On the home and in the chat, when the browser can install the site.'],
        variants: [],
        example: { compact: true },
    },
    {
        id: 'managed-env', name: 'ManagedEnvNote', kind: 'component', status: 'active',
        summary: 'A neutral note above a copyable prompt that explains the reader\'s environment.',
        module: '/components/ManagedEnvNote.js', sheet: '/css/components/managed-env.css',
        data: { shape: 'ManagedEnvNote({ compact })', fields: { compact: 'the one-line cut' } },
        useFor: ['Above every copyable prompt on the public pages.'],
        variants: [],
        example: { compact: false },
    },
    {
        id: 'mcp-install', name: 'McpInstall', kind: 'component', status: 'active',
        summary: 'The short way in: one-click install links, terminal one-liners and downloadable config files, ranked by effort.',
        module: '/components/McpInstall.js', sheet: '/css/components/mcp-install.css',
        data: { shape: 'McpInstallRow({ tool, serverName, className }) · McpQuickConnect({ serverName, guideHref, title, lead })', fields: { tool: 'which AI tool', serverName: 'the name the connection gets', guideHref: 'the full guide', title: 'the headline', lead: 'the line under it' } },
        useFor: ['Connecting an AI tool to this node over MCP.'],
        variants: [],
        example: { serverName: 'aimeat', title: 'Connect your AI' },
    },
    {
        id: 'instruction-block', name: 'InstructionBlock', kind: 'component', status: 'active',
        summary: 'The copyable instruction block of one organism, in the three formats people paste it into (the AI chat\'s instructions, CLAUDE.md, AGENTS.md): the formats as the tab row, a line that says where the chosen one goes, the block in the typewriter face, and a row with its copy door and a grey line naming the organism and how many workspaces it was made from. A grey line while it loads or when it cannot be read.',
        module: '/components/InstructionBlock.js', sheet: '/css/components/instruction-block.css',
        data: {
            shape: 'InstructionBlock({ orgId })',
            fields: { orgId: 'the organism whose block it shows; the node writes the block from the organism\'s real structure, in the reader\'s language, and it is read again when the language changes' },
        },
        useFor: ['Giving a person the text that tells their AI where things live in an organism, and where to paste it.'],
        variants: [
            { name: 'formats', class: 'instruction-block-tabs', when: 'the three formats, one tab each; the chosen one decides the block and the line that says where it goes' },
            { name: 'loading or failed', class: 'instruction-block-note', prop: 'orgId', when: 'the block is still being read, or could not be read' },
        ],
        example: { orgId: 'fbb51de5-…' },
        note: 'Moved on 2026-09-26 out of views/profile/instruction-block.js, which only re-exports it now. Since 2026-09-27 it draws its own names (.instruction-block-*, formerly .ib-*) from its own sheet, moved unchanged out of hello-mcp.css, whose other half is the setup guide\'s setup-guide.css (entry setup-guide, components/SetupGuide.js; its InstructionsDialog also draws this block). The MCP page, the organism pages and the instructions dialog draw it.',
    },
    {
        id: 'contact-picker', name: 'ContactPicker', kind: 'component', status: 'active',
        summary: 'A field with a suggestion list: contacts, directory hits, and an action to resolve an email address.',
        module: '/components/ContactPicker.js', sheet: '/css/components/contact-picker.css',
        data: { shape: 'ContactPicker({ value, onChange, onSubmit, onEmailUnresolved, placeholder, disabled, excludeIds, autofocus, valueMode, kinds })', fields: { value: 'the text', onChange: 'change handler', onSubmit: 'a person was picked', onEmailUnresolved: 'an email nobody here has', excludeIds: 'people not to offer', valueMode: "'bare' or another form", kinds: 'which kinds of principal to offer' } },
        useFor: ['Choosing who to send to, invite or share with.'],
        variants: [],
        example: { value: '', placeholder: 'Name or email' },
    },
    {
        id: 'tags', name: 'TagList', kind: 'component', status: 'active',
        summary: 'Tags as small pills in a wrapping row, with an optional editor.',
        module: '/components/TagList.js', sheet: '/css/components/tags.css',
        data: { shape: 'TagList({ tags, max, prefix, onTag })', fields: { tags: 'the tags', max: 'how many to show', prefix: 'text before each', onTag: 'a tag was pressed' } },
        useFor: ['The tags of an agent, an app or a record.'],
        variants: [{ name: 'removable', class: 'tag-removable', when: 'a tag that takes itself off when pressed (the tag editor, js/components/tag-editor.js; a new contact\'s tags; a file\'s tags): its x is the Tag\'s remove mark (.poster-chip-x), grey, coral while the pointer is on the tag' }],
        example: { tags: ['music', 'charts'], max: 5 },
    },
    {
        id: 'app-sandbox', name: 'AppSandbox', kind: 'component', status: 'active',
        summary: 'A full-screen overlay that hosts a published app in a sandboxed iframe, without the site\'s own origin.',
        module: '/js/app-sandbox.js', sheet: '/css/components/app-sandbox.css',
        data: { shape: 'openAppSandboxed(url, name) · isAppHtmlUrl(href)', fields: { url: 'the app address', name: 'its name' } },
        useFor: ['Opening a person\'s published app from inside the site.'],
        variants: [],
        example: { url: '/v1/apps/alice/charts.html' },
    },
    {
        id: 'own-aimeat', name: 'OwnAimeat', kind: 'component', status: 'active',
        summary: 'A demo site\'s one prompt to buy: a record-face card with its small row label, the headline, one paragraph, and the loud slab to the store, which opens in a new tab. With no store address it draws nothing.',
        module: '/components/OwnAimeat.js', sheet: '/css/components/own-aimeat.css',
        data: {
            shape: 'OwnAimeat({ label, title, text, cta, href })',
            fields: {
                label: 'the small row label at the top ("Demo")',
                title: 'the headline',
                text: 'the one paragraph under it',
                cta: 'the slab\'s words',
                href: 'the store\'s address; without it the card is not drawn (a stored layout can outlive its store)',
            },
        },
        useFor: ['The home of a demo node, as a layout block the operator adds; no built-in home has it.'],
        variants: [],
        example: { label: 'Demo', title: 'This is a demo. Get your own AIMEAT.', text: 'Many people share this site to try things out.', cta: 'Go to the store →', href: 'https://store.example.com' },
        note: 'The markup OwnAimeatBlock (views/surface/blocks-home.js) wrote, moved unchanged into components/OwnAimeat.js on 2026-09-27, so the block passes the words and the store\'s address. Its look is own-aimeat.css with the record and slab shapes of poster.css.',
    },
];
