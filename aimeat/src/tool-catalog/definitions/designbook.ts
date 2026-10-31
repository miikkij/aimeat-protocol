/**
 * @file src/tool-catalog/definitions/designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book tools (TARGET-074 phase 5): the shared library of PROVEN screen
 *   arrangements. Search it, read one part whole, propose one (the bench runs before anything
 *   lands), adopt one into your own app. This is the answer to the measured problem that the
 *   same brief produced a great screen or a confusing one depending on choices one builder
 *   happened to make: a good arrangement becomes an address, and the first move of a build is to
 *   pick from the Book rather than compose from nothing.
 * @structure designbookTools
 * @usage import { designbookTools } from './designbook.js';
 * @version-history
 *   2026-10-30 — The node's default kit: `node` on aimeat_designbook_kit_default, view "defaults" on
 *     aimeat_designbook_kit. aimeat_designbook_status: the operator publishes a part (a kit waiting for
 *     everyone among them) from chat, as POST /v1/designbook/:id/status does on the admin Apps tab.
 *   2026-10-30 — Style kits: aimeat_designbook_kit and aimeat_designbook_kit_default, and the kit kind
 *     in the search filter, the propose part description and adopt.
 *   2026-10-30 — Ornament sets ({ set }) in the propose part description and adopt.
 *   2026-10-29 — The ornament kind in the search filter, the propose part description and adopt.
 *   2026-10-19 — The avatar kind in the search filter and the propose part description.
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.4.8 — 2026-09-26 — The propose contract says that beside a <ul> or <ol> of the markup every
 *     counter-reset also names list-item and "all" takes only revert or revert-layer, because a
 *     counter-reset replaces the list's own reset.
 *   v1.4.7 — 2026-09-26 — The propose contract says a list item stays inside a list of the component,
 *     because a browser numbers any other as an item of the page's own list, and how.
 *   v1.4.6 — 2026-09-26 — The propose contract says the blocks of @font-feature-values pass inside it
 *     and a @function names its parameters without types, defaults or "returns", which the bench's
 *     CSS parser cannot read.
 *   v1.4.5 — 2026-09-26 — The propose contract says a declaration that names a counter, an anchor, a
 *     view transition or a timeline names only the component's own, as the word itself, and what
 *     `all` takes.
 *   v1.4.4 — 2026-09-26 — The propose contract says a component's stylesheet closes every block,
 *     bracket, comment and string it opens, because one left open takes in what the page writes after it.
 *   v1.4.3 — 2026-09-26 — The propose contract states the list of at-rules a component's stylesheet may
 *     carry, and that every other at-rule is refused.
 *   v1.4.2 — 2026-09-26 — The propose contract says a component's stylesheet carries no @layer, @page or
 *     @view-transition, and that a name it defines with @keyframes, @property or @counter-style starts
 *     with its prefix.
 *   v1.4.1 — 2026-09-26 — The propose contract says a component's stylesheet carries no @scope, and why.
 *   v1.4.0 — 2026-09-26 — A component that no longer passes the bench: the search leaves it out, get
 *     answers `bench` and shows its html and css only to its proposer, and adopt refuses it with the
 *     bench's reason. The propose contract says the markup closes every element it opens and a
 *     nested rule starts with "&".
 *   v1.3.0 — 2026-09-20 — aimeat_designbook_keep, the search's view "reasons", and the reasons in
 *     what get answers: why a part was taken, why it was passed over, what was made by hand.
 *   v1.2.0 — 2026-09-19 — The search says what it answers when it is given nothing: the whole
 *     published Book on one page.
 *   v1.1.0 — 2026-09-05 — Seven kinds, said out loud (wish-atelier-ambient-visuals): the search,
 *     the read, the propose and the adopt name look, motion, illustration, genre and ambient
 *     beside layout and fill — this catalogue had said two kinds while six existed, so a fleet
 *     agent reading it could not know what the Book held. Adopt says which kinds replace and
 *     which merge, and that a genre is forked, never adopted.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

/** What the search's `view` parameter says, on both MCP doors. */
export const BOOK_VIEW_PARAM = '"reasons": what builders wrote down about the Book, as the list of what it should become next. "map": the whole published Book on one page (also what calling with nothing answers). Omit it to search rows.';

export const designbookTools = [
    {
        name: 'aimeat_designbook_search',
        description: "Browse the Design Book: the node's shared library of proven parts. Each row is a part — `layout` (a complete Atelier mosaic arrangement), `fill` (the same shape with <placeholder> slots, a starting shape), `look` (a signature token sheet with an optional preset), `motion` (a motion-token recipe), `illustration` (art direction for the imagery pipeline), `genre` (one of the node's served page templates, shown and forked rather than adopted) or `ambient` (the one layer allowed to move at idle: a preset with its alpha and speed, proven on a look) — with its title, what it is for, lifecycle status and how many builds have adopted it. Published parts are what everyone builds from; proposed ones are still earning it. Filter by kind, status or a word. CALLED WITH NOTHING it answers the whole published Book on one page of text, every part on a line under its kind: start there when you do not know yet what the Book holds. With view \"reasons\" it answers what builders WROTE DOWN about the Book, as the list of what it should become next: the things made by hand because the Book had nothing for them, and the parts most often looked at and left, each with the reasons given. A component whose stored markup or stylesheet no longer passes the bench this node runs is left out of the rows and the page, because nobody can take it.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: browse the parts', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            kind: { type: 'string', description: 'Only this part kind: layout, fill, look, motion, illustration, genre, ambient, effect, component, avatar (an SVG an agent starts its own agent.avatar picture from), ornament (an animated SVG figure the Atelier kit grows round one element: a frame, a vine, a wreath, a flourish) or kit (a style kit, the whole look of a new app: the search lists the kits you can read, your own and your organisms\' included).' },
            status: { type: 'string', description: 'Only this lifecycle state: proposed, published, aging or retired. Omit for all.' },
            q: { type: 'string', description: 'A word matched against id, title, summary and tags.' },
            limit: { type: 'number', description: 'Rows to return, 1-200. Default 50.' },
            view: { type: 'string', description: BOOK_VIEW_PARAM },
        },
    },
    {
        name: 'aimeat_designbook_keep',
        description: "Record that the OWNER is satisfied with one of their apps: it turned out well and they mean to keep it. Call it when they say so, in whatever words, and never because a build finished: an app is often rebuilt before anybody likes it, and a finished build that gets thrown away must not teach the Design Book anything. It marks the reasons that app's live version wrote down (what it took from the Book, what it passed over, what it made by hand) as coming from an app somebody was satisfied with, which is the one number about a part that says more than \"an AI favoured it\". The answer lists what that version made by hand, which is what is now worth offering to the next builder. `kept: false` takes it back. The app must carry build notes (<script type=\"application/json\" id=\"aimeat-build-notes\">); one that carries none is answered with how to add them.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: the owner is satisfied with this app', idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            filename: { type: 'string', required: true, description: 'The published app the owner is satisfied with, e.g. "habits.html". It must belong to your owner.' },
            kept: { type: 'boolean', description: 'false takes it back. Default true.' },
        },
    },
    {
        name: 'aimeat_designbook_get',
        description: "Read one Design Book part whole: its body is exactly what an adopt writes into an app — a layout or fill whole; a look's or motion's tokens and preset; an illustration's style; an ambient's preset, alpha, speed, the look it was proven on and its tokens; a genre's template id, which is forked rather than adopted — so reading it IS the preview. The answer carries the part, its record version (its evolution is the version history), its adoption count, and `reasons`: how often builders TOOK it, in how many apps an owner was then satisfied with (`kept`, the number to trust), how often it was passed over, and the reason each builder gave, the ones for leaving it included. Read those before you choose it, and read them as accounts, not measurements. A COMPONENT also answers `bench`: { passes: true }, or { passes: false, why, note } when its stored markup or stylesheet no longer passes the bench this node runs. Such a component cannot be taken, and its html and css are shown only to its proposer, who needs them to fix it and propose it again under the same id.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: one part, whole', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The part id, from the search.' },
        },
    },
    {
        name: 'aimeat_designbook_propose',
        description: "Propose a part into the Design Book, or update one you already proposed. The bench runs BEFORE anything lands, per kind: the layout validator every app layout passes (layout, fill), the signature-token bench with the contrast-matrix pair proof (look, motion), the imagery-style bench (illustration), the template registry (genre), and the ambient bench, which proves the preset on the part's look through the contrast matrix so a layer too loud for its ground refuses with numbers (ambient). A refusal carries the validator's words with the nearest real name. A new part lands as `proposed` — publishing it into the shared catalogue is the node operator's call. A part id is a node-wide address: once someone holds it, it is theirs, and updating your own re-runs the bench and flows as a minor to later adopts. A COMPONENT is the ninth kind and the one the Book grows by: what an app made by hand because the Book had nothing for it, offered to the next builder as { prefix, html, css, use, judgement: { reach: \"general\" | \"special\", why }, from_app? }. It is markup and a stylesheet and NO script (its preview is served from this node, so script in it would be anybody's code running as the node; the app that takes it wires the behaviour); every class starts with its prefix; the markup closes every element it opens, and the stylesheet every block, bracket, comment and string, because one left open takes in whatever the page writes after it; a rule nested inside another starts with \"&\" (\"& .<prefix>-cell { … }\", \"&:hover { … }\"); the stylesheet reaches only the component, so the at-rules it may carry are a list: @media, @supports, @container and @starting-style, which condition its own rules, and @keyframes, @property, @counter-style, @font-palette-values, @position-try, @function and @font-feature-values under a name that starts with its prefix (\"@keyframes <prefix>-spin\", \"@property --<prefix>-x\"), because the whole page shares that name, with the blocks of @font-feature-values (@styleset, @swash, …) inside it and a @function's parameters named without types, defaults or \"returns\", which the bench's CSS parser cannot read; every other at-rule, @scope, @layer, @page, @view-transition and @import among them, is refused; a declaration that names a counter, an anchor, a view transition or a timeline (counter-reset, counter-set, counter-increment, anchor-name, view-transition-name, the timeline names and timeline-scope) names only its own, under the prefix (\"counter-increment: <prefix>-step\"), or none, as the word itself and never through var(), and \"all\" takes only unset, initial, revert or revert-layer; an animation, counter style, counter or anchor the page defines is still used by its name; a list item stays inside a list of the component, because a browser numbers any other as an item of the page's own list: an <li> stands only inside a <ul> or <ol>, no display holds list-item or is written through var() or inherit, and where the markup carries a <summary> every counter-increment also writes \"list-item 0\"; where it carries a <ul> or <ol>, every counter-reset also names list-item and \"all\" takes only revert or revert-layer, because a counter-reset replaces the list's own reset, and only there does list-item pass in a counter-reset; every colour is a var(--ak-…) token, so it wears whatever page it lands in. YOU JUDGE ITS REACH, honestly: \"general\" when another kind of app would use it, \"special\" when it belongs to one app, with the reason. A general component whose from_app is an app the owner said turned out well (aimeat_designbook_keep) is PUBLISHED BY ITSELF, with no person in between; any other stays proposed, listed and usable by you, and the answer says which and why. A GENRE CAN GROW OUT OF AN APP the same way: a published page with a look of its own (its head says aimeat-register \"custom:<name>\") is proposed as kind \"genre\", id \"genre-<name>\", body { app: { owner, filename }, judgement: { reach, why } }, naming YOUR OWN app. A general one is published by itself when its owner said the app turned out well AND opened it for forking, which only the owner can do, because a genre hands the page's source to every builder; it is then forked with aimeat_app_template_get like any genre, and it stops being offered the moment the app is deleted, parked or closed for forking." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: propose (benched first)', idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            part: { type: 'object', required: true, description: 'The part: { id, kind: "layout"|"fill"|"look"|"motion"|"illustration"|"genre"|"ambient"|"effect"|"component"|"avatar"|"ornament"|"kit", title, summary, body, tags? }. A KIT has body { reach: "own"|"organism"|"node", organism?, look, tokens?, genre?, ornament?: { set, palette?: "set"|"look" }, logo?, from_app? }: the whole look of a new app. reach "own" is yours alone and "organism" the members\' of the organism you name (you must be an active member); both are usable at once. "node" is everyone\'s once published, by itself when from_app names an app its owner said turned out well, else by the operator. An AVATAR has body { svg }: one SVG element an agent starts its own picture from, at most 256 kB, no DOCTYPE. An ORNAMENT has body { ornament, params?, look? }: one figure the Atelier kit draws (the Book lists them under kind ornament), with knobs speed, delay, leaves, value or strands inside their bounds; or body { set, params?, look? }: one of the kit\'s eleven ornament sets, five figures in one style (the chaotic set also takes mess).A COMPONENT has body { prefix, html, css, use, judgement: { reach: "general"|"special", why }, from_app? }: markup that closes every element it opens and a stylesheet under one class prefix that closes every block, bracket, comment and string it opens (a nested rule starts with "&"; the only at-rules are @media, @supports, @container and @starting-style, and @keyframes, @property, @counter-style, @font-palette-values, @position-try, @function and @font-feature-values under a name that starts with the prefix, with the blocks of @font-feature-values inside it and the parameters of a @function untyped; a counter, anchor, view transition or timeline a declaration names starts with the prefix too, as the word itself, never through var(); an <li> stands only inside a <ul> or <ol>, no display holds list-item, and with a <summary> in the markup every counter-increment also writes list-item 0; with a <ul> or <ol> in the markup every counter-reset also names list-item and all takes only revert or revert-layer), every colour a var(--ak-…) token, NO script. The kind decides the body: a whole mosaic layout, the vocabulary aimeat_app_manage action "ui_get" hands you (layout, fill); { tokens, look? } (look); { tokens } of motion tokens only (motion); { style, palette_words? } (illustration); { template } naming a served genre template, or { app: { owner, filename }, judgement: { reach, why } } naming your own published page whose look is its own (genre); { ambient: waves|aurora|dust|grid|static|ink, alpha?, speed?, look?, tokens? } (ambient — "none" is an arrangement\'s choice, never a part).' },
            ...aiProvenanceCatalogInput,
        },
    },
    {
        name: 'aimeat_designbook_adopt',
        description: "Take one part for one of your own Atelier apps. A COMPONENT is taken BEFORE the app exists: the answer carries `snippet` { html, css, use, prefix }, two texts to build into your page and how to wire them (a component carries no script), nothing is written and the app need not be published yet; name it in your page's build notes (`took`) and the publish counts it as used. A component whose stored markup or stylesheet no longer passes the bench is refused with the bench's reason. An ORNAMENT is taken the same way, before or after the app exists: the answer carries `ornament` { ornament, code, use }, the one line `AIMEAT.atelier.ornament(el, id, params)` to call on the element it decorates, or for a set `ornament` { set, code, use } with the one `AIMEAT.atelier.ornamentSet(set, { frame, rule, bar, bullets, strip }, params)` line; nothing is written. A KIT is taken the same way: the answer carries `kit` { look, genre?, fork?, css?, app, ornament?, use }, what to fork, what to put in the head and the lines to call; nothing is written, and taking it counts the use that keeps the kit from aging. Every other kind goes into a PUBLISHED app through the same validated, versioned write every layout takes; the app renders it on its next open. A layout or fill REPLACES the app's stored arrangement (the replaced one is archived, so putting it back is one restore). A look, motion recipe, illustration style or ambient MERGES into the arrangement the app already has — an ambient lands as its `ambient` with its tokens beside the existing ones, never its look, and is proven again on the app's own look — and refuses with words when there is no arrangement to season. A genre is never adopted: it is forked from its template, and the refusal carries the address. Published parts are adoptable by anyone; a proposed one only by its own proposer. Adopting counts as usage — it is the signal that keeps a part alive." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: adopt into your app', destructiveHint: true, idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The part to adopt.' },
            filename: { type: 'string', required: true, description: 'Your published app file the layout lands in, e.g. "errands.html".' },
            ...aiProvenanceCatalogInput,
        },
    },
    {
        name: 'aimeat_designbook_kit',
        description: "The style kit a NEW APP starts from: call it FIRST, before you pick a genre. A kit is the whole look of an app in one Design Book part (a look, its colours, faces, corners and motion, the genre to fork, an ornament set, a logo), chosen by the person for their own new apps, or by an organism's owners for every member's. Name the `organism` when the app is built for one: its kit answers when it chose one and you are an active member, else the person's own, else none. The answer carries the kit and `apply`: the genre to fork, the `css` to put in the head, the `app` line with the look and the logo, the `ornament` line, and `use`, what to do in order. Build in the kit unless the person asks for something else: it is a default, never a rule. When neither the organism nor the person chose one, the node's own default answers (`source` \"node\"). `passed_over` says when a chosen kit no longer answers and why. No kit is answered with how the person can choose one. With view \"defaults\" it answers every default the person can see or choose instead: their own, the node's, and each organism's they are an owner or an admin of, and whether they may choose the node's.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: the style kit a new app starts from', readOnlyHint: true },
        scope: 'memory:read',
        surfaces: ['agent'],
        input: {
            organism: { type: 'string', description: 'The organism the app is built for, when it is built for one. Omit for the person\'s own kit.' },
            view: { type: 'string', enum: ['defaults'], description: '"defaults" answers every default the person can see or choose, instead of the kit in force.' },
        },
    },
    {
        name: 'aimeat_designbook_kit_default',
        description: "Choose the style kit new apps start from, or clear it with clear true. Without `organism` it is the person's own: their next apps start in it. With `organism` it is that organism's, for every member's new apps, and only its owners and admins choose it; the kit must be one its members can read (proposed with reach \"organism\" for that organism, or a published kit for the whole node). With `node` true it is the node's, for every new app whose organism and person chose none; only the node's operator chooses it, and the kit must be a published kit for the whole node. Make a kit with aimeat_designbook_propose, kind \"kit\": body { reach: \"own\" | \"organism\" | \"node\", organism?, look, tokens?, genre?, ornament?: { set, palette? }, logo?, from_app? }. To save the style of an app the person likes, read the app (aimeat_app_get), take its look, its --ak-… tokens, its genre and its ornament set, and propose them as a kit with from_app naming it. List the kits they can read with aimeat_designbook_search { kind: \"kit\" }.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: choose the default style kit', idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            kit: { type: 'string', description: 'The kit id. Leave it out with clear true.' },
            clear: { type: 'boolean', description: 'true clears the default, so new apps start with no kit.' },
            organism: { type: 'string', description: 'The organism whose default this is. Omit for the person\'s own.' },
            node: { type: 'boolean', description: 'true makes it the node\'s default (the operator only). Not together with organism.' },
        },
    },
    {
        name: 'aimeat_designbook_status',
        description: "Move a Design Book part through its life: \"published\" puts a proposed part on the shared shelf for everyone (a kit with reach \"node\" waiting for the operator among them), \"aging\" marks one nobody takes, \"proposed\" takes one back off the shelf, \"retired\" ends it. Publishing, aging and demoting are the node operator's calls; a proposer may retire their own part, nothing more. The parts waiting for the operator are listed with aimeat_designbook_search { status: \"proposed\" }. The answer carries the part's new and previous status.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        annotations: { title: 'Design Book: publish or retire a part', idempotentHint: true },
        scope: 'memory:write',
        surfaces: ['agent'],
        input: {
            id: { type: 'string', required: true, description: 'The part id.' },
            status: { type: 'string', required: true, enum: ['published', 'aging', 'proposed', 'retired'], description: 'The status the part moves to.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
