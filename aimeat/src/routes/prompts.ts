/**
 * @file prompts.ts
 * @description Routes for serving tiered system prompts (tier0 through tier2, anonymous,
 *   openclaw, package-builder) and prompt packages. Each tier provides progressively
 *   more context to AI agents based on their authentication level.
 * @version-history
 *   v1.0.0 -- 2026-03-01 -- Initial tiered prompts (0, 1, 2, anonymous)
 *   v1.1.0 -- 2026-05-21 -- Extend tier1 response with directives, task queue, and agent endpoints
 *   v1.2.0 -- 2026-05-22 -- Add GET /v1/prompts/tier1/:module for modular prompt system
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { substituteVariables, resolvePromptContent } from '../services/prompt-variables.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export function promptsRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  const VALID_MODULES = ['tasks', 'messages', 'work', 'services', 'memory', 'activity', 'social', 'collaboration', 'appdev', 'mcp'] as const;

  // GET /v1/prompts/tier1/:module -- Feature module prompts (auth required)
  router.get('/v1/prompts/tier1/:module', requireAuth(), async (req, res) => {
    const mod = req.params.module as string;
    if (!(VALID_MODULES as readonly string[]).includes(mod)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND',
        `Unknown module: ${mod}. Valid: ${VALID_MODULES.join(', ')}`));
      return;
    }

    const record = await storage.getSystemPrompt(`tier-1-${mod}`);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Module prompt not available'));
      return;
    }

    const gaii = req.auth?.sub ?? 'unknown';
    const agent = req.auth?.sub ? await storage.getAgent(req.auth.sub) : null;
    const parsed = parseGaiiLoose(gaii);
    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const system_prompt = substituteVariables(promptContent, {
      node_url: config.baseUrl,
      node_id: config.nodeId,
      gaii,
      agent_name: parsed.agent || 'unknown',
      trust_score: agent?.trustScore ?? 50,
      daily_allowance: config.dailyAllowance,
    });

    res.json(success(config.nodeId, {
      tier: '1',
      module: mod,
      system_prompt,
    }));
  });

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
        // Extract agent name from GAII for template
        const parsedSelf = parseGaiiLoose(gaii);
        const selfAgentName = parsedSelf.agent || 'unknown';
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          gaii,
          agent_name: selfAgentName,
          owner_name: req.auth?.owner ?? 'unknown',
          trust_score: agent?.trustScore ?? 50,
          morsel_balance: agent?.morselBalance ?? 0,
          daily_allowance: config.dailyAllowance,
        });
        // Fetch directives for this agent
        const directives = gaii !== 'unknown' ? await storage.getAgentDirectives(gaii) : null;
        const ownerGhii = req.auth?.owner ? `${req.auth.owner}@${config.nodeId}` : '';
        const ownerDefaults = ownerGhii ? await storage.getOwnerAgentDefaults(ownerGhii) : null;

        // Fetch queued and active tasks
        const queuedTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'queued' }) : { tasks: [], total: 0 };
        const activeTasks = gaii !== 'unknown' ? await storage.listAgentTasks(gaii, { status: 'active' }) : { tasks: [], total: 0 };

        // Extract agent name from GAII for endpoint URLs
        const parsed = parseGaiiLoose(gaii);
        const agentName = parsed.agent || '{name}';

        res.json(success(config.nodeId, {
          tier: '1',
          agent_name: selfAgentName,
          system_prompt,
          available_operations: ['memory_crud', 'action_publish', 'action_execute', 'work_queue', 'wallet', 'boards', 'catalogue', 'task_lifecycle', 'directives', 'capabilities_report', 'message_handling'],
          economics: {
            note: 'Agents share the owner\'s wallet. This balance belongs to your owner, not you individually.',
            daily_allowance: config.dailyAllowance,
            current_balance: ownerGhii ? (await storage.getGHIIByOwner(req.auth?.owner as string))?.morselBalance ?? 0 : 0,
          },
          directives: {
            purpose: directives?.purpose ?? '',
            system_rules: config.agentSystemPrinciples.map((desc, i) => ({ id: `system-${i + 1}`, description: desc })),
            owner_rules: (ownerDefaults?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
            agent_rules: (directives?.rules ?? []).map(r => ({ id: r.id, description: r.description })),
            memory_areas: directives?.memoryAreas ?? [],
            resources: directives?.resources ?? [],
            max_tokens_per_task: config.agentMaxTokensPerTask,
            mandatory_logging: config.agentMandatoryLogging,
            aimeat_first: config.agentAimeatFirstEnabled,
          },
          task_queue: {
            queued: queuedTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
            active: activeTasks.tasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
            endpoints: {
              inbox: `/v1/agents/${encodeURIComponent(agentName)}/inbox`,
              start: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/start`,
              event: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/event`,
              complete: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/complete`,
              fail: `/v1/agents/${encodeURIComponent(agentName)}/tasks/{id}/fail`,
              wait: `/v1/agents/${encodeURIComponent(agentName)}/tasks/wait`,
            },
          },
          capabilities: {
            report_endpoint: `/v1/agents/${encodeURIComponent(agentName)}/capabilities`,
            current: {
              technical: agent?.technicalCapabilities ?? [],
              domain: agent?.domainCapabilities ?? [],
            },
            instructions: 'Report your capabilities on first connect and when they change. PUT to the report_endpoint with: { technical: [{ name, type }], domain: [string], languages: [string] }',
          },
          messages: {
            inbox_endpoint: `GET ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages/inbox`,
            send_endpoint: `POST ${config.baseUrl}/v1/agents/${encodeURIComponent(agentName)}/messages`,
            instructions: 'Poll inbox for pending messages. For each: read content, process, send response as outbound message. If user asks you to do something, include proposedTask in metadata.',
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
            'context.latest': 'Most recent working context (full key: anonymous.context.latest)',
            'handoff.pending': 'Tasks for next session (full key: anonymous.handoff.pending)',
            'agents.roster': 'Master list of known GAIIs (full key: anonymous.agents.roster)',
            'agents.presence.{platform}-{id}': 'Agent presence records (full key: anonymous.agents.presence.*)',
            'inbox.{agent}': 'Messages for a specific agent (full key: anonymous.inbox.*)',
            'project.{name}': 'Project-related data (full key: anonymous.project.*)',
            'notes.{topic}': 'General notes and knowledge (full key: anonymous.notes.*)',
            'config.{setting}': 'Shared configuration (full key: anonymous.config.*)',
            'tmp.{anything}': 'Temporary data — clean up when done (full key: anonymous.tmp.*)',
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
      case 'package-builder': {
        const record = await storage.getSystemPrompt('package-builder');
        if (!record || !record.active) { res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Prompt not available')); return; }
        const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
        const ownerName = req.auth?.owner ?? 'user';
        const system_prompt = substituteVariables(promptContent, {
          node_url: config.baseUrl,
          node_id: config.nodeId,
          owner_name: ownerName,
        });
        res.json(success(config.nodeId, {
          name: record.name,
          content: system_prompt,
        }));
        break;
      }
      default:
        res.status(400).json(error(config.nodeId, 'INVALID_TIER', `Unknown tier: ${tier}. Valid: 0, 0.5, 1, 2, anonymous, openclaw, package-builder`));
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

  // ── Prompt Packages (storage-backed) ──────────────────────────

  // GET /v1/portal/prompts — List available prompt packages from the builders group
  router.get('/v1/portal/prompts', async (req, res) => {
    const builderPrompts = await storage.listSystemPrompts({ group: 'builders' });
    const packages = builderPrompts
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.group,
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

    const record = await storage.getSystemPrompt(promptId);
    if (!record || !record.active) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Prompt package "${promptId}" not found`));
      return;
    }

    const promptContent = resolvePromptContent(record, req.headers['accept-language'] as string);
    const prompt = substituteVariables(promptContent, {
      node_url: baseUrl,
      owner_name: ownerName,
      cortex_extensions: cortexExtDescriptions.join('\n'),
    });

    res.json(success(config.nodeId, {
      id: promptId,
      name: record.name,
      description: record.description,
      category: record.group,
      prompt,
      node_url: baseUrl,
      owner: ownerName,
      cortex_extensions_available: cortexExtDescriptions.length,
    }));
  });

  return router;
}
