/**
 * @file src/services/prompt-defaults/app-builders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extracted from prompt-defaults.ts (max-file-lines). Builders group — custom app / game / notes / dashboard / chat builders + CSM builder.
 * @structure BUILD_FROM_SPEC (the shared pointer to the build specification) · APP_BUILDER_SEEDS,
 *   a PromptSeedEntry[] slice of PROMPT_SEEDS (same ids and order as before the extraction).
 * @usage Imported and spread by prompt-defaults.ts into PROMPT_SEEDS.
 * @version-history
 *   v1.1.0 — 2026-09-18 — The five app-builder prompts keep what the app IS and hand the HOW to the
 *     build specification (BUILD_FROM_SPEC). Each carried its own short platform guide, and by the
 *     instruction review every one of them was wrong somewhere: hand-written theme colours where
 *     the node ships a design system, charts "with no external dependencies" where it ships
 *     chart libraries, one memory key per note (the shape the key budget forbids), a three-second
 *     poll where live updates exist, a game on board posts where realtime rooms exist, and a
 *     self-publish button. Approved by the developer as item 6 of that review. csm-builder is
 *     untouched.
 *   v1.0.0 — 2026-07-13 — Extracted from prompt-defaults.ts
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

/**
 * The half every app-builder prompt shares. One text, so the five cannot drift apart again, and
 * short, so the specification stays the only place that says how an app is built here.
 */
const BUILD_FROM_SPEC = `## How to build it

The complete, current build specification for this AIMEAT is one document. Read it before you write code:

  GET {{node_url}}/v1/prompts/build-app?format=txt

Connected over MCP, the same document comes in parts: aimeat_handbook_get { tier: "build-app" } is the first and lists the rest.

It decides everything this prompt leaves out: which libraries to load and from where, how a person signs in, where data is kept and in what shape, the design system, realtime and live updates, and how the finished app is published or brought back. Where this prompt and that document disagree, the document is right.
{{cortex_extensions}}`;

export const APP_BUILDER_SEEDS: PromptSeedEntry[] = [
  // ═══════════════════════════════════════════════════════════════════
  // Group: builders — from src/routes/prompts.ts PROMPT_PACKAGES
  // ═══════════════════════════════════════════════════════════════════

  {
    id: 'app-builder-general',
    group: 'builders',
    name: 'Custom App Builder',
    description: 'User interview then bespoke single-file HTML app generation',
    content: `You are building a custom single-file HTML app for user "{{owner_name}}" on AIMEAT node {{node_url}}.

Ask the user what their app should do. Then build a complete, self-contained HTML file.

${BUILD_FROM_SPEC}

## Rules
- Return the complete HTML file, not fragments
- Mobile-first responsive design
- Include error handling and loading states`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-general'],
  },

  {
    id: 'app-builder-game',
    group: 'builders',
    name: 'Multiplayer Game Builder',
    description: 'Game with lobby, turns, and scoreboard',
    content: `Build a multiplayer HTML game for "{{owner_name}}" on AIMEAT node {{node_url}}.

## Required Features
- Game lobby: create a game, join a game
- Turn-based or real-time play between the people in the game
- A scoreboard that persists: one memory key holding the whole table (games.{gamename}.scores), not one key per score
- Player profiles with wins and losses
- Players are signed-in people; their identity comes from the sign-in, never from a name they type

${BUILD_FROM_SPEC}

For this app, read the specification's sections on realtime rooms and on the game look as well. If it is an arcade or platform game, load the skill aimeat-game-apps first.

## Design
Mobile-first, smooth animations. Return the complete single HTML file.`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-game'],
  },

  {
    id: 'app-builder-notes',
    group: 'builders',
    name: 'Note-Taking App Builder',
    description: 'Notes app with folders, tags, and search using AIMEAT memory',
    content: `Build a note-taking app for "{{owner_name}}" on AIMEAT node {{node_url}}.

## Features
- Create, edit, delete notes
- Organize with folders/categories and tags
- Full-text search via AIMEAT memory search
- Set visibility (private/public) per note
- Markdown support in note body

## Data
- A note is { id, title, body, folder, tags, createdAt, updatedAt }
- Keep the notes of one folder (or of one month) together in one memory key as an array, not one key per note: an account holds a limited number of keys, and search finds a note inside an array as well as it finds a key
- A note made public is written with public visibility; the rest stay private

${BUILD_FROM_SPEC}

## Design
Mobile-first, sidebar and editor layout. Return the complete HTML file.`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-notes'],
  },

  {
    id: 'app-builder-dashboard',
    group: 'builders',
    name: 'Data Dashboard Builder',
    description: 'Charts, tables, and live data from AIMEAT memory',
    content: `Build a data dashboard for "{{owner_name}}" on AIMEAT node {{node_url}}.

## Features
- Read structured data from AIMEAT memory keys
- Display as charts (bar, line, pie) and data tables
- Auto-refresh interval for live data
- Configurable data sources (user picks which memory keys to visualize)
- Summary cards with key metrics

${BUILD_FROM_SPEC}

For the charts and tables, use the chart and table libraries the specification lists before you draw anything by hand. For data that changes while the page is open, read its section on live updates instead of polling.

## Design
Grid layout, responsive cards. Return the complete HTML file.`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-dashboard'],
  },

  {
    id: 'app-builder-chat',
    group: 'builders',
    name: 'Chat Room Builder',
    description: 'Real-time messaging using AIMEAT boards',
    content: `Build a chat room app for "{{owner_name}}" on AIMEAT node {{node_url}}.

## Features
- Channel sidebar (list boards as channels)
- Message display with author, timestamp, reactions
- Send message (POST to board)
- Reply threading
- Emoji reactions
- New messages appear without a reload
- Create new channels (create board)

## Architecture
- Each channel = one AIMEAT board
- Messages = board posts
- Replies = posts with replyTo field
- Reactions = post reaction API
- The boards library is aimeat-social.js

${BUILD_FROM_SPEC}

## Design
Channel list beside the conversation, mobile-responsive. Return the complete HTML file.`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-chat'],
  },

  {
    id: 'csm-builder',
    group: 'builders',
    name: 'CSM Builder',
    description: 'Create a Contextual Service Model (CSM) via AI conversation',
    content: `You are helping "{{owner_name}}" design a CSM (Community Service Manifest) for AIMEAT node {{node_url}}.

## What is a CSM?

A CSM is a YAML document that defines a service's data model for an AIMEAT node. It specifies what data a service collects, how it's validated, and what consent rules apply. Services like hobby directories, marketplaces, dating apps, news feeds, and forums all use CSMs.

## YAML STRING RULES (read this FIRST — violations cause parse errors)

Every string value MUST be on ONE line wrapped in double quotes. No exceptions.
Always use quoted strings. Always wrap values in double quotes (block scalars > and | are unsupported).

WRONG — will crash the parser:
  description: > This is a multi-line folded string
  description: This has (parens) and special: chars
  description: |
    This is a literal block

CORRECT — always do this:
  description: "This has (parens) and special: chars all on one line"

## CSM YAML Format

\`\`\`yaml
csm: "1.0"
service:
  name: kebab-case-name
  type: directory
  description: "What this service does — one line, double quoted"
  version: "1.0"
schema_mode: open
data_schema:
  required:
    fieldName:
      type: string
      maxLength: 200
    tags:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string }
  optional:
    bio: { type: string, maxLength: 500 }
    rating: { type: number, minimum: 0, maximum: 5 }
    status: { type: string, enum: [active, paused, closed] }
consent_requirements:
  visibility_default: public
  requires_consent: true
  consent_purpose: "Why data is collected — one line, double quoted"
  data_retention: "until_revoked"
moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [fieldName, tags, location]
  detail_view: [fieldName, bio, tags, location, status]
  search_fields: [tags]
\`\`\`

## Your Task

1. Ask the user what kind of service they want to create
2. Ask about the data fields they need (required vs optional)
3. Ask about consent and moderation requirements
4. Generate the complete CSM YAML

## Rules
- Service name must be unique and kebab-case
- data_schema.required and data_schema.optional are MAPS (fieldName: {type: ...}), NOT arrays (- name: ...)
- data_schema.required MUST have at least one field
- Field types: string, number, integer, boolean, array, object
- Always include consent_requirements
- Choose appropriate schema_mode (open for flexibility, strict for data integrity)
- Include ui_hints to help frontends render the data

## Registration

Once the user is happy with the CSM, they can register it by:
- Pasting the YAML in the admin dashboard CSM Management tab
- Or via API: POST {{node_url}}/v1/csm with Content-Type: text/yaml

The node will validate the CSM, generate a JSON Schema, and register it for use.`,
    variables: ['owner_name', 'node_url'],
    usedIn: ['/v1/portal/prompts/csm-builder'],
  },
];
