/**
 * @file src/routes/profile.ts
 * @description Serves the standalone legacy profile page (self-contained HTML) at GET /v1/profile —
 *   an SSR-rendered "My Profile" page with inlined CSS and localized translations injected as a
 *   window.T object, driven client-side by the aimeat-auth.js library.
 *
 * @structure
 *   - profileRouter(config, storage): Router exposing GET /v1/profile (locale-resolved, sets lang cookie)
 *   - profileHtml(config, locale, translations): builds the full HTML document string,
 *     composing the extracted CSS + client-script template strings from ./profile/
 *   - buildProfileTranslations / sanitize: gather flat profile+modal i18n and HTML-escape interpolations
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 *   v1.1.0 — 2026-07-13 — Split inline CSS + client script into ./profile/ modules (max-file-lines); behavior unchanged
 */
import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveFlat, resolveLocale, type Locale } from '../i18n.js';
import { PROFILE_CSS } from './profile/styles.js';
import { PROFILE_JS_CORE } from './profile/client-script-core.js';
import { PROFILE_JS_TABS } from './profile/client-script-tabs.js';

function sanitize(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildProfileTranslations(locale: Locale): Record<string, string> {
  return { ...resolveFlat(locale, 'profile'), ...resolveFlat(locale, 'modal') };
}

function profileHtml(config: AimeatConfig, locale: string, translations: Record<string, string>): string {
  return `<!DOCTYPE html>
<html lang="${sanitize(locale)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="aimeat-node" content="${sanitize(config.baseUrl)}">
<title>${sanitize(translations['profile.title'] || 'My Profile')} \u2014 AIMEAT ${sanitize(config.nodeId)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script>var T = ${JSON.stringify(translations)};</script>
<script src="${sanitize(config.baseUrl)}/v1/libs/aimeat-auth.js"></script>
<style>
${PROFILE_CSS}
</style>
</head>
<body>

<!-- Background -->
<div class="bg-layer bg-aurora">
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
  <div class="aurora-wave"></div>
</div>

<!-- Top bar -->
<div class="topbar">
  <div class="topbar-left">
    <a href="/v1/portal">\u{1F496} AIMEAT</a>
    <span style="color:var(--muted);font-weight:400;font-size:.85rem">/&nbsp;${sanitize(translations['profile.subtitle'] || 'Profile')}</span>
  </div>
  <div class="topbar-right">
    <div class="lang-toggle">
      <button class="lang-btn ${locale === 'fi' ? 'active' : ''}" onclick="switchLang('fi')">FI</button>
      <button class="lang-btn ${locale === 'en' ? 'active' : ''}" onclick="switchLang('en')">EN</button>
    </div>
    <div id="auth-container"></div>
  </div>
</div>

<!-- Not logged in state -->
<div class="container" id="login-screen">
  <div class="login-prompt">
    <h1>\u{1F496} <span id="login-title">${sanitize(translations['profile.signInTitle'] || 'Your AIMEAT Profile')}</span></h1>
    <p id="login-desc">${sanitize(translations['profile.signInDesc'] || 'Sign in to see your agents, wallet, memory, work history, and more.')}</p>
    <div id="login-area"></div>
  </div>
</div>

<!-- Logged in profile -->
<div class="container" id="profile-screen" style="display:none">
  <!-- Profile header -->
  <div class="profile-header">
    <div class="avatar" id="avatar">\u{1F9D1}</div>
    <div class="profile-info">
      <h1 id="display-name">${sanitize(translations['profile.loading'] || 'Loading...')}</h1>
      <div class="ghii" id="ghii-label"></div>
      <div class="meta" id="profile-meta"></div>
    </div>
  </div>

  <!-- Stats bar -->
  <div class="stats-bar" id="stats-bar">
    <div class="stat-card"><div class="num" id="stat-agents">-</div><div class="label">${sanitize(translations['profile.stats.agents'] || 'Agents')}</div></div>
    <div class="stat-card"><div class="num" id="stat-chatsessions">-</div><div class="label">${sanitize(translations['profile.stats.chatSessions'] || 'Chat Sessions')}</div></div>
    <div class="stat-card"><div class="num" id="stat-balance">-</div><div class="label">${sanitize(translations['profile.stats.morsels'] || 'Morsels')}</div></div>
    <div class="stat-card"><div class="num" id="stat-memory">-</div><div class="label">${sanitize(translations['profile.stats.memories'] || 'Memories')}</div></div>
    <div class="stat-card"><div class="num" id="stat-actions">-</div><div class="label">${sanitize(translations['profile.stats.services'] || 'Services')}</div></div>
    <div class="stat-card"><div class="num" id="stat-work">-</div><div class="label">${sanitize(translations['profile.stats.tasks'] || 'Tasks')}</div></div>
    <div class="stat-card"><div class="num" id="stat-apps">-</div><div class="label">${sanitize(translations['profile.stats.apps'] || 'Apps')}</div></div>
    <div class="stat-card"><div class="num" id="stat-files">-</div><div class="label">${sanitize(translations['profile.stats.files'] || 'Files')}</div></div>
    <div class="stat-card"><div class="num" id="stat-nodes">-</div><div class="label">${sanitize(translations['profile.stats.nodes'] || 'Nodes')}</div></div>
  </div>

  <!-- Tabs -->
  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="agents">${sanitize(translations['profile.tabs.agents'] || 'Agents')}</button>
    <button class="tab" data-tab="chatsessions">${sanitize(translations['profile.tabs.chatSessions'] || 'Chat Sessions')}</button>
    <button class="tab" data-tab="wallet">${sanitize(translations['profile.tabs.wallet'] || 'Wallet')}</button>
    <button class="tab" data-tab="memory">${sanitize(translations['profile.tabs.memory'] || 'Memory')}</button>
    <button class="tab" data-tab="work">${sanitize(translations['profile.tabs.work'] || 'Work')}</button>
    <button class="tab" data-tab="actions">${sanitize(translations['profile.tabs.services'] || 'Services')}</button>
    <button class="tab" data-tab="boards">${sanitize(translations['profile.tabs.boards'] || 'Boards')}</button>
    <button class="tab" data-tab="apps">${sanitize(translations['profile.tabs.apps'] || 'Apps')}</button>
    <button class="tab" data-tab="federation">${sanitize(translations['profile.tabs.federation'] || 'Federation')}</button>
    <button class="tab" data-tab="nodes">${sanitize(translations['profile.tabs.nodes'] || 'Nodes')}</button>
    <button class="tab" data-tab="access">${sanitize(translations['profile.tabs.access'] || 'Access')}</button>
  </div>

  <!-- Tab panels -->

  <!-- ═══ AGENTS ═══ -->
  <div class="tab-panel active" id="panel-agents">
    <div class="section-title">${sanitize(translations['profile.agents.title'] || 'Your Agents')}</div>
    <div class="section-desc">${sanitize(translations['profile.agents.desc'] || '')}</div>

    <!-- Agent CTA -->
    <div class="agent-cta" id="agent-cta">
      <h3>${sanitize(translations['profile.agents.connect'] || 'Connect an Automation Agent')}</h3>
      <p>${sanitize(translations['profile.agents.connectDesc'] || '')}</p>
      <div class="agent-prompt-box" id="agent-connect-prompt">${sanitize(translations['profile.agents.loadingPrompt'] || 'Loading prompt...')}</div>
      <button class="copy-prompt-btn" onclick="copyAgentPrompt()">${sanitize(translations['profile.agents.copyPrompt'] || 'Copy Prompt')}</button>

      <div style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
        <p style="margin-bottom:.75rem">${sanitize(translations['profile.agents.noAgent'] || 'Don\'t have an automation agent yet?')}</p>
        <button class="expand-btn" onclick="toggleInstructions(this)">${sanitize(translations['profile.agents.seeHow'] || 'See how to get one')} <span style="transition:transform .2s">\u25BC</span></button>
        <div class="platform-instructions" id="platform-instructions">
          <div class="platform-tabs" id="platform-tabs">
            <button class="platform-tab active" data-platform="windows">${sanitize(translations['profile.platforms.windows'] || 'Windows')}</button>
            <button class="platform-tab" data-platform="mac">${sanitize(translations['profile.platforms.mac'] || 'macOS')}</button>
            <button class="platform-tab" data-platform="linux">${sanitize(translations['profile.platforms.linux'] || 'Linux')}</button>
            <button class="platform-tab" data-platform="wsl2">${sanitize(translations['profile.platforms.wsl2'] || 'WSL2')}</button>
            <button class="platform-tab" data-platform="android">${sanitize(translations['profile.platforms.android'] || 'Android')}</button>
            <button class="platform-tab" data-platform="aws">${sanitize(translations['profile.platforms.aws'] || 'AWS / Cloud')}</button>
          </div>
          <div id="platform-panels"></div>
        </div>
      </div>
    </div>

    <div id="agents-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.agents.loadingAgents'] || 'Loading agents...')}</span></div>
  </div>

  <!-- ═══ CHAT SESSIONS ═══ -->
  <div class="tab-panel" id="panel-chatsessions">
    <div class="section-title">${sanitize(translations['profile.chatSessions.title'] || 'Chat Sessions')}</div>
    <div class="section-desc">${sanitize(translations['profile.chatSessions.desc'] || '')}</div>
    <div id="chatsessions-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.chatSessions.loading'] || 'Loading chat sessions...')}</span></div>
  </div>

  <!-- ═══ WALLET ═══ -->
  <div class="tab-panel" id="panel-wallet">
    <div class="section-title">${sanitize(translations['profile.wallet.title'] || 'Wallet')}</div>
    <div class="section-desc">${sanitize(translations['profile.wallet.desc'] || '')}</div>
    <div id="wallet-area"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.wallet.loading'] || 'Loading wallet...')}</span></div>
  </div>

  <!-- ═══ MEMORY ═══ -->
  <div class="tab-panel" id="panel-memory">
    <div class="section-title">${sanitize(translations['profile.memory.title'] || 'Memory')}</div>
    <div class="section-desc">${sanitize(translations['profile.memory.desc'] || '')}</div>
    <div class="sub-tabs" id="memory-sub-tabs">
      <button class="sub-tab active" data-subtab="memory-entries">${sanitize(translations['profile.memory.entries'] || 'Entries')}</button>
      <button class="sub-tab" data-subtab="memory-files">${sanitize(translations['profile.memory.files'] || 'Files')}</button>
    </div>
    <div class="sub-panel active" id="subpanel-memory-entries">
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" id="memory-search" placeholder="${sanitize(translations['profile.memory.search'] || 'Search memories...')}" class="input-field">
          <button class="btn-sm" onclick="searchMemory()">${sanitize(translations['profile.memory.searchBtn'] || 'Search')}</button>
          <button class="btn-sm btn-outline" onclick="loadMemory()">${sanitize(translations['profile.memory.clearBtn'] || 'Clear')}</button>
        </div>
        <button class="btn-primary" onclick="toggleMemoryForm()">${sanitize(translations['profile.memory.newBtn'] || '+ New Memory')}</button>
      </div>
      <div class="create-form" id="memory-form" style="display:none">
        <div class="form-row"><label>${sanitize(translations['profile.memory.keyLabel'] || 'Key')}</label><input type="text" id="mem-key" class="input-field" placeholder="${sanitize(translations['profile.memory.keyPlaceholder'] || 'my-preference')}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.memory.valueLabel'] || 'Value')}</label><textarea id="mem-value" class="input-field" rows="3" placeholder="${sanitize(translations['profile.memory.valuePlaceholder'] || 'The value to store...')}"></textarea></div>
        <div class="form-row"><label>${sanitize(translations['profile.memory.visLabel'] || 'Visibility')}</label><select id="mem-vis" class="input-field"><option value="private">${sanitize(translations['profile.memory.visPrivate'] || 'Private')}</option><option value="shared">${sanitize(translations['profile.memory.visShared'] || 'Shared')}</option><option value="public">${sanitize(translations['profile.memory.visPublic'] || 'Public')}</option></select></div>
        <div class="form-row"><label>${sanitize(translations['profile.memory.tagsLabel'] || 'Tags')}</label><input type="text" id="mem-tags" class="input-field" placeholder="${sanitize(translations['profile.memory.tagsPlaceholder'] || 'tag1, tag2 (optional)')}"></div>
        <div class="form-actions"><button class="btn-primary" onclick="createMemory()">${sanitize(translations['profile.memory.saveBtn'] || 'Save')}</button><button class="btn-outline" onclick="toggleMemoryForm()">${sanitize(translations['profile.memory.cancelBtn'] || 'Cancel')}</button></div>
      </div>
      <div id="memory-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.memory.loading'] || 'Loading memories...')}</span></div>
    </div>
    <div class="sub-panel" id="subpanel-memory-files">
      <div class="action-bar">
        <button class="btn-primary" onclick="toggleFileForm()">${sanitize(translations['profile.files.uploadBtn'] || '+ Upload File')}</button>
        <span class="muted-text" style="font-size:.75rem;color:var(--muted)">${sanitize(translations['profile.files.sizeLimit'] || 'Max 10MB per file')}</span>
      </div>
      <div class="create-form" id="file-form" style="display:none">
        <div class="form-row"><label>${sanitize(translations['profile.files.keyLabel'] || 'File Name')} <span style="font-weight:normal;font-size:.75rem;color:var(--muted)">${sanitize(translations['profile.files.nameNote'] || '(must be unique per user)')}</span></label><input type="text" id="file-key" class="input-field" placeholder="${sanitize(translations['profile.files.keyPlaceholder'] || 'document.pdf')}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.files.fileLabel'] || 'File')}</label><input type="file" id="file-input" class="input-field" onchange="if(this.files[0]&&!document.getElementById('file-key').value){document.getElementById('file-key').value=this.files[0].name}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.files.visLabel'] || 'Visibility')}</label><select id="file-vis" class="input-field"><option value="private">${sanitize(translations['profile.files.visPrivate'] || 'Private')}</option><option value="owner">${sanitize(translations['profile.files.visOwner'] || 'Owner')}</option><option value="public">${sanitize(translations['profile.files.visPublic'] || 'Public')}</option></select></div>
        <div class="form-actions"><button class="btn-primary" onclick="uploadFile()">${sanitize(translations['profile.files.uploadSaveBtn'] || 'Upload')}</button><button class="btn-outline" onclick="toggleFileForm()">${sanitize(translations['profile.files.cancelBtn'] || 'Cancel')}</button></div>
      </div>
      <div id="files-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.files.loading'] || 'Loading files...')}</span></div>
    </div>
  </div>

  <!-- ═══ WORK ═══ -->
  <div class="tab-panel" id="panel-work">
    <div class="section-title">${sanitize(translations['profile.work.title'] || 'Work History')}</div>
    <div class="section-desc">${sanitize(translations['profile.work.desc'] || '')}</div>
    <div class="sub-tabs" id="work-sub-tabs">
      <button class="sub-tab active" data-subtab="work-inbox">${sanitize(translations['profile.work.inbox'] || 'Inbox')}</button>
      <button class="sub-tab" data-subtab="work-sent">${sanitize(translations['profile.work.sent'] || 'Sent')}</button>
    </div>
    <div class="sub-panel active" id="subpanel-work-inbox">
      <div id="work-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.work.loading'] || 'Loading work items...')}</span></div>
    </div>
    <div class="sub-panel" id="subpanel-work-sent">
      <div id="work-sent-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.work.loading'] || 'Loading work items...')}</span></div>
    </div>
  </div>

  <!-- ═══ SERVICES ═══ -->
  <div class="tab-panel" id="panel-actions">
    <div class="section-title">${sanitize(translations['profile.services.title'] || 'Services')}</div>
    <div class="section-desc">${sanitize(translations['profile.services.desc'] || '')}</div>
    <div class="sub-tabs" id="services-sub-tabs">
      <button class="sub-tab active" data-subtab="services-mine">${sanitize(translations['profile.services.mine'] || 'My Services')}</button>
      <button class="sub-tab" data-subtab="services-catalogue">${sanitize(translations['profile.services.catalogue'] || 'Catalogue')}</button>
    </div>
    <div class="sub-panel active" id="subpanel-services-mine">
      <button class="btn-primary" onclick="togglePublishForm()" style="margin-bottom:1rem">${sanitize(translations['profile.services.publishBtn'] || '+ Publish Service')}</button>
      <div class="create-form" id="publish-form" style="display:none">
        <div class="form-row"><label>${sanitize(translations['profile.services.nameLabel'] || 'Display Name')}</label><input type="text" id="svc-name" class="input-field" placeholder="${sanitize(translations['profile.services.namePlaceholder'] || 'My Translation Service')}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.services.descLabel'] || 'Description')}</label><textarea id="svc-desc" class="input-field" rows="3" placeholder="${sanitize(translations['profile.services.descPlaceholder'] || 'What this service does...')}"></textarea></div>
        <div class="form-row"><label>${sanitize(translations['profile.services.categoryLabel'] || 'Category')}</label><select id="svc-category" class="input-field"><option value="language">Language</option><option value="translation">Translation</option><option value="analysis">Analysis</option><option value="generation">Generation</option><option value="coding">Coding</option><option value="data">Data</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option><option value="search">Search</option><option value="utility">Utility</option><option value="other">Other</option></select></div>
        <div class="form-row"><label>${sanitize(translations['profile.services.priceLabel'] || 'Price (morsels)')}</label><input type="number" id="svc-price" class="input-field" value="0" min="0"></div>
        <div class="form-row"><label>${sanitize(translations['profile.services.unitLabel'] || 'Unit')}</label><select id="svc-unit" class="input-field"><option value="call">Per call</option><option value="minute">Per minute</option><option value="token">Per token</option><option value="task">Per task</option></select></div>
        <div class="form-row"><label>${sanitize(translations['profile.services.webhookLabel'] || 'Webhook URL (optional)')}</label><input type="text" id="svc-webhook" class="input-field" placeholder="${sanitize(translations['profile.services.webhookPlaceholder'] || 'https://...')}"></div>
        <div class="form-actions"><button class="btn-primary" onclick="publishService()">${sanitize(translations['profile.services.publishSaveBtn'] || 'Publish')}</button><button class="btn-outline" onclick="togglePublishForm()">${sanitize(translations['profile.cancel'] || 'Cancel')}</button></div>
      </div>
      <div id="actions-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.services.loading'] || 'Loading services...')}</span></div>
    </div>
    <div class="sub-panel" id="subpanel-services-catalogue">
      <div class="action-bar"><select id="cat-filter" class="input-field" style="max-width:200px" onchange="loadCatalogue()"><option value="">${sanitize(translations['profile.services.allCategories'] || 'All Categories')}</option><option value="language">Language</option><option value="translation">Translation</option><option value="analysis">Analysis</option><option value="generation">Generation</option><option value="coding">Coding</option><option value="data">Data</option><option value="image">Image</option><option value="audio">Audio</option><option value="video">Video</option><option value="search">Search</option><option value="utility">Utility</option><option value="other">Other</option></select></div>
      <div id="catalogue-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.services.loading'] || 'Loading services...')}</span></div>
    </div>
  </div>

  <!-- ═══ BOARDS ═══ -->
  <div class="tab-panel" id="panel-boards">
    <div class="section-title">${sanitize(translations['profile.boards.title'] || 'Boards')}</div>
    <div class="section-desc">${sanitize(translations['profile.boards.desc'] || '')}</div>
    <div class="sub-tabs" id="boards-sub-tabs">
      <button class="sub-tab active" data-subtab="boards-mine">${sanitize(translations['profile.boards.mine'] || 'My Boards')}</button>
      <button class="sub-tab" data-subtab="boards-browse">${sanitize(translations['profile.boards.browse'] || 'Browse All')}</button>
    </div>
    <div class="sub-panel active" id="subpanel-boards-mine">
      <button class="btn-primary" onclick="toggleBoardForm()" style="margin-bottom:1rem">${sanitize(translations['profile.boards.createBtn'] || '+ Create Board')}</button>
      <div class="create-form" id="board-create-form" style="display:none">
        <div class="form-row"><label>${sanitize(translations['profile.boards.nameLabel'] || 'Board Name')}</label><input type="text" id="board-name" class="input-field" placeholder="${sanitize(translations['profile.boards.namePlaceholder'] || 'My Discussion Board')}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.boards.descLabel'] || 'Description')}</label><input type="text" id="board-desc" class="input-field" placeholder="${sanitize(translations['profile.boards.descPlaceholder'] || 'What this board is about...')}"></div>
        <div class="form-row"><label>${sanitize(translations['profile.boards.visLabel'] || 'Visibility')}</label><select id="board-vis" class="input-field"><option value="private">${sanitize(translations['profile.boards.visPrivate'] || 'Private')}</option><option value="public">${sanitize(translations['profile.boards.visPublic'] || 'Public (operators only)')}</option></select></div>
        <div class="form-actions"><button class="btn-primary" onclick="createBoard()">${sanitize(translations['profile.boards.createSaveBtn'] || 'Create')}</button><button class="btn-outline" onclick="toggleBoardForm()">${sanitize(translations['profile.cancel'] || 'Cancel')}</button></div>
      </div>
      <div id="boards-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.boards.loading'] || 'Loading boards...')}</span></div>
    </div>
    <div class="sub-panel" id="subpanel-boards-browse">
      <div id="boards-browse-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.boards.browseLoading'] || 'Loading boards...')}</span></div>
    </div>
  </div>

  <!-- ═══ APPS ═══ -->
  <div class="tab-panel" id="panel-apps">
    <div class="section-title">${sanitize(translations['profile.apps.title'] || 'Apps')}</div>
    <div class="section-desc">${sanitize(translations['profile.apps.desc'] || '')}</div>
    <div class="sub-tabs" id="apps-sub-tabs">
      <button class="sub-tab active" data-subtab="apps-mine">${sanitize(translations['profile.apps.mine'] || 'My Apps')}</button>
      <button class="sub-tab" data-subtab="apps-gallery">${sanitize(translations['profile.apps.gallery'] || 'All Apps')}</button>
    </div>
    <div class="sub-panel active" id="subpanel-apps-mine">
      <div style="background:linear-gradient(135deg, rgba(251,191,36,.1), rgba(245,158,11,.05));border:1px solid rgba(251,191,36,.3);border-radius:var(--radius);padding:1.25rem;margin-bottom:1.25rem">
        <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem">
          <span style="font-size:1.3rem">\ud83d\ude80</span>
          <span style="font-weight:700;font-size:1rem;color:#fbbf24">${sanitize(translations['profile.apps.launcherTitle'] || 'App Launcher')}</span>
        </div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${sanitize(translations['profile.apps.launcherDesc'] || 'Manage all your apps in one place. Pin favorites, search by tags, publish to your node.')}</div>
        <a href="/app-catalog.html" class="btn-primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:.4rem;background:linear-gradient(135deg,#f59e0b,#d97706)">\ud83d\ude80 ${sanitize(translations['profile.apps.launcherOpen'] || 'Open App Catalog')}</a>
      </div>
      <div class="app-create-guide" style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1.25rem">
        <div style="font-weight:700;font-size:1rem;margin-bottom:.5rem;color:var(--love1)">${sanitize(translations['profile.apps.createGuide'] || 'Create a New App')}</div>
        <div style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${sanitize(translations['profile.apps.createGuideDesc'] || '')}</div>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
          <a href="/v1/aimeat-os.md" download class="btn-primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:.4rem">\ud83d\udcd6 ${sanitize(translations['profile.apps.downloadGuide'] || 'Download AIMEAT-OS.md')}</a>
          <button class="btn-outline" onclick="copyAppPrompt()">\ud83d\udccb ${sanitize(translations['profile.apps.copyPrompt'] || 'Copy App Creation Prompt')}</button>
        </div>
        <div style="font-size:.75rem;color:var(--muted)">${sanitize(translations['profile.apps.guideDesc'] || '')}</div>
      </div>
      <button class="btn-primary" onclick="toggleUploadForm()" style="margin-bottom:1rem">${sanitize(translations['profile.apps.uploadBtn'] || '+ Add New App')}</button>
      <div class="create-form" id="upload-form" style="display:none">
        <div class="form-row"><label>${sanitize(translations['profile.apps.fileLabel'] || 'HTML File')}</label><div class="file-input-wrap"><label class="file-label" id="app-file-label">${sanitize(translations['profile.apps.filePlaceholder'] || 'Choose HTML file...')}<input type="file" id="app-file" accept=".html,.htm" onchange="this.parentElement.querySelector('.file-label')&&(document.getElementById('app-file-label').textContent=this.files[0]?this.files[0].name:'${sanitize(translations['profile.apps.filePlaceholder'] || 'Choose HTML file...')}')"></label></div></div>
        <div class="form-row"><label>${sanitize(translations['profile.apps.screenshotLabel'] || 'Screenshot (optional)')}</label><div class="file-input-wrap"><label class="file-label" id="app-ss-label">${sanitize(translations['profile.apps.screenshotPlaceholder'] || 'Choose screenshot...')}<input type="file" id="app-screenshot" accept="image/*" onchange="document.getElementById('app-ss-label').textContent=this.files[0]?this.files[0].name:'${sanitize(translations['profile.apps.screenshotPlaceholder'] || 'Choose screenshot...')}'"></label></div></div>
        <div class="form-row"><label>${sanitize(translations['profile.apps.accessCodeLabel'] || 'Access Code (optional)')}</label><input type="text" id="app-access-code" class="input-field" placeholder="${sanitize(translations['profile.apps.accessCodePlaceholder'] || 'Leave empty for public')}"></div>
        <div class="form-actions"><button class="btn-primary" onclick="uploadApp()">${sanitize(translations['profile.apps.uploadSaveBtn'] || 'Send')}</button><button class="btn-outline" onclick="toggleUploadForm()">${sanitize(translations['profile.cancel'] || 'Cancel')}</button></div>
      </div>
      <div id="apps-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.apps.loading'] || 'Loading apps...')}</span></div>
    </div>
    <div class="sub-panel" id="subpanel-apps-gallery">
      <div id="apps-gallery-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.apps.galleryLoading'] || 'Loading apps...')}</span></div>
    </div>
  </div>

  <!-- ═══ FEDERATION ═══ -->
  <div class="tab-panel" id="panel-federation">
    <div class="section-title">${sanitize(translations['profile.federation.title'] || 'Federation & Peers')}</div>
    <div class="section-desc">${sanitize(translations['profile.federation.desc'] || '')}</div>
    <div id="federation-area"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.federation.loading'] || 'Loading federation info...')}</span></div>
  </div>

  <!-- ═══ PERSONAL NODES ═══ -->
  <div class="tab-panel" id="panel-nodes">
    <div class="section-title">${sanitize(translations['profile.nodes.title'] || 'Personal Nodes')}</div>
    <div class="section-desc">${sanitize(translations['profile.nodes.desc'] || '')}</div>

    <!-- Add Node button -->
    <button class="expand-btn" id="add-node-btn" onclick="toggleAddNodeForm()" style="margin-bottom:1.25rem">${sanitize(translations['profile.nodes.addBtn'] || '+ Add Node')}</button>

    <!-- Add Node form (hidden) -->
    <div id="add-node-form" style="display:none">
      <div class="card" style="border-color:var(--love1);margin-bottom:1.5rem">
        <h3 style="color:var(--love1);margin-bottom:1rem;font-size:1rem">${sanitize(translations['profile.nodes.addTitle'] || 'Register a Personal Node')}</h3>
        <div style="margin-bottom:.75rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.nodeIdLabel'] || 'Node ID')}</label>
          <input id="node-id-input" type="text" placeholder="${sanitize(translations['profile.nodes.nodeIdPlaceholder'] || 'personal-my-laptop')}" style="width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:monospace;font-size:.85rem">
        </div>
        <div style="margin-bottom:.75rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.visLabel'] || 'Visibility')}</label>
          <div style="display:flex;gap:1rem">
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.85rem">
              <input type="radio" name="node-vis" value="private" checked style="accent-color:var(--love1)"> ${sanitize(translations['profile.nodes.private'] || 'Private')}
              <span style="font-size:.75rem;color:var(--muted)">\u2014 ${sanitize(translations['profile.nodes.privateDesc'] || 'Hidden from federation')}</span>
            </label>
            <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;font-size:.85rem">
              <input type="radio" name="node-vis" value="public" style="accent-color:var(--love1)"> ${sanitize(translations['profile.nodes.public'] || 'Public')}
              <span style="font-size:.75rem;color:var(--muted)">\u2014 ${sanitize(translations['profile.nodes.publicDesc'] || 'Discoverable')}</span>
            </label>
          </div>
        </div>
        <div style="margin-bottom:1rem">
          <label style="font-size:.8rem;color:var(--muted);display:block;margin-bottom:.3rem">${sanitize(translations['profile.nodes.agentGaiisLabel'] || 'Agent GAIIs')}</label>
          <input id="node-gaiis-input" type="text" placeholder="${sanitize(translations['profile.nodes.agentGaiisPlaceholder'] || 'bot1#owner, bot2#owner')}" style="width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.85rem">
        </div>
        <div style="display:flex;gap:.75rem">
          <button onclick="registerNode()" style="padding:8px 20px;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:.85rem">${sanitize(translations['profile.nodes.registerBtn'] || 'Register')}</button>
          <button onclick="toggleAddNodeForm()" style="padding:8px 20px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:.85rem">${sanitize(translations['profile.nodes.cancelBtn'] || 'Cancel')}</button>
        </div>
      </div>
    </div>

    <div id="nodes-list"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.nodes.loading'] || 'Loading...')}</span></div>
  </div>

  <!-- ═══ ACCESS ═══ -->
  <div class="tab-panel" id="panel-access">
    <div class="section-title">${sanitize(translations['profile.access.title'] || 'Access Codes & Tokens')}</div>
    <div class="section-desc">${sanitize(translations['profile.access.desc'] || '')}</div>
    <div id="access-area"><span class="spinner"></span><span class="loading-text">${sanitize(translations['profile.access.loading'] || 'Loading access info...')}</span></div>
  </div>
</div>

<script>
var NODE_URL = ${JSON.stringify(config.baseUrl)};
${PROFILE_JS_CORE}
${PROFILE_JS_TABS}
</script>
</body>
</html>`;
}

export function profileRouter(config: AimeatConfig, _storage: Storage): Router {
  const router = Router();

  router.get('/v1/profile', (req, res) => {
    const langParam = req.query.lang as string | undefined;
    const locale = resolveLocale(langParam, req.headers.cookie, req.headers['accept-language']);
    if (langParam) res.cookie('aimeat-lang', locale, { maxAge: 365 * 24 * 60 * 60 * 1000, path: '/', sameSite: 'lax' });
    const translations = buildProfileTranslations(locale);
    res.type('text/html').send(profileHtml(config, locale, translations));
  });

  return router;
}
