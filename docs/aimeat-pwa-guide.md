# Installed web apps and push notifications

The AIMEAT web interface can use a web app manifest and a service worker.
The current worker provides notifications, share-sheet intake and an offline page.
It does not cache API responses or queue arbitrary API writes for later replay.

Sources: [the service worker](../aimeat/public/sw.js),
[static routing](../aimeat/src/server-bootstrap/static-files.ts),
[push routes](../aimeat/src/routes/push.ts) and
[app-origin discovery](../aimeat/src/routes/subdomain-origin-docs.ts).

## What happens offline

The worker pre-caches `/offline.html`. A failed page navigation can show that page.
It does not store authenticated documents, API results or static assets as an
offline copy of the system. Reconnect before performing work that needs the node.

A share-sheet POST to `/share-target` is a separate intake flow. The worker stores
that incoming content and sends the user to the chat. This is not a general API retry queue.

When changing the offline page, update the worker's `OFFLINE_CACHE` version as
described in the worker source.

## Push configuration

The node reads these settings in [config.ts](../aimeat/src/config.ts):

| Variable | Purpose |
|---|---|
| `AIMEAT_PUSH_ENABLED` | Push switch, defaults to true |
| `AIMEAT_VAPID_PUBLIC_KEY` | VAPID public key |
| `AIMEAT_VAPID_PRIVATE_KEY` | VAPID private key |
| `AIMEAT_VAPID_SUBJECT` | Contact URI for the push service |
| `AIMEAT_PUSH_NOTIFY_TYPES` | Notification types eligible for delivery |
| `AIMEAT_PUSH_COOLDOWN_MIN` | Delivery cooldown |
| `AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE` | Subscription limit |
| `AIMEAT_PUSH_MAX_FAILURES` | Failure limit before a subscription is removed |

Push also requires browser permission and a valid subscription. The setting alone
does not prove delivery. Use the current [configuration reference](b-config.md)
and the node's admin settings for resolved values.

## Subscription API

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/push/vapid-key` | Read the public key |
| POST | `/v1/push/subscribe` | Register a browser subscription |
| DELETE | `/v1/push/subscribe` | Remove a subscription |
| GET | `/v1/push/subscriptions` | List the owner's devices |

Use [OpenAPI](../openapi.yaml) for body fields and errors. Subscription management
uses `push:manage`. Hosted apps can request `push:receive` to register and remove
their own subscription. An app cannot remove all of an owner's subscriptions.

## Hosted apps

A hosted app has its own origin, manifest and worker. Its notifications use the
app's identity. Use the served `AIMEAT.push` SDK and the app's granted permissions.
The main site's worker is not a replacement for an app's worker.

## Removed guidance

Earlier versions of this page described API caching, background mutation replay and
PWA-specific environment variables for cache TTL, names, colours and offline-page paths.
Those instructions do not describe the current implementation.
