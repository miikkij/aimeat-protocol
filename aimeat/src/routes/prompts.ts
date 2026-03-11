import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { emitChange } from '../services/event-bus.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';

export function promptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // GET /v1/prompts/:tier — unified prompts endpoint (Tier 0)
  router.get('/v1/prompts/:tier', async (req, res) => {
    const tier = req.params.tier as string;
    const agents = await storage.listAgents();
    const actions = await storage.listActions();

    switch (tier) {
      case '0':
      case 'tier0': {
        const record = await storage.getSystemPrompt('tier-0');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '0',
          system_prompt,
          available_endpoints: ['/v1/catalogue', '/v1/agents/{gaii}', '/v1/boards/{id}/posts', '/.well-known/aimeat'],
          upgrade_paths: {
            mcp: '/v1/mcp',
            jwt: 'POST /v1/auth/token',
            keyed_browse: '/v1/auth/challenge',
            dashboard: '/dashboard',
          },
          stats: { agents: agents.length, actions: actions.length },
        }));
        break;
      }
      case '0.5': {
        const record = await storage.getSystemPrompt('tier-0.5');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '0.5',
          system_prompt,
          available_endpoints: ['/v1/mm', '/v1/mm/{gaii}/{set}', '/v1/catalogue', '/v1/auth/challenge'],
          keyed_browse_enabled: config.keyedBrowseEnabled,
        }));
        break;
      }
      case '1':
      case 'tier1': {
        const gaii = req.auth?.sub ?? 'unknown';
        const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
        const record = await storage.getSystemPrompt('tier-1');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          gaii,
          owner_name: req.auth?.owner ?? 'unknown',
          trust_score: agent?.trustScore ?? 50,
          morsel_balance: agent?.morselBalance ?? 0,
          daily_allowance: config.dailyAllowance,
        });
        res.json(success(config.nodeId, {
          tier: '1',
          system_prompt,
          available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue'],
          economics: {
            daily_allowance: config.dailyAllowance,
            current_balance: agent?.morselBalance ?? 0,
          },
        }));
        break;
      }
      case '2':
      case 'tier2': {
        const owner = req.auth?.owner ?? 'unknown';
        const record = await storage.getSystemPrompt('tier-2');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          gaii: req.auth?.sub ?? 'unknown',
          owner_name: owner,
          agent_count: agents.length,
          action_count: actions.length,
        });
        res.json(success(config.nodeId, {
          tier: '2',
          system_prompt,
          available_operations: ['all_tier_1', 'dashboard', 'config', 'peering', 'disputes', 'role_grants'],
          node_stats: {
            agent_count: agents.length,
            action_count: actions.length,
          },
        }));
        break;
      }
      case 'anonymous': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const anonGaii = `shared#anonymous@${config.nodeId}`;
        // Chat instance ID — identifies this specific chat session
        const timestamp = Math.floor(Date.now() / 1000);
        const anonChatId = `anon-${timestamp}#anonymous@${config.nodeId}`;

        let systemPrompt: string;
        if (config.anonymousMode) {
          const record = await storage.getSystemPrompt('tier-anonymous');
          if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
          const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
          systemPrompt = substituteVariables(promptContent, {
            node_url: baseUrl,
            node_id: config.nodeId,
            anon_gaii: anonGaii,
            anon_chat_id: anonChatId,
          });
        } else {
          systemPrompt = `Anonymous mode is not enabled on this node. Set AIMEAT_ANONYMOUS=true to enable it. Normal authenticated operations still work.`;
        }

        res.json(success(config.nodeId, {
          tier: 'anonymous',
          enabled: config.anonymousMode,
          system_prompt: systemPrompt,
          available_endpoints: config.anonymousMode
            ? ['/v1/memory', '/v1/memory/{key}', '/v1/memory/search', '/v1/mm', '/v1/prompts/anonymous/share',
              '/v1/catalogue', '/v1/catalogue/agents', '/v1/catalogue/actions', '/v1/stats', '/v1/health']
            : [],
          key_conventions: config.anonymousMode ? {
            'anonymous.agents.presence.{platform}-{id}': 'Agent presence records',
            'anonymous.agents.roster': 'Master list of known GAIIs',
            'anonymous.context.latest': 'Most recent working context',
            'anonymous.handoff.pending': 'Tasks for next session',
            'anonymous.inbox.{agent}': 'Messages for a specific agent',
            'anonymous.project.{name}': 'Project-related data',
            'anonymous.notes.{topic}': 'General notes and knowledge',
            'anonymous.config.{setting}': 'Shared configuration',
            'anonymous.tmp.{anything}': 'Temporary data (clean up when done)',
          } : undefined,
          boot_sequence: config.anonymousMode ? [
            'POST /v1/auth/anonymous — Get a JWT token first',
            'GET /v1/memory — Read node state',
            'GET /v1/memory/search?q=anonymous.handoff — Check for pending handoffs',
            'GET /v1/memory/search?q=anonymous.agents — Check who else is here',
            'POST /v1/memory — Announce presence (anonymous.agents.presence.\u2026)',
            'GET /v1/memory/search?q=anonymous.context.latest — Read latest context',
          ] : undefined,
          share_prompt_url: config.anonymousMode ? `${baseUrl}/v1/prompts/anonymous/share` : null,
          gaii: anonGaii,
          chat_instance_id: anonChatId,
          note: 'Anonymous mode runs alongside normal authenticated mode. Both work simultaneously.',
        }));
        break;
      }
      case 'openclaw': {
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const authMode = config.anonymousMode ? 'anonymous' : 'otk-or-jwt';
        const record = await storage.getSystemPrompt('tier-openclaw');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const system_prompt = substituteVariables(promptContent, {
          node_url: baseUrl,
          node_id: config.nodeId,
          gaii: req.auth?.sub ?? 'unknown',
          owner_name: req.auth?.owner ?? 'unknown',
        });
        res.json(success(config.nodeId, {
          tier: 'openclaw',
          system_prompt,
          mcp_config: {
            transport: 'streamable-http',
            url: `${baseUrl}/v1/mcp`,
            auth_mode: authMode,
          },
          tools: {
            user: [
              'aimeat_catalogue_search', 'aimeat_agent_profile',
              'aimeat_memory_read', 'aimeat_memory_write', 'aimeat_memory_list',
              'aimeat_action_execute', 'aimeat_work_inbox', 'aimeat_work_accept', 'aimeat_work_deliver',
              'aimeat_wallet_balance',
              'aimeat_board_read', 'aimeat_board_post',
              'aimeat_storage_upload', 'aimeat_storage_download',
            ],
            admin: ['aimeat_admin_stats', 'aimeat_admin_agents', 'aimeat_admin_config', 'aimeat_admin_mint'],
          },
          auth_instructions: config.anonymousMode
            ? 'Anonymous mode is enabled. No authentication needed \u2014 connect directly to the MCP URL.'
            : 'Authentication required. Use an Initial OTK (POST /v1/auth/initial-otk) or JWT (POST /v1/auth/token) as a Bearer token in the MCP connection headers.',
          docs: `${baseUrl}/v1/docs`,
          integration_guide: 'See docs/integrations/openclaw-setup.md for full setup instructions.',
        }, [
          { description: 'Connect via MCP', method: 'POST', url: '/v1/mcp' },
          { description: 'Generate Initial OTK for auth', method: 'POST', url: '/v1/auth/initial-otk' },
          { description: 'Browse catalogue', method: 'GET', url: '/v1/catalogue' },
        ]));
        break;
      }
      default:
        res.status(400).json(error(config.nodeId, 'INVALID_TIER', `Unknown tier: ${tier}. Valid: 0, 0.5, 1, 2, anonymous, openclaw`));
    }
  });

  // GET /v1/prompts/anonymous/share — Generate a share prompt for copying to other AIs
  router.get('/v1/prompts/anonymous/share', async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const anonGaii = `shared#anonymous@${config.nodeId}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const anonChatId = `anon-${timestamp}#anonymous@${config.nodeId}`;

    const record = await storage.getSystemPrompt('anonymous-share');
    if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const sharePrompt = substituteVariables(promptContent, {
      node_url: baseUrl,
      node_id: config.nodeId,
      anon_gaii: anonGaii,
      anon_chat_id: anonChatId,
    });

    // If ?format=text, return plain text (for sharing as a URL)
    if (req.query.format === 'text') {
      res.type('text/plain').send(sharePrompt);
      return;
    }

    res.json(success(config.nodeId, {
      share_prompt: sharePrompt,
      node_id: config.nodeId,
      base_url: baseUrl,
      gaii: anonGaii,
      chat_instance_id: anonChatId,
    }, [
      { description: 'View anonymous mode guidance', method: 'GET', url: '/v1/prompts/anonymous' },
      { description: 'List memory keys', method: 'GET', url: '/v1/memory' },
      { description: 'Micro-memory operations', method: 'GET', url: '/v1/mm?op=list' },
    ]));
  });

  // ── Prompt Packages (dynamic API) ──────────────────────────

  const PROMPT_PACKAGES: Record<string, { name: string; description: string; category: string; cortexHints: string[]; template: (nodeUrl: string, ownerName: string, cortexExtensions: string[]) => string }> = {
    'app-builder-general': {
      name: 'Custom App Builder',
      description: 'User interview \u2192 bespoke single-file HTML app',
      category: 'builder',
      cortexHints: [],
      template: (nodeUrl, ownerName, cortexExts) => `You are building a custom single-file HTML app for user "${ownerName}" on AIMEAT node ${nodeUrl}.

Ask the user what their app should do. Then build a complete, self-contained HTML file.

## AIMEAT Platform
- Load client libraries from ${nodeUrl}/v1/libs/ (aimeat-auth.js, aimeat-data.js, aimeat-storage.js, aimeat-social.js, aimeat-wallet.js, aimeat-work.js)
- Auth: AIMEAT.auth.mountLoginButton("#login", { onLogin: fn, onLogout: fn })
- Data: AIMEAT.data.set(key, value), AIMEAT.data.get(key), AIMEAT.data.search(q)
- Dark theme: --bg:#0f0a14; --text:#f0e6f6; --accent:#ff6b9d
${cortexExts.length ? '\n## Available Cortex Extensions\n' + cortexExts.join('\n') : ''}

## Rules
- Return COMPLETE HTML file, not fragments
- Mobile-first responsive design
- Include error handling and loading states
- Include a self-publish button using POST ${nodeUrl}/v1/apps`,
    },
    'app-builder-game': {
      name: 'Multiplayer Game Builder',
      description: 'Game with lobby, turns, scoreboard using AIMEAT boards',
      category: 'builder',
      cortexHints: [],
      template: (nodeUrl, ownerName, cortexExts) => `Build a multiplayer HTML game for "${ownerName}" on AIMEAT node ${nodeUrl}.

## Game Architecture
- Use AIMEAT boards for real-time game state (POST/GET /v1/boards/{id}/posts)
- Use AIMEAT memory for persistent scores and player profiles
- Use AIMEAT auth for player identity

## Required Features
- Game lobby (create/join using a board as the lobby channel)
- Turn-based or real-time gameplay via board posts
- Scoreboard stored in AIMEAT memory (key: games.{gamename}.scores)
- Player profiles with wins/losses

## Libraries
Load from ${nodeUrl}/v1/libs/:
- aimeat-auth.js \u2014 Login/identity
- aimeat-data.js \u2014 Score persistence
- aimeat-social.js \u2014 Game state via boards
${cortexExts.length ? '\n## Cortex Extensions\n' + cortexExts.join('\n') : ''}

## Design
Dark theme (--bg:#0f0a14; --accent:#ff6b9d), mobile-first, smooth animations.
Return a COMPLETE single HTML file.`,
    },
    'app-builder-notes': {
      name: 'Note-Taking App Builder',
      description: 'Notes app with folders, tags, search using AIMEAT memory',
      category: 'builder',
      cortexHints: [],
      template: (nodeUrl, ownerName, cortexExts) => `Build a note-taking app for "${ownerName}" on AIMEAT node ${nodeUrl}.

## Features
- Create, edit, delete notes
- Organize with folders/categories and tags
- Full-text search via AIMEAT memory search
- Set visibility (private/public) per note
- Markdown support in note body

## Data Storage
- Notes stored as AIMEAT memory keys: notes.{id}
- Value: { title, body, folder, tags, createdAt, updatedAt }
- Use AIMEAT.data.search("notes.") to list all notes
- Use AIMEAT.data.set() / .get() / .delete()

## Libraries
Load from ${nodeUrl}/v1/libs/:
- aimeat-auth.js \u2014 Login
- aimeat-data.js \u2014 Note CRUD
${cortexExts.length ? '\n## Cortex Extensions\n' + cortexExts.join('\n') : ''}

## Design
Dark theme, mobile-first, sidebar + editor layout. Return COMPLETE HTML file.`,
    },
    'app-builder-dashboard': {
      name: 'Data Dashboard Builder',
      description: 'Charts, tables, and live data from AIMEAT memory',
      category: 'builder',
      cortexHints: ['aimeat-charts'],
      template: (nodeUrl, ownerName, cortexExts) => `Build a data dashboard for "${ownerName}" on AIMEAT node ${nodeUrl}.

## Features
- Read structured data from AIMEAT memory keys
- Display as charts (bar, line, pie) and data tables
- Auto-refresh interval for live data
- Configurable data sources (user picks which memory keys to visualize)
- Summary cards with key metrics

## Libraries
Load from ${nodeUrl}/v1/libs/:
- aimeat-auth.js \u2014 Login
- aimeat-data.js \u2014 Read data
${cortexExts.length ? '\n## Cortex Extensions\n' + cortexExts.join('\n') : ''}

## Chart Implementation
Use Canvas API or inline SVG for charts (no external dependencies).
Dashboard should be fully self-contained in one HTML file.

## Design
Dark theme, grid layout, responsive cards. Return COMPLETE HTML file.`,
    },
    'app-builder-chat': {
      name: 'Chat Room Builder',
      description: 'Real-time messaging using AIMEAT boards',
      category: 'builder',
      cortexHints: [],
      template: (nodeUrl, ownerName, cortexExts) => `Build a chat room app for "${ownerName}" on AIMEAT node ${nodeUrl}.

## Features
- Channel sidebar (list boards as channels)
- Message display with author, timestamp, reactions
- Send message (POST to board)
- Reply threading
- Emoji reactions
- Auto-poll for new messages (every 3 seconds)
- Create new channels (create board)

## Architecture
- Each channel = one AIMEAT board
- Messages = board posts
- Replies = posts with replyTo field
- Reactions = post reaction API

## Libraries
Load from ${nodeUrl}/v1/libs/:
- aimeat-auth.js \u2014 Login/identity
- aimeat-social.js \u2014 Boards, posts, reactions
${cortexExts.length ? '\n## Cortex Extensions\n' + cortexExts.join('\n') : ''}

## Design
Dark theme, Discord-like layout, mobile-responsive. Return COMPLETE HTML file.`,
    },
    'csm-builder': {
      name: 'CSM Builder',
      description: 'Create a Contextual Service Model (CSM) via AI conversation',
      category: 'builder',
      cortexHints: [],
      template: (nodeUrl, ownerName, _cortexExts) => `You are helping "${ownerName}" design a CSM (Contextual Service Model) for AIMEAT node ${nodeUrl}.

## What is a CSM?

A CSM is a YAML document that defines a service's data model for an AIMEAT node. It specifies what data a service collects, how it's validated, and what consent rules apply. Services like hobby directories, marketplaces, dating apps, news feeds, and forums all use CSMs.

## CSM YAML Format

\`\`\`yaml
csm: "1.0"
service:
  name: "service-name"           # unique identifier (kebab-case)
  type: "directory"              # directory | marketplace | forum | social | feed | auction
  description: "What this service does"
  locale: "en"                   # primary locale

schema_mode: "open"              # open = flexible, strict = exact match, locked = no changes

data_schema:
  required:
    field_name:
      type: string               # string | number | boolean | array | object
      maxLength: 200             # optional constraints
    tags:
      type: array
      items: { type: string }
      minItems: 1
    location:
      type: object
      properties:
        city: { type: string }
        country: { type: string, default: "US" }
      required: [city]
  optional:
    bio: { type: string, maxLength: 500 }
    rating: { type: number, minimum: 0, maximum: 5 }
    status: { type: string, enum: ["active", "paused", "closed"] }

consent_requirements:
  visibility_default: "federation"    # public | node | federation | private
  requires_consent: true
  consent_purpose: "community-discovery"  # describe why data is collected
  data_retention: "until_revoked"     # until_revoked | 30_days | 90_days | 1_year

moderation:
  flags_enabled: true
  auto_hide_threshold: 5
  appeals_enabled: false

ui_hints:
  list_view: ["displayName", "tags", "location.city"]
  detail_view: ["displayName", "bio", "tags", "location", "status"]
  search_fields: ["tags", "location.city"]
\`\`\`

## Your Task

1. Ask the user what kind of service they want to create
2. Ask about the data fields they need (required vs optional)
3. Ask about consent and moderation requirements
4. Generate the complete CSM YAML

## Rules
- Service name must be unique and kebab-case
- Include at least one required field in data_schema
- Always include consent_requirements
- Choose appropriate schema_mode (open for flexibility, strict for data integrity)
- Include ui_hints to help frontends render the data

## Registration

Once the user is happy with the CSM, they can register it by:
- Pasting the YAML in the admin dashboard CSM Management tab
- Or via API: POST ${nodeUrl}/v1/csm with Content-Type: text/yaml

The node will validate the CSM, generate a JSON Schema, and register it for use.`,
    },
  };

  // GET /v1/portal/prompts — List available prompt packages
  router.get('/v1/portal/prompts', async (req, res) => {
    const packages = Object.entries(PROMPT_PACKAGES).map(([id, pkg]) => ({
      id,
      name: pkg.name,
      description: pkg.description,
      category: pkg.category,
      cortex_hints: pkg.cortexHints,
    }));

    res.json(success(config.nodeId, {
      packages,
      total: packages.length,
    }, [
      { description: 'Get a specific prompt package', method: 'GET', url: '/v1/portal/prompts/{promptId}' },
    ]));
  });

  // GET /v1/portal/prompts/:promptId — Get prompt with node values auto-filled
  router.get('/v1/portal/prompts/:promptId', async (req, res) => {
    const promptId = req.params.promptId as string;
    const pkg = PROMPT_PACKAGES[promptId];

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const ownerName = req.auth?.owner ?? req.query.owner as string ?? 'user';

    // Auto-detect active cortex extensions
    let cortexExtDescriptions: string[] = [];
    try {
      const extensions = await storage.listCortexExtensions({ status: 'active' });
      if (extensions && extensions.length > 0) {
        cortexExtDescriptions = extensions.map((ext) =>
          `- ${ext.name}: ${ext.description}`
        );
      }
    } catch { /* cortex not available */ }

    // Try storage-backed prompt first
    const record = await storage.getSystemPrompt(promptId);
    if (record && record.active) {
      const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
      const prompt = substituteVariables(promptContent, {
        node_url: baseUrl,
        owner_name: ownerName,
        cortex_extensions: cortexExtDescriptions.join('\n'),
      });

      // Use PROMPT_PACKAGES metadata if available, otherwise use record metadata
      const meta = pkg ?? { name: record.name, description: record.description, category: record.group };
      res.json(success(config.nodeId, {
        id: promptId,
        name: meta.name,
        description: meta.description,
        category: meta.category,
        prompt,
        node_url: baseUrl,
        owner: ownerName,
        cortex_extensions_available: cortexExtDescriptions.length,
      }));
      return;
    }

    // Fallback: prompt not in storage — check PROMPT_PACKAGES for legacy template
    if (!pkg) {
      const validIds = Object.keys(PROMPT_PACKAGES).join(', ');
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt package "${promptId}" not found. Available: ${validIds}`));
      return;
    }

    const prompt = pkg.template(baseUrl, ownerName, cortexExtDescriptions);

    res.json(success(config.nodeId, {
      id: promptId,
      name: pkg.name,
      description: pkg.description,
      category: pkg.category,
      prompt,
      node_url: baseUrl,
      owner: ownerName,
      cortex_extensions_available: cortexExtDescriptions.length,
    }));
  });

  return router;
}
