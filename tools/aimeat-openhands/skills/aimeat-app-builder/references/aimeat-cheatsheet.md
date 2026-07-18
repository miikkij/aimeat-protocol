# AIMEAT app cheatsheet (offline fallback)

The live spec at `GET /v1/prompts/build-app` is authoritative and always wins on any
conflict. This file is a quick offline reminder of the shape of a working app.

## Minimal head (node libraries)

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="aimeat-app" content="my-app.html">
  <meta name="aimeat-scopes" content="memory:read memory:write memory:delete">
  <title>My App</title>

  <!-- theme + CSS (daisyUI + Tailwind + AIMEAT bridge) -->
  <link href="https://aimeat.io/lib/daisyui@5.css" rel="stylesheet">
  <link href="https://aimeat.io/lib/aimeat-daisyui-bridge.css" rel="stylesheet">
  <script src="https://aimeat.io/lib/tailwindcss@4.js"></script>

  <!-- auth + data + UI libs -->
  <script src="https://aimeat.io/v1/libs/aimeat-auth.js"></script>
  <script src="https://aimeat.io/v1/libs/aimeat-data.js"></script>
  <script src="https://aimeat.io/v1/cortex/aimeat-ui-viewers/libs/aimeat-ui-viewers.js"></script>
  <script src="https://aimeat.io/v1/cortex/aimeat-ui-forms/libs/aimeat-ui-forms.js"></script>
</head>
```

(Confirm these exact URLs against `/v1/prompts/build-app` — versions change.)

## Auth

```js
// Mount a login/logout button; onLogin fires on fresh sign-in.
AIMEAT.auth.mountLoginButton('#auth-bar', {
  onLogin: showApp, onLogout: hideApp, compact: true,
});

// Restore an existing session on reload (onLogin does NOT fire on reload).
AIMEAT.auth.login().then(function (session) {
  if (session) showApp(session); else hideApp();
}).catch(hideApp);

AIMEAT.auth.on('login', showApp);
AIMEAT.auth.on('logout', hideApp);
```

Always wire **both** paths: `mountLoginButton`/`on('login')` (fresh) **and** `login()`
(restore). Show a logged-out landing state until a session exists.

## Data (the user's private memory)

```js
const items = (await AIMEAT.data.get('myapp.items')) || [];   // read
await AIMEAT.data.set('myapp.items', items, { visibility: 'private' });  // write
```

`visibility: 'private'` = owner-only. Use a public visibility only for data the app
intends to share (e.g. a leaderboard).

## UI helpers

```js
const list = AIMEAT.ui.viewers.List({ target: hostEl, items: [
  { id, title, subtitle, badge, onClick, actions: [{ label, onClick }] },
]});
list.destroy();  // before re-render

const form = AIMEAT.ui.forms.FormGroup({
  target: '#add-form',
  submitLabel: 'Add',
  fields: [{ type: 'url', name: 'url', label: 'URL', required: true }],
  validate: (data) => ({ /* field: 'error' */ }),
  onSubmit: async (data) => { /* ... */ },
});
```

## Theme

Respect `data-theme` (`light` / `dark`) and drive colors from the AIMEAT theme CSS
variables (`--card`, `--border`, `--text`, `--bg`, `--radius`, daisyUI `base-*`,
`primary`, …). Never hardcode brand hex values in JS or CSS.

## Publish (over MCP)

Use `aimeat_app_publish`. For files > ~1 KB, omit the content param → get `upload_url` →
`PUT` the raw HTML. Provide `filename`, `name`, `description`, `category`, `tags`, `icon`.
Republishing the same `filename` bumps the version. Then return the live URL and/or verify
with `aimeat_app_list`.
