// Pure state helpers shared by the front door and its regression tests.
(function (root) {
  const STORAGE_KEY = 'aimeat.desktop.environments';
  const FIRST_PROMPT = 'Use the AIMEAT connection I just added. Read its handbook or available capabilities and tell me three things you can help me do. Use read-only tools. Do not create, change, delete, publish or send anything, and do not call a paid model.';
  function safeAddress(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (value.length > 2048 || /[\s\u0000-\u001f\u007f]/u.test(value)) return null;
    try {
      const url = new URL(value.includes('://') ? value : 'https://' + value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash ? value : null;
    } catch (_) { return null; }
  }
  function initial(saved, oldAddress, localAddress) {
    let state;
    try { state = JSON.parse(saved || 'null'); } catch (_) { state = null; }
    if (!state || state.version !== 1 || !Array.isArray(state.items)) state = null;
    const items = state ? state.items.filter((e) => e && typeof e.id === 'string' && typeof e.address === 'string').map((e) => ({ id: e.id, kind: e.kind || 'custom', name: typeof e.name === 'string' ? e.name.slice(0, 80) : '', address: safeAddress(e.address) || '' })) : [
      { id: 'personal', kind: 'personal', name: '', address: safeAddress(oldAddress) || 'https://aimeat.io' },
      { id: 'work', kind: 'work', name: '', address: '' },
      { id: 'local', kind: 'local', name: '', address: 'http://localhost:41050' },
    ];
    if (!items.length) return initial(null, oldAddress, localAddress);
    let selected = items.some((e) => e.id === state?.selected) ? state.selected : items[0].id;
    if (localAddress) {
      // A machine-room hand-off only selects a loopback HTTP address, never an arbitrary link.
      try {
        const url = new URL(localAddress);
        if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) {
          let local = items.find((e) => e.kind === 'local');
          if (!local) { local = { id: 'local-' + items.length, kind: 'local', name: '', address: '' }; items.push(local); }
          local.address = url.origin; selected = local.id;
        }
      } catch (_) { /* Ignore an invalid hand-off. */ }
    }
    return { version: 1, selected, items };
  }
  function current(state) { return state.items.find((e) => e.id === state.selected) || state.items[0]; }
  function saveDraft(state, name, address) {
    const profile = current(state); profile.name = name.trim().slice(0, 80);
    // Invalid input remains visible in the field for correction, never in persistent storage.
    const safe = safeAddress(address); if (safe !== null) profile.address = safe;
    return state;
  }
  function errorCode(error) { return String(error).split(':', 1)[0]; }
  root.DesktopFrontdoor = { STORAGE_KEY, FIRST_PROMPT, initial, current, saveDraft, errorCode, safeAddress };
  if (typeof module !== 'undefined') module.exports = root.DesktopFrontdoor;
})(typeof window === 'undefined' ? globalThis : window);
