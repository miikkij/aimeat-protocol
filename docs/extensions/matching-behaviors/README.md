# matching-behaviors

QuickJS-WASM sandbox extension for interest-based matching with geographic proximity scoring. It replaced the node's earlier built-in matching service.

## Overview

This extension pairs users based on shared interests, geographic proximity, recent activity, and compatibility preferences. It supports multiple instances, allowing operators to run separate matching pools (e.g., by community, topic, or region).

## Installation

The node (3.26 or later) ships this extension in `docs/extensions/`. The operator installs it with one call, and it is active at once:

```
POST /v1/admin/extensions/available/matching-behaviors/install
Authorization: Bearer <operator-token>
```

Then create an instance: `POST /v1/extensions/matching-behaviors/instances` with `{ "id": "hobbies", "config": { ... } }`, and call the actions at `POST /v1/ext/matching-behaviors/{instanceId}/{action}`.

**Consent first.** `create-profile` refuses with `CONSENT_REQUIRED: matching` until the person holds an active consent whose purpose is `matching` (`POST /v1/consent` with `"purpose": "matching"`, or `aimeat_consent_grant` over MCP).

## Privacy and opting in

A profile holds personal data (a name, interests, a city), so the extension writes it **private**: no other owner and no anonymous caller can read it through the memory API, whatever the profile says. Suggestions and accepted matches are private too.

Being matched is a separate choice, the profile's `matchable` field, **off by default**. Pass `"matchable": true` to `create-profile`, or later to `update-profile`, to join the rounds; `false` leaves them again. A round pairs only profiles with `matchable: true`, so a person who did not opt in is never suggested to anyone and gets no suggestions. `get-suggestions` answers only the caller's own suggestions, shows another person only while they are still opted in, and answers an empty list with `matchable: false` to a caller who is not.

Opting in does not publish the profile: another person learns the display name, interests and place of someone who opted in only as a suggestion made to them.

Version 1.1.0 made this change. Profiles written by 1.0.x are public keys with no `matchable` field, so they take part in no round until their owner updates them, and an update rewrites them private.

## Multi-Instance Support

Each instance runs an independent matching pool with its own configuration. Create instances via the extension management API with per-instance config:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | string | "Matching" | Display name for the instance |
| `visibility` | string | public | Access control: `public`, `password`, or `invite` |
| `password` | string | — | Required when visibility is `password` |
| `allowed_users` | array | — | GAII allowlist when visibility is `invite` |
| `max_distance_km` | number | 100 | Maximum distance for proximity scoring |
| `match_threshold` | number | 0.3 | Minimum score to create a suggestion |
| `max_suggestions` | integer | 10 | Max suggestions per profile per round |
| `cooldown_days` | integer | 7 | Days before a dismissed match can reappear |

## Actions

| Action | Auth | Description |
|--------|------|-------------|
| `create-profile` | required | Register a private matching profile with display name, interests, location, and `matchable` (default `false`) |
| `update-profile` | required | Update fields on an existing profile, `matchable` included |
| `get-suggestions` | required | The caller's own suggestions, sorted by score; empty while the caller is not opted in |
| `respond` | required | Accept or dismiss a suggestion |
| `run-matching` | operator | Execute a matching round across the profiles that opted in |

## Scoring Formula

```
match_score = 0.40 * shared_interests_score
            + 0.25 * distance_score
            + 0.20 * activity_score
            + 0.15 * compatibility_score
```

- **Shared interests** (40%): `min(shared_count / 3, 1.0)` — case-insensitive comparison
- **Distance** (25%): `max(1.0 - distance_km / max_distance_km, 0)` — haversine formula; defaults to 0.5 when location is unknown
- **Activity** (20%): `max(1.0 - days_since_active / 90, 0)` — rewards recently active profiles
- **Compatibility** (15%): ratio of seeking terms matched against the other profile's interests, city, area, or country

## Scheduled Matching

The `matching-round` schedule runs `run-matching` every 6 hours via cron (`0 */6 * * *`). A manifest schedule runs for the extension, not for an instance, so it scans the extension's own namespace. To run a round in an instance's pool, schedule it per instance: `POST /v1/schedules` with `{ "kind": "extension", "cron": "0 */6 * * *", "extension_name": "matching-behaviors", "action_id": "run-matching", "instance_id": "<id>" }`. Operators can also trigger rounds manually.

## Memory Key Patterns

| Pattern | Content |
|---------|---------|
| `profile.{gaii}` | User matching profile, with `matchable`. Private |
| `suggestion.{gaii}.{otherGaii}` | Match suggestion for a user. Private |
| `accepted.{gaii}.{otherGaii}` | Accepted match record. Private |

All keys live in the instance's namespace, `ext:matching-behaviors.{instanceId}`.

## Required APIs

- **memory** — profile and suggestion storage
- **consent** — matching consent verification
- **trust** — trust score lookups
