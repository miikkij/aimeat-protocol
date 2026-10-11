# membership-behaviors

Group membership management extension for AIMEAT nodes. Provides join policies (open, approval-required, invite-only), roles, and membership lifecycle actions.

A group here is a record in this extension's own memory. The field names say `organism`, but it is not a platform organism (those have their own membership, at `/v1/organisms`); this extension is an example of how an extension keeps a membership list of its own.

## Prerequisites

- An AIMEAT node at 3.26 or later. The node ships this extension in `docs/extensions/`.

## Installation

The operator installs it with one call, and it is active at once:

```bash
curl -X POST https://your-node/v1/admin/extensions/available/membership-behaviors/install \
  -H "Authorization: Bearer $OPERATOR_TOKEN"
```

## Actions

### create

Create a group. The caller becomes its creator and first admin. The other actions need the group to exist.

```
POST /v1/ext/membership-behaviors/create
{ "organismKey": "org.hiking-club", "name": "Hiking club", "join_policy": "approval_required", "max_members": 200 }
```

`join_policy` is `open` when left out and `max_members` is 10,000. A second `create` with the same key is refused.

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
{ "organismKey": "org.hiking-club", "inviteeGhii": "alice@your-node" }
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
{ "organismKey": "org.hiking-club", "memberGhii": "alice@your-node", "role": "admin" }
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

The extension stores its data in its own namespace, `ext:membership-behaviors`. The group record is public; who belongs to a group, and who asked to join, is personal data and is written private.

| Key pattern | Contents |
|---|---|
| `{organismKey}` | The group: `name`, `join_policy`, `max_members`, `creator_ghii`, `createdAt`. Public. |
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
