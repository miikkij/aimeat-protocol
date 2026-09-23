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
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { UiEntrySource } from './types.js';

export const SHARED_ENTRIES: UiEntrySource[] = [
    {
        id: 'card-menu', name: 'CardMenu', kind: 'component', status: 'active',
        summary: 'The dots in the top right corner of a card, and the menu they open.',
        module: '/components/CardMenu.js', sheet: '/css/components/card-menu.css',
        data: { shape: 'CardMenu({ state, actions, label, onOpened })', fields: { state: "'off', 'open' or 'working': the colour of the dots", actions: '[{ label, run, done }]', label: 'what the dots are, for a screen reader', onOpened: 'called the first time it opens' } },
        use: ['Acting on one card: always the same corner, on every card.'],
        variants: [],
        example: { state: 'open', label: 'Your welcome mat', actions: [{ label: 'Take it off your open items' }] },
    },
    {
        id: 'markdown', name: 'Markdown', kind: 'component', status: 'active',
        summary: 'Rendered Markdown as a readable document: headings, tables, code, quotes, lists and links, sanitised.',
        module: '/components/Markdown.js', sheet: '/css/components/markdown.css',
        data: { shape: 'Markdown({ text, onWikiLink })', fields: { text: 'the Markdown source', onWikiLink: 'handler for [[wiki]] links, when the page has them' } },
        use: ['Anything an agent or a person wrote in Markdown: an agent turn, a document, an operator passage.'],
        variants: [],
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
        use: ['Content made with AI that carries a record (EU AI Act, Article 50), and the start of a conversation with an AI.'],
        variants: [],
        example: { variant: 'inline', recordUrl: '/v1/provenance/abc' },
    },
    {
        id: 'voice-recorder', name: 'VoiceRecorder', kind: 'component', status: 'active',
        summary: 'A record button and its active state: a pulsing dot, the elapsed time, a level meter, stop and cancel.',
        module: '/components/VoiceRecorder.js', sheet: '/css/components/voice-recorder.css',
        data: { shape: 'VoiceRecorder({ onRecorded, maxSeconds, disabled, label, className })', fields: { onRecorded: 'called with the recorded file', maxSeconds: 'the longest recording', disabled: 'cannot record now', label: 'the button words', className: 'the button class' } },
        use: ['Speaking instead of typing: the chat composer, the inbox, the transcription test.'],
        variants: [],
        example: { maxSeconds: 300, className: 'btn-outline' },
    },
    {
        id: 'image-deliverable', name: 'ImageDeliverable', kind: 'component', status: 'active',
        summary: 'Size-capped image thumbnails that open on click, and the loading and failure chips, fetched with the session when the file is private.',
        module: '/components/ImageDeliverable.js', sheet: '/css/components/image-deliverable.css',
        data: { shape: 'ImageView({ desc }) · ImageStrip({ images, alt }) · DeliverableBody({ value, alt, format })', fields: { desc: '{ url, alt }', images: 'a list of descs', value: 'a deliverable that may hold images' } },
        use: ['A picture in a task result, a memory, an offer, a workflow or a chat attachment.'],
        variants: [],
        example: { desc: { url: '/v1/storage/photo.png', alt: 'photo.png' } },
    },
    {
        id: 'install-cta', name: 'InstallCta', kind: 'component', status: 'active',
        summary: 'The "install this as an app" suggestion: a slim row a person can dismiss.',
        module: '/components/InstallCta.js', sheet: '/css/components/install-cta.css',
        data: { shape: 'InstallCta({ compact })', fields: { compact: 'the tighter cut for the chat column' } },
        use: ['On the home and in the chat, when the browser can install the site.'],
        variants: [],
        example: { compact: true },
    },
    {
        id: 'managed-env', name: 'ManagedEnvNote', kind: 'component', status: 'active',
        summary: 'A neutral note above a copyable prompt that explains the reader\'s environment.',
        module: '/components/ManagedEnvNote.js', sheet: '/css/components/managed-env.css',
        data: { shape: 'ManagedEnvNote({ compact })', fields: { compact: 'the one-line cut' } },
        use: ['Above every copyable prompt on the public pages.'],
        variants: [],
        example: { compact: false },
    },
    {
        id: 'mcp-install', name: 'McpInstall', kind: 'component', status: 'active',
        summary: 'The short way in: one-click install links, terminal one-liners and downloadable config files, ranked by effort.',
        module: '/components/McpInstall.js', sheet: '/css/components/mcp-install.css',
        data: { shape: 'McpInstallRow({ tool, serverName, className }) · McpQuickConnect({ serverName, guideHref, title, lead })', fields: { tool: 'which AI tool', serverName: 'the name the connection gets', guideHref: 'the full guide', title: 'the headline', lead: 'the line under it' } },
        use: ['Connecting an AI tool to this node over MCP.'],
        variants: [],
        example: { serverName: 'aimeat', title: 'Connect your AI' },
    },
    {
        id: 'hello-mcp', name: 'InstructionBlock', kind: 'component', status: 'active',
        summary: 'The organism instruction block and the per-tool setup guide, the two onboarding components of the Agents page and every organism.',
        module: '/views/profile/instruction-block.js', sheet: '/css/components/hello-mcp.css',
        data: { shape: 'InstructionBlock({ orgId }) · McpSetupGuide({ installClassName, tabClass, activeClass }) (views/profile/ai-setup-guide.js)', fields: { orgId: 'the organism whose instructions to show', tabClass: 'the tab class for the guide', activeClass: 'the chosen tab class' } },
        use: ['Telling a person how to connect their AI to an organism, tool by tool.'],
        variants: [],
        example: { orgId: 'fbb51de5-…' },
        note: 'Two modules read this sheet: views/profile/instruction-block.js and views/profile/ai-setup-guide.js. The MCP page draws the same components in the poster dress (views/mcp-poster.css).',
    },
    {
        id: 'contact-picker', name: 'ContactPicker', kind: 'component', status: 'active',
        summary: 'A field with a suggestion list: contacts, directory hits, and an action to resolve an email address.',
        module: '/components/ContactPicker.js', sheet: '/css/components/contact-picker.css',
        data: { shape: 'ContactPicker({ value, onChange, onSubmit, onEmailUnresolved, placeholder, disabled, excludeIds, autofocus, valueMode, kinds })', fields: { value: 'the text', onChange: 'change handler', onSubmit: 'a person was picked', onEmailUnresolved: 'an email nobody here has', excludeIds: 'people not to offer', valueMode: "'bare' or another form", kinds: 'which kinds of principal to offer' } },
        use: ['Choosing who to send to, invite or share with.'],
        variants: [],
        example: { value: '', placeholder: 'Name or email' },
    },
    {
        id: 'data-map', name: 'DataMap', kind: 'component', status: 'unused',
        summary: 'The data map: one line on an app card, and the panel it opens into.',
        module: '/components/DataMap.js', sheet: '/css/components/data-map.css',
        data: { shape: 'DataMapLine({ stamp, onOpen }) · DataMapPanel({ map, findings, appLabel })', fields: { stamp: 'the one-line summary', onOpen: 'opens the panel', map: 'what the app reads and writes', findings: 'what the check found', appLabel: 'the app name' } },
        use: ['Showing what an app does with a person\'s data, before and after they use it. No page draws it today.'],
        variants: [],
        example: { stamp: 'Reads your notes, writes nothing' },
        note: 'Its only page use was the Apps tab (views/profile/apps-tab.datamap.js), deleted in 8fde4f329 (2026-09-02) when per-app management moved to the app launcher, which has its own data map (src/static/app-catalog/js/data-map.js). Only the barrel file components/index.js imports it now, and nothing imports the barrel. Keep or delete is Jouni\'s call.',
    },
    {
        id: 'tags', name: 'TagList', kind: 'component', status: 'active',
        summary: 'Tags as small pills in a wrapping row, with an optional editor.',
        module: '/components/TagList.js', sheet: '/css/components/tags.css',
        data: { shape: 'TagList({ tags, max, prefix, onTag })', fields: { tags: 'the tags', max: 'how many to show', prefix: 'text before each', onTag: 'a tag was pressed' } },
        use: ['The tags of an agent, an app or a record.'],
        variants: [],
        example: { tags: ['music', 'charts'], max: 5 },
    },
    {
        id: 'app-sandbox', name: 'AppSandbox', kind: 'component', status: 'active',
        summary: 'A full-screen overlay that hosts a published app in a sandboxed iframe, without the site\'s own origin.',
        module: '/js/app-sandbox.js', sheet: '/css/components/app-sandbox.css',
        data: { shape: 'openAppSandboxed(url, name) · isAppHtmlUrl(href)', fields: { url: 'the app address', name: 'its name' } },
        use: ['Opening a person\'s published app from inside the site.'],
        variants: [],
        example: { url: '/v1/apps/alice/charts.html' },
    },
    {
        id: 'own-aimeat', name: 'OwnAimeat', kind: 'component', status: 'active',
        summary: 'The home\'s "get your own AIMEAT" card on a demo site, stacked from the poster box, label, headline and slab.',
        module: null, sheet: '/css/components/own-aimeat.css', classes: ['poster-own-aimeat'],
        data: { shape: 'markup: .poster-own-aimeat (OwnAimeatBlock in views/surface/blocks-home.js)', fields: { headline: 'the card headline', href: 'where to get one' } },
        use: ['The home of a demo node, as a layout block.'],
        variants: [],
        example: { headline: 'Get your own', href: '/v1/store' },
        note: 'Its markup sits in OwnAimeatBlock (views/surface/blocks-home.js), which a node draws only when it has a store address and its operator added the block.',
    },
];
