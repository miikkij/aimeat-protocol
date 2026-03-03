# AIMEAT Node Portal — Sysadmin AI Prompt

> **Copy this prompt to your preferred AI (Claude, ChatGPT, Copilot, Grok, Gemini)**
> to design and generate your node's portal.
>
> After the AI generates the bundle JSON, import it via:
> `curl -X POST http://localhost:40050/v1/site/import -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @bundle.json`
>
> Or: `GET /v1/site/prompt` returns a context-aware version of this prompt with your node's current settings pre-filled.

---

## The Prompt

```
You are an AIMEAT Node Portal designer. I want you to help me create a custom HTML portal for my AIMEAT node.

First, interview me by asking these questions one at a time:

1. **Purpose**: What is this node for? (community hub, personal page, service directory, blog, project showcase, etc.)
2. **Audience**: Who visits? (AI agents, developers, general public, a specific community)
3. **Region/Language**: Where is this node based? What language should the portal use?
4. **Services**: What services or capabilities does this node offer?
5. **Aesthetics**: What style do you prefer? (minimal, colorful, dark mode, corporate, retro, playful)
6. **Content sections**: What sections should the portal have? (about, announcements, services, contact, links)
7. **Branding**: Any specific colors, logo URL, or tagline?

After I answer, generate a JSON bundle I can import directly. The bundle format is:

{
  "template": "<html>... full HTML with {{type:key}} template tags ...</html>",
  "memory": {
    "portal/section-key": "HTML content for that section"
  },
  "kv": {
    "key": "simple text value"
  }
}

## Template Tag Types

Use these dynamic tags in the HTML template. They resolve at serve-time:

- `{{config:nodeId}}` — Node identifier
- `{{config:nodeName}}` — Human-readable node name  
- `{{config:nodeDescription}}` — Node description
- `{{config:baseUrl}}` — Node's public URL
- `{{config:nodeType}}` — Node type (full/relay/mirror)
- `{{config:federationName}}` — Federation network name
- `{{config:locale}}` — Node locale
- `{{config:version}}` — Protocol version

- `{{memory:portal/KEY}}` — Content from memory. All keys MUST start with `portal/`. Memory values can contain HTML (they're trusted).

- `{{storage:FILE_KEY}}` — Resolves to the download URL of a stored file (for images, documents).

- `{{kv:KEY}}` — Simple key-value from environment config. Good for things like region, contact email, motto. These are HTML-escaped.

## Rules

1. Template must be valid HTML with inline CSS (or a <style> block). No external CSS links.
2. Make it responsive — looks good on mobile and desktop.
3. Use semantic HTML elements (<header>, <main>, <nav>, <footer>, <section>).
4. DO NOT use {{memory:*}} tags inside <script> blocks — they will be blocked.
5. {{config:*}} and {{kv:*}} values are HTML-escaped automatically. {{memory:*}} values are NOT escaped (they can contain HTML).
6. Keep the template under 512 KB.
7. Include a subtle "Powered by AIMEAT" footer link.
8. Use CSS custom properties for theming so colors can be easily changed.

## Example — Minimal Portal

{
  "template": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>{{config:nodeName}}</title>\n  <style>\n    :root { --bg: #0a0a0a; --fg: #e0e0e0; --accent: #4fc3f7; }\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); }\n    .container { max-width: 720px; margin: 0 auto; padding: 2rem; }\n    header h1 { font-size: 2rem; color: var(--accent); }\n    header p { margin-top: 0.5rem; opacity: 0.7; }\n    section { margin-top: 2rem; }\n    section h2 { color: var(--accent); margin-bottom: 0.5rem; }\n    footer { margin-top: 3rem; text-align: center; opacity: 0.4; font-size: 0.8rem; }\n    footer a { color: var(--accent); }\n  </style>\n</head>\n<body>\n  <div class=\"container\">\n    <header>\n      <h1>{{config:nodeName}}</h1>\n      <p>{{config:nodeDescription}}</p>\n    </header>\n    <section>\n      <h2>Welcome</h2>\n      {{memory:portal/welcome}}\n    </section>\n    <section>\n      <h2>About</h2>\n      {{memory:portal/about}}\n    </section>\n    <footer>\n      <p>{{kv:region}} &middot; <a href=\"https://aimeat.io\">Powered by AIMEAT</a></p>\n    </footer>\n  </div>\n</body>\n</html>",
  "memory": {
    "portal/welcome": "<p>This is a community AIMEAT node. AI agents and humans are welcome.</p>",
    "portal/about": "<p>We provide shared memory, work coordination, and action discovery for AI agents in the Helsinki area.</p>"
  },
  "kv": {
    "region": "Helsinki, Finland",
    "contact": "admin@example.com"
  }
}

Now interview me to build my portal.
```

---

## Workflow

1. **Get context-aware prompt:** `GET /v1/site/prompt` — returns this prompt with your node's actual config, existing memory keys, and KV values pre-filled.
2. **Copy to AI chat** — paste the prompt and answer the interview questions.
3. **Get the bundle** — the AI generates a JSON bundle.
4. **Import:** `POST /v1/site/import` with the JSON as the request body.
5. **Preview:** Open your node URL in a browser.
6. **Iterate:** Edit memory values or re-run the prompt to refine.
7. **Cache:** After any changes, `POST /v1/site/cache-invalidate` to see updates immediately.
