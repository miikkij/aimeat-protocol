import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';

// === Scope Management Constants ===
const SCOPE_DOMAINS = [
  { key: 'memory',    permissions: ['read', 'write', 'delete'] },
  { key: 'work',      permissions: ['request', 'read', 'accept', 'publish'] },
  { key: 'social',    permissions: ['read', 'write'] },
  { key: 'wallet',    permissions: ['read'] },
  { key: 'consent',   permissions: ['manage'] },
  { key: 'tunnel',    permissions: ['connect'] },
  { key: 'agent',     permissions: ['register'] },
  { key: 'catalogue', permissions: ['read'] },
];

const SCOPE_TEMPLATES = {
  readonly:  ['memory:read', 'catalogue:read', 'social:read'],
  standard:  ['memory:read', 'memory:write', 'catalogue:read', 'social:read', 'work:request', 'work:read'],
  full:      ['*'],
};

function detectTemplate(scopes) {
  if (!scopes || scopes.length === 0) return 'full';
  if (scopes.includes('*')) return 'full';
  const sorted = [...scopes].sort();
  for (const [name, tpl] of Object.entries(SCOPE_TEMPLATES)) {
    if (name === 'full') continue;
    const tplSorted = [...tpl].sort();
    if (sorted.length === tplSorted.length && sorted.every((s, i) => s === tplSorted[i])) return name;
  }
  return 'custom';
}

function templateLabel(name) {
  const map = { readonly: 'readOnly', standard: 'standard', full: 'fullAccess', custom: 'custom' };
  return t(`profile.agents.scopeUi.${map[name] || 'custom'}`);
}

function domainLabel(domain) {
  const cap = domain.charAt(0).toUpperCase() + domain.slice(1);
  return t(`profile.agents.scopeUi.domain${cap}`);
}

function permLabel(perm) {
  const cap = perm.charAt(0).toUpperCase() + perm.slice(1);
  return t(`profile.agents.scopeUi.perm${cap}`);
}

/* ── CSS (scoped under .pf) ── */
const PROFILE_CSS = `
.pf{max-width:1000px;margin:0 auto;padding:2rem 1.5rem;position:relative;z-index:1}
.pf .bg-aurora{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.pf .aurora-wave{position:absolute;width:200%;height:60%;left:-50%;border-radius:50%;filter:blur(80px);opacity:.25;animation:pfAurora 8s ease-in-out infinite alternate}
.pf .aurora-wave:nth-child(1){top:10%;background:linear-gradient(90deg,#ff6b9d,#c44569,#ff8a80,#f48fb1);animation-duration:8s}
.pf .aurora-wave:nth-child(2){top:35%;background:linear-gradient(90deg,#f48fb1,#880e4f,#ff6b9d,#e91e63);animation-duration:12s;animation-delay:-4s}
.pf .aurora-wave:nth-child(3){top:60%;background:linear-gradient(90deg,#ad1457,#ff6b9d,#f06292,#880e4f);animation-duration:10s;animation-delay:-2s}
@keyframes pfAurora{0%{transform:translateX(-20%) scaleY(1)}50%{transform:translateX(10%) scaleY(1.3)}100%{transform:translateX(-10%) scaleY(.8)}}
.pf .login-prompt{text-align:center;padding:4rem 2rem}
.pf .login-prompt h1{font-size:2rem;margin-bottom:1rem}
.pf .login-prompt p{color:var(--muted,#c4a6d0);margin-bottom:2rem;font-size:1.1rem}
.pf .profile-header{display:flex;align-items:center;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap}
.pf .avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--love1,#ff6b9d),var(--love2,#c44569));display:flex;align-items:center;justify-content:center;font-size:2.2rem;flex-shrink:0;box-shadow:0 0 24px rgba(255,107,157,.3)}
.pf .profile-info h1{font-size:1.6rem;font-weight:700;margin-bottom:.2rem}
.pf .profile-info .ghii{color:var(--love1,#ff6b9d);font-family:monospace;font-size:.9rem}
.pf .profile-info .meta{color:var(--muted,#c4a6d0);font-size:.85rem;margin-top:.3rem}
.pf .stats-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin-bottom:2rem}
.pf .stat-card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1rem;text-align:center}
.pf .stat-card .num{font-size:1.6rem;font-weight:700;color:var(--love1,#ff6b9d)}
.pf .stat-card .label{font-size:.75rem;color:var(--muted,#c4a6d0);text-transform:uppercase;letter-spacing:.05em;margin-top:.2rem}
.pf .tabs{display:flex;gap:.25rem;border-bottom:2px solid var(--border,rgba(255,107,157,.25));margin-bottom:1.5rem;flex-wrap:wrap}
.pf .tab{padding:.6rem 1.2rem;cursor:pointer;color:var(--muted,#c4a6d0);font-weight:600;font-size:.9rem;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s;background:none}
.pf .tab:hover{color:var(--text,#f0e6f6)}
.pf .tab.active{color:var(--love1,#ff6b9d);border-bottom-color:var(--love1,#ff6b9d)}
.pf .section-title{font-size:1.15rem;font-weight:600;margin-bottom:.4rem;color:var(--love1,#ff6b9d)}
.pf .section-desc{color:var(--muted,#c4a6d0);font-size:.85rem;margin-bottom:1.25rem;line-height:1.5;max-width:700px}
.pf .card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1.25rem;margin-bottom:.75rem;transition:border-color .2s}
.pf .card:hover{border-color:var(--love1,#ff6b9d)}
.pf .card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.pf .card-title{font-weight:600;font-size:1rem}
.pf .card-subtitle{color:var(--muted,#c4a6d0);font-size:.8rem}
.pf .badge{display:inline-block;padding:.15rem .5rem;border-radius:6px;font-size:.7rem;font-weight:700;letter-spacing:.03em}
.pf .badge-success{background:rgba(34,197,94,.15);color:var(--success,#22c55e)}
.pf .badge-warn{background:rgba(245,158,11,.15);color:var(--warn,#f59e0b)}
.pf .badge-info{background:rgba(255,107,157,.15);color:var(--love1,#ff6b9d)}
.pf .badge-danger{background:rgba(239,68,68,.15);color:var(--danger,#ef4444)}
.pf .badge-muted{background:rgba(196,166,208,.1);color:var(--muted,#c4a6d0)}
.pf .agent-card .gaii{font-family:monospace;font-size:.8rem;color:var(--muted,#c4a6d0)}
.pf .agent-card .caps{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem}
.pf .agent-card .caps .cap{font-size:.7rem;background:rgba(255,107,157,.1);color:var(--love4,#f48fb1);padding:.15rem .4rem;border-radius:4px}
.pf .wallet-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-bottom:1.5rem}
.pf .wallet-card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1rem;text-align:center}
.pf .wallet-card .amount{font-size:1.4rem;font-weight:700}
.pf .wallet-card .amount.positive{color:var(--success,#22c55e)}
.pf .wallet-card .amount.neutral{color:var(--love1,#ff6b9d)}
.pf .wallet-card .wlabel{font-size:.75rem;color:var(--muted,#c4a6d0);text-transform:uppercase;margin-top:.2rem}
.pf .tx-list{max-height:400px;overflow-y:auto}
.pf .tx-item{display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem}
.pf .tx-item:last-child{border-bottom:none}
.pf .tx-amount{font-weight:600;font-family:monospace}
.pf .tx-amount.credit{color:var(--success,#22c55e)}
.pf .tx-amount.debit{color:var(--danger,#ef4444)}
.pf .tx-type{font-size:.75rem;color:var(--muted,#c4a6d0)}
.pf .tx-date{font-size:.75rem;color:var(--muted,#c4a6d0)}
.pf .mem-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem;cursor:pointer}
.pf .mem-item:hover{background:rgba(255,107,157,.05)}
.pf .mem-key{font-family:monospace;color:var(--love3,#ff8a80);font-weight:500}
.pf .mem-vis{font-size:.7rem}
.pf .mem-detail{background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1rem;margin-top:.5rem;font-size:.85rem}
.pf .mem-detail pre{white-space:pre-wrap;word-break:break-all;font-family:monospace;color:var(--text,#f0e6f6);font-size:.8rem}
.pf .mem-detail .mem-actions{display:flex;gap:.5rem;margin-top:.75rem}
.pf .peer-card{display:flex;justify-content:space-between;align-items:center}
.pf .peer-status{display:flex;align-items:center;gap:.4rem}
.pf .peer-dot{width:8px;height:8px;border-radius:50%}
.pf .peer-dot.alive{background:var(--success,#22c55e)}
.pf .peer-dot.dead{background:var(--danger,#ef4444)}
.pf .pn-card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);margin-bottom:.75rem;transition:border-color .2s;overflow:hidden}
.pf .pn-card:hover{border-color:var(--love1,#ff6b9d)}
.pf .pn-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;cursor:pointer;user-select:none}
.pf .pn-header-left{display:flex;align-items:center;gap:.75rem}
.pf .pn-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.pf .pn-status-dot.online{background:var(--success,#22c55e);box-shadow:0 0 6px rgba(34,197,94,.4)}
.pf .pn-status-dot.offline{background:var(--danger,#ef4444)}
.pf .pn-status-dot.degraded{background:var(--warn,#f59e0b)}
.pf .pn-status-dot.detached{background:var(--muted,#c4a6d0)}
.pf .pn-name{font-weight:600;font-family:monospace;font-size:.9rem}
.pf .pn-badges{display:flex;gap:.4rem;align-items:center}
.pf .pn-quick{font-size:.8rem;color:var(--muted,#c4a6d0);padding:0 1.25rem .75rem}
.pf .pn-arrow{color:var(--muted,#c4a6d0);font-size:.8rem;transition:transform .2s;display:inline-block}
.pf .pn-arrow.open{transform:rotate(180deg)}
.pf .pn-details{display:none;padding:0 1.25rem 1.25rem;border-top:1px solid rgba(255,107,157,.08)}
.pf .pn-details.open{display:block}
.pf .pn-detail-row{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.06);font-size:.85rem}
.pf .pn-detail-row:last-child{border-bottom:none}
.pf .pn-detail-label{color:var(--muted,#c4a6d0);font-size:.8rem}
.pf .pn-detail-value{font-family:monospace;font-size:.8rem;color:var(--text,#f0e6f6);word-break:break-all}
.pf .pn-agent-list{display:flex;flex-direction:column;gap:.3rem;margin:.5rem 0}
.pf .pn-agent-item{font-family:monospace;font-size:.8rem;color:var(--love3,#ff8a80);padding:.2rem .5rem;background:rgba(255,107,157,.08);border-radius:4px}
.pf .pn-vis-toggle{display:flex;gap:2px;border-radius:6px;overflow:hidden;border:1px solid var(--border,rgba(255,107,157,.25))}
.pf .pn-vis-btn{padding:4px 12px;border:none;cursor:pointer;font-size:.75rem;font-weight:600;background:transparent;color:var(--muted,#c4a6d0);transition:all .2s}
.pf .pn-vis-btn.active{background:var(--love1,#ff6b9d);color:#fff}
.pf .pn-vis-btn:hover:not(.active){color:var(--text,#f0e6f6)}
.pf .pn-setup{display:none;margin-top:.75rem;background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1rem;font-size:.85rem;line-height:1.7}
.pf .pn-setup.open{display:block}
.pf .pn-setup ol{margin-left:1.5rem;margin-bottom:.5rem}
.pf .pn-setup li{margin-bottom:.3rem;color:var(--muted,#c4a6d0)}
.pf .pn-detach-btn{margin-top:.75rem;padding:6px 16px;background:transparent;color:var(--danger,#ef4444);border:1px solid var(--danger,#ef4444);border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s}
.pf .pn-detach-btn:hover{background:rgba(239,68,68,.15)}
.pf .agent-cta{background:linear-gradient(135deg,rgba(30,20,40,.95),rgba(50,20,50,.9));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1.5rem;margin-bottom:1.5rem}
.pf .agent-cta h3{color:var(--love1,#ff6b9d);margin-bottom:.5rem;font-size:1.05rem}
.pf .agent-cta p{font-size:.9rem;color:var(--muted,#c4a6d0);margin-bottom:.75rem}
.pf .agent-prompt-box{position:relative;background:rgba(15,10,20,.8);border:1px solid rgba(255,107,157,.15);border-radius:8px;padding:1rem;font-family:monospace;font-size:.8rem;color:var(--text,#f0e6f6);white-space:pre-wrap;word-break:break-all;line-height:1.5;margin-bottom:1rem;max-height:300px;overflow-y:auto}
.pf .copy-prompt-btn{background:var(--love2,#c44569);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s}
.pf .copy-prompt-btn:hover{background:var(--love1,#ff6b9d)}
.pf .expand-btn{background:none;border:1px solid var(--border,rgba(255,107,157,.25));color:var(--love4,#f48fb1);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
.pf .expand-btn:hover{border-color:var(--love1,#ff6b9d);color:var(--love1,#ff6b9d)}
.pf .platform-instructions{display:none;margin-top:1rem}
.pf .platform-instructions.expanded{display:block}
.pf .platform-tabs{display:flex;gap:.25rem;flex-wrap:wrap;margin-bottom:1rem}
.pf .platform-tab{padding:.5rem 1rem;background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:8px;cursor:pointer;color:var(--muted,#c4a6d0);font-size:.8rem;font-weight:600;transition:all .2s}
.pf .platform-tab:hover{color:var(--text,#f0e6f6);border-color:var(--love4,#f48fb1)}
.pf .platform-tab.active{color:var(--love1,#ff6b9d);border-color:var(--love1,#ff6b9d);background:rgba(255,107,157,.1)}
.pf .platform-content{background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1.25rem;font-size:.85rem;line-height:1.7}
.pf .platform-content ol{margin-left:1.5rem;margin-bottom:.75rem}
.pf .platform-content li{margin-bottom:.4rem}
.pf .platform-content code{background:rgba(255,107,157,.1);padding:1px 5px;border-radius:3px;font-size:.8rem;color:var(--love3,#ff8a80)}
.pf .empty{text-align:center;padding:2rem;color:var(--muted,#c4a6d0);font-size:.9rem}
.pf .spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border,rgba(255,107,157,.25));border-top-color:var(--love1,#ff6b9d);border-radius:50%;animation:pfSpin .6s linear infinite;margin-right:.5rem;vertical-align:middle}
@keyframes pfSpin{to{transform:rotate(360deg)}}
.pf .loading-text{color:var(--muted,#c4a6d0);font-size:.9rem}
.pf .sub-tabs{display:flex;gap:.25rem;margin-bottom:1rem}
.pf .sub-tab{padding:.4rem .8rem;cursor:pointer;color:var(--muted,#c4a6d0);font-weight:600;font-size:.8rem;background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:6px;transition:all .2s}
.pf .sub-tab:hover{color:var(--text,#f0e6f6)}
.pf .sub-tab.active{color:var(--love1,#ff6b9d);border-color:var(--love1,#ff6b9d);background:rgba(255,107,157,.1)}
.pf .action-bar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap}
.pf .search-bar{display:flex;gap:.5rem;flex:1;max-width:500px}
.pf .input-field{width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border,rgba(255,107,157,.25));border-radius:6px;color:var(--text,#f0e6f6);font-size:.85rem;font-family:inherit}
.pf .input-field:focus{outline:none;border-color:var(--love1,#ff6b9d)}
.pf select.input-field{cursor:pointer}
.pf textarea.input-field{resize:vertical;min-height:60px}
.pf .create-form{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1.25rem;margin-bottom:1rem}
.pf .form-row{margin-bottom:.75rem}
.pf .form-row label{display:block;font-size:.8rem;color:var(--muted,#c4a6d0);margin-bottom:.3rem;font-weight:600}
.pf .form-actions{display:flex;gap:.5rem;margin-top:1rem}
.pf .btn-primary{background:linear-gradient(135deg,var(--love1,#ff6b9d),var(--love2,#c44569));color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s}
.pf .btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(255,107,157,.3)}
.pf .btn-sm{padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;background:var(--love2,#c44569);color:#fff;border:none;transition:all .2s}
.pf .btn-sm:hover{background:var(--love1,#ff6b9d)}
.pf .btn-outline{padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;background:transparent;color:var(--muted,#c4a6d0);border:1px solid var(--border,rgba(255,107,157,.25));transition:all .2s}
.pf .btn-outline:hover{color:var(--text,#f0e6f6);border-color:var(--love4,#f48fb1)}
.pf .btn-danger{background:var(--danger,#ef4444);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.8rem;font-weight:600}
.pf .btn-danger:hover{opacity:.8}
.pf .app-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
.pf .app-card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);overflow:hidden;transition:all .2s}
.pf .app-card:hover{border-color:var(--love1,#ff6b9d);transform:translateY(-2px)}
.pf .app-screenshot{width:100%;height:180px;object-fit:cover;background:rgba(15,10,20,.6);display:flex;align-items:center;justify-content:center}
.pf .app-screenshot img{width:100%;height:100%;object-fit:cover}
.pf .app-screenshot .placeholder{color:var(--muted,#c4a6d0);font-size:2rem}
.pf .app-info{padding:1rem}
.pf .app-info .app-name{font-weight:600;font-size:.95rem;margin-bottom:.3rem}
.pf .app-info .app-meta{font-size:.75rem;color:var(--muted,#c4a6d0)}
.pf .file-grid{display:flex;flex-direction:column;gap:.5rem}
.pf .file-card{display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);transition:all .2s}
.pf .file-card:hover{border-color:var(--love1,#ff6b9d)}
.pf .file-icon{font-size:1.5rem;min-width:2rem;text-align:center}
.pf .file-info{flex:1;min-width:0}
.pf .file-name{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pf .file-meta{font-size:.75rem;color:var(--muted,#c4a6d0)}
.pf .file-actions{display:flex;gap:.25rem;flex-shrink:0}
.pf .post-card{background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:1rem;margin-bottom:.75rem}
.pf .post-content{font-size:.9rem;margin-bottom:.5rem;line-height:1.5}
.pf .post-meta{font-size:.75rem;color:var(--muted,#c4a6d0);display:flex;justify-content:space-between;align-items:center}
.pf .post-reactions{display:flex;gap:.4rem;margin-top:.5rem}
.pf .reaction-btn{padding:2px 8px;border-radius:12px;border:1px solid var(--border,rgba(255,107,157,.25));background:transparent;cursor:pointer;font-size:.8rem;transition:all .2s}
.pf .reaction-btn:hover{border-color:var(--love1,#ff6b9d);background:rgba(255,107,157,.1)}
.pf .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px)}
.pf .modal{background:var(--bg,#0f0a14);border:1px solid var(--border,rgba(255,107,157,.25));border-radius:var(--radius,12px);padding:2rem;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}
.pf .modal h3{color:var(--love1,#ff6b9d);margin-bottom:1rem}
.pf .toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:var(--success,#22c55e);color:#fff;padding:.75rem 1.5rem;border-radius:8px;font-weight:600;font-size:.85rem;z-index:2000;animation:pfToastIn .3s ease,pfToastOut .3s ease 2.5s forwards}
.pf .toast.error{background:var(--danger,#ef4444)}
@keyframes pfToastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes pfToastOut{from{opacity:1}to{opacity:0}}
.pf .star-rating{display:flex;gap:.25rem}
.pf .star{font-size:1.5rem;cursor:pointer;color:var(--muted,#c4a6d0);transition:color .15s}
.pf .star:hover,.pf .star.active{color:var(--warn,#f59e0b)}
.pf .audit-day-btn{padding:.4rem .8rem;cursor:pointer;color:var(--muted,#c4a6d0);font-weight:600;font-size:.8rem;background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:6px;transition:all .2s}
.pf .audit-day-btn:hover{color:var(--text,#f0e6f6)}
.pf .audit-day-btn.active{color:var(--love1,#ff6b9d);border-color:var(--love1,#ff6b9d);background:rgba(255,107,157,.1)}
.pf .consent-table,.pf .audit-table{width:100%;border-collapse:collapse;font-size:.85rem}
.pf .consent-table th,.pf .audit-table th{text-align:left;padding:.5rem .6rem;color:var(--muted,#c4a6d0);font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border,rgba(255,107,157,.25))}
.pf .consent-table td,.pf .audit-table td{padding:.5rem .6rem;border-bottom:1px solid rgba(255,107,157,.06)}
.pf .consent-table tr:hover,.pf .audit-table tr:hover{background:rgba(255,107,157,.04)}
.pf .revoke-btn{padding:4px 10px;border-radius:6px;border:1px solid var(--danger,#ef4444);background:transparent;color:var(--danger,#ef4444);cursor:pointer;font-size:.75rem;font-weight:600;transition:all .2s}
.pf .revoke-btn:hover{background:rgba(239,68,68,.15)}
@media(max-width:600px){
  .pf .profile-header{flex-direction:column;text-align:center}
  .pf .stats-bar{grid-template-columns:repeat(2,1fr)}
  .pf .wallet-overview{grid-template-columns:repeat(2,1fr)}
  .pf .action-bar{flex-direction:column;align-items:stretch}
  .pf .search-bar{max-width:100%}
  .pf .app-grid{grid-template-columns:1fr}
  .pf .consent-table,.pf .audit-table{font-size:.75rem}
  .pf .consent-table th,.pf .consent-table td,.pf .audit-table th,.pf .audit-table td{padding:.4rem}
}
/* === Scope Management UI === */
.pf .scope-summary {display:flex;align-items:center;gap:.5rem;margin-top:.65rem;padding-top:.5rem;border-top:1px solid rgba(255,107,157,.1);font-size:.8rem}
.pf .scope-summary .scope-badge {background:rgba(255,107,157,.12);color:var(--love4,#f48fb1);padding:.15rem .5rem;border-radius:5px;font-weight:600;font-size:.72rem}
.pf .scope-summary .scope-count {color:var(--muted,#c4a6d0);font-size:.78rem}
.pf .scope-summary .scope-manage-btn {margin-left:auto;background:none;border:1px solid var(--border,rgba(255,107,157,.25));color:var(--love4,#f48fb1);border-radius:6px;padding:3px 10px;cursor:pointer;font-size:.72rem;font-weight:600;transition:all .2s}
.pf .scope-summary .scope-manage-btn:hover {border-color:var(--love1,#ff6b9d);color:var(--love1,#ff6b9d)}
.pf .scope-readonly-list {display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem}
.pf .scope-readonly-list .scope-tag {font-size:.68rem;background:rgba(255,107,157,.08);color:var(--muted,#c4a6d0);padding:.12rem .4rem;border-radius:4px}
.pf .scope-modal {max-width:560px}
.pf .scope-modal h3 {margin-bottom:.25rem}
.pf .scope-modal .scope-agent-info {color:var(--muted,#c4a6d0);font-size:.8rem;margin-bottom:1.25rem;font-family:monospace}
.pf .scope-templates {display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem}
.pf .scope-tpl-btn {flex:1;min-width:100px;padding:.6rem .75rem;background:var(--card,rgba(30,20,40,.85));border:1px solid var(--border,rgba(255,107,157,.25));border-radius:8px;cursor:pointer;color:var(--muted,#c4a6d0);font-size:.8rem;font-weight:600;transition:all .2s;text-align:center}
.pf .scope-tpl-btn:hover {color:var(--text,#f0e6f6);border-color:var(--love4,#f48fb1)}
.pf .scope-tpl-btn.active {color:var(--love1,#ff6b9d);border-color:var(--love1,#ff6b9d);background:rgba(255,107,157,.1)}
.pf .scope-advanced-toggle {background:none;border:1px solid var(--border,rgba(255,107,157,.25));color:var(--love4,#f48fb1);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s;display:inline-flex;align-items:center;gap:6px;margin-bottom:1rem}
.pf .scope-advanced-toggle:hover {border-color:var(--love1,#ff6b9d);color:var(--love1,#ff6b9d)}
.pf .scope-domain {background:rgba(15,10,20,.5);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:.75rem;margin-bottom:.5rem}
.pf .scope-domain-header {display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;cursor:pointer}
.pf .scope-domain-header .domain-label {font-weight:600;font-size:.85rem;color:var(--text,#f0e6f6)}
.pf .scope-domain-header .domain-toggle {font-size:.65rem;color:var(--muted,#c4a6d0)}
.pf .scope-row {display:flex;align-items:center;gap:.6rem;padding:.3rem 0}
.pf .scope-row label {display:flex;align-items:center;gap:.5rem;cursor:pointer;flex:1}
.pf .scope-row input[type="checkbox"] {accent-color:var(--love1,#ff6b9d);width:16px;height:16px;cursor:pointer}
.pf .scope-row .scope-friendly {font-size:.82rem;color:var(--text,#f0e6f6)}
.pf .scope-row .scope-technical {font-size:.7rem;color:var(--muted,#c4a6d0);font-family:monospace}
.pf .scope-row.disabled {opacity:.45;pointer-events:none}
.pf .scope-row .scope-lock {font-size:.7rem;color:var(--muted,#c4a6d0)}
`;

/* ── Auth helpers ── */
function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  if (!s || !s.jwt) return null;
  return s;
}

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

async function apiFetch(path) {
  const s = getSession();
  if (!s?.fetch) return null;
  const resp = await s.fetch(path);
  return resp.json ? await resp.json() : resp;
}

async function publicFetch(path) {
  const resp = await fetch(NODE_URL + path);
  return await resp.json();
}

/* ── Agent prompt builder ── */
function buildAgentPrompt(sess) {
  const ghii = sess.ghii || (sess.owner + '@unknown');
  const url = NODE_URL;
  return `I want you to register a new automation agent on my AIMEAT node.

IMPORTANT: I already have an account. Do NOT create a new owner. Use my existing identity.

My GHII: ${ghii}
My owner name (for API calls): ${sess.owner}
Node URL: ${url}

Steps:
1. First, authenticate as my owner:
   POST ${url}/v1/auth/token
   You need my owner private key to sign (ownerName + nodeId + timestamp) with Ed25519.
   My owner key is stored in my browser (I will provide it if needed).

2. Register a new agent under my account:
   POST ${url}/v1/agents
   Header: Authorization: Bearer <owner_jwt>
   Body: {"name": "<choose-a-name>", "owner": "${sess.owner}", "display_name": "<Your Agent Name>", "description": "<What this agent does>"}
   The new agent will get a GAII in the format: <name>#${ghii}
   SAVE the private_key from the response!

3. Authenticate as the new agent:
   Sign (gaii + timestamp) with the agent's Ed25519 private key
   POST ${url}/v1/auth/token with {"gaii": "<agent-gaii>", "timestamp": "<iso>", "signature": "<sig>"}

4. You're connected! Use the JWT to access:
   GET ${url}/v1/catalogue \u2014 Browse services
   POST ${url}/v1/memory \u2014 Store/retrieve memories
   GET ${url}/v1/wallet \u2014 Check balance
   Full API spec: ${url}/v1/spec
   Operating instructions: ${url}/v1/prompts/tier1`;
}

/* ── Platform instructions data ── */
const PLATFORMS = {
  windows: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<p>Windows requires WSL2. Open PowerShell as Admin:</p>
<ol><li>Install WSL2: <code>wsl --install</code> (restart if prompted)</li>
<li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  mac: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>brew install node</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  linux: `<h4>OpenClaw (Recommended)</h4>
<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \u2014 perfect for AIMEAT.</p>
<ol><li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Alternative: one-liner install</h4>
<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>`,
  wsl2: `<h4>Setup WSL2 (if not already)</h4>
<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>
<li>Restart and set up your Linux username/password</li></ol>
<h4>Install OpenClaw</h4>
<ol><li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>`,
  android: `<h4>Option A: Termux (CLI only)</h4>
<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a> (not Play Store)</li>
<li>Run: <code>pkg update && pkg install nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>Option B: andClaw (on-device with camera/mic)</h4>
<p><a href="https://play.google.com/store/apps/details?id=com.coderred.andclaw" target="_blank">andClaw</a> runs the OpenClaw gateway directly on your phone \u2014 no server needed.</p>
<p><strong>\u26A0\uFE0F Heads up:</strong> This means an AI agent can see through your camera and hear your mic. Only use this if you understand the privacy implications and trust your LLM provider.</p>`,
  aws: `<h4>Quick EC2 Setup</h4>
<ol><li>Launch an EC2 instance (Amazon Linux 2023 or Ubuntu, t3.micro is fine)</li>
<li>SSH in: <code>ssh -i key.pem ec2-user@your-ip</code></li>
<li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs</code></li>
<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>
<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>
<li>Paste the agent prompt above into the OpenClaw session</li></ol>
<h4>For a persistent agent</h4>
<ol><li>Use <code>tmux</code> or <code>screen</code> to keep the session alive</li>
<li>Or set up a systemd service for always-on operation</li></ol>`,
};
const PLATFORM_KEYS = ['windows','mac','linux','wsl2','android','aws'];
const PLATFORM_LABELS = { windows:'profile.platforms.windows', mac:'profile.platforms.mac', linux:'profile.platforms.linux', wsl2:'profile.platforms.wsl2', android:'profile.platforms.android', aws:'profile.platforms.aws' };
const SERVICE_CATEGORIES = ['language','translation','analysis','generation','coding','data','image','audio','video','search','utility','other'];
const TABS = [
  { id:'agents', key:'profile.tabs.agents' },
  { id:'chatsessions', key:'profile.tabs.chatSessions' },
  { id:'wallet', key:'profile.tabs.wallet' },
  { id:'memory', key:'profile.tabs.memory' },
  { id:'work', key:'profile.tabs.work' },
  { id:'actions', key:'profile.tabs.services' },
  { id:'boards', key:'profile.tabs.boards' },
  { id:'apps', key:'profile.tabs.apps' },
  { id:'federation', key:'profile.tabs.federation' },
  { id:'nodes', key:'profile.tabs.nodes' },
  { id:'access', key:'profile.tabs.access' },
  { id:'dataWallet', key:'profile.tabs.dataWallet' },
];

/* ── Loading indicator ── */
function Spinner({ text }) {
  return html`<span class="spinner"></span><span class="loading-text">${text || t('profile.loading')}</span>`;
}

/* ── Main component ── */
export default function Profile({ navigate, locale }) {
  const [session, setSession] = useState(null);
  const [activeTab, setActiveTab] = useState('agents');
  const [stats, setStats] = useState({ agents:'-', chatSessions:'-', balance:'-', memory:'-', services:'-', work:'-', apps:'-', files:'-', nodes:'-' });

  // Tab data
  const [agents, setAgents] = useState(null);
  const [chatSessions, setChatSessions] = useState(null);
  const [walletData, setWalletData] = useState(null);
  const [walletTx, setWalletTx] = useState(null);
  const [memories, setMemories] = useState(null);
  const [files, setFiles] = useState(null);
  const [workInbox, setWorkInbox] = useState(null);
  const [workSent, setWorkSent] = useState(null);
  const [myServices, setMyServices] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [myBoards, setMyBoards] = useState(null);
  const [allBoards, setAllBoards] = useState(null);
  const [boardView, setBoardView] = useState(null); // {id, name, posts}
  const [myApps, setMyApps] = useState(null);
  const [allApps, setAllApps] = useState(null);
  const [federation, setFederation] = useState(null);
  const [nodes, setNodes] = useState(null);
  const [consents, setConsents] = useState(null);
  const [auditEntries, setAuditEntries] = useState(null);
  const [auditDays, setAuditDays] = useState(30);

  // UI state
  const [toast, setToast] = useState(null);
  const [showMemForm, setShowMemForm] = useState(false);
  const [showFileForm, setShowFileForm] = useState(false);
  const [showPubForm, setShowPubForm] = useState(false);
  const [showBrdForm, setShowBrdForm] = useState(false);
  const [showNodeForm, setShowNodeForm] = useState(false);
  const [showAppUpload, setShowAppUpload] = useState(false);
  const [expandedMem, setExpandedMem] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [rateModal, setRateModal] = useState(null);
  const [scopesModal, setScopesModal] = useState(null);
  const [platExpand, setPlatExpand] = useState(false);
  const [activePlat, setActivePlat] = useState('windows');
  const [memSubTab, setMemSubTab] = useState('entries');
  const [workSubTab, setWorkSubTab] = useState('inbox');
  const [svcSubTab, setSvcSubTab] = useState('mine');
  const [brdSubTab, setBrdSubTab] = useState('mine');
  const [catFilter, setCatFilter] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [expandedSetups, setExpandedSetups] = useState(new Set());
  const loadedRef = useRef(new Set());
  const toastTimer = useRef(null);

  // Toast helper
  const showToast = useCallback((msg, isError) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Auth listener
  useEffect(() => {
    const s = getSession();
    if (s) { setSession(s); }
    const handler = () => {
      const ns = getSession();
      setSession(ns);
      if (!ns) {
        loadedRef.current = new Set();
        setActiveTab('agents');
      }
    };
    window.addEventListener('aimeat-auth-change', handler);
    return () => window.removeEventListener('aimeat-auth-change', handler);
  }, []);

  // Load all data when session becomes available
  useEffect(() => {
    if (!session) return;
    loadedRef.current = new Set();
    loadAll();
  }, [session]);

  async function loadAll() {
    if (!session) return;
    const results = await Promise.allSettled([
      loadAgentsData(), loadChatSessionsData(), loadWalletData(),
      loadMemoryData(), loadFilesData(), loadWorkData(),
      loadMyServicesData(), loadAppsData(), loadFederationData(),
      loadNodesData(), loadConsentsData(), loadAuditData(30),
    ]);
    loadedRef.current = new Set(TABS.map(t => t.id));
  }

  // ── Data loaders ──
  async function loadAgentsData() {
    try {
      const data = await apiFetch('/v1/agents');
      const list = data?.data?.agents || data?.data || [];
      const own = list.filter(a => a.owner === session.owner);
      setAgents(own);
      setStats(s => ({ ...s, agents: own.length }));
    } catch { setAgents([]); }
  }

  async function loadChatSessionsData() {
    try {
      const data = await apiFetch('/v1/agents');
      const list = data?.data?.agents || data?.data || [];
      const sessions = list.filter(a => a.owner === session.owner && a.name?.startsWith('session-'));
      setChatSessions(sessions);
      setStats(s => ({ ...s, chatSessions: sessions.length }));
    } catch { setChatSessions([]); }
  }

  async function loadWalletData() {
    try {
      const data = await apiFetch('/v1/wallet');
      const w = data?.data || data || {};
      setWalletData(w);
      setStats(s => ({ ...s, balance: w.balance ?? '-' }));
      // Load transactions
      try {
        const txData = await apiFetch('/v1/wallet/transactions?limit=20');
        setWalletTx(txData?.data?.transactions || txData?.data || []);
      } catch { setWalletTx([]); }
    } catch { setWalletData(null); }
  }

  async function loadMemoryData() {
    try {
      const data = await apiFetch('/v1/memory');
      const list = data?.data?.entries || data?.data || [];
      setMemories(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, memory: Array.isArray(list) ? list.length : 0 }));
    } catch { setMemories([]); }
  }

  async function loadFilesData() {
    try {
      const data = await apiFetch('/v1/memory/files');
      const list = data?.data?.files || data?.data || [];
      setFiles(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, files: Array.isArray(list) ? list.length : 0 }));
    } catch { setFiles([]); }
  }

  async function loadWorkData() {
    try {
      const data = await apiFetch('/v1/work/inbox');
      const list = data?.data?.items || data?.data || [];
      setWorkInbox(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, work: Array.isArray(list) ? list.length : 0 }));
    } catch { setWorkInbox([]); }
    try {
      const data = await apiFetch('/v1/work/sent');
      setWorkSent(data?.data?.items || data?.data || []);
    } catch { setWorkSent([]); }
  }

  async function loadMyServicesData() {
    try {
      const data = await apiFetch('/v1/catalogue?owner=' + encodeURIComponent(session.owner));
      const list = data?.data?.actions || data?.data || [];
      setMyServices(Array.isArray(list) ? list : []);
      setStats(s => ({ ...s, services: Array.isArray(list) ? list.length : 0 }));
    } catch { setMyServices([]); }
  }

  async function loadCatalogueData(cat) {
    try {
      const q = cat ? '?category=' + encodeURIComponent(cat) : '';
      const data = await publicFetch('/v1/catalogue' + q);
      setCatalogue(data?.data?.actions || data?.data || []);
    } catch { setCatalogue([]); }
  }

  async function loadAppsData() {
    try {
      const data = await publicFetch('/v1/apps');
      const list = data?.data?.apps || [];
      const own = list.filter(a => a.owner === session.owner);
      setMyApps(own);
      setAllApps(list);
      setStats(s => ({ ...s, apps: own.length }));
    } catch { setMyApps([]); setAllApps([]); }
  }

  async function loadFederationData() {
    try {
      const data = await publicFetch('/v1/federation/directory');
      setFederation(data?.data?.peers || []);
    } catch { setFederation([]); }
  }

  async function loadNodesData() {
    try {
      const data = await apiFetch('/v1/personal/status');
      const list = [];
      if (data?.data?.node_id) list.push(data.data);
      setNodes(list);
      setStats(s => ({ ...s, nodes: list.length }));
    } catch {
      setNodes([]);
      setStats(s => ({ ...s, nodes: 0 }));
    }
  }

  async function loadConsentsData() {
    try {
      const data = await apiFetch('/v1/consent');
      setConsents(data?.data?.consents || (Array.isArray(data?.data) ? data.data : []));
    } catch { setConsents([]); }
  }

  async function loadAuditData(days) {
    try {
      const data = await apiFetch('/v1/consent/audit?days=' + days);
      setAuditEntries(data?.data?.entries || (Array.isArray(data?.data) ? data.data : []));
    } catch { setAuditEntries([]); }
  }

  // ── CRUD actions ──
  async function createMemory(key, value, visibility, tags) {
    const s = getSession();
    if (!s?.fetch) return;
    const body = { key, value, visibility: visibility || 'private' };
    if (tags) body.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
    const resp = await s.fetch('/v1/memory', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.memory.saved')); setShowMemForm(false); loadMemoryData(); }
    else showToast(t('profile.memory.saveFailed'), true);
  }

  async function deleteMemory(key) {
    if (!confirm(t('profile.memory.deleteConfirm') + ': ' + key + '?')) return;
    const s = getSession();
    await s.fetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.memory.deleted'));
    setExpandedMem(null);
    loadMemoryData();
  }

  async function saveMemoryEdit(key, value) {
    const s = getSession();
    await s.fetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    showToast(t('profile.memory.updated'));
    setEditModal(null);
    loadMemoryData();
  }

  async function searchMemory(query) {
    if (!query) { loadMemoryData(); return; }
    try {
      const data = await apiFetch('/v1/memory/search?q=' + encodeURIComponent(query));
      const list = data?.data?.results || data?.data || [];
      setMemories(Array.isArray(list) ? list : []);
    } catch { showToast(t('profile.memory.searchFailed'), true); }
  }

  async function uploadFile(key, file, visibility) {
    const s = getSession();
    if (!s?.fetch || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      const resp = await s.fetch('/v1/memory/files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key || file.name, content: base64, mime_type: file.type || 'application/octet-stream', visibility: visibility || 'private' }),
      });
      if (resp.ok !== false) { showToast(t('profile.files.uploaded')); setShowFileForm(false); loadFilesData(); }
      else showToast(t('profile.files.uploadFailed'), true);
    };
    reader.readAsDataURL(file);
  }

  async function deleteFile(key) {
    if (!confirm(t('profile.files.deleteConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/memory/files/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.files.deleted'));
    loadFilesData();
  }

  async function publishService(name, desc, category, price, unit, webhook) {
    const s = getSession();
    const body = { display_name: name, description: desc, category, price_morsels: Number(price) || 0, unit: unit || 'call' };
    if (webhook) body.webhook_url = webhook;
    const resp = await s.fetch('/v1/catalogue', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.services.published')); setShowPubForm(false); loadMyServicesData(); }
    else showToast(t('profile.error'), true);
  }

  async function unpublishService(id) {
    if (!confirm(t('profile.services.unpublishConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/catalogue/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('profile.services.unpublished'));
    loadMyServicesData();
  }

  async function createBoard(name, desc, vis) {
    const s = getSession();
    const resp = await s.fetch('/v1/boards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc, visibility: vis || 'private' }),
    });
    if (resp.ok !== false) { showToast(t('profile.boards.created')); setShowBrdForm(false); loadMyBoardsData(); }
    else showToast(t('profile.boards.createFailed'), true);
  }

  async function loadMyBoardsData() {
    try {
      const data = await apiFetch('/v1/boards/subscriptions');
      setMyBoards(data?.data?.boards || data?.data || []);
    } catch { setMyBoards([]); }
  }

  async function loadAllBoardsData() {
    try {
      const data = await publicFetch('/v1/boards');
      setAllBoards(data?.data?.boards || data?.data || []);
    } catch { setAllBoards([]); }
  }

  async function subscribeBoard(boardId) {
    const s = getSession();
    try {
      await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', { method: 'POST' });
      showToast(t('profile.boards.subscribed'));
    } catch { showToast(t('profile.boards.subscribeFailed'), true); }
  }

  async function viewBoardPosts(boardId, boardName) {
    try {
      const data = await apiFetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts');
      setBoardView({ id: boardId, name: boardName, posts: data?.data?.posts || data?.data || [] });
    } catch { setBoardView({ id: boardId, name: boardName, posts: [] }); }
  }

  async function createPost(boardId, content) {
    if (!content?.trim()) { showToast(t('profile.boards.writeFirst'), true); return; }
    const s = getSession();
    await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    showToast(t('profile.boards.posted'));
    viewBoardPosts(boardId, boardView?.name);
  }

  async function reactToPost(boardId, postId, emoji) {
    const s = getSession();
    await s.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/react', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji }),
    });
    viewBoardPosts(boardId, boardView?.name);
  }

  async function uploadApp(file, screenshot, accessCode) {
    const s = getSession();
    if (!file) { showToast(t('profile.apps.selectFile'), true); return; }
    const readFile = (f) => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(f); });
    const body = { filename: file.name, content: await readFile(file), mime_type: file.type || 'text/html' };
    if (accessCode) body.access_code = accessCode;
    if (screenshot) { body.screenshot = await readFile(screenshot); body.screenshot_mime_type = screenshot.type || 'image/png'; }
    const resp = await s.fetch('/v1/apps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok !== false) { showToast(t('profile.apps.uploaded')); setShowAppUpload(false); loadAppsData(); }
    else showToast(t('profile.apps.uploadFailed'), true);
  }

  async function registerNode(nodeId, visibility, gaiis) {
    const s = getSession();
    let nid = nodeId.trim();
    if (!nid) { showToast(t('profile.nodes.registerFailed'), true); return; }
    if (!nid.startsWith('personal-')) nid = 'personal-' + nid;
    const agentGaiis = gaiis ? gaiis.split(',').map(s => s.trim()).filter(Boolean) : [];
    const resp = await s.fetch('/v1/personal/anchor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: nid, owner_name: s.owner, public_key: s.publicKey || 'placeholder', agent_gaiis: agentGaiis, visibility: visibility || 'private' }),
    });
    if (resp.ok !== false) { showToast(t('profile.nodes.registered')); setShowNodeForm(false); loadNodesData(); }
    else showToast(t('profile.nodes.registerFailed'), true);
  }

  async function detachNode(nodeId) {
    if (!confirm(t('profile.nodes.detachConfirm'))) return;
    const s = getSession();
    await s.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
    showToast(t('profile.nodes.detachedToast'));
    loadNodesData();
  }

  async function setNodeVis(nodeId, vis) {
    const s = getSession();
    await s.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });
    showToast(t('profile.nodes.visUpdated'));
    loadNodesData();
  }

  async function revokeConsent(consentId) {
    const s = getSession();
    await s.fetch('/v1/consent/' + encodeURIComponent(consentId), { method: 'DELETE' });
    showToast(t('wallet.consents.revoked'));
    loadConsentsData();
  }

  async function exportGdpr() {
    try {
      const data = await apiFetch('/v1/owners/' + encodeURIComponent(session.owner) + '/export');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'aimeat-export-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { showToast(t('profile.error'), true); }
  }

  async function submitRating(workId, rating, comment) {
    if (!rating) { showToast(t('profile.work.selectRating'), true); return; }
    const s = getSession();
    await s.fetch('/v1/work/' + encodeURIComponent(workId) + '/rate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating, comment }),
    });
    showToast(t('profile.work.ratingSubmitted'));
    setRateModal(null);
    loadWorkData();
  }

  // Inject CSS
  useEffect(() => {
    const id = 'profile-view-css';
    if (!document.getElementById(id)) {
      const s = document.createElement('style');
      s.id = id;
      s.textContent = PROFILE_CSS;
      document.head.appendChild(s);
    }
    return () => { const el = document.getElementById(id); if (el) el.remove(); };
  }, []);

  // URL tab param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && TABS.some(t => t.id === tab)) setActiveTab(tab);
  }, []);

  // ── Not logged in ──
  if (!session) {
    return html`
      <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
        <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
      </div>
      <div class="pf">
        <div class="login-prompt">
          <h1>\u{1F496} ${t('profile.signInTitle')}</h1>
          <p>${t('profile.signInDesc')}</p>
        </div>
      </div>`;
  }

  // ── Tab switch handler ──
  function switchTab(tabId) {
    setActiveTab(tabId);
    // Lazy load sub-data on first visit
    if (tabId === 'actions' && svcSubTab === 'catalogue' && !catalogue) loadCatalogueData(catFilter);
    if (tabId === 'boards' && brdSubTab === 'mine' && !myBoards) loadMyBoardsData();
    if (tabId === 'boards' && brdSubTab === 'browse' && !allBoards) loadAllBoardsData();
  }

  // ── Render helpers ──
  const renderAgents = () => {
    if (!agents) return html`<${Spinner} text=${t('profile.agents.loadingAgents')} />`;
    return html`
      <div class="section-title">${t('profile.agents.title')}</div>
      <div class="section-desc">${t('profile.agents.desc')}</div>

      <!-- Agent CTA -->
      <div class="agent-cta">
        <h3>${t('profile.agents.connect')}</h3>
        <p>${t('profile.agents.connectDesc')}</p>
        <div class="agent-prompt-box">${buildAgentPrompt(session)}</div>
        <button class="copy-prompt-btn" onClick=${() => {
          copyToClipboard(buildAgentPrompt(session)).then(() => {
            setPromptCopied(true);
            setTimeout(() => setPromptCopied(false), 2000);
          });
        }}>${promptCopied ? '\u2705 ' + t('profile.agents.copied') : t('profile.agents.copyPrompt')}</button>

        <div style="margin-top:1.25rem;border-top:1px solid var(--border);padding-top:1.25rem">
          <p style="margin-bottom:.75rem">${t('profile.agents.noAgent')}</p>
          <button class="expand-btn" onClick=${() => setPlatExpand(!platExpand)}>
            <span>${t('profile.agents.seeHow')}</span>
            <span style="transition:transform .2s;${platExpand ? 'transform:rotate(180deg)' : ''}">\u25BC</span>
          </button>
          ${platExpand && html`
            <div class="platform-instructions expanded">
              <div class="platform-tabs">
                ${PLATFORM_KEYS.map(k => html`
                  <button class="platform-tab ${k === activePlat ? 'active' : ''}" onClick=${() => setActivePlat(k)}>${t(PLATFORM_LABELS[k])}</button>
                `)}
              </div>
              <div class="platform-content" dangerouslySetInnerHTML=${{ __html: PLATFORMS[activePlat] }}></div>
            </div>
          `}
        </div>
      </div>

      ${agents.length === 0
        ? html`<div class="empty">${t('profile.agents.empty')}</div>`
        : agents.map(a => html`
          <div class="card agent-card">
            <div class="card-header">
              <div class="card-title">${escHtml(a.display_name || a.name)}</div>
              <span class="badge badge-info">${escHtml(a.name)}</span>
            </div>
            <div class="gaii">${escHtml(a.gaii || '')}</div>
            <div class="card-subtitle">
              ${t('profile.agents.trust')}: ${a.trust_score ?? '-'} \u2502
              ${t('profile.agents.balance')}: ${a.balance ?? '-'} \u2502
              ${t('profile.agents.lastSeen')}: ${a.last_seen ? timeAgo(a.last_seen) : '-'}
            </div>
            ${a.capabilities?.length > 0 && html`
              <div class="caps">${a.capabilities.map(c => html`<span class="cap">${escHtml(c)}</span>`)}</div>
            `}
            ${(() => {
              const scopes = a.default_scopes ?? ['*'];
              const tpl = detectTemplate(scopes);
              const count = scopes.includes('*') ? '\u221E' : scopes.length;
              const isOwnerOrOp = session.roles?.includes('owner') || session.roles?.includes('operator');
              return html`
                <div class="scope-summary">
                  <span class="scope-badge">${templateLabel(tpl)}</span>
                  <span class="scope-count">${count} ${t('profile.agents.scopeUi.scopes')}</span>
                  ${isOwnerOrOp
                    ? html`<button class="scope-manage-btn" onClick=${(e) => { e.stopPropagation(); setScopesModal(a); }}>
                        ${t('profile.agents.scopeUi.manage')} \u25B8
                      </button>`
                    : html`<span class="scope-lock">\uD83D\uDD12</span>`
                  }
                </div>`;
            })()}
          </div>
        `)
      }`;
  };

  const renderChatSessions = () => {
    if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
    return html`
      <div class="section-title">${t('profile.chatSessions.title')}</div>
      <div class="section-desc">${t('profile.chatSessions.desc')}</div>
      ${chatSessions.length === 0
        ? html`<div class="empty">${t('profile.chatSessions.empty')}</div>`
        : chatSessions.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name || t('profile.chatSessions.anonymous'))}</div>
              <span class="badge badge-info">${escHtml(s.name || '')}</span>
            </div>
            <div class="card-subtitle">${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}</div>
          </div>
        `)
      }`;
  };

  const renderWallet = () => {
    if (!walletData) return html`<${Spinner} text=${t('profile.wallet.loading')} />`;
    const w = walletData;
    return html`
      <div class="section-title">${t('profile.wallet.title')}</div>
      <div class="section-desc">${t('profile.wallet.desc')}</div>
      <div class="wallet-overview">
        <div class="wallet-card"><div class="amount neutral">${w.balance ?? 0} \u2764\uFE0F</div><div class="wlabel">${t('profile.wallet.balance')}</div></div>
        <div class="wallet-card"><div class="amount neutral">${w.escrow ?? 0}</div><div class="wlabel">${t('profile.wallet.inEscrow')}</div></div>
        <div class="wallet-card"><div class="amount positive">${(w.balance ?? 0) - (w.escrow ?? 0)}</div><div class="wlabel">${t('profile.wallet.available')}</div></div>
        <div class="wallet-card"><div class="amount neutral">${w.daily_allowance ?? 50}</div><div class="wlabel">${t('profile.wallet.dailyAllowance')}</div></div>
      </div>
      <div class="section-title" style="margin-top:1rem">${t('profile.wallet.recentTx')}</div>
      ${(!walletTx || walletTx.length === 0)
        ? html`<div class="empty">${t('profile.wallet.empty')}</div>`
        : html`<div class="card"><div class="tx-list">
            ${walletTx.map(tx => {
              const isCredit = tx.amount > 0;
              const typeLabel = tx.type === 'daily_allowance' ? t('profile.wallet.earned')
                : tx.type === 'welcome_bonus' ? t('profile.wallet.welcomeBonus')
                : isCredit ? t('profile.wallet.earned') : t('profile.wallet.shared');
              return html`
                <div class="tx-item">
                  <div><span class="tx-type">${typeLabel}</span> <span style="font-size:.8rem">${escHtml(tx.description || tx.memo || '')}</span></div>
                  <div style="text-align:right">
                    <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : ''}${tx.amount}</div>
                    <div class="tx-date">${tx.created_at ? timeAgo(tx.created_at) : ''}</div>
                  </div>
                </div>`;
            })}
          </div></div>`
      }`;
  };

  const renderMemory = () => {
    const searchRef = useRef(null);
    return html`
      <div class="section-title">${t('profile.memory.title')}</div>
      <div class="section-desc">${t('profile.memory.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${memSubTab === 'entries' ? 'active' : ''}" onClick=${() => setMemSubTab('entries')}>${t('profile.memory.entries')}</button>
        <button class="sub-tab ${memSubTab === 'files' ? 'active' : ''}" onClick=${() => setMemSubTab('files')}>${t('profile.memory.files')}</button>
      </div>
      ${memSubTab === 'entries' ? renderMemoryEntries(searchRef) : renderFiles()}
    `;
  };

  const renderMemoryEntries = (searchRef) => {
    if (!memories) return html`<${Spinner} text=${t('profile.memory.loading')} />`;
    return html`
      <div class="action-bar">
        <div class="search-bar">
          <input type="text" ref=${searchRef} class="input-field" placeholder=${t('profile.memory.search')} onKeyDown=${e => e.key === 'Enter' && searchMemory(e.target.value)} />
          <button class="btn-sm" onClick=${() => searchMemory(searchRef.current?.value)}>${t('profile.memory.searchBtn')}</button>
          <button class="btn-sm btn-outline" onClick=${() => { if (searchRef.current) searchRef.current.value = ''; loadMemoryData(); }}>${t('profile.memory.clearBtn')}</button>
        </div>
        <button class="btn-primary" onClick=${() => setShowMemForm(!showMemForm)}>${t('profile.memory.newBtn')}</button>
      </div>
      ${showMemForm && html`<${MemoryForm} onSave=${createMemory} onCancel=${() => setShowMemForm(false)} />`}
      ${memories.length === 0
        ? html`<div class="empty">${t('profile.memory.empty')}</div>`
        : memories.map(m => html`
          <div>
            <div class="mem-item" onClick=${() => setExpandedMem(expandedMem === m.key ? null : m.key)}>
              <span class="mem-key">${escHtml(m.key)}</span>
              <span class="mem-vis badge ${m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-info' : 'badge-muted'}">${m.visibility || 'private'}</span>
            </div>
            ${expandedMem === m.key && html`
              <div class="mem-detail">
                <pre>${escHtml(typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || ''))}</pre>
                ${m.tags?.length > 0 && html`<div style="margin-top:.5rem;font-size:.75rem;color:var(--muted)">${m.tags.join(', ')}</div>`}
                <div class="mem-actions">
                  <button class="btn-sm" onClick=${() => setEditModal({ key: m.key, value: typeof m.value === 'object' ? JSON.stringify(m.value, null, 2) : String(m.value || '') })}>${t('profile.memory.editBtn')}</button>
                  <button class="btn-danger" onClick=${() => deleteMemory(m.key)}>${t('profile.memory.deleteBtn')}</button>
                </div>
              </div>
            `}
          </div>
        `)
      }`;
  };

  const renderFiles = () => {
    if (!files) return html`<${Spinner} text=${t('profile.files.loading')} />`;
    return html`
      <div class="action-bar">
        <button class="btn-primary" onClick=${() => setShowFileForm(!showFileForm)}>${t('profile.files.uploadBtn')}</button>
        <span style="font-size:.75rem;color:var(--muted)">${t('profile.files.sizeLimit')}</span>
      </div>
      ${showFileForm && html`<${FileUploadForm} onUpload=${uploadFile} onCancel=${() => setShowFileForm(false)} />`}
      ${files.length === 0
        ? html`<div class="empty">${t('profile.files.empty')}</div>`
        : html`<div class="file-grid">
            ${files.map(f => {
              const icon = f.mime_type?.startsWith('image') ? '\u{1F5BC}\uFE0F' : f.mime_type?.includes('pdf') ? '\u{1F4C4}' : '\u{1F4CE}';
              return html`
                <div class="file-card">
                  <div class="file-icon">${icon}</div>
                  <div class="file-info">
                    <div class="file-name">${escHtml(f.key || f.name)}</div>
                    <div class="file-meta">${f.size ? Math.round(f.size / 1024) + ' KB' : ''} \u2502 ${f.visibility || 'private'}</div>
                  </div>
                  <div class="file-actions">
                    <a class="btn-sm" href="${NODE_URL}/v1/memory/files/${encodeURIComponent(f.key || f.name)}" target="_blank" style="text-decoration:none">${t('profile.files.download')}</a>
                    <button class="btn-danger" onClick=${() => deleteFile(f.key || f.name)}>${t('profile.files.delete')}</button>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  const renderWork = () => {
    return html`
      <div class="section-title">${t('profile.work.title')}</div>
      <div class="section-desc">${t('profile.work.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${workSubTab === 'inbox' ? 'active' : ''}" onClick=${() => setWorkSubTab('inbox')}>${t('profile.work.inbox')}</button>
        <button class="sub-tab ${workSubTab === 'sent' ? 'active' : ''}" onClick=${() => setWorkSubTab('sent')}>${t('profile.work.sent')}</button>
      </div>
      ${workSubTab === 'inbox' ? renderWorkList(workInbox, 'inbox') : renderWorkList(workSent, 'sent')}
    `;
  };

  const renderWorkList = (items, type) => {
    if (!items) return html`<${Spinner} text=${t('profile.work.loading')} />`;
    if (items.length === 0) return html`<div class="empty">${t(type === 'sent' ? 'profile.work.sentEmpty' : 'profile.work.empty')}</div>`;
    return items.map(w => html`
      <div class="card">
        <div class="card-header">
          <div class="card-title">${escHtml(w.description || w.action_name || '-')}</div>
          <span class="badge ${w.status === 'completed' ? 'badge-success' : w.status === 'accepted' ? 'badge-info' : w.status === 'delivered' ? 'badge-warn' : 'badge-muted'}">${w.status || '-'}</span>
        </div>
        <div class="card-subtitle">
          ${type === 'sent' ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii || '-') : t('profile.work.from') + ': ' + escHtml(w.requester_gaii || '-')}
          ${w.price_morsels != null ? ' \u2502 ' + t('profile.work.cost') + ': ' + w.price_morsels + ' \u2764\uFE0F' : ''}
          ${w.created_at ? ' \u2502 ' + timeAgo(w.created_at) : ''}
        </div>
        ${type === 'sent' && w.status === 'delivered' && html`
          <button class="btn-sm" style="margin-top:.5rem" onClick=${() => setRateModal({ workId: w.id || w.work_id, desc: w.description || w.action_name })}>${t('profile.work.rateBtn')}</button>
        `}
      </div>
    `);
  };

  const renderServices = () => {
    return html`
      <div class="section-title">${t('profile.services.title')}</div>
      <div class="section-desc">${t('profile.services.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${svcSubTab === 'mine' ? 'active' : ''}" onClick=${() => setSvcSubTab('mine')}>${t('profile.services.mine')}</button>
        <button class="sub-tab ${svcSubTab === 'catalogue' ? 'active' : ''}" onClick=${() => { setSvcSubTab('catalogue'); if (!catalogue) loadCatalogueData(catFilter); }}>${t('profile.services.catalogue')}</button>
      </div>
      ${svcSubTab === 'mine' ? renderMyServices() : renderCatalogue()}
    `;
  };

  const renderMyServices = () => {
    if (!myServices) return html`<${Spinner} text=${t('profile.services.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowPubForm(!showPubForm)}>${t('profile.services.publishBtn')}</button>
      ${showPubForm && html`<${PublishForm} onPublish=${publishService} onCancel=${() => setShowPubForm(false)} />`}
      ${myServices.length === 0
        ? html`<div class="empty">${t('profile.services.empty')}</div>`
        : myServices.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name)}</div>
              <div>
                <span class="badge badge-info">${escHtml(s.category || '')}</span>
                <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(s.description || '')}</div>
            <button class="btn-danger" style="margin-top:.5rem" onClick=${() => unpublishService(s.id || s.action_id)}>${t('profile.delete')}</button>
          </div>
        `)
      }`;
  };

  const renderCatalogue = () => {
    return html`
      <div class="action-bar">
        <select class="input-field" style="max-width:200px" value=${catFilter} onChange=${e => { setCatFilter(e.target.value); loadCatalogueData(e.target.value); }}>
          <option value="">${t('profile.services.allCategories')}</option>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      ${!catalogue ? html`<${Spinner} text=${t('profile.services.loading')} />`
        : catalogue.length === 0 ? html`<div class="empty">${t('profile.services.catalogueEmpty')}</div>`
        : catalogue.map(s => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(s.display_name || s.name)}</div>
              <div>
                <span class="badge badge-info">${escHtml(s.category || '')}</span>
                <span class="badge badge-success" style="margin-left:.25rem">${s.price_morsels ? s.price_morsels + ' \u2764\uFE0F' : t('profile.services.free')}</span>
              </div>
            </div>
            <div class="card-subtitle">${escHtml(s.description || '')} \u2502 ${escHtml(s.owner || '')}</div>
          </div>
        `)
      }`;
  };

  const renderBoards = () => {
    if (boardView) return renderBoardDetail();
    return html`
      <div class="section-title">${t('profile.boards.title')}</div>
      <div class="section-desc">${t('profile.boards.desc')}</div>
      <div class="sub-tabs">
        <button class="sub-tab ${brdSubTab === 'mine' ? 'active' : ''}" onClick=${() => { setBrdSubTab('mine'); if (!myBoards) loadMyBoardsData(); }}>${t('profile.boards.mine')}</button>
        <button class="sub-tab ${brdSubTab === 'browse' ? 'active' : ''}" onClick=${() => { setBrdSubTab('browse'); if (!allBoards) loadAllBoardsData(); }}>${t('profile.boards.browse')}</button>
      </div>
      ${brdSubTab === 'mine' ? renderMyBoards() : renderAllBoards()}
    `;
  };

  const renderMyBoards = () => {
    if (!myBoards) return html`<${Spinner} text=${t('profile.boards.loading')} />`;
    return html`
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowBrdForm(!showBrdForm)}>${t('profile.boards.createBtn')}</button>
      ${showBrdForm && html`<${BoardForm} onCreate=${createBoard} onCancel=${() => setShowBrdForm(false)} />`}
      ${myBoards.length === 0
        ? html`<div class="empty">${t('profile.boards.empty')}</div>`
        : myBoards.map(b => html`
          <div class="card" style="cursor:pointer" onClick=${() => viewBoardPosts(b.id || b.board_id, b.name)}>
            <div class="card-header">
              <div class="card-title">${escHtml(b.name)}</div>
              <span class="badge ${b.visibility === 'public' ? 'badge-success' : 'badge-muted'}">${b.visibility || 'private'}</span>
            </div>
            <div class="card-subtitle">${escHtml(b.description || '')}</div>
          </div>
        `)
      }`;
  };

  const renderAllBoards = () => {
    if (!allBoards) return html`<${Spinner} text=${t('profile.boards.browseLoading')} />`;
    if (allBoards.length === 0) return html`<div class="empty">${t('profile.boards.browseEmpty')}</div>`;
    return allBoards.map(b => html`
      <div class="card">
        <div class="card-header">
          <div class="card-title" style="cursor:pointer" onClick=${() => viewBoardPosts(b.id || b.board_id, b.name)}>${escHtml(b.name)}</div>
          <button class="btn-sm" onClick=${() => subscribeBoard(b.id || b.board_id)}>${t('profile.boards.subscribe')}</button>
        </div>
        <div class="card-subtitle">${escHtml(b.description || '')}</div>
      </div>
    `);
  };

  const renderBoardDetail = () => {
    const postRef = useRef(null);
    return html`
      <button class="btn-outline" style="margin-bottom:1rem" onClick=${() => setBoardView(null)}>\u2190 ${t('profile.boards.backToBoards')}</button>
      <div class="section-title">${escHtml(boardView.name)}</div>
      <div style="margin-bottom:1rem">
        <textarea ref=${postRef} class="input-field" rows="2" placeholder=${t('profile.boards.postPlaceholder')}></textarea>
        <button class="btn-primary" style="margin-top:.5rem" onClick=${() => { createPost(boardView.id, postRef.current?.value); if (postRef.current) postRef.current.value = ''; }}>${t('profile.boards.postBtn')}</button>
      </div>
      ${boardView.posts.length === 0
        ? html`<div class="empty">${t('profile.boards.postsEmpty')}</div>`
        : boardView.posts.map(p => html`
          <div class="post-card">
            <div class="post-content">${escHtml(p.content)}</div>
            <div class="post-meta">
              <span>${escHtml(p.author_gaii || p.author || '-')}</span>
              <span>${p.created_at ? timeAgo(p.created_at) : ''}</span>
            </div>
            <div class="post-reactions">
              ${['\u{1F44D}','\u2764\uFE0F','\u{1F525}','\u{1F4A1}','\u{1F602}'].map(emoji => html`
                <button class="reaction-btn" onClick=${() => reactToPost(boardView.id, p.id || p.post_id, emoji)}>${emoji} ${p.reactions?.[emoji] || ''}</button>
              `)}
            </div>
          </div>
        `)
      }`;
  };

  const renderApps = () => {
    return html`
      <div class="section-title">${t('profile.apps.title')}</div>
      <div class="section-desc">${t('profile.apps.desc')}</div>

      <!-- App launcher -->
      <div class="card" style="margin-bottom:1rem">
        <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u{1F680} ${t('profile.apps.launcherTitle')}</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.launcherDesc')}</p>
        <a href="/v1/apps/launcher" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block">${t('profile.apps.launcherOpen')}</a>
      </div>

      <!-- Create guide -->
      <div class="card" style="margin-bottom:1rem">
        <h3 style="color:var(--love1);font-size:1rem;margin-bottom:.5rem">\u2728 ${t('profile.apps.createGuide')}</h3>
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:.75rem">${t('profile.apps.createGuideDesc')}</p>
        <a href="/v1/aimeat-os" target="_blank" class="btn-primary" style="text-decoration:none;display:inline-block;margin-bottom:.5rem">${t('profile.apps.downloadGuide')}</a>
        <p style="font-size:.8rem;color:var(--muted)">${t('profile.apps.guideDesc')}</p>
      </div>

      <!-- Upload -->
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowAppUpload(!showAppUpload)}>${t('profile.apps.uploadBtn')}</button>
      ${showAppUpload && html`<${AppUploadForm} onUpload=${uploadApp} onCancel=${() => setShowAppUpload(false)} />`}

      <!-- My Apps -->
      <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.mine')}</div>
      ${!myApps ? html`<${Spinner} text=${t('profile.apps.loading')} />`
        : myApps.length === 0 ? html`<div class="empty">${t('profile.apps.empty')}</div>`
        : myApps.map(a => html`
          <div class="card">
            <div class="card-header">
              <div class="card-title">${escHtml(a.filename || a.name)}</div>
              <span class="badge badge-info">${escHtml(a.content_type || 'html')}</span>
            </div>
            <div class="card-subtitle">
              <a href="${NODE_URL}/v1/apps/${encodeURIComponent(a.owner || session.owner)}/${encodeURIComponent(a.filename || a.name)}" target="_blank">${t('profile.apps.download')}</a>
              ${a.size ? ' \u2022 ' + Math.round(a.size / 1024) + ' KB' : ''}
            </div>
          </div>
        `)
      }

      <!-- Gallery -->
      <div class="section-title" style="margin-top:1.5rem">${t('profile.apps.gallery')}</div>
      ${!allApps ? html`<${Spinner} text=${t('profile.apps.galleryLoading')} />`
        : allApps.length === 0 ? html`<div class="empty">${t('profile.apps.galleryEmpty')}</div>`
        : html`<div class="app-grid">
            ${allApps.map(a => {
              const ssUrl = a.screenshot_url ? NODE_URL + a.screenshot_url : null;
              return html`
                <div class="app-card">
                  <div class="app-screenshot">
                    ${ssUrl ? html`<img src=${ssUrl} alt=${a.filename} onError=${e => { e.target.parentElement.innerHTML = '<div class="placeholder">\u{1F4F1}</div>'; }} />` : html`<div class="placeholder">\u{1F4F1}</div>`}
                  </div>
                  <div class="app-info">
                    <div class="app-name">${escHtml(a.filename)}</div>
                    <div class="app-meta">${escHtml(a.owner)} \u2022 ${Math.round((a.size || 0) / 1024)} KB${a.protected ? ' \u2022 \u{1F512} ' + t('profile.apps.protected') : ''}</div>
                    <div style="margin-top:.5rem"><a href="${NODE_URL + (a.download_url || '/v1/apps/' + encodeURIComponent(a.owner) + '/' + encodeURIComponent(a.filename))}" class="btn-sm" style="text-decoration:none;display:inline-block">${t('profile.apps.download')}</a></div>
                  </div>
                </div>`;
            })}
          </div>`
      }`;
  };

  const renderFederation = () => {
    return html`
      <div class="section-title">${t('profile.federation.title')}</div>
      <div class="section-desc">${t('profile.federation.desc')}</div>
      ${!federation ? html`<${Spinner} text=${t('profile.federation.loading')} />`
        : federation.length === 0 ? html`<div class="empty">${t('profile.federation.empty')}</div>`
        : html`<div class="section-title" style="margin-top:0">${t('profile.federation.peers')}</div>
            ${federation.map(p => {
              const alive = p.status === 'active' || p.alive;
              return html`
                <div class="card">
                  <div class="peer-card">
                    <div>
                      <div class="card-title">${escHtml(p.node_id || p.nodeId || p.url)}</div>
                      <div class="card-subtitle">${escHtml(p.url || '')}</div>
                    </div>
                    <div class="peer-status">
                      <span class="peer-dot ${alive ? 'alive' : 'dead'}"></span>
                      <span style="font-size:.8rem;color:${alive ? 'var(--success)' : 'var(--danger)'}">${alive ? t('profile.federation.online') : t('profile.federation.offline')}</span>
                    </div>
                  </div>
                </div>`;
            })}`
      }`;
  };

  const renderNodes = () => {
    const tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
    return html`
      <div class="section-title">${t('profile.nodes.title')}</div>
      <div class="section-desc">${t('profile.nodes.desc')}</div>
      <button class="btn-primary" style="margin-bottom:1rem" onClick=${() => setShowNodeForm(!showNodeForm)}>${t('profile.nodes.addBtn')}</button>
      ${showNodeForm && html`<${NodeForm} onRegister=${registerNode} onCancel=${() => setShowNodeForm(false)} />`}
      ${!nodes ? html`<${Spinner} text=${t('profile.nodes.loading')} />`
        : nodes.length === 0 ? html`<div class="empty">${t('profile.nodes.empty')}</div>`
        : nodes.map((node, idx) => {
            const statusClass = node.status || 'offline';
            const statusLabel = t('profile.nodes.' + statusClass) || statusClass;
            const isPublic = node.visibility === 'public';
            const agentCount = node.agent_gaiis?.length || 0;
            const agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
            const mailboxCount = node.mailbox?.items || 0;
            const isOpen = expandedNodes.has(idx);
            const setupOpen = expandedSetups.has(idx);
            const mbUsedMB = ((node.mailbox?.used_bytes || 0) / 1024 / 1024).toFixed(1);
            const mbQuotaMB = ((node.mailbox?.quota_bytes || 0) / 1024 / 1024).toFixed(0);

            return html`
              <div class="pn-card">
                <div class="pn-header" onClick=${() => {
                  const s = new Set(expandedNodes);
                  s.has(idx) ? s.delete(idx) : s.add(idx);
                  setExpandedNodes(s);
                }}>
                  <div class="pn-header-left">
                    <div class="pn-status-dot ${statusClass}"></div>
                    <span class="pn-name">${escHtml(node.node_id)}</span>
                  </div>
                  <div class="pn-badges">
                    ${isPublic
                      ? html`<span class="badge badge-success">${t('profile.nodes.public')}</span>`
                      : html`<span class="badge badge-muted">${t('profile.nodes.private')}</span>`}
                    <span class="badge badge-${statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger'}">${statusLabel}</span>
                    <span class="pn-arrow ${isOpen ? 'open' : ''}">\u25BC</span>
                  </div>
                </div>
                <div class="pn-quick">${agentCount} ${agentWord} \u2502 ${t('profile.nodes.mailboxItems')}: ${mailboxCount} ${t('profile.nodes.items')}</div>
                ${isOpen && html`
                  <div class="pn-details open">
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.tunnelUrl')}</span>
                      <span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem">
                        <code style="font-size:.75rem">${tunnelUrl}</code>
                        <button onClick=${() => { copyToClipboard(tunnelUrl).then(() => showToast(t('profile.nodes.copied'))); }} style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">${t('profile.nodes.copyUrl')}</button>
                      </span>
                    </div>
                    <div style="padding:.5rem 0">
                      <span class="pn-detail-label">${t('profile.nodes.agentList')}</span>
                      ${node.agent_gaiis?.length > 0
                        ? html`<div class="pn-agent-list">${node.agent_gaiis.map(g => html`<div class="pn-agent-item">${escHtml(g)}</div>`)}</div>`
                        : html`<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">${t('profile.nodes.noAgents')}</div>`}
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.mailbox')}</span>
                      <span class="pn-detail-value">${mailboxCount} ${t('profile.nodes.items')} (${mbUsedMB} ${t('profile.nodes.mailboxOf')} ${mbQuotaMB} MB)</span>
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.lastSeen')}</span>
                      <span class="pn-detail-value">${node.last_seen ? timeAgo(node.last_seen) : '-'}</span>
                    </div>
                    <div class="pn-detail-row">
                      <span class="pn-detail-label">${t('profile.nodes.visibility')}</span>
                      <div class="pn-vis-toggle">
                        <button class="pn-vis-btn ${!isPublic ? 'active' : ''}" onClick=${() => setNodeVis(node.node_id, 'private')}>${t('profile.nodes.private')}</button>
                        <button class="pn-vis-btn ${isPublic ? 'active' : ''}" onClick=${() => setNodeVis(node.node_id, 'public')}>${t('profile.nodes.public')}</button>
                      </div>
                    </div>
                    <div style="margin-top:.75rem">
                      <button class="expand-btn" style="font-size:.8rem;padding:6px 12px" onClick=${() => {
                        const s = new Set(expandedSetups);
                        s.has(idx) ? s.delete(idx) : s.add(idx);
                        setExpandedSetups(s);
                      }}>${t('profile.nodes.setupTitle')} <span style="transition:transform .2s;${setupOpen ? 'transform:rotate(180deg)' : ''}">\u25BC</span></button>
                      ${setupOpen && html`
                        <div class="pn-setup open">
                          <ol>
                            <li>${t('profile.nodes.setupStep1')}</li>
                            <li>${t('profile.nodes.setupStep2')}</li>
                            <li>${t('profile.nodes.setupStep3')}</li>
                            <li>${t('profile.nodes.setupStep4')}</li>
                          </ol>
                          <a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">${t('profile.nodes.setupDocs')} \u2192</a>
                        </div>
                      `}
                    </div>
                    <button class="pn-detach-btn" onClick=${() => detachNode(node.node_id)}>${t('profile.nodes.detachBtn')}</button>
                  </div>
                `}
              </div>`;
          })
      }`;
  };

  const renderAccess = () => {
    const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
    const [keyBlurred, setKeyBlurred] = useState(true);
    return html`
      <div class="section-title">${t('profile.access.title')}</div>
      <div class="section-desc">${t('profile.access.desc')}</div>

      <h3 style="color:var(--love1);margin-bottom:.75rem">\u{1F4BB} ${t('profile.access.session')}</h3>
      <div class="card">
        <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.ghii')}</span><span>${escHtml(session.ghii || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.agentGaii')}</span><span>${escHtml(session.gaii || '-')}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.node')}</span><span>${escHtml(NODE_URL)}</span></div>
        <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>${session.valid ? html`<span class="badge badge-success">${t('profile.access.yes')}</span>` : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}</span></div>
      </div>

      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F510} ${t('profile.access.publicKey')}</h3>
      <div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">${escHtml(session.publicKey || 'N/A')}</div></div>

      ${ownerKey && html`
        <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F5DD}\uFE0F ${t('profile.access.ownerKey')}</h3>
        <div class="card" style="border-color:var(--warn);cursor:pointer" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:${keyBlurred ? 'blur(4px)' : 'none'};transition:filter .2s"
              onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
              ${escHtml(ownerKey)}
            </div>
            <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
          </div>
          <div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\u26A0 ${t('profile.access.keepSafe')}</div>
        </div>
      `}

      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F517} ${t('profile.access.mcpEndpoint')}</h3>
      <div class="card">
        <div style="font-family:monospace;font-size:.85rem;color:var(--love3)">${escHtml(NODE_URL + '/v1/mcp')}</div>
        <div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">${t('profile.access.mcpDesc')}</div>
      </div>
    `;
  };

  const renderDataWallet = () => {
    return html`
      <div class="section-title">\u{1F6E1}\uFE0F ${t('profile.tabs.dataWallet')}</div>

      <!-- Consents -->
      <h3 style="color:var(--love1);margin:1rem 0 .75rem">${t('wallet.consents.title')}</h3>
      ${!consents ? html`<${Spinner} />`
        : consents.length === 0 ? html`<div class="empty">${t('wallet.consents.empty')}</div>`
        : html`<div class="card" style="overflow-x:auto">
            <table class="consent-table"><thead><tr>
              <th>${t('wallet.consents.pattern')}</th>
              <th>${t('wallet.consents.recipient')}</th>
              <th>${t('wallet.consents.purpose')}</th>
              <th>${t('wallet.consents.scope')}</th>
              <th>${t('wallet.consents.granted')}</th>
              <th>${t('wallet.consents.expires')}</th>
              <th></th>
            </tr></thead><tbody>
              ${consents.map(c => {
                const isExpired = c.expires_at && new Date(c.expires_at) < new Date();
                return html`<tr>
                  <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(c.data_pattern || c.pattern || '-')}</span></td>
                  <td>${escHtml(c.recipient_gaii || c.recipient || '-')}</td>
                  <td>${escHtml(c.purpose || '-')}</td>
                  <td>${isExpired ? html`<span class="badge badge-muted">expired</span>` : html`<span class="badge badge-success">active</span>`} ${escHtml(c.scope || '-')}</td>
                  <td style="font-size:.8rem;color:var(--muted)">${c.granted_at ? new Date(c.granted_at).toLocaleDateString() : '-'}</td>
                  <td style="font-size:.8rem;color:var(--muted)">${c.expires_at ? new Date(c.expires_at).toLocaleDateString() : t('wallet.consents.never')}</td>
                  <td>${!isExpired && html`<button class="revoke-btn" onClick=${() => revokeConsent(c.id || c.consent_id)}>${t('wallet.consents.revoke')}</button>`}</td>
                </tr>`;
              })}
            </tbody></table>
          </div>`
      }

      <!-- Audit -->
      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.audit.title')}</h3>
      <div style="display:flex;gap:.5rem;margin-bottom:1rem">
        ${[7, 30, 90].map(d => html`
          <button class="audit-day-btn ${auditDays === d ? 'active' : ''}" onClick=${() => { setAuditDays(d); loadAuditData(d); }}>${d} ${t('wallet.audit.days')}</button>
        `)}
      </div>
      ${!auditEntries ? html`<${Spinner} />`
        : auditEntries.length === 0 ? html`<div class="empty">${t('wallet.audit.empty')}</div>`
        : html`<div class="card" style="overflow-x:auto">
            <table class="audit-table"><thead><tr>
              <th>${t('wallet.audit.who')}</th>
              <th>${t('wallet.audit.what')}</th>
              <th>${t('wallet.audit.when')}</th>
              <th>${t('wallet.audit.purpose')}</th>
            </tr></thead><tbody>
              ${auditEntries.map(e => html`<tr>
                <td>${escHtml(e.accessor_gaii || e.accessed_by || e.who || '-')}</td>
                <td><span style="font-family:monospace;font-size:.8rem;color:var(--love3)">${escHtml(e.data_key || e.key || e.what || '-')}</span></td>
                <td style="font-size:.8rem;color:var(--muted)">${e.accessed_at ? timeAgo(e.accessed_at) : (e.timestamp ? timeAgo(e.timestamp) : '-')}</td>
                <td>${escHtml(e.purpose || '-')}</td>
              </tr>`)}
            </tbody></table>
          </div>`
      }

      <!-- GDPR Export -->
      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">${t('wallet.export.title')}</h3>
      <div class="card">
        <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem">${t('wallet.export.description')}</p>
        <button class="btn-primary" onClick=${exportGdpr}>${t('wallet.export.button')}</button>
      </div>
    `;
  };

  // ── Tab panel map ──
  const tabContent = {
    agents: renderAgents,
    chatsessions: renderChatSessions,
    wallet: renderWallet,
    memory: renderMemory,
    work: renderWork,
    actions: renderServices,
    boards: renderBoards,
    apps: renderApps,
    federation: renderFederation,
    nodes: renderNodes,
    access: renderAccess,
    dataWallet: renderDataWallet,
  };

  // ── Main render ──
  return html`
    <div class="bg-aurora" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none">
      <div class="aurora-wave"></div><div class="aurora-wave"></div><div class="aurora-wave"></div>
    </div>
    <div class="pf">
      <!-- Profile header -->
      <div class="profile-header">
        <div class="avatar">\u{1F9D1}</div>
        <div class="profile-info">
          <h1>${escHtml(session.displayName || session.owner)}</h1>
          <div class="ghii">${escHtml(session.ghii || '')}</div>
          <div class="meta">${t('profile.node')}: ${escHtml(NODE_URL)}</div>
        </div>
      </div>

      <!-- Stats bar -->
      <div class="stats-bar">
        <div class="stat-card"><div class="num">${stats.agents}</div><div class="label">${t('profile.stats.agents')}</div></div>
        <div class="stat-card"><div class="num">${stats.chatSessions}</div><div class="label">${t('profile.stats.chatSessions')}</div></div>
        <div class="stat-card"><div class="num">${stats.balance}</div><div class="label">${t('profile.stats.morsels')}</div></div>
        <div class="stat-card"><div class="num">${stats.memory}</div><div class="label">${t('profile.stats.memories')}</div></div>
        <div class="stat-card"><div class="num">${stats.services}</div><div class="label">${t('profile.stats.services')}</div></div>
        <div class="stat-card"><div class="num">${stats.work}</div><div class="label">${t('profile.stats.tasks')}</div></div>
        <div class="stat-card"><div class="num">${stats.apps}</div><div class="label">${t('profile.stats.apps')}</div></div>
        <div class="stat-card"><div class="num">${stats.files}</div><div class="label">${t('profile.stats.files')}</div></div>
        <div class="stat-card"><div class="num">${stats.nodes}</div><div class="label">${t('profile.stats.nodes')}</div></div>
      </div>

      <!-- Tabs -->
      <div class="tabs">
        ${TABS.map(tab => html`
          <button class="tab ${activeTab === tab.id ? 'active' : ''}" onClick=${() => switchTab(tab.id)}>${t(tab.key)}</button>
        `)}
      </div>

      <!-- Active panel -->
      <div>${tabContent[activeTab]?.()}</div>

      <!-- Modals -->
      ${editModal && html`
        <${EditMemoryModal}
          memKey=${editModal.key}
          initialValue=${editModal.value}
          onSave=${(v) => saveMemoryEdit(editModal.key, v)}
          onCancel=${() => setEditModal(null)}
        />`}

      ${rateModal && html`
        <${RateModal}
          desc=${rateModal.desc}
          onSubmit=${(rating, comment) => submitRating(rateModal.workId, rating, comment)}
          onCancel=${() => setRateModal(null)}
        />`}

      ${scopesModal && html`
        <${ScopesModal}
          agent=${scopesModal}
          session=${session}
          onSave=${async (agentName, newScopes) => {
            try {
              const s = getSession();
              if (!s?.fetch) return;
              const resp = await s.fetch('/v1/agents/' + encodeURIComponent(agentName) + '/scopes', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scopes: newScopes }),
              });
              if (resp.ok !== false) {
                showToast(t('profile.agents.scopeUi.saved'));
                setScopesModal(null);
                loadAgentsData();
              } else {
                const data = resp.json ? await resp.json() : {};
                showToast(data?.error?.message || t('profile.agents.scopeUi.saveError'), true);
              }
            } catch (err) {
              showToast(t('profile.agents.scopeUi.saveError'), true);
            }
          }}
          onCancel=${() => setScopesModal(null)}
        />`}

      <!-- Toast -->
      ${toast && html`<div class="toast ${toast.isError ? 'error' : ''}">${toast.msg}</div>`}
    </div>`;
}

/* ── Form sub-components ── */

function MemoryForm({ onSave, onCancel }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [vis, setVis] = useState('private');
  const [tags, setTags] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.memory.keyLabel')}</label><input class="input-field" placeholder=${t('profile.memory.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.memory.valueLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.memory.valuePlaceholder')} value=${value} onInput=${e => setValue(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.memory.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.memory.visPrivate')}</option>
          <option value="shared">${t('profile.memory.visShared')}</option>
          <option value="public">${t('profile.memory.visPublic')}</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.memory.tagsLabel')}</label><input class="input-field" placeholder=${t('profile.memory.tagsPlaceholder')} value=${tags} onInput=${e => setTags(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { if (!key || !value) return; onSave(key, value, vis, tags); }}>${t('profile.memory.saveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.memory.cancelBtn')}</button>
      </div>
    </div>`;
}

function FileUploadForm({ onUpload, onCancel }) {
  const [key, setKey] = useState('');
  const [vis, setVis] = useState('private');
  const fileRef = useRef(null);
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.files.keyLabel')} <span style="font-weight:normal;font-size:.75rem;color:var(--muted)">${t('profile.files.nameNote')}</span></label><input class="input-field" placeholder=${t('profile.files.keyPlaceholder')} value=${key} onInput=${e => setKey(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.files.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" onChange=${e => { if (e.target.files[0] && !key) setKey(e.target.files[0].name); }} /></div>
      <div class="form-row"><label>${t('profile.files.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.files.visPrivate')}</option>
          <option value="owner">${t('profile.files.visOwner')}</option>
          <option value="public">${t('profile.files.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => { const f = fileRef.current?.files?.[0]; if (!f) return; onUpload(key || f.name, f, vis); }}>${t('profile.files.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.files.cancelBtn')}</button>
      </div>
    </div>`;
}

function PublishForm({ onPublish, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [cat, setCat] = useState('language');
  const [price, setPrice] = useState('0');
  const [unit, setUnit] = useState('call');
  const [webhook, setWebhook] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.services.nameLabel')}</label><input class="input-field" placeholder=${t('profile.services.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.descLabel')}</label><textarea class="input-field" rows="3" placeholder=${t('profile.services.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea></div>
      <div class="form-row"><label>${t('profile.services.categoryLabel')}</label>
        <select class="input-field" value=${cat} onChange=${e => setCat(e.target.value)}>
          ${SERVICE_CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.priceLabel')}</label><input type="number" class="input-field" value=${price} min="0" onInput=${e => setPrice(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.services.unitLabel')}</label>
        <select class="input-field" value=${unit} onChange=${e => setUnit(e.target.value)}>
          <option value="call">Per call</option><option value="minute">Per minute</option>
          <option value="token">Per token</option><option value="task">Per task</option>
        </select>
      </div>
      <div class="form-row"><label>${t('profile.services.webhookLabel')}</label><input class="input-field" placeholder=${t('profile.services.webhookPlaceholder')} value=${webhook} onInput=${e => setWebhook(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onPublish(name, desc, cat, price, unit, webhook)}>${t('profile.services.publishSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function BoardForm({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState('private');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.boards.nameLabel')}</label><input class="input-field" placeholder=${t('profile.boards.namePlaceholder')} value=${name} onInput=${e => setName(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.descLabel')}</label><input class="input-field" placeholder=${t('profile.boards.descPlaceholder')} value=${desc} onInput=${e => setDesc(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.boards.visLabel')}</label>
        <select class="input-field" value=${vis} onChange=${e => setVis(e.target.value)}>
          <option value="private">${t('profile.boards.visPrivate')}</option>
          <option value="public">${t('profile.boards.visPublic')}</option>
        </select>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onCreate(name, desc, vis)}>${t('profile.boards.createSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function NodeForm({ onRegister, onCancel }) {
  const [nodeId, setNodeId] = useState('');
  const [vis, setVis] = useState('private');
  const [gaiis, setGaiis] = useState('');
  return html`
    <div class="create-form">
      <div class="section-title">${t('profile.nodes.addTitle')}</div>
      <div class="form-row"><label>${t('profile.nodes.nodeIdLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.nodeIdPlaceholder')} value=${nodeId} onInput=${e => setNodeId(e.target.value)} /></div>
      <div class="form-row"><label>${t('profile.nodes.visLabel')}</label>
        <div style="display:flex;gap:1rem">
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="nodeVis" value="private" checked=${vis === 'private'} onChange=${() => setVis('private')} /> ${t('profile.nodes.private')}
          </label>
          <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
            <input type="radio" name="nodeVis" value="public" checked=${vis === 'public'} onChange=${() => setVis('public')} /> ${t('profile.nodes.public')}
          </label>
        </div>
      </div>
      <div class="form-row"><label>${t('profile.nodes.agentGaiisLabel')}</label><input class="input-field" placeholder=${t('profile.nodes.agentGaiisPlaceholder')} value=${gaiis} onInput=${e => setGaiis(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onRegister(nodeId, vis, gaiis)}>${t('profile.nodes.registerBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.nodes.cancelBtn')}</button>
      </div>
    </div>`;
}

function AppUploadForm({ onUpload, onCancel }) {
  const fileRef = useRef(null);
  const ssRef = useRef(null);
  const [code, setCode] = useState('');
  return html`
    <div class="create-form">
      <div class="form-row"><label>${t('profile.apps.fileLabel')}</label><input type="file" ref=${fileRef} class="input-field" accept=".html,.htm" /></div>
      <div class="form-row"><label>${t('profile.apps.screenshotLabel')}</label><input type="file" ref=${ssRef} class="input-field" accept="image/*" /></div>
      <div class="form-row"><label>${t('profile.apps.accessCodeLabel')}</label><input class="input-field" placeholder=${t('profile.apps.accessCodePlaceholder')} value=${code} onInput=${e => setCode(e.target.value)} /></div>
      <div class="form-actions">
        <button class="btn-primary" onClick=${() => onUpload(fileRef.current?.files?.[0], ssRef.current?.files?.[0], code)}>${t('profile.apps.uploadSaveBtn')}</button>
        <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
      </div>
    </div>`;
}

function EditMemoryModal({ memKey, initialValue, onSave, onCancel }) {
  const [value, setValue] = useState(initialValue);
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.memory.editTitle')}: ${escHtml(memKey)}</h3>
        <textarea class="input-field" rows="6" value=${value} onInput=${e => setValue(e.target.value)}></textarea>
        <div class="form-actions" style="margin-top:1rem">
          <button class="btn-primary" onClick=${() => onSave(value)}>${t('profile.save')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}

function RateModal({ desc, onSubmit, onCancel }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal">
        <h3>${t('profile.work.rateTitle')}</h3>
        <p style="color:var(--muted);margin-bottom:1rem">${t('profile.work.rateDesc')} ${escHtml(desc || '')}</p>
        <div class="star-rating" style="margin-bottom:1rem">
          ${[1,2,3,4,5].map(i => html`
            <span class="star ${i <= rating ? 'active' : ''}" onClick=${() => setRating(i)}>\u2605</span>
          `)}
        </div>
        <div class="form-row"><label>${t('profile.work.commentLabel')}</label><textarea class="input-field" rows="2" value=${comment} onInput=${e => setComment(e.target.value)}></textarea></div>
        <div class="form-actions">
          <button class="btn-primary" onClick=${() => onSubmit(rating, comment)}>${t('profile.work.submitRating')}</button>
          <button class="btn-outline" onClick=${onCancel}>${t('profile.cancel')}</button>
        </div>
      </div>
    </div>`;
}

function ScopesModal({ agent, session, onSave, onCancel }) {
  const scopes = agent.default_scopes ?? ['*'];

  function expandScopes(scopeList) {
    const set = new Set();
    if (scopeList.includes('*')) {
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) set.add(`${d.key}:${p}`);
      }
      return set;
    }
    for (const s of scopeList) {
      const [domain, perm] = s.split(':');
      if (perm === '*') {
        const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
        if (domDef) domDef.permissions.forEach(p => set.add(`${domain}:${p}`));
      } else {
        set.add(s);
      }
    }
    return set;
  }

  const [checked, setChecked] = useState(() => expandScopes(scopes));
  const [advanced, setAdvanced] = useState(() => detectTemplate(scopes) === 'custom');
  const [saving, setSaving] = useState(false);
  const currentTemplate = detectTemplate([...checked]);

  function applyTemplate(name) {
    if (name === 'full') {
      const all = new Set();
      for (const d of SCOPE_DOMAINS) {
        for (const p of d.permissions) all.add(`${d.key}:${p}`);
      }
      setChecked(all);
    } else {
      setChecked(new Set(SCOPE_TEMPLATES[name] || []));
    }
  }

  function toggleScope(scope) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function toggleDomain(domain) {
    const domDef = SCOPE_DOMAINS.find(d => d.key === domain);
    if (!domDef) return;
    const domScopes = domDef.permissions.map(p => `${domain}:${p}`);
    const allChecked = domScopes.every(s => checked.has(s));
    setChecked(prev => {
      const next = new Set(prev);
      domScopes.forEach(s => allChecked ? next.delete(s) : next.add(s));
      return next;
    });
  }

  function buildScopesArray() {
    const arr = [...checked];
    const allScopes = SCOPE_DOMAINS.flatMap(d => d.permissions.map(p => `${d.key}:${p}`));
    if (allScopes.every(s => checked.has(s))) return ['*'];
    return arr.length > 0 ? arr : ['catalogue:read'];
  }

  async function handleSave() {
    setSaving(true);
    await onSave(agent.name, buildScopesArray());
    setSaving(false);
  }

  const isReadOnly = !(session.roles?.includes('owner') || session.roles?.includes('operator'));

  return html`
    <div class="modal-overlay" onClick=${e => { if (e.target.className.includes('modal-overlay')) onCancel(); }}>
      <div class="modal scope-modal">
        <h3>${t('profile.agents.scopeUi.scopeProfile')}: ${escHtml(agent.display_name || agent.name)}</h3>
        <div class="scope-agent-info">${escHtml(agent.gaii || '')}</div>

        ${isReadOnly ? html`
          <p style="color:var(--muted);margin-bottom:1rem;font-size:.85rem">${t('profile.agents.scopeUi.readOnlyView')}</p>
          <div class="scope-readonly-list">
            ${scopes.map(s => html`<span class="scope-tag">${escHtml(s)}</span>`)}
          </div>
          <div class="form-actions" style="margin-top:1.5rem">
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        ` : html`
          <div class="scope-templates">
            ${['readonly', 'standard', 'full'].map(tpl => html`
              <button class="scope-tpl-btn ${currentTemplate === tpl ? 'active' : ''}"
                      onClick=${() => applyTemplate(tpl)}>
                ${templateLabel(tpl)}
              </button>
            `)}
          </div>

          <button class="scope-advanced-toggle" onClick=${() => setAdvanced(!advanced)}>
            <span>${t('profile.agents.scopeUi.advanced')}</span>
            <span style="transition:transform .2s;${advanced ? 'transform:rotate(180deg)' : ''}">\u25BC</span>
          </button>

          ${advanced && html`
            <div class="scope-domains">
              ${SCOPE_DOMAINS.map(d => {
                const domScopes = d.permissions.map(p => `${d.key}:${p}`);
                const allChecked = domScopes.every(s => checked.has(s));
                const isCatalogue = d.key === 'catalogue';
                return html`
                  <div class="scope-domain">
                    <div class="scope-domain-header" onClick=${() => !isCatalogue && toggleDomain(d.key)}>
                      <span class="domain-label">${domainLabel(d.key)}</span>
                      ${!isCatalogue && html`<span class="domain-toggle">${allChecked ? '\u2611 all' : '\u2610'}</span>`}
                    </div>
                    ${d.permissions.map(p => {
                      const scope = `${d.key}:${p}`;
                      const isLocked = isCatalogue && p === 'read';
                      return html`
                        <div class="scope-row ${isLocked ? 'disabled' : ''}">
                          <label>
                            <input type="checkbox"
                              checked=${checked.has(scope) || isLocked}
                              onChange=${() => !isLocked && toggleScope(scope)}
                              disabled=${isLocked}
                            />
                            <span class="scope-friendly">${permLabel(p)}</span>
                            <span class="scope-technical">${scope}</span>
                            ${isLocked && html`<span class="scope-lock" title=${t('profile.agents.scopeUi.alwaysOn')}>\uD83D\uDD12</span>`}
                          </label>
                        </div>`;
                    })}
                  </div>`;
              })}
            </div>
          `}

          <div class="form-actions" style="margin-top:1.25rem">
            <button class="btn-primary" onClick=${handleSave} disabled=${saving}>
              ${saving ? t('profile.agents.scopeUi.saving') : t('profile.agents.scopeUi.save')}
            </button>
            <button class="btn-outline" onClick=${onCancel}>${t('profile.agents.scopeUi.cancel')}</button>
          </div>
        `}
      </div>
    </div>`;
}
