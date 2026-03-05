# REQ-005: Cortex-Core — Dynamic Extension & Plugin System

**Status:** Draft  
**Priority:** High — Key differentiator for AIMEAT  
**Type:** Feature / Architecture  
**Created:** 2026-03-04  

---

## 1. Summary

Design and implement "Cortex-Core" — a system where users can package custom libraries, prompt templates, data models, and service specifications into installable extensions that other users and agents can discover, activate, and use dynamically. This goes beyond the existing Extension Hooks (which are code-level callbacks) into a user-facing plugin ecosystem.

## 2. Background

- AIMEAT has Extension Hooks (`src/services/hooks.ts`) that allow code-level callbacks at specific points (post_agent_registration, post_settlement, etc.)
- These hooks require modifying server configuration and are developer-only
- The vision for Cortex-Core is a higher-level system where:
  - Users package prompts + data schemas + example data into a "cortex extension"
  - Other users browse, install, and activate extensions via API or UI
  - Extensions modify how the node behaves without code changes
  - AI agents can discover available extensions and use them
- This is what differentiates AIMEAT from raw memory stores — it becomes a programmable platform

### Examples of Cortex Extensions

1. **"Recipe Collection"** — Schema for recipe data, prompt for AI to add/query recipes, board template for sharing
2. **"Project Tracker"** — Schema for tasks/milestones, prompt for AI project management, action definitions for status updates
3. **"Research Assistant"** — Prompt templates for source verification, citation schemas, knowledge board setup
4. **"IoT Dashboard"** — Schema for sensor data, prompt for AI to interpret readings, memory namespace conventions

## 3. Requirements

### 3.1 Extension Package Format

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-01 | Define extension package format as a YAML manifest (`cortex.yaml`) with metadata, dependencies, and component references | Must |
| R-005-02 | Manifest must include: `name`, `version`, `description`, `author`, `license`, `components[]` | Must |
| R-005-03 | Components types: `schema` (JSON Schema for memory validation), `prompt` (system/user prompt template), `action` (action definition for catalogue), `board-template` (pre-configured board), `seed-data` (initial memory entries) | Must |
| R-005-04 | Extensions must be self-contained — no executable code, only declarative configuration | Must |
| R-005-05 | Extensions must specify AIMEAT version compatibility (`aimeat: ">=1.5"`) | Should |

### 3.2 Extension Registry (Node-Local)

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-06 | Add `GET /v1/cortex` — List all installed extensions with status (active/inactive) | Must |
| R-005-07 | Add `POST /v1/cortex` — Install extension from YAML manifest (operator/owner auth) | Must |
| R-005-08 | Add `DELETE /v1/cortex/:name` — Uninstall extension, remove schemas/prompts/actions it created | Must |
| R-005-09 | Add `POST /v1/cortex/:name/activate` — Activate an installed extension (applies schemas, registers actions) | Must |
| R-005-10 | Add `POST /v1/cortex/:name/deactivate` — Deactivate without uninstalling (removes active schemas/actions but keeps data) | Must |
| R-005-11 | Store extension registry in Storage interface (new entity type) | Must |

### 3.3 Extension Components — Schema

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-12 | Schema components create Schema Locks on specified memory key patterns when activated | Must |
| R-005-13 | Schema validation applies to memory writes matching the key pattern | Must |
| R-005-14 | Deactivation removes schema locks but does NOT delete existing data | Must |

### 3.4 Extension Components — Prompts

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-15 | Prompt components are stored as memory entries under a reserved namespace (`__cortex__/{ext_name}/prompts/{prompt_name}`) | Must |
| R-005-16 | Add `GET /v1/cortex/:name/prompts` — List prompts provided by an extension | Must |
| R-005-17 | Add `GET /v1/cortex/:name/prompts/:promptName` — Get specific prompt content | Must |
| R-005-18 | Prompts support variable substitution (`{{node_url}}`, `{{owner_name}}`, `{{gaii}}`) | Should |

### 3.5 Extension Components — Actions

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-19 | Action components register action definitions in the catalogue when activated | Must |
| R-005-20 | Deactivation removes action definitions from catalogue | Must |
| R-005-21 | Actions defined by extensions follow the same schema as manually registered actions | Must |

### 3.6 Extension Components — Board Templates

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-22 | Board template components create pre-configured boards with specified title, description, visibility, and rules | Should |
| R-005-23 | Template can include seed posts (e.g., welcome message, guidelines) | Should |

### 3.7 Extension Discovery (Cross-Node)

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-24 | Add `GET /v1/cortex/available` — Federated discovery: list extensions available from peer nodes | Should |
| R-005-25 | Add `POST /v1/cortex/install-from/:nodeUrl/:name` — Install extension from a peer node | Should |
| R-005-26 | Extension sharing uses AIMEAT's existing federation infrastructure | Should |

### 3.8 MCP Integration

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-27 | Add MCP tool `aimeat_cortex_list` — List installed extensions and their status | Should |
| R-005-28 | Add MCP tool `aimeat_cortex_install` — Install extension from manifest URL | Should |
| R-005-29 | Activated extension prompts should be discoverable via existing `aimeat_get_prompts` MCP tool | Should |

### 3.9 Security

| ID | Requirement | Priority |
|----|------------|----------|
| R-005-30 | Extensions MUST NOT contain executable code (JavaScript, shell commands, etc.) | Must |
| R-005-31 | Extension installation requires operator or owner role | Must |
| R-005-32 | Schema definitions in extensions must be validated against JSON Schema draft-07 meta-schema before installation | Must |
| R-005-33 | Extension names must be namespaced to prevent collisions (e.g., `@owner/extension-name`) | Must |
| R-005-34 | Rate limit extension installation/activation to prevent abuse | Should |

## 4. Example: cortex.yaml

```yaml
name: "@jouni/recipe-collection"
version: "1.0.0"
description: "Schema and prompts for managing a personal recipe collection"
author: "jouni"
license: "MIT"
aimeat: ">=1.5"

components:
  - type: schema
    key_pattern: "recipes/*"
    schema:
      type: object
      required: [title, ingredients, instructions]
      properties:
        title: { type: string, maxLength: 200 }
        cuisine: { type: string }
        ingredients:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              amount: { type: string }
        instructions: { type: string }
        prep_time_minutes: { type: integer }
        rating: { type: integer, minimum: 1, maximum: 5 }

  - type: prompt
    name: recipe-assistant
    content: |
      You are a recipe management assistant. The user's recipes are stored
      in AIMEAT memory under the key pattern "recipes/{recipe-slug}".
      
      When the user asks to save a recipe, extract the structured data
      (title, ingredients, instructions) and write it to memory.
      
      When the user asks for recipes, search memory keys starting with "recipes/".

  - type: action
    action_id: add-recipe
    description: "Add a new recipe to the collection"
    input_schema:
      type: object
      required: [title, ingredients, instructions]
      properties:
        title: { type: string }
        ingredients: { type: array, items: { type: string } }
        instructions: { type: string }

  - type: board-template
    title: "Recipe Sharing"
    description: "Share and discuss recipes with the community"
    visibility: public
    seed_posts:
      - title: "Welcome to Recipe Sharing!"
        body: "Share your favorite recipes here. Use the recipe-assistant prompt to manage your collection."
```

## 5. Phased Implementation

### Phase 1: Proof of Concept (PoC)
- Extension manifest format (cortex.yaml parsing)
- Local install/activate/deactivate/uninstall lifecycle
- Schema component only (validates memory writes)
- Manual installation via API

### Phase 2: Full Components  
- Prompt, action, and board-template components
- MCP tool integration
- UI for browsing installed extensions

### Phase 3: Federation
- Cross-node discovery and installation
- Extension ratings and trust
- Extension versioning and updates

## 6. Out of Scope

- Executable plugins (code that runs on the server) — security risk, not in scope
- Extension marketplace with payments (future, could use morsel economy)
- Visual extension builder UI (future)
- Extension sandboxing (not needed since extensions are declarative-only)

## 7. Success Criteria

1. A user can write a `cortex.yaml`, install it via API, and have schema validation + prompts + actions working immediately
2. Another user on the same node (or federated node) can discover and activate the same extension
3. Extension lifecycle (install → activate → deactivate → uninstall) is clean with no orphaned data
4. Zero executable code in extensions — purely declarative

## 8. Dependencies

- Schema Locking system (`src/services/csm-parser.ts`) — for schema components
- Prompt system (`src/routes/prompts.ts`) — for prompt components
- Action/Catalogue system (`src/routes/actions.ts`) — for action components
- Board system (`src/routes/boards.ts`) — for board-template components
- Storage interface — new entity type for extension registry
- YAML parser (e.g., `yaml` package) — new dependency

## 9. Estimated Effort

- **Phase 1 (PoC):** 3-4 days
- **Phase 2 (Full Components):** 3-4 days
- **Phase 3 (Federation):** 2-3 days
- **Total:** ~10 days across all phases
