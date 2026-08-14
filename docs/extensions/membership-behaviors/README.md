# membership-behaviors

Group membership management extension for AIMEAT organisms. Provides join policies (open, approval-required, invite-only), role-based access control, and membership lifecycle actions.

## Prerequisites

- AIMEAT node running v1.5 or later
- An organism must exist in memory before membership actions can be used
- The organism record should include a `join_policy` field (`open`, `approval_required`, or `invite_only`) and a `creator_ghii` field

## Installation

Register the extension on your AIMEAT node:

```bash
curl -X POST https://your-node/v1/extensions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://extensions.aimeat.org/membership-behaviors/extension.yaml" }'
```

Then activate it:

```bash
curl -X POST https://your-node/v1/extensions/membership-behaviors/activate \
  -H "Authorization: Bearer $TOKEN"
```

## Actions

### join

Join an organism. Behavior depends on the organism's `join_policy`:

- **open** (default) -- caller is added as a member immediately.
- **approval_required** -- a join request is created. An admin must call `review-request` to approve or reject it.
- **invite_only** -- fails unless the caller has a pending invite (created via `invite`). If an invite exists, the caller is added as a member.

```
POST /v1/ext/membership-behaviors/join
{ "organismKey": "org.hiking-club", "message": "I love hiking!" }
```

### invite

Invite a user to join an organism. Only the organism creator or members with the `admin` role can send invites. The invitee must then call `join` to accept.

```
POST /v1/ext/membership-behaviors/invite
{ "organismKey": "org.hiking-club", "inviteeGhii": "ghii-abc123" }
```

### leave

Leave an organism. The organism creator cannot leave; they must transfer ownership first.

```
POST /v1/ext/membership-behaviors/leave
{ "organismKey": "org.hiking-club" }
```

### promote

Change a member's role between `member` and `admin`. Only the organism creator or existing admins can promote or demote members. The creator cannot be demoted.

```
POST /v1/ext/membership-behaviors/promote
{ "organismKey": "org.hiking-club", "memberGhii": "ghii-abc123", "role": "admin" }
```

### review-request

Approve or reject a pending join request (for organisms with `approval_required` policy). Only the organism creator or admins can review requests. Approved users are added as members automatically.

```
POST /v1/ext/membership-behaviors/review-request
{ "organismKey": "org.hiking-club", "requestId": "jr-1709500000000-a1b2", "decision": "approve" }
```

## Membership Flows

### Open Join

```
User -> join(organismKey) -> joined (role: member)
```

### Approval-Required Join

```
User   -> join(organismKey, message) -> pending (requestId returned)
Admin  -> review-request(organismKey, requestId, "approve") -> approved (user added)
```

### Invite-Only Join

```
Admin  -> invite(organismKey, inviteeGhii) -> invited
Invitee -> join(organismKey) -> joined (role: member)
```

## Data Stored in Memory

The extension stores membership data under the following memory keys:

| Key pattern | Contents |
|---|---|
| `{organismKey}.members` | Object with `members` array. Each entry has `ghii`, `role`, `status`, `joinedAt`, and optionally `invitedBy`, `invitedAt`, `promotedBy`, `promotedAt`, `approvedBy`. |
| `{organismKey}.join-requests` | Object with `requests` array. Each entry has `id`, `ghii`, `message`, `status` (`pending`, `approved`, `rejected`), `createdAt`, and optionally `reviewedBy`, `reviewedAt`. |

## Roles

| Role | Capabilities |
|---|---|
| `member` | Can leave the organism |
| `admin` | Can invite, promote/demote members, and review join requests |
| `creator` | Same as admin. Determined by matching `organism.creator_ghii`. Cannot be demoted or leave. |

## Limits

- **Memory:** 64 MB
- **Timeout:** 5000 ms per action
- **Max API calls:** 50 per action invocation
- **Max members:** Configured per organism via `max_members` (default: 10,000)
