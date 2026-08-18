/**
 * @file src/services/prompt-defaults/app-builders.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extracted from prompt-defaults.ts (max-file-lines). Builders group — custom app / game / notes / dashboard / chat builders + CSM builder.
 * @structure Exports a PromptSeedEntry[] slice of PROMPT_SEEDS, verbatim (same names/values/order).
 * @usage Imported and spread by prompt-defaults.ts into PROMPT_SEEDS.
 * @version-history v1.0.0 — 2026-07-13 — Extracted from prompt-defaults.ts
 */

import type { PromptSeedEntry } from '../prompt-defaults.js';

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

## AIMEAT Platform
- Load client libraries from {{node_url}}/v1/libs/ (aimeat-auth.js, aimeat-data.js, aimeat-storage.js, aimeat-social.js, aimeat-wallet.js, aimeat-work.js)
- Auth: AIMEAT.auth.mountLoginButton("#login", { onLogin: fn, onLogout: fn }) — onLogin fires ONLY on a fresh sign-in, NOT on reload; also call AIMEAT.auth.login().then(s => { if (s) fn(s); }) on load to restore an already-signed-in session
- Data: AIMEAT.data.set(key, value), AIMEAT.data.get(key), AIMEAT.data.search(q)
- Dark theme: --bg:#0f0a14; --text:#f0e6f6; --accent:#ff6b9d
{{cortex_extensions}}

## Rules
- Return COMPLETE HTML file, not fragments
- Mobile-first responsive design
- Include error handling and loading states
- Include a self-publish button using POST {{node_url}}/v1/apps`,
    variables: ['owner_name', 'node_url', 'cortex_extensions'],
    usedIn: ['/v1/portal/prompts/app-builder-general'],
  },

  {
    id: 'app-builder-game',
    group: 'builders',
    name: 'Multiplayer Game Builder',
    description: 'Game with lobby, turns, and scoreboard using AIMEAT boards',
    content: `Build a multiplayer HTML game for "{{owner_name}}" on AIMEAT node {{node_url}}.

## Game Architecture
- Use AIMEAT boards for real-time game state (POST/GET /v1/boards/{id}/posts)
- Use AIMEAT memory for persistent scores and player profiles
- Use AIMEAT auth for player identity

## Required Features
- Game lobby (create/join using a board as the lobby channel)
- Turn-based or real-time gameplay via board posts
- Scoreboard stored in AIMEAT memory (key: games.{gamename}.scores)
- Player profiles with wins/losses

## Libraries
Load from {{node_url}}/v1/libs/:
- aimeat-auth.js — Login/identity
- aimeat-data.js — Score persistence
- aimeat-social.js — Game state via boards
{{cortex_extensions}}

## Design
Dark theme (--bg:#0f0a14; --accent:#ff6b9d), mobile-first, smooth animations.
Return a COMPLETE single HTML file.`,
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

## Data Storage
- Notes stored as AIMEAT memory keys: notes.{id}
- Value: { title, body, folder, tags, createdAt, updatedAt }
- Use AIMEAT.data.search("notes.") to list all notes
- Use AIMEAT.data.set() / .get() / .delete()

## Libraries
Load from {{node_url}}/v1/libs/:
- aimeat-auth.js — Login
- aimeat-data.js — Note CRUD
{{cortex_extensions}}

## Design
Dark theme, mobile-first, sidebar + editor layout. Return COMPLETE HTML file.`,
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

## Libraries
Load from {{node_url}}/v1/libs/:
- aimeat-auth.js — Login
- aimeat-data.js — Read data
{{cortex_extensions}}

## Chart Implementation
Use Canvas API or inline SVG for charts (no external dependencies).
Dashboard should be fully self-contained in one HTML file.

## Design
Dark theme, grid layout, responsive cards. Return COMPLETE HTML file.`,
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
- Auto-poll for new messages (every 3 seconds)
- Create new channels (create board)

## Architecture
- Each channel = one AIMEAT board
- Messages = board posts
- Replies = posts with replyTo field
- Reactions = post reaction API

## Libraries
Load from {{node_url}}/v1/libs/:
- aimeat-auth.js — Login/identity
- aimeat-social.js — Boards, posts, reactions
{{cortex_extensions}}

## Design
Dark theme, Discord-like layout, mobile-responsive. Return COMPLETE HTML file.`,
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
