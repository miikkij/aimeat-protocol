# AIMEAT PWA Guide

## Overview

AIMEAT nodes support Progressive Web App (PWA) capabilities, enabling offline-capable access to portal interfaces. When configured, the node serves a service worker, web manifest, and offline fallback page alongside the standard API.

## Prerequisites

PWA features require VAPID key configuration for push notifications. Generate a VAPID keypair and set the following environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `AIMEAT_PUSH_ENABLED` | Yes | Set to `true` to activate PWA and push features |
| `AIMEAT_VAPID_PUBLIC_KEY` | Yes | Base64url-encoded VAPID public key |
| `AIMEAT_VAPID_PRIVATE_KEY` | Yes | Base64url-encoded VAPID private key |
| `AIMEAT_VAPID_SUBJECT` | Yes | Contact URI, e.g. `mailto:admin@example.com` |
| `AIMEAT_PWA_SHORT_NAME` | No | Short name shown on home screen (default: node ID) |
| `AIMEAT_PWA_THEME_COLOR` | No | Theme color hex value (default: `#1a1a2e`) |
| `AIMEAT_OFFLINE_PAGE` | No | Path to custom offline HTML (default: built-in fallback) |

## Architecture

Three static assets are served when PWA is enabled:

- **`/sw.js`** -- Service worker script handling caching, offline fallback, push event listeners, and background sync registration.
- **`/manifest.json`** -- Web app manifest declaring name, icons, start URL, display mode (`standalone`), and theme colors.
- **Offline page** -- A minimal HTML page displayed when the user is offline and no cached version of the requested page exists.

The service worker is registered by a small inline script injected into portal HTML responses.

## Cache Strategies

The service worker applies different caching strategies depending on the request type:

### Cache-First (Static Assets)

Requests matching `/public/**`, icon files, and font resources are served from the cache when available. The cache is updated in the background on each fetch. This minimizes latency for assets that change infrequently.

### Network-First (API Calls)

All requests to `/v1/**` API endpoints attempt the network first. On network failure, the service worker returns a cached response if one exists, or a JSON error payload indicating offline status. API responses are cached with a short TTL (5 minutes by default).

### Stale-While-Revalidate (Portal Pages)

Portal HTML pages (`/v1/portal`, `/v1/profile`, `/v1/guides`, etc.) serve the cached version immediately while fetching an updated version in the background. This provides instant page loads while keeping content reasonably fresh.

## Push Notifications

Four endpoints manage push notification subscriptions and delivery:

### `POST /v1/push/subscribe`

Registers a push subscription for the authenticated user. Accepts a standard PushSubscription object (endpoint, keys).

### `DELETE /v1/push/unsubscribe`

Removes a push subscription by its endpoint URL.

### `POST /v1/push/send`

Sends a push notification to a specific GHII. Requires `operator` or `owner` role. Accepts `title`, `body`, `url`, and optional `icon` fields.

### `GET /v1/push/subscriptions`

Lists active subscriptions for the authenticated user. Operators can query subscriptions for any GHII.

All endpoints require authentication via `requireAuth()`.

## Background Sync

When the device is offline, mutation requests (POST, PUT, DELETE to API endpoints) are queued in IndexedDB by the service worker. The queue is tagged with the sync registration name `aimeat-sync`.

When connectivity is restored, the browser triggers a `sync` event. The service worker replays queued requests in order, skipping any that have expired (default TTL: 24 hours). Failed replays are retried up to 3 times before being discarded.

Queued mutations are visible in the offline page UI so users can see pending changes.

## Installation

Users can install the AIMEAT portal as a standalone app through the browser's "Add to Home Screen" prompt:

1. Navigate to the AIMEAT portal URL in a supported browser.
2. The browser displays an install banner (or use the browser menu).
3. Confirm installation. The app appears on the home screen or app launcher.
4. Launching the installed app opens in standalone mode without browser chrome.

The `manifest.json` `display` field is set to `standalone`. The `start_url` points to `/v1/portal`. Icons should be provided at 192x192 and 512x512 pixel sizes in the `public/icons/` directory.

## Config Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `AIMEAT_PUSH_ENABLED` | `false` | Enable PWA and push notification features |
| `AIMEAT_VAPID_PUBLIC_KEY` | -- | VAPID public key (base64url) |
| `AIMEAT_VAPID_PRIVATE_KEY` | -- | VAPID private key (base64url) |
| `AIMEAT_VAPID_SUBJECT` | -- | VAPID contact URI |
| `AIMEAT_PWA_SHORT_NAME` | node ID | App short name |
| `AIMEAT_PWA_THEME_COLOR` | `#1a1a2e` | Theme and status bar color |
| `AIMEAT_OFFLINE_PAGE` | built-in | Custom offline fallback page path |
| `AIMEAT_SYNC_MAX_AGE_HOURS` | `24` | Max age for queued background sync mutations |
| `AIMEAT_CACHE_API_TTL_SECONDS` | `300` | TTL for cached API responses |

---

*AIMEAT Protocol -- Overscale Solutions Oy, 2026*
