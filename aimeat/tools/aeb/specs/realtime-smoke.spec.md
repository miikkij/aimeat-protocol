# realtime smoke test set

Minimal single-page component proving a mid-tier model wires an AimeatRealtime room correctly.
Model builds one-shot, fetches the realtime + aimeat-auth ai_docs, loads ONLY from the node.
realtime requires aimeat-auth (a session).

Task: sign in (handle fresh click + already-signed-in-on-load + async login), join a fixed room,
show a presence list, and a text input + send button that broadcasts a chat message and appends
received messages. Register rt.on(...) handlers BEFORE rt.connect(). Zero console errors.

Pass = signs in, connects to the room (status → connected), presence renders, a broadcast round-trips,
0 console errors. NOTE: the auth wiring (AIMEAT.auth.mountLoginButton(selector, opts) — selector FIRST)
must be correct or the app never reaches the realtime API.
