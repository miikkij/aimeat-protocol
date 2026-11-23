# AIMEAT app cheatsheet (offline fallback)

The live spec at `GET /v1/prompts/build-app-atelier` is authoritative and always wins on any
conflict. This file is a quick offline reminder of the shape of a working app on the Atelier
shell. The Classic track (daisyUI, Tailwind, the `aimeat-ui-*` cortex, a hand-written sign-in)
was retired on 2026-11-19.

## The head and the frame (the Atelier shell)

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="aimeat-track" content="atelier" />
  <meta name="aimeat-level" content="proto" />
  <meta name="aimeat-locales" content="en fi" />
  <meta name="aimeat-app" content="my-app.html" />
  <meta name="aimeat-scopes" content="memory:read memory:write storage:read storage:write" />
  <title>My App</title>
  <link href="/lib/aimeat-atelier.css" rel="stylesheet" type="text/css" />
  <script src="/lib/aimeat-boot.js"></script>
</head>
<body>
  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script src="/v1/libs/aimeat-atelier.js"></script>
  <script>
    var a = AIMEAT.atelier.app({
      title: 'My App',
      onReady: function (session) { render(session); },
      // requireLogin: false,   // for an app anyone uses signed out; onReady then gets null
    });
    function render(session) {
      AIMEAT.atelier.hero({ target: a.main, title: 'My App', sub: '…' });
      var l = AIMEAT.atelier.list({ target: a.main, items: [] });
      // load data with AIMEAT.data.get, then l.set({ items: rows });
    }
  </script>
</body>
</html>
```

(Take the exact head from `GET /v1/app-templates/shell-atelier`, or the genre you fork, rather
than this copy. On the finest level a fork of a genre has its own `aimeat-register`.)

## Sign-in

The shell provides it: the login pill, the language switch, the theme. `onReady` gives you the
session. Never mount your own sign-in, theme toggle or language switch.

## Data (the user's private memory)

```js
const items = (await AIMEAT.data.get('myapp.items')) || [];   // read
await AIMEAT.data.set('myapp.items', items, { visibility: 'private' });  // write
```

`visibility: 'private'` = owner-only. Use a public visibility only for data the app intends to
share (e.g. a leaderboard). Data a team shares goes to one organism workspace, not to each
person's memory: the specification's platform section `group` says how.

## Look

The kit's `--ak-*` tokens are the look, chosen by the preset (`look:`) or the genre. Never
hardcode colours in JS or CSS.

## Publish (over MCP)

Use `aimeat_app_publish` with the `spec_token` from the specification. For files > ~1 KB, omit
the content param → get `upload_url` → `PUT` the raw HTML. Provide `filename`, `name`,
`description`, `category`, `tags`, `icon`. Republishing the same `filename` bumps the version.
Then return the live URL and/or verify with `aimeat_app_list`.
