# Node Portal — Overview & Vision

> **Status:** Planning  
> **RFC Target:** v1.5  
> **Depends on:** Memory system, Storage system, admin config, federation catalogue

---

## 1. What Is the Node Portal?

Every AIMEAT node has a **portal** — a single HTML file served at the root URL (`/`) that is the node's public face. Think of it like a **90s homepage**: your own space on the network where you present yourself, your services, and your community. No big corporation dictating what you can say or how it looks.

The portal is:
- **A standalone HTML file** with template tags that the server resolves from memory, storage, and config
- **Served at `GET /`** — type an IP address and port into a browser, see the portal
- **Editable with AI help** — a sysadmin prompt guides non-technical operators through customization
- **Alive** — content pulls dynamically from the node's memory and storage at serve-time
- **Ships with a default** — the existing `portal-human.ts` output is the starter template

### How It Works

```
Operator's HTML template (stored in storage)
        │
        │  contains template tags:
        │  {{config:nodeId}}
        │  {{memory:portal/welcome-text}}
        │  {{storage:abc123-image-uuid}}
        │  {{kv:contact-email}}
        │
        ▼
┌─────────────────────┐
│  Template Resolver   │  (at serve-time, on each GET /)
│                      │
│  {{config:*}}   → config values (nodeId, nodeType, baseUrl...)
│  {{memory:*}}   → memory key values (any key the operator wrote)
│  {{storage:*}}  → storage URLs/content (images, videos, files)
│  {{kv:*}}       → operator's custom key-value pairs
└─────────┬───────────┘
          │
          ▼
     Resolved HTML → served to browser
```

### Example Use Case

**Jouni** runs the genesis node at `https://aimeat.io`. His portal template pulls from memory and storage:
- `{{memory:portal/hero-text}}` → "Tietosi on sinun. AI:si työskentelee puolestasi."
- `{{storage:logo-uuid}}` → the AIME AT logo
- `{{memory:portal/services}}` → list of available actions/apps
- `{{kv:region}}` → "Espoo"

**Timo** in Oulu sets up his node at `http://85.132.44.21:40050`. He starts with the default template, then uses the AI-assisted editor to customize it. The AI asks "Mikä sun noden tarkoitus on? Mitä palveluita tarjoat?" and generates memory keys + updated HTML. Timo imports it. His portal now shows Oulu-specific content — pulled live from his node's memory.

When Timo adds HTTPS and joins the federation, his portal appears in Jouni's catalogue. Anyone can bookmark `https://85.132.44.21:40050` and see Timo's portal.

Both portals are **fully independent** — Timo's shows nothing from Jouni's.

### Zero-Config Default

A fresh node serves the **existing portal** (`portal-human.ts`) at `GET /` immediately. This is the polished educational page already in the codebase — memory cards, app launcher, platform setup, FI/EN switching. It works without any configuration.

The operator can then:
1. Use the AI editor to generate a custom template
2. Upload it via `POST /v1/site/template`
3. Their portal is now live with dynamic content from memory/storage

---

## 2. Template Tags

The portal HTML is a regular HTML file with special `{{...}}` tags that the server resolves before serving.

### Tag Types

| Tag | Resolves From | Example | Result |
|---|---|---|---|
| `{{config:nodeId}}` | `AimeatConfig` | `{{config:nodeId}}` | `aimeat-local-001-dev` |
| `{{config:nodeType}}` | `AimeatConfig` | `{{config:nodeType}}` | `full` |
| `{{config:baseUrl}}` | `AimeatConfig` | `{{config:baseUrl}}` | `http://85.132.44.21:40050` |
| `{{memory:key}}` | Memory system | `{{memory:portal/welcome}}` | Value of that memory key |
| `{{storage:id}}` | Storage system | `{{storage:abc123}}` | `/v1/storage/abc123` (URL) |
| `{{kv:key}}` | Operator KV pairs | `{{kv:contact-email}}` | `timo@example.fi` |

### Allowed Config Keys (whitelist)

Only safe, public config values are exposed — no secrets, no keys:

```
nodeId, nodeType, baseUrl, nodeName, nodeDescription, 
federationName, locale, version
```

### Memory Tags

`{{memory:portal/welcome}}` reads the memory key `portal/welcome` from the operator's namespace. The value can be:
- A string → inserted as-is (supports HTML/Markdown)
- An object → JSON serialized
- Missing → tag renders as empty string (graceful fallback)

### Storage Tags

`{{storage:abc123}}` resolves to the storage download URL (`/v1/storage/abc123`). Use in `<img src="{{storage:abc123}}">` for images, `<video>` for video, etc.

### KV Tags

Simple key-value pairs the operator defines without touching memory. Stored in config:

```
AIMEAT_SITE_KV_REGION=Oulu
AIMEAT_SITE_KV_CONTACT=timo@example.fi
AIMEAT_SITE_KV_TAGLINE=AI-agenttien koti pohjoisessa
```

Or set via admin API: `PUT /v1/admin/config` with path `site.kv.region`.

---

## 3. Reuse Map — No Duplicate Systems

| New Feature | Built On | What's New |
|---|---|---|
| Portal template | **Storage** | Template HTML stored as a storage file |
| Dynamic content | **Memory system** (`/v1/memory`) | Template tags read memory values at serve-time |
| Media/images | **Storage system** (`/v1/storage`) | Template tags resolve to storage URLs |
| KV pairs | **Admin config** | Simple operator-defined key-value substitutions |
| Template resolver | **New (lightweight)** | Regex-based tag replacement at serve-time |
| Default template | **Existing `portal-human.ts`** | Current portal output serves as starter |
| AI editor | **Prompt template + import endpoint** | AI generates template + memory writes |
| Announcements | **Board system** (`/v1/boards`) | `system` visibility: operator writes, all read |
| Discovery | **Federation catalogue** | Portal URL in catalogue |

### What We Do NOT Duplicate

- ❌ No new storage layer — portal template is a storage file
- ❌ No new content database — content lives in memory (existing system)
- ❌ No page CRUD system — it's one HTML template with dynamic tags
- ❌ No custom templating engine — simple `{{tag}}` regex replacement
- ❌ No conflict with existing `/v1/portal/*` — that stays as AI platform onboarding

---

## 4. Feature Scope

### Phase 1: Template Engine & Default Portal
- `GET /` serves the portal (default template or operator's custom template)
- Template resolver: `{{config:*}}`, `{{memory:*}}`, `{{storage:*}}`, `{{kv:*}}`
- `POST /v1/site/template` — upload custom portal HTML template (operator)
- `GET /v1/site/template` — download current template (operator)
- Default template = current `portal-human.ts` output
- KV pairs in config

### Phase 2: AI-Assisted Editor
- Sysadmin prompt template for AI-assisted portal creation
- AI interviews the operator, generates: HTML template + memory keys to write
- Import workflow: operator uploads the AI-generated bundle
- Change log for template updates

### Phase 3: System Board & Announcements
- `system` board visibility: operator writes, everyone reads
- MOTD as a memory key (`portal/motd`) rendered in template
- Announcements available via `{{memory:portal/announcements}}`

### Phase 4: Editor UI in Admin Dashboard
- Visual template editor in admin dashboard
- Live preview with resolved tags
- Media picker (select from storage files)
- KV pair editor

### Phase 5: Load-Balancer Sync
- LB nodes sync portal template + related memory keys from origin

---

## 5. Non-Goals (KISS)

- **No multi-page sites** — it's one HTML page, like a 90s homepage
- **No server-side scripting** — template tags are read-only substitutions, not logic
- **No CSS framework switching** — the template is self-contained HTML/CSS
- **No cross-node content** — each portal is independent
- **No portal marketplace** — operators make their own or copy from examples

---

## 6. Naming Convention

| Context | Name | Why |
|---|---|---|
| Feature | **Node Portal** | User-facing name |
| Code namespace | `site` | Avoids collision with existing `portal.ts` |
| Route file | `src/routes/site.ts` | Clean separation |
| Service file | `src/services/site.ts` | Template resolution + management |
| API path | `/v1/site/*` | No conflict |
| Config prefix | `AIMEAT_SITE_*` | Clear env namespace |
| Root URL | `GET /` | The portal page |
| Template tags | `{{type:key}}` | Simple, recognizable syntax |

---

## 7. The Spirit

> *"Mietitään että helpotetaan ei niin tech savvy ihmisten käyttämistä. Että ne pääsee mukaan ja nauttimaan siitä mistä nautittiin 90-luvun lopussa. Verkon vapaudesta ja siitä että omaa sanomaa sai tuotua lokaalisti esille ilman että joku suuryritys runkkaa sun päälle."*

This feature brings back the personal homepage. Your node, your portal, your voice. AI helps you build it — you don't need to know HTML. But if you do, you have full control.

---

## 8. Document Index

| Document | Description |
|---|---|
| [00-overview.md](00-overview.md) | This document — vision, template tags, scope |
| [01-architecture.md](01-architecture.md) | Template resolver, storage model, service design |
| [02-api-design.md](02-api-design.md) | API endpoints, template upload, editor |
| [03-implementation-roadmap.md](03-implementation-roadmap.md) | Phased plan with file-by-file changes |
| [04-sync-mode.md](04-sync-mode.md) | Load-balancer portal sync |
