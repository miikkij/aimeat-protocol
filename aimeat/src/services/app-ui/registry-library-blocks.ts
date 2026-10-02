/**
 * @file src/services/app-ui/registry-library-blocks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The mosaic components drawn over a node library rather than a memory source: the
 *   members blocks (AIMEAT.iam), workspaceTeam and workspacePicker (AIMEAT.organism), the intake
 *   forms, connections, workflowInput, aiTask, doc, decision and aiChat. Moved out of registry.ts
 *   unchanged on 2026-10-02 (it stood at 810 lines against the 800 cap); registry.ts spreads them
 *   at the end of UI_COMPONENTS, in the same order. APPEND-ONLY, as every registry entry is.
 * @structure LIBRARY_BLOCK_COMPONENTS
 * @usage import { LIBRARY_BLOCK_COMPONENTS } from './registry-library-blocks.js';
 * @version-history
 *   v1.0.0 — 2026-10-02 — Moved from registry.ts (v1.25.0) under the 800-line cap.
 */
import { text, requiredText, type AppUiComponentDef } from './registry-defs.js';

export const LIBRARY_BLOCK_COMPONENTS: readonly AppUiComponentDef[] = [
  // ── The app's own members (2026-10-01, append-only): self-sourced over AIMEAT.iam, so they bind
  //    no memory source. The page loads aimeat-auth.js and aimeat-iam.js; the node keeps the roster.
  {
    id: 'members',
    summary: "The owner's member screen: who asked for access (approve with a role, decline), who opened the app and holds no role (approve, seen it), the members with a role select and Remove (confirmed), add someone by account name, and what a stranger gets. One click on Approve grants the role with the least power. A non-owner is told only the owner manages members. A refused action shows the node's reason. Needs aimeat-iam.js on the page.",
    maxPerLayout: 1,
    props: {
      app: requiredText('The app whose roster this is, "owner/file.html".', 120),
      roles: text("The app's roles, a comma list, least power first, e.g. \"member, admin\". Leave empty when the page already called AIMEAT.iam.init.", 200),
      approveRole: text('The role one click on Approve grants, when it is not the least powerful one.', 40),
      variant: text('"list" (the default: tabs, faces and rows), "table" (one dense table of members) or "dense" (for a side panel).', 10),
      title: text("The section title, when the kit's own is not wanted.", 120),
    },
  },
  {
    id: 'joinRequest',
    summary: "The visitor's side: ask the owner for access with a note, or see \"you asked on …\", \"declined, you can ask again\" or \"you are a member\". Renders nothing for the app's owner. Needs aimeat-iam.js on the page.",
    maxPerLayout: 1,
    props: {
      app: requiredText('The app to ask for, "owner/file.html".', 120),
      roles: text("The app's roles, a comma list, least power first. Leave empty when the page already called AIMEAT.iam.init.", 200),
      title: text("The section title, when the kit's own is not wanted.", 120),
    },
  },
  {
    id: 'workspaceTeam',
    summary: "A workspace's people: requests to approve as viewer or contributor or decline, the people with their role (raising to contributor asks first, the creator stays), and add by account name or invite by email. Give org and ws, or leave them empty and give app to open on the workspace a workspacePicker block chose. Needs aimeat-organism.js on the page.",
    maxPerLayout: 1,
    props: {
      org: text('The organism id. Leave empty, with app given, to follow the workspacePicker.', 80),
      ws: text('The workspace id. Leave empty, with app given, to follow the workspacePicker.', 80),
      title: text("The section title, when the kit's own is not wanted.", 120),
      variant: text('"list" (the default) or "table".', 10),
      app: text('The app key the workspacePicker on this page uses. Used only when org and ws are empty.', 120),
      inviteInto: text('Workspaces one invitation names, each "wsId:role:label", comma-separated, e.g. "ws-a:viewer:B1, ws-b:contributor". It replaces the block\'s own workspace in the invite.', 1000),
    },
  },
  {
    id: 'workspacePicker',
    summary: "An app's first run: which organism and which workspace of it keep the app's records. A choice made before is used at once and shown as one line with Change; otherwise the person picks an organism or creates one, and the workspace is found or created and remembered. The blocks below that name the same app (workspaceTeam, intakeForm, intakeAdmin with org and ws left empty) open on the choice. Needs aimeat-organism.js on the page.",
    maxPerLayout: 1,
    props: {
      app: requiredText('The app key the choice is remembered under, e.g. "cadence" (no spaces).', 120),
      name: text('The workspace name to find or create. Defaults to the app key.', 120),
      kind: text('The workspace kind written into its manifest.', 60),
      purpose: text('One line saying what the workspace holds.', 200),
      title: text("The section title, when the kit's own is not wanted.", 120),
      variant: text('"dense" for a side panel; empty for the full block.', 10),
      allowPrivate: text('"true" adds a choice to keep the app private, with no shared workspace.', 5),
      multiple: text('"true" keeps a list of workspaces with the current one marked.', 5),
    },
  },
  {
    id: 'intakeForm',
    summary: 'A Public Intake form drawn from its public descriptor: every field type, a hidden spam trap, the error on the field it names, and the thank-you line after sending. Without formId it reads ?form= from the page address. Needs aimeat-intake.js on the page.',
    maxPerLayout: 2,
    props: {
      org: text('The organism id. Leave empty to read ?org= from the page address, or, with app given, to follow the workspacePicker.', 80),
      ws: text('The workspace id. Leave empty to read ?ws= from the page address, or, with app given, to follow the workspacePicker.', 80),
      formId: text('The form id. Leave empty to read ?form= from the page address.', 80),
      title: text('The section title, when the form title is not wanted.', 120),
      hint: text('One line under the title.', 300),
      app: text('The app key the workspacePicker on this page uses. Used only when org and ws are empty.', 120),
    },
  },
  {
    id: 'intakeAdmin',
    summary: 'The owner list of Public Intake forms in one workspace: title, id and flags per form, copy link, delete after a confirm, and a create form with labelled fields. Needs aimeat-intake.js on the page.',
    maxPerLayout: 1,
    props: {
      org: text('The organism id. Leave empty, with app given, to follow the workspacePicker.', 80),
      ws: text('The workspace id. Leave empty, with app given, to follow the workspacePicker.', 80),
      namespace: text('The row space new forms write into. Leave empty to let the owner type it.', 80),
      title: text("The section title, when the kit's own is not wanted.", 120),
      app: text('The app key the workspacePicker on this page uses. Used only when org and ws are empty.', 120),
    },
  },
  {
    id: 'connections',
    summary: 'The owner outside accounts (mail, social): status per account, what each can do, sign in again, disconnect after a confirm, and connect a new one. need narrows the list to the services that can do it. Needs aimeat-connect.js on the page.',
    maxPerLayout: 1,
    props: {
      title: text("The section title, when the kit's own is not wanted.", 120),
      need: text('"readMail", "sendMail" or "publish": show only the services that can do it.', 20),
      via: text('"node" makes Connect, Sign in again and Disconnect open the node\'s own accounts page; inside an app the block does this by itself.', 10),
    },
  },
  {
    id: 'workflowInput',
    summary: 'The steps a workflow waits on a person for: workflow and run, the question, options as radio buttons or checkboxes, an own answer when the step accepts one, the due time and Answer. An answered step leaves the list. run keeps to one run. Needs aimeat-workflows.js on the page.',
    maxPerLayout: 1,
    props: {
      run: text('One run id: show only that run\'s waiting steps. Leave empty for every run.', 80),
      title: text("The section title, when the kit's own is not wanted.", 120),
      variant: text('"dense" for a side panel; leave empty for the default.', 10),
    },
  },
  {
    id: 'aiTask',
    summary: "Ask the person's own AI once and show the answer: a prompt box, a run button held busy, the answer with the AI label, the model and today's cost, words for each refusal, and an optional copy-the-prompt route. Needs aimeat-ai.js on the page.",
    maxPerLayout: 2,
    props: {
      appId: requiredText('The app id the AI call is made under.', 80),
      prompt: requiredText('The prompt sent to the AI; {input} is replaced with what the person wrote.', 2000),
      title: text("The section title, when the kit's own is not wanted.", 120),
      hint: text('One line under the title.', 300),
      placeholder: text('The grey text in the empty prompt box.', 200),
      minChars: text('The fewest characters before the run button turns on, e.g. "10".', 4),
      input: text('"none" for a run button with no prompt box.', 4),
      systemPrompt: text('Instructions to the model that the person does not see.', 2000),
      runLabel: text("The run button's words, when the kit's own are not wanted.", 60),
      render: text('"markdown" (the default) or "text".', 10),
      copyPrompt: text('"true" adds the route to copy the prompt into any AI chat and paste the answer back.', 5),
      variant: text('"compact" for a side panel or a card.', 10),
    },
  },
  {
    id: 'doc',
    summary: "One markdown document in the kit's box: headings, lists, code, tables, quotes and links in the app's colours, light and dark. Without aimeat-markdown.js on the page it shows the text as written; an empty text shows an empty card.",
    maxPerLayout: 4,
    props: {
      markdown: text('The document, in markdown.', 8000),
      title: text('The section title.', 120),
      rich: text('"true" uses the full renderer (task lists, footnotes, highlighted code, diagrams).', 5),
      variant: text('"plain" draws the typeset text without the box, for text inside a card the app already drew.', 10),
    },
  },
  {
    id: 'decision',
    summary: "Runs one of the owner's decision rules on the given text when the person presses Ask: each answer with its number and threshold, the personal data taken out before sending, the cost and who answered. Under the threshold the person confirms or overrides. Needs aimeat-decide.js.",
    maxPerLayout: 2,
    props: {
      appId: requiredText('The app id the decision is recorded under.', 120),
      rule: requiredText('The id of the owner decision rule to run.', 80),
      state: text('The text to judge. Without it the block shows an empty card.', 4000),
      title: text("The section title, when the kit's own is not wanted.", 120),
      decisionId: text('The id of a decision already made: the block shows it and its review instead of running the rule again.', 120),
      via: text('"node" sends Confirm and Override to the owner\'s AI settings on the node; inside an app the block does this by itself.', 10),
    },
  },
  {
    id: 'aiChat',
    summary: "A follow-up conversation with the person's own AI about one document: each question goes with the document and the conversation so far, each answer is drawn with the AI label, the model and the date, words for each refusal, and Start over. Needs aimeat-ai.js on the page.",
    maxPerLayout: 1,
    props: {
      appId: requiredText('The app id the AI calls are made under.', 80),
      context: requiredText('The document the conversation is about.', 8000),
      title: text("The section title, when the kit's own is not wanted.", 120),
      hint: text('One line under the title.', 300),
      placeholder: text('The grey text in the empty question box.', 200),
      systemPrompt: text("Instructions to the model that replace the block's own (answer from the document only).", 2000),
      keep: text('How many earlier messages go with each question, e.g. "8".', 3),
      variant: text('"compact" for a side panel or a card.', 10),
    },
  },
];
