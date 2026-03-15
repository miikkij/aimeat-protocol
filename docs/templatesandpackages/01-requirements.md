# Templates & Packages System — Requirements

**Date:** 2026-03-15
**Status:** Draft
**Author:** Operator + Claude Design Session

---

## 1. Problem Statement

AIMEAT has powerful building blocks — CSM, Extensions, Cortex, Apps, Memory, MSM, Translations — but no way to bundle them into a single installable unit. Users who want to deploy a complete service (e.g., a building corridor digital signage system) must manually create and configure each component individually.

This creates three gaps:

1. **No turnkey solutions** — A new user cannot install a working service in one click
2. **No reusable templates** — Operators cannot share proven configurations as starting points
3. **No managed update path** — When a package author improves their work, existing users have no structured way to adopt updates while preserving their customizations

## 2. Goals

### 2.1 Primary Goals

1. **Package System** — Enable bundling of multiple AIMEAT component types (CSM, Extension, Cortex, App, MSM, Memory, Translation) into a single versioned, distributable package
2. **One-Click Installation** — Users install a package and get a fully working instance with all components registered and activated
3. **Customization After Install** — Installed components are real copies owned by the user, freely modifiable
4. **Version History** — Every package version is preserved permanently. No overwrites, no data loss
5. **AI-Assisted Migration** — When a package author publishes an update, users can migrate their customized instances via a two-phase AI prompt workflow
6. **Template Gallery** — A discovery and social layer on top of packages: ratings, reviews, discussions, featured listings, install counters
7. **Role-Based Access** — Operator always has full control. Owner access to package creation is configurable

### 2.2 Secondary Goals

1. **Package Import/Export** — Packages can be exported as YAML bundles and imported on other nodes
2. **Federation-Ready** — Package metadata can be advertised to federated peers (future)
3. **Generator Integration** — The existing AI generator could output a package instead of individual components (future)

## 3. User Stories

### 3.1 Operator (sysadmin)

- **As an operator**, I want to create a package containing all components for a digital signage system, so that building managers can deploy it with one click
- **As an operator**, I want to publish a new version of my package with a changelog, so that users know what changed
- **As an operator**, I want to see all instances of my packages across all users, so that I can monitor adoption and provide support
- **As an operator**, I want to create a template listing with screenshots and description, so that users can discover my package in the gallery
- **As an operator**, I want to feature certain templates in the gallery, so that the best solutions get visibility
- **As an operator**, I want to configure whether owners can create packages, so that I control the complexity of my node

### 3.2 Owner (regular user)

- **As an owner**, I want to browse available packages and install one with a single click, so that I get a working service immediately
- **As an owner**, I want to customize the installed components (change colors, add data, modify layouts), because my building has specific needs
- **As an owner**, I want to install the same package multiple times with different configurations, because I manage multiple buildings
- **As an owner**, I want to check if updates are available for my instances and see what changed
- **As an owner**, I want to run a migration that preserves my customizations when adopting an update
- **As an owner**, I want to review and rate packages I've installed, so that other users benefit from my experience
- **As an owner** (if permitted), I want to create and share my own packages

### 3.3 Template Gallery Visitor

- **As a visitor**, I want to browse the template gallery by category and rating, so that I find the right solution
- **As a visitor**, I want to read reviews and discussions before installing, so that I make an informed choice
- **As a visitor**, I want to see screenshots of what the package looks like when deployed

## 4. Scope Boundaries

### In Scope

- Package CRUD with version history (own storage repository)
- Template listing CRUD with reviews and discussions (own storage repository)
- Instance tracking with component-level status (own storage repository)
- One-click install flow (creates real component copies)
- Two-phase AI migration workflow (analyze-prompt + migrate-prompt)
- Profile tab for owners (my instances, available packages, manage, migrate)
- Admin dashboard tab for operators (all packages, templates, instances, config)
- Configuration via `.env` / config parameters
- Digital signage as the first example package

### Out of Scope (future work)

- Federation of packages across nodes
- Morsel-based package pricing/marketplace
- Automatic migration (without AI prompt step)
- Generator → package output pipeline
- Package dependency resolution (package A requires package B)
- Package signing and verification
- 3x3 demo grid on landing page (separate UI project, consumes template gallery)

## 5. Non-Functional Requirements

1. **Performance** — Package listing queries must be fast (<100ms for 100 packages)
2. **Storage** — Each package version is a complete snapshot. No delta compression needed initially
3. **Backward Compatibility** — Existing CSM, Extension, Cortex, App APIs are unchanged. Packages use them internally
4. **Dual Backend** — SQLite and MongoDB implementations required (per CLAUDE.md Rule 1)
5. **i18n** — All UI strings in both `en.json` and `fi.json` (per CLAUDE.md Rule 4)
6. **Security** — Package content is validated before installation. No arbitrary code execution beyond existing Extension sandbox
7. **Testability** — E2E tests for both backends (per CLAUDE.md Rule 1)

## 6. Digital Signage Example Package

The first package to be created as proof-of-concept:

**Name:** `digital-signage`
**Category:** `signage`
**Description:** Managed corridor display system for residential buildings

### Components (6)

| ID | Type | Purpose |
|----|------|---------|
| `csm-signage` | CSM | Data schema for residents, announcements, ads |
| `memory-init` | Memory | Initial data structure and indexes |
| `cortex-signage` | Cortex | Client-side JS library wrapping Memory API |
| `app-admin` | App | Admin panel: manage displays, residents, content |
| `app-kiosk` | App | Fullscreen kiosk display with rotation |
| `translation-fi-en` | Translation | Finnish and English UI strings |

### Key Design Decision: No Extension Needed

Per the generator's decision framework: "Extension MUST do something a browser CANNOT do." All signage operations (CRUD residents, announcements, ads, display configuration, slide composition, rotation) can be done client-side via Memory API + Cortex library. No server-only work is required for the base package.

An extension would only be added if the user customizes the instance to include external API integrations (weather feed, RSS, calendar sync) — but that's the user's modification, not part of the template.

### Features

- **Resident directory**: Floor, apartment number, surname per unit
- **Announcements**: Title, content, QR code URL, validity period
- **Advertisements**: Title, content, QR code URL, type
- **Display management**: Configure per-display (static vs rotating, interval in seconds)
- **Kiosk mode**: Fullscreen display for corridor screens, auto-rotation, QR code generation
- **Admin panel**: CRUD all content, configure displays, preview kiosk view
