import { Router } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { resolveFlat, resolveLocale, type Locale } from '../i18n.js';

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
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f0a14;--card:rgba(30,20,40,.85);--card2:rgba(60,30,60,.7);--text:#f0e6f6;--muted:#c4a6d0;--accent:#ff6b9d;--accent2:#c44569;--border:rgba(255,107,157,.25);--success:#22c55e;--warn:#f59e0b;--danger:#ef4444;--radius:12px;--love1:#ff6b9d;--love2:#c44569;--love3:#ff8a80;--love4:#f48fb1;--love5:#880e4f}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;min-height:100vh;overflow-x:hidden}
a{color:var(--love1);text-decoration:none}
a:hover{text-decoration:underline;color:var(--love3)}

/* Background */
.bg-layer{position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none}
.bg-aurora .aurora-wave{position:absolute;width:200%;height:60%;left:-50%;border-radius:50%;filter:blur(80px);opacity:.25;animation:auroraShift 8s ease-in-out infinite alternate}
.bg-aurora .aurora-wave:nth-child(1){top:10%;background:linear-gradient(90deg,#ff6b9d,#c44569,#ff8a80,#f48fb1);animation-duration:8s}
.bg-aurora .aurora-wave:nth-child(2){top:35%;background:linear-gradient(90deg,#f48fb1,#880e4f,#ff6b9d,#e91e63);animation-duration:12s;animation-delay:-4s}
.bg-aurora .aurora-wave:nth-child(3){top:60%;background:linear-gradient(90deg,#ad1457,#ff6b9d,#f06292,#880e4f);animation-duration:10s;animation-delay:-2s}
@keyframes auroraShift{0%{transform:translateX(-20%) scaleY(1)}50%{transform:translateX(10%) scaleY(1.3)}100%{transform:translateX(-10%) scaleY(.8)}}

/* Layout */
.topbar{background:rgba(30,20,40,.9);backdrop-filter:blur(12px);border-bottom:1px solid var(--border);padding:.6rem 1.5rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.topbar-left{display:flex;align-items:center;gap:.75rem;font-weight:700;font-size:1rem}
.topbar-left a{color:var(--text);text-decoration:none}
.topbar-right{display:flex;align-items:center;gap:.75rem}
#auth-container{display:inline-flex;align-items:center}

.container{max-width:1000px;margin:0 auto;padding:2rem 1.5rem;position:relative;z-index:1}

/* Login prompt */
.login-prompt{text-align:center;padding:4rem 2rem}
.login-prompt h1{font-size:2rem;margin-bottom:1rem}
.login-prompt p{color:var(--muted);margin-bottom:2rem;font-size:1.1rem}
#login-area{display:flex;justify-content:center}

/* Profile header */
.profile-header{display:flex;align-items:center;gap:1.5rem;margin-bottom:2rem;flex-wrap:wrap}
.avatar{width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,var(--love1),var(--love2));display:flex;align-items:center;justify-content:center;font-size:2.2rem;flex-shrink:0;box-shadow:0 0 24px rgba(255,107,157,.3)}
.profile-info h1{font-size:1.6rem;font-weight:700;margin-bottom:.2rem}
.profile-info .ghii{color:var(--love1);font-family:monospace;font-size:.9rem}
.profile-info .meta{color:var(--muted);font-size:.85rem;margin-top:.3rem}

/* Stats bar */
.stats-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem;margin-bottom:2rem}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;text-align:center}
.stat-card .num{font-size:1.6rem;font-weight:700;color:var(--love1)}
.stat-card .label{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:.2rem}

/* Tabs */
.tabs{display:flex;gap:.25rem;border-bottom:2px solid var(--border);margin-bottom:1.5rem;flex-wrap:wrap}
.tab{padding:.6rem 1.2rem;cursor:pointer;color:var(--muted);font-weight:600;font-size:.9rem;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s;background:none;border-top:none;border-left:none;border-right:none}
.tab:hover{color:var(--text)}
.tab.active{color:var(--love1);border-bottom-color:var(--love1)}
.tab-panel{display:none}
.tab-panel.active{display:block}

/* Cards */
.section-title{font-size:1.15rem;font-weight:600;margin-bottom:.4rem;color:var(--love1)}
.section-desc{color:var(--muted);font-size:.85rem;margin-bottom:1.25rem;line-height:1.5;max-width:700px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:.75rem;transition:border-color .2s}
.card:hover{border-color:var(--love1)}
.card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}
.card-title{font-weight:600;font-size:1rem}
.card-subtitle{color:var(--muted);font-size:.8rem}
.badge{display:inline-block;padding:.15rem .5rem;border-radius:6px;font-size:.7rem;font-weight:700;letter-spacing:.03em}
.badge-success{background:rgba(34,197,94,.15);color:var(--success)}
.badge-warn{background:rgba(245,158,11,.15);color:var(--warn)}
.badge-info{background:rgba(255,107,157,.15);color:var(--love1)}
.badge-danger{background:rgba(239,68,68,.15);color:var(--danger)}
.badge-muted{background:rgba(196,166,208,.1);color:var(--muted)}

/* Agent card specifics */
.agent-card .gaii{font-family:monospace;font-size:.8rem;color:var(--muted)}
.agent-card .caps{display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.5rem}
.agent-card .caps .cap{font-size:.7rem;background:rgba(255,107,157,.1);color:var(--love4);padding:.15rem .4rem;border-radius:4px}

/* Wallet */
.wallet-overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin-bottom:1.5rem}
.wallet-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;text-align:center}
.wallet-card .amount{font-size:1.4rem;font-weight:700}
.wallet-card .amount.positive{color:var(--success)}
.wallet-card .amount.neutral{color:var(--love1)}
.wallet-card .wlabel{font-size:.75rem;color:var(--muted);text-transform:uppercase;margin-top:.2rem}
.tx-list{max-height:400px;overflow-y:auto}
.tx-item{display:flex;justify-content:space-between;align-items:center;padding:.6rem .8rem;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem}
.tx-item:last-child{border-bottom:none}
.tx-amount{font-weight:600;font-family:monospace}
.tx-amount.credit{color:var(--success)}
.tx-amount.debit{color:var(--danger)}
.tx-type{font-size:.75rem;color:var(--muted)}
.tx-date{font-size:.75rem;color:var(--muted)}

/* Memory list */
.mem-item{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.08);font-size:.85rem;cursor:pointer}
.mem-item:hover{background:rgba(255,107,157,.05)}
.mem-key{font-family:monospace;color:var(--love3);font-weight:500}
.mem-vis{font-size:.7rem}

/* Memory expanded view */
.mem-detail{background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1rem;margin-top:.5rem;font-size:.85rem}
.mem-detail pre{white-space:pre-wrap;word-break:break-all;font-family:monospace;color:var(--text);font-size:.8rem}
.mem-detail .mem-actions{display:flex;gap:.5rem;margin-top:.75rem}

/* Work items */
.work-status{display:flex;gap:.4rem;align-items:center}

/* OTK list */
.otk-item{font-size:.85rem;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.08)}
.otk-key{font-family:monospace;font-size:.8rem;color:var(--love3);word-break:break-all}
.otk-meta{color:var(--muted);font-size:.75rem;margin-top:.2rem}

/* Federation */
.peer-card{display:flex;justify-content:space-between;align-items:center}
.peer-status{display:flex;align-items:center;gap:.4rem}
.peer-dot{width:8px;height:8px;border-radius:50%}
.peer-dot.alive{background:var(--success)}
.peer-dot.dead{background:var(--danger)}

/* Personal Node cards */
.pn-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:.75rem;transition:border-color .2s;overflow:hidden}
.pn-card:hover{border-color:var(--love1)}
.pn-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.25rem;cursor:pointer;user-select:none}
.pn-header-left{display:flex;align-items:center;gap:.75rem}
.pn-status-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.pn-status-dot.online{background:var(--success);box-shadow:0 0 6px rgba(34,197,94,.4)}
.pn-status-dot.offline{background:var(--danger)}
.pn-status-dot.degraded{background:var(--warn)}
.pn-status-dot.detached{background:var(--muted)}
.pn-name{font-weight:600;font-family:monospace;font-size:.9rem}
.pn-badges{display:flex;gap:.4rem;align-items:center}
.pn-quick{font-size:.8rem;color:var(--muted);padding:0 1.25rem .75rem}
.pn-arrow{color:var(--muted);font-size:.8rem;transition:transform .2s}
.pn-arrow.open{transform:rotate(180deg)}
.pn-details{display:none;padding:0 1.25rem 1.25rem;border-top:1px solid rgba(255,107,157,.08)}
.pn-details.open{display:block}
.pn-detail-row{display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid rgba(255,107,157,.06);font-size:.85rem}
.pn-detail-row:last-child{border-bottom:none}
.pn-detail-label{color:var(--muted);font-size:.8rem}
.pn-detail-value{font-family:monospace;font-size:.8rem;color:var(--text);word-break:break-all}
.pn-agent-list{display:flex;flex-direction:column;gap:.3rem;margin:.5rem 0}
.pn-agent-item{font-family:monospace;font-size:.8rem;color:var(--love3);padding:.2rem .5rem;background:rgba(255,107,157,.08);border-radius:4px}
.pn-vis-toggle{display:flex;gap:2px;border-radius:6px;overflow:hidden;border:1px solid var(--border)}
.pn-vis-btn{padding:4px 12px;border:none;cursor:pointer;font-size:.75rem;font-weight:600;background:transparent;color:var(--muted);transition:all .2s}
.pn-vis-btn.active{background:var(--love1);color:#fff}
.pn-vis-btn:hover:not(.active){color:var(--text)}
.pn-setup{display:none;margin-top:.75rem;background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1rem;font-size:.85rem;line-height:1.7}
.pn-setup.open{display:block}
.pn-setup ol{margin-left:1.5rem;margin-bottom:.5rem}
.pn-setup li{margin-bottom:.3rem;color:var(--muted)}
.pn-detach-btn{margin-top:.75rem;padding:6px 16px;background:transparent;color:var(--danger);border:1px solid var(--danger);border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s}
.pn-detach-btn:hover{background:rgba(239,68,68,.15)}

/* Agent CTA */
.agent-cta{background:linear-gradient(135deg,rgba(30,20,40,.95),rgba(50,20,50,.9));border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem;margin-bottom:1.5rem}
.agent-cta h3{color:var(--love1);margin-bottom:.5rem;font-size:1.05rem}
.agent-cta p{font-size:.9rem;color:var(--muted);margin-bottom:.75rem}
.agent-prompt-box{position:relative;background:rgba(15,10,20,.8);border:1px solid rgba(255,107,157,.15);border-radius:8px;padding:1rem;font-family:monospace;font-size:.8rem;color:var(--text);white-space:pre-wrap;word-break:break-all;line-height:1.5;margin-bottom:1rem;max-height:300px;overflow-y:auto}
.copy-prompt-btn{background:var(--love2);color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:.8rem;font-weight:600;transition:all .2s}
.copy-prompt-btn:hover{background:var(--love1)}
.expand-btn{background:none;border:1px solid var(--border);color:var(--love4);border-radius:8px;padding:8px 16px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s;display:inline-flex;align-items:center;gap:6px}
.expand-btn:hover{border-color:var(--love1);color:var(--love1)}
.platform-instructions{display:none;margin-top:1rem}
.platform-instructions.expanded{display:block}
.platform-tabs{display:flex;gap:.25rem;flex-wrap:wrap;margin-bottom:1rem}
.platform-tab{padding:.5rem 1rem;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:pointer;color:var(--muted);font-size:.8rem;font-weight:600;transition:all .2s}
.platform-tab:hover{color:var(--text);border-color:var(--love4)}
.platform-tab.active{color:var(--love1);border-color:var(--love1);background:rgba(255,107,157,.1)}
.platform-content{background:rgba(15,10,20,.6);border:1px solid rgba(255,107,157,.1);border-radius:8px;padding:1.25rem;font-size:.85rem;line-height:1.7}
.platform-content ol{margin-left:1.5rem;margin-bottom:.75rem}
.platform-content li{margin-bottom:.4rem}
.platform-content code{background:rgba(255,107,157,.1);padding:1px 5px;border-radius:3px;font-size:.8rem;color:var(--love3)}
.platform-panel{display:none}
.platform-panel.active{display:block}

/* Empty state */
.empty{text-align:center;padding:2rem;color:var(--muted);font-size:.9rem}

/* Spinner */
.spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--love1);border-radius:50%;animation:spin .6s linear infinite;margin-right:.5rem;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.loading-text{color:var(--muted);font-size:.9rem}

/* Language toggle */
.lang-toggle{display:flex;gap:2px;margin-right:.5rem}
.lang-btn{padding:4px 10px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:.75rem;font-weight:700;border-radius:4px;transition:all .2s}
.lang-btn:first-child{border-radius:4px 0 0 4px}
.lang-btn:last-child{border-radius:0 4px 4px 0}
.lang-btn.active{background:var(--love1);color:#fff;border-color:var(--love1)}
.lang-btn:hover{color:var(--text)}

/* Sub-tabs */
.sub-tabs{display:flex;gap:.25rem;margin-bottom:1rem}
.sub-tab{padding:.4rem .8rem;cursor:pointer;color:var(--muted);font-weight:600;font-size:.8rem;background:var(--card);border:1px solid var(--border);border-radius:6px;transition:all .2s}
.sub-tab:hover{color:var(--text)}
.sub-tab.active{color:var(--love1);border-color:var(--love1);background:rgba(255,107,157,.1)}
.sub-panel{display:none}
.sub-panel.active{display:block}

/* Action bar */
.action-bar{display:flex;justify-content:space-between;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap}
.search-bar{display:flex;gap:.5rem;flex:1;max-width:500px}

/* Form elements */
.input-field{width:100%;padding:8px 12px;background:rgba(15,10,20,.8);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.85rem;font-family:inherit}
.input-field:focus{outline:none;border-color:var(--love1)}
select.input-field{cursor:pointer}
textarea.input-field{resize:vertical;min-height:60px}

/* Create forms */
.create-form{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem;margin-bottom:1rem}
.form-row{margin-bottom:.75rem}
.form-row label{display:block;font-size:.8rem;color:var(--muted);margin-bottom:.3rem;font-weight:600}
.form-actions{display:flex;gap:.5rem;margin-top:1rem}

/* Buttons */
.btn-primary{background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:.85rem;font-weight:600;transition:all .2s}
.btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(255,107,157,.3)}
.btn-sm{padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;background:var(--love2);color:#fff;border:none;transition:all .2s}
.btn-sm:hover{background:var(--love1)}
.btn-outline{padding:6px 12px;border-radius:6px;cursor:pointer;font-size:.8rem;font-weight:600;background:transparent;color:var(--muted);border:1px solid var(--border);transition:all .2s}
.btn-outline:hover{color:var(--text);border-color:var(--love4)}
.btn-danger{background:var(--danger);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.8rem;font-weight:600}
.btn-danger:hover{opacity:.8}
.btn-icon{background:none;border:none;cursor:pointer;font-size:1rem;padding:4px 6px;border-radius:4px;transition:all .2s}
.btn-icon:hover{background:rgba(255,107,157,.1)}

/* App gallery */
.app-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
.app-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;transition:all .2s}
.app-card:hover{border-color:var(--love1);transform:translateY(-2px)}
.app-screenshot{width:100%;height:180px;object-fit:cover;background:rgba(15,10,20,.6);display:flex;align-items:center;justify-content:center}
.app-screenshot img{width:100%;height:100%;object-fit:cover}
.app-screenshot .placeholder{color:var(--muted);font-size:2rem}
.app-info{padding:1rem}
.app-info .app-name{font-weight:600;font-size:.95rem;margin-bottom:.3rem}
.app-info .app-meta{font-size:.75rem;color:var(--muted)}

/* Upload form */
.file-input-wrap{position:relative;display:inline-flex}
.file-input-wrap input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer}
.file-label{display:inline-flex;align-items:center;gap:.5rem;padding:8px 16px;background:var(--card);border:1px dashed var(--border);border-radius:8px;color:var(--muted);font-size:.85rem;cursor:pointer;transition:all .2s}
.file-label:hover{border-color:var(--love1);color:var(--text)}

/* File storage grid */
.file-grid{display:flex;flex-direction:column;gap:.5rem}
.file-card{display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;background:var(--card);border:1px solid var(--border);border-radius:var(--radius);transition:all .2s}
.file-card:hover{border-color:var(--love1)}
.file-icon{font-size:1.5rem;min-width:2rem;text-align:center}
.file-info{flex:1;min-width:0}
.file-name{font-weight:600;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-meta{font-size:.75rem;color:var(--muted)}
.file-actions{display:flex;gap:.25rem;flex-shrink:0}

/* Board post */
.post-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:1rem;margin-bottom:.75rem}
.post-content{font-size:.9rem;margin-bottom:.5rem;line-height:1.5}
.post-meta{font-size:.75rem;color:var(--muted);display:flex;justify-content:space-between;align-items:center}
.post-reactions{display:flex;gap:.4rem;margin-top:.5rem}
.reaction-btn{padding:2px 8px;border-radius:12px;border:1px solid var(--border);background:transparent;cursor:pointer;font-size:.8rem;transition:all .2s}
.reaction-btn:hover{border-color:var(--love1);background:rgba(255,107,157,.1)}
.reaction-btn.active{border-color:var(--love1);background:rgba(255,107,157,.15)}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px)}
.modal{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:2rem;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}
.modal h3{color:var(--love1);margin-bottom:1rem}

/* Toast notification */
.toast{position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);background:var(--success);color:#fff;padding:.75rem 1.5rem;border-radius:8px;font-weight:600;font-size:.85rem;z-index:2000;animation:toastIn .3s ease,toastOut .3s ease 2.5s forwards}
.toast.error{background:var(--danger)}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
@keyframes toastOut{from{opacity:1}to{opacity:0}}

/* Pagination */
.pagination{display:flex;justify-content:center;gap:.5rem;margin-top:1rem}
.page-btn{padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:.8rem}
.page-btn.active{background:var(--love1);color:#fff;border-color:var(--love1)}
.page-btn:hover{border-color:var(--love4)}

/* Star rating */
.star-rating{display:flex;gap:.25rem}
.star{font-size:1.5rem;cursor:pointer;color:var(--muted);transition:color .15s}
.star:hover,.star.active{color:var(--warn)}

/* Responsive */
@media(max-width:600px){
  .profile-header{flex-direction:column;text-align:center}
  .stats-bar{grid-template-columns:repeat(2,1fr)}
  .wallet-overview{grid-template-columns:repeat(2,1fr)}
  .topbar{flex-direction:column;gap:.5rem;text-align:center}
  .action-bar{flex-direction:column;align-items:stretch}
  .search-bar{max-width:100%}
  .app-grid{grid-template-columns:1fr}
}
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
var session = null;

// ── Clipboard helper (fallback for HTTP) ──
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(function() { return fallbackCopy(text); });
  }
  return fallbackCopy(text);
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
  return Promise.resolve();
}

// ── i18n helper ──
function t(key) { return T[key] || key; }

function switchLang(lang) {
  var url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  localStorage.setItem('aimeat-lang', lang);
  document.cookie = 'aimeat-lang=' + lang + ';path=/;max-age=31536000;SameSite=Lax';
  window.location.href = url.toString();
}

// ── Auth setup ──
console.log('[AIMEAT Profile] Starting auth...', { AIMEAT: !!window.AIMEAT, auth: !!(window.AIMEAT && window.AIMEAT.auth) });
var storedRaw = localStorage.getItem('aimeat_session');
console.log('[AIMEAT Profile] Stored session:', storedRaw ? 'exists (' + storedRaw.substring(0,60) + '...)' : 'NONE');

var auth = window.AIMEAT && window.AIMEAT.auth;
if (auth) {
  auth.mountLoginButton('#auth-container', {
    i18n: (function() {
      var m = {};
      for (var k in T) { if (k.indexOf('modal.') === 0) m[k.slice(6)] = T[k]; }
      return m;
    })(),
    onLogin: function(s) { console.log('[AIMEAT Profile] onLogin callback', s); session = s; showProfile(); },
    onLogout: function() { console.log('[AIMEAT Profile] onLogout callback'); session = null; hideProfile(); },
  });
  auth.login().then(function(s) {
    console.log('[AIMEAT Profile] auth.login() result:', s ? 'session OK (gaii=' + s.gaii + ')' : 'null');
    if (s) { session = s; showProfile(); }
    else {
      console.log('[AIMEAT Profile] No session after login, stored now:', localStorage.getItem('aimeat_session') ? 'still exists' : 'DELETED');
      renderLoginSplash();
    }
  }).catch(function(e) {
    console.error('[AIMEAT Profile] auth.login() THREW:', e);
    renderLoginSplash();
  });
} else {
  console.error('[AIMEAT Profile] window.AIMEAT.auth not found! Script may have failed to load.');
  renderLoginSplash();
}

function renderLoginSplash() {
  var area = document.getElementById('login-area');
  area.innerHTML = '<button onclick="document.querySelector(\\'#auth-container button\\').click()" '
    + 'style="padding:12px 28px;background:linear-gradient(135deg,var(--love1),var(--love2));color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:1rem;box-shadow:0 0 20px rgba(255,107,157,.3)">'
    + '\\u{1F496} ' + t('profile.signInBtn') + '</button>';
}

function showProfile() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('profile-screen').style.display = 'block';
  updateAgentPrompt();
  loadAll();
}
function hideProfile() {
  document.getElementById('login-screen').style.display = 'block';
  document.getElementById('profile-screen').style.display = 'none';
}

function escHtml(s) { if (s == null) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

// ── Toast notifications ──
function showToast(msg, isError) {
  var existing = document.querySelector('.toast');
  if (existing) existing.remove();
  var el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function(){ el.remove(); }, 3000);
}

// ── Tabs ──
document.getElementById('tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.tab');
  if (!btn) return;
  var tab = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === tab); });
  document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'panel-' + tab); });
});

// ── Sub-tab handling (generic) ──
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.sub-tab');
  if (!btn) return;
  var container = btn.closest('.tab-panel');
  if (!container) return;
  container.querySelectorAll('.sub-tab').forEach(function(t){ t.classList.toggle('active', t === btn); });
  var target = btn.dataset.subtab;
  container.querySelectorAll('.sub-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'subpanel-' + target); });
  // Lazy-load content
  if (target === 'memory-files') loadFiles();
  if (target === 'services-catalogue') loadCatalogue();
  if (target === 'boards-browse') loadAllBoards();
  if (target === 'apps-gallery') loadAllApps();
  if (target === 'work-sent') loadSentWork();
});

// ── Data loading ──
async function loadAll() {
  if (!session) return;
  var dn = session.ghii || session.owner;
  document.getElementById('display-name').textContent = dn;
  document.getElementById('ghii-label').textContent = session.ghii || '';
  document.getElementById('profile-meta').textContent = t('profile.node') + ': ' + NODE_URL;

  // Load everything in parallel
  loadAgents();
  loadChatSessions();
  loadWallet();
  loadMemory();
  loadFiles();
  loadWork();
  loadActions();
  loadBoards();
  loadApps();
  loadFederation();
  loadAccess();
  loadNodes();
}

// Helper to do authenticated fetch
async function apiFetch(path) {
  try {
    var resp = await session.fetch(path);
    if (resp && resp.ok !== undefined) return resp;
    return resp;
  } catch(e) {
    return null;
  }
}

// ── Agents ──
async function loadAgents() {
  var el = document.getElementById('agents-list');
  try {
    var data = await apiFetch('/v1/agents');
    var agents = data && data.data && data.data.agents ? data.data.agents : (Array.isArray(data) ? data : []);
    document.getElementById('stat-agents').textContent = agents.length;

    if (agents.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.agents.empty') + '</div>'; return; }
    var html = '';
    agents.forEach(function(a) {
      var trustPct = Math.round((a.trust_score || 0) * 100);
      var trustClass = trustPct >= 80 ? 'badge-success' : trustPct >= 50 ? 'badge-warn' : 'badge-danger';
      html += '<div class="card agent-card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(a.display_name || a.name) + '</div>'
        + '<div class="gaii">' + escHtml(a.gaii) + '</div></div>'
        + '<span class="badge ' + trustClass + '">' + t('profile.agents.trust') + ': ' + trustPct + '%</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>';
      if (a.capabilities && a.capabilities.length) {
        html += '<div class="caps">';
        a.capabilities.forEach(function(c) { html += '<span class="cap">' + escHtml(c) + '</span>'; });
        html += '</div>';
      }
      html += '<div class="card-subtitle" style="margin-top:.5rem">' + t('profile.agents.balance') + ': <strong>' + (a.morsel_balance || 0) + '</strong> ' + t('profile.stats.morsels').toLowerCase()
        + (a.last_seen ? ' &bull; ' + t('profile.agents.lastSeen') + ': ' + new Date(a.last_seen).toLocaleString() : '') + '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.agents.loadError') + '</div>'; }
}

// ── Chat Sessions ──
async function loadChatSessions() {
  var el = document.getElementById('chatsessions-list');
  try {
    var csData = await apiFetch('/v1/chat-instances');
    var csList = (csData && csData.data && csData.data.chat_instances) ? csData.data.chat_instances : [];
    document.getElementById('stat-chatsessions').textContent = csList.length;
    var csHtml = '';
    if (csList.length === 0) {
      csHtml = '<div class="empty">' + t('profile.chatSessions.empty') + '</div>';
    } else {
      csList.forEach(function(c) {
        csHtml += '<div class="card">';
        csHtml += '<div class="card-header"><div><span class="card-title">' + escHtml(c.platform) + '</span>';
        csHtml += '<div class="card-subtitle">' + escHtml(c.app_name) + '</div></div>';
        csHtml += '<span class="badge badge-info">' + (c.is_anonymous ? t('profile.chatSessions.anonymous') : escHtml(c.platform)) + '</span></div>';
        csHtml += '<div style="font-size:.8rem;color:var(--muted);margin-top:.4rem">' + t('profile.chatSessions.lastSeen') + ': ' + new Date(c.last_seen).toLocaleString() + '</div>';
        csHtml += '</div>';
      });
    }
    el.innerHTML = csHtml;
  } catch(e) {
    el.innerHTML = '<div class="empty">' + t('profile.chatSessions.error') + '</div>';
  }
}

// ── Wallet ──
async function loadWallet() {
  var el = document.getElementById('wallet-area');
  try {
    var data = await apiFetch('/v1/wallet');
    var w = data && data.data ? data.data : null;
    if (!w) { el.innerHTML = '<div class="empty">' + t('profile.wallet.empty') + '</div>'; return; }
    document.getElementById('stat-balance').textContent = w.balance || 0;

    var html = '<div class="wallet-overview">'
      + '<div class="wallet-card"><div class="amount neutral">' + (w.balance || 0) + '</div><div class="wlabel">' + t('profile.wallet.balance') + '</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--warn)">' + (w.in_escrow || 0) + '</div><div class="wlabel">' + t('profile.wallet.inEscrow') + '</div></div>'
      + '<div class="wallet-card"><div class="amount positive">' + (w.available || 0) + '</div><div class="wlabel">' + t('profile.wallet.available') + '</div></div>'
      + '<div class="wallet-card"><div class="amount" style="color:var(--muted)">' + (w.daily_allowance ? w.daily_allowance.amount : '-') + '</div><div class="wlabel">' + t('profile.wallet.dailyAllowance') + '</div></div>'
      + '</div>';

    // Try loading transactions
    try {
      var txData = await apiFetch('/v1/wallet/transactions');
      var txs = txData && txData.data && txData.data.transactions ? txData.data.transactions : [];
      if (txs.length > 0) {
        html += '<h3 style="color:var(--love1);margin-bottom:.75rem">' + t('profile.wallet.recentTx') + '</h3>';
        html += '<div class="card"><div class="tx-list">';
        txs.slice(0, 50).forEach(function(tx) {
          var isCredit = tx.amount > 0;
          html += '<div class="tx-item">'
            + '<div><div class="tx-type">' + escHtml(tx.type || 'transfer') + '</div>'
            + (tx.counterparty_gaii ? '<div class="tx-date">' + escHtml(tx.counterparty_gaii) + '</div>' : '')
            + '</div>'
            + '<div class="tx-amount ' + (isCredit ? 'credit' : 'debit') + '">' + (isCredit ? '+' : '') + tx.amount + '</div>'
            + '</div>';
        });
        html += '</div></div>';
      }
    } catch(e) {}

    if (w.lifetime) {
      html += '<div style="margin-top:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.5rem">'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--success)">' + (w.lifetime.earned || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.earned') + '</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--love1)">' + (w.lifetime.spent || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.shared') + '</div></div>'
        + '<div class="card" style="text-align:center;padding:.75rem"><div style="font-size:1.1rem;font-weight:700;color:var(--love1)">' + (w.lifetime.welcome_bonus || 0) + '</div><div style="font-size:.7rem;color:var(--muted)">' + t('profile.wallet.welcomeBonus') + '</div></div>'
        + '</div>';
    }

    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.wallet.error') + '</div>'; }
}

// ── Memory ──
function renderMemoryList(entries, el) {
  document.getElementById('stat-memory').textContent = entries.length;
  if (entries.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.memory.noResults') + '</div>'; return; }
  var html = '<div class="card">';
  entries.forEach(function(m) {
    var visBadge = m.visibility === 'public' ? 'badge-success' : m.visibility === 'shared' ? 'badge-warn' : 'badge-muted';
    html += '<div class="mem-item" data-memkey="' + escHtml(m.key) + '" onclick="viewMemory(\\'' + escHtml(m.key).replace(/'/g, "\\\\'") + '\\')">'
      + '<div class="mem-key">' + escHtml(m.key) + '</div>'
      + '<div><span class="badge mem-vis ' + visBadge + '">' + escHtml(m.visibility || 'private') + '</span>'
      + (m.tags && m.tags.length ? ' <span style="font-size:.7rem;color:var(--muted)">' + m.tags.map(escHtml).join(', ') + '</span>' : '')
      + '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

async function loadMemory() {
  var el = document.getElementById('memory-list');
  try {
    var data = await apiFetch('/v1/memory');
    var entries = data && data.data && data.data.entries ? data.data.entries : [];
    renderMemoryList(entries, el);
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.memory.error') + '</div>'; }
}

function toggleMemoryForm() {
  var el = document.getElementById('memory-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function createMemory() {
  var key = document.getElementById('mem-key').value.trim();
  var value = document.getElementById('mem-value').value;
  var vis = document.getElementById('mem-vis').value;
  var tagsStr = document.getElementById('mem-tags').value.trim();
  var tags = tagsStr ? tagsStr.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  if (!key || !value) { showToast(t('profile.memory.keyRequired'), true); return; }

  try {
    var resp = await session.fetch('/v1/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key, value: value, visibility: vis, tags: tags })
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.memory.saved'));
      toggleMemoryForm();
      document.getElementById('mem-key').value = '';
      document.getElementById('mem-value').value = '';
      document.getElementById('mem-tags').value = '';
      loadMemory();
    } else {
      showToast(t('profile.memory.saveFailed') + ': ' + (resp && resp.error ? resp.error.message : t('profile.unknownError')), true);
    }
  } catch(e) { showToast(t('profile.memory.saveFailed'), true); }
}

async function viewMemory(key) {
  var existingEl = document.getElementById('mem-detail-' + key);
  if (existingEl) { existingEl.remove(); return; }

  try {
    var data = await apiFetch('/v1/memory/' + encodeURIComponent(key));
    var entry = data && data.data ? data.data : null;
    if (!entry) return;

    var containers = document.querySelectorAll('[data-memkey]');
    var container = null;
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].getAttribute('data-memkey') === key) { container = containers[i]; break; }
    }
    if (!container) return;

    var detail = document.createElement('div');
    detail.className = 'mem-detail';
    detail.id = 'mem-detail-' + key;
    var valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2);
    detail.innerHTML = '<pre>' + escHtml(valueStr) + '</pre>'
      + '<div class="mem-actions">'
      + '<button class="btn-sm" onclick="editMemoryPrompt(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.memory.editBtn') + '</button>'
      + '<button class="btn-danger" onclick="deleteMemory(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.memory.deleteBtn') + '</button>'
      + '</div>';
    container.after(detail);
  } catch(e) {}
}

async function deleteMemory(key) {
  if (!confirm(t('profile.memory.deleteConfirm') + ' "' + key + '"?')) return;
  try {
    await session.fetch('/v1/memory/' + encodeURIComponent(key), { method: 'DELETE' });
    showToast(t('profile.memory.deleted'));
    loadMemory();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function editMemoryPrompt(key) {
  try {
    var data = await apiFetch('/v1/memory/' + encodeURIComponent(key));
    var entry = data && data.data ? data.data : null;
    if (!entry) return;

    var valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="modal"><h3>' + t('profile.memory.editTitle') + ': ' + escHtml(key) + '</h3>'
      + '<div class="form-row"><label>' + t('profile.memory.valueLabel') + '</label><textarea id="edit-mem-value" class="input-field" rows="5">' + escHtml(valueStr) + '</textarea></div>'
      + '<div class="form-row"><label>' + t('profile.memory.visLabel') + '</label><select id="edit-mem-vis" class="input-field">'
      + '<option value="private"' + (entry.visibility === 'private' ? ' selected' : '') + '>' + t('profile.memory.visPrivate') + '</option>'
      + '<option value="shared"' + (entry.visibility === 'shared' ? ' selected' : '') + '>' + t('profile.memory.visShared') + '</option>'
      + '<option value="public"' + (entry.visibility === 'public' ? ' selected' : '') + '>' + t('profile.memory.visPublic') + '</option></select></div>'
      + '<div class="form-row"><label>' + t('profile.memory.tagsLabel') + '</label><input type="text" id="edit-mem-tags" class="input-field" value="' + escHtml((entry.tags || []).join(', ')) + '"></div>'
      + '<div class="form-actions"><button class="btn-primary" onclick="saveMemoryEdit(\\'' + escHtml(key).replace(/'/g, "\\\\'") + '\\')">' + t('profile.save') + '</button><button class="btn-outline" onclick="this.closest(\\'.modal-overlay\\').remove()">' + t('profile.cancel') + '</button></div></div>';
    document.body.appendChild(overlay);
  } catch(e) { showToast(t('profile.error'), true); }
}

async function saveMemoryEdit(key) {
  var value = document.getElementById('edit-mem-value').value;
  var vis = document.getElementById('edit-mem-vis').value;
  var tagsStr = document.getElementById('edit-mem-tags').value.trim();
  var tags = tagsStr ? tagsStr.split(',').map(function(t){ return t.trim(); }).filter(Boolean) : [];

  try {
    await session.fetch('/v1/memory/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: value, visibility: vis, tags: tags })
    });
    showToast(t('profile.memory.updated'));
    document.querySelector('.modal-overlay').remove();
    loadMemory();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function searchMemory() {
  var q = document.getElementById('memory-search').value.trim();
  if (!q) { loadMemory(); return; }
  var el = document.getElementById('memory-list');
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.memory.searchBtn') + '...';
  try {
    var data = await apiFetch('/v1/memory/search?q=' + encodeURIComponent(q));
    var entries = data && data.data && data.data.entries ? data.data.entries : [];
    renderMemoryList(entries, el);
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.memory.searchFailed') + '</div>'; }
}

// ── Files (Storage) ──
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function loadFiles() {
  var el = document.getElementById('files-list');
  try {
    var data = await apiFetch('/v1/storage');
    var files = data && data.data && data.data.files ? data.data.files : [];
    document.getElementById('stat-files').textContent = files.length;

    if (files.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.files.empty') + '</div>'; return; }
    var html = '<div class="file-grid">';
    files.forEach(function(f) {
      var isImage = f.mime_type && f.mime_type.startsWith('image/');
      var icon = isImage ? '\ud83d\uddbc\ufe0f' : f.mime_type && f.mime_type.includes('pdf') ? '\ud83d\udcc4' : f.mime_type && f.mime_type.includes('text') ? '\ud83d\udcdd' : '\ud83d\udcc1';
      var safeKey = escHtml(f.key).replace(/'/g, '&#39;');
      html += '<div class="file-card">'
        + '<div class="file-icon">' + icon + '</div>'
        + '<div class="file-info">'
        + '<div class="file-name" title="' + escHtml(f.key) + '">' + escHtml(f.key) + '</div>'
        + '<div class="file-meta">' + formatFileSize(f.size) + ' &bull; ' + escHtml(f.mime_type || 'unknown') + '</div>'
        + '<div class="file-meta">' + escHtml(f.visibility) + (f.created_at ? ' &bull; ' + new Date(f.created_at).toLocaleDateString() : '') + '</div>'
        + '</div>'
        + '<div class="file-actions">'
        + '<button class="btn-sm" onclick="downloadFile(decodeURIComponent(\\'' + encodeURIComponent(f.key) + '\\'))" title="' + t('profile.files.download') + '">\u2b07\ufe0f</button>'
        + '<button class="btn-sm btn-danger" onclick="deleteFile(decodeURIComponent(\\'' + encodeURIComponent(f.key) + '\\'))" title="' + t('profile.files.delete') + '">\u2716</button>'
        + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.files.error') + '</div>'; }
}

function toggleFileForm() {
  var form = document.getElementById('file-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function uploadFile() {
  var fileInput = document.getElementById('file-input');
  var keyInput = document.getElementById('file-key');
  var vis = document.getElementById('file-vis').value;

  if (!fileInput.files || !fileInput.files.length) {
    showToast(t('profile.files.selectFile'), true); return;
  }
  var file = fileInput.files[0];
  var key = keyInput.value.trim() || file.name;

  // Read file as base64
  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    try {
      var resp = await session.fetch('/v1/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key,
          visibility: vis,
          data: base64,
          mime_type: file.type || 'application/octet-stream'
        })
      });
      if (resp && resp.data) {
        showToast(t('profile.files.uploaded'));
        toggleFileForm();
        fileInput.value = '';
        keyInput.value = '';
        loadFiles();
      } else {
        showToast(t('profile.files.uploadFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
      }
    } catch(e) {
      showToast(t('profile.files.uploadFailed'), true);
    }
  };
  reader.readAsDataURL(file);
}

async function downloadFile(key) {
  try {
    // Use raw fetch with JWT since session.fetch() auto-parses as JSON
    var resp = await fetch(NODE_URL + '/v1/storage/' + encodeURIComponent(key), {
      headers: { 'Authorization': 'Bearer ' + session.jwt }
    });
    if (!resp || !resp.ok) { showToast(t('profile.files.error'), true); return; }
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = key;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) { showToast(t('profile.files.error'), true); }
}

async function deleteFile(key) {
  if (!confirm(t('profile.files.deleteConfirm') + ': ' + key)) return;
  try {
    var resp = await session.fetch('/v1/storage/' + encodeURIComponent(key), { method: 'DELETE' });
    if (resp && resp.data && resp.data.deleted) {
      showToast(t('profile.files.deleted'));
      loadFiles();
    } else {
      showToast(t('profile.files.error'), true);
    }
  } catch(e) { showToast(t('profile.files.error'), true); }
}

// ── Board creation ──
function toggleBoardForm() {
  var form = document.getElementById('board-create-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

async function createBoard() {
  var name = document.getElementById('board-name').value.trim();
  var desc = document.getElementById('board-desc').value.trim();
  var vis = document.getElementById('board-vis').value;
  if (!name) { showToast(t('profile.boards.createFailed'), true); return; }
  try {
    var resp = await session.fetch('/v1/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, description: desc, visibility: vis })
    });
    if (resp && resp.data) {
      showToast(t('profile.boards.created'));
      toggleBoardForm();
      document.getElementById('board-name').value = '';
      document.getElementById('board-desc').value = '';
      loadBoards();
    } else {
      showToast(t('profile.boards.createFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
    }
  } catch(e) { showToast(t('profile.boards.createFailed'), true); }
}

async function subscribeBoard(boardId) {
  try {
    var resp = await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (resp && resp.data) {
      showToast(t('profile.boards.subscribed'));
      loadBoards();
    } else {
      showToast(t('profile.boards.subscribeFailed') + (resp && resp.error ? ': ' + resp.error.message : ''), true);
    }
  } catch(e) { showToast(t('profile.boards.subscribeFailed'), true); }
}

// ── App creation prompt ──
function copyAppPrompt() {
  var prompt = 'I want to create a self-contained HTML application that connects to an AIMEAT node. '
    + 'The node is at: ' + NODE_URL + '\\n\\n'
    + 'Please read the attached AIMEAT-OS.md file for the complete API reference and guidelines. '
    + 'The app should be a single HTML file with embedded CSS and JavaScript that I can upload and share. '
    + 'Start by asking me what kind of app I want to build, then help me design and implement it step by step.';
  copyToClipboard(prompt).then(function() {
    showToast(t('profile.apps.promptCopied'));
  });
}

// ── Work ──
async function loadWork() {
  var el = document.getElementById('work-list');
  try {
    var data = await apiFetch('/v1/work/inbox');
    var items = data && data.data && data.data.items ? data.data.items : [];
    document.getElementById('stat-work').textContent = items.length;
    if (items.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.work.empty') + '</div>'; return; }
    var html = '';
    items.forEach(function(w) {
      var statusClass = w.status === 'completed' ? 'badge-success' : w.status === 'delivered' ? 'badge-info' : w.status === 'accepted' ? 'badge-warn' : w.status === 'in_progress' ? 'badge-info' : w.status === 'failed' ? 'badge-danger' : w.status === 'disputed' ? 'badge-danger' : 'badge-muted';
      html += '<div class="card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(w.action_id || w.tracking_code) + '</div>'
        + '<div class="card-subtitle">' + escHtml(w.tracking_code) + '</div></div>'
        + '<div class="work-status"><span class="badge ' + statusClass + '">' + escHtml(w.status) + '</span></div></div>'
        + '<div class="card-subtitle">'
        + (w.requester_gaii ? t('profile.work.from') + ': ' + escHtml(w.requester_gaii) : '')
        + (w.cost ? ' &bull; ' + t('profile.work.cost') + ': ' + w.cost + ' ' + t('profile.stats.morsels').toLowerCase() : '') + '</div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.work.error') + '</div>'; }
}

async function loadSentWork() {
  var el = document.getElementById('work-sent-list');
  try {
    var data = await apiFetch('/v1/work/inbox');
    var items = data && data.data && data.data.items ? data.data.items : [];
    if (items.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.work.sentEmpty') + '</div>'; return; }
    var html = '';
    items.forEach(function(w) {
      var statusClass = w.status === 'completed' ? 'badge-success' : w.status === 'delivered' ? 'badge-info' : w.status === 'accepted' ? 'badge-warn' : w.status === 'disputed' ? 'badge-danger' : 'badge-muted';
      html += '<div class="card">'
        + '<div class="card-header"><div><div class="card-title">' + escHtml(w.action_id || w.tracking_code) + '</div>'
        + '<div class="card-subtitle">' + escHtml(w.tracking_code) + '</div></div>'
        + '<div class="work-status"><span class="badge ' + statusClass + '">' + escHtml(w.status) + '</span></div></div>'
        + '<div class="card-subtitle">'
        + (w.provider_gaii ? t('profile.work.provider') + ': ' + escHtml(w.provider_gaii) : '')
        + (w.cost ? ' &bull; ' + t('profile.work.cost') + ': ' + w.cost + ' ' + t('profile.stats.morsels').toLowerCase() : '') + '</div>';

      // Rate button for delivered items
      if (w.status === 'delivered') {
        html += '<div style="margin-top:.5rem"><button class="btn-sm" onclick="showRateModal(\\'' + escHtml(w.tracking_code) + '\\')">' + t('profile.work.rateBtn') + '</button></div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.work.sentError') + '</div>'; }
}

function showRateModal(tc) {
  var overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="modal"><h3>' + t('profile.work.rateTitle') + '</h3>'
    + '<p style="color:var(--muted);font-size:.85rem">' + t('profile.work.rateDesc') + ' ' + escHtml(tc) + '</p>'
    + '<div class="star-rating" id="rate-stars">'
    + [1,2,3,4,5].map(function(n) { return '<span class="star" data-rating="' + n + '" onclick="selectRating(' + n + ')">&#9734;</span>'; }).join('')
    + '</div>'
    + '<div class="form-row" style="margin-top:1rem"><label>' + t('profile.work.commentLabel') + '</label><textarea id="rate-comment" class="input-field" rows="2"></textarea></div>'
    + '<div class="form-actions"><button class="btn-primary" onclick="submitRating(\\'' + escHtml(tc) + '\\')">' + t('profile.work.submitRating') + '</button><button class="btn-outline" onclick="this.closest(\\'.modal-overlay\\').remove()">' + t('profile.cancel') + '</button></div></div>';
  document.body.appendChild(overlay);
}

var currentRating = 0;
function selectRating(n) {
  currentRating = n;
  document.querySelectorAll('#rate-stars .star').forEach(function(s) {
    var r = parseInt(s.dataset.rating);
    s.innerHTML = r <= n ? '&#9733;' : '&#9734;';
    s.classList.toggle('active', r <= n);
  });
}

async function submitRating(tc) {
  if (currentRating === 0) { showToast(t('profile.work.selectRating'), true); return; }
  try {
    await session.fetch('/v1/work/' + tc + '/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: currentRating, comment: document.getElementById('rate-comment').value })
    });
    showToast(t('profile.work.ratingSubmitted'));
    document.querySelector('.modal-overlay').remove();
    currentRating = 0;
    loadSentWork();
  } catch(e) { showToast(t('profile.error'), true); }
}

// ── Actions (published services) ──
async function loadActions() {
  var el = document.getElementById('actions-list');
  try {
    var data = await apiFetch('/v1/actions');
    var actions = data && data.data && data.data.actions ? data.data.actions : [];
    // Filter to own actions
    var mine = actions.filter(function(a) { return a.provider_gaii === session.gaii; });
    document.getElementById('stat-actions').textContent = mine.length;
    if (mine.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.services.empty') + '</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.display_name || a.id) + '</div>'
        + '<div><span class="badge badge-info">' + escHtml(a.category || 'general') + '</span>'
        + ' <button class="btn-icon" title="' + t('profile.delete') + '" onclick="deleteAction(\\'' + escHtml(a.id) + '\\')">\\u{1F5D1}\\u{FE0F}</button></div></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>'
        + (a.pricing && a.pricing.amount ? '<div class="card-subtitle" style="margin-top:.3rem">' + t('profile.services.price') + ': <strong>' + a.pricing.amount + '</strong> ' + t('profile.stats.morsels').toLowerCase() + '/' + (a.pricing.unit || 'call') + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.services.error') + '</div>'; }
}

function togglePublishForm() {
  var el = document.getElementById('publish-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function publishService() {
  var name = document.getElementById('svc-name').value.trim();
  var desc = document.getElementById('svc-desc').value.trim();
  var cat = document.getElementById('svc-category').value;
  var amount = parseInt(document.getElementById('svc-price').value) || 0;
  var unit = document.getElementById('svc-unit').value || 'call';
  var webhook = document.getElementById('svc-webhook').value.trim();

  if (!name || !desc) { showToast(t('profile.memory.keyRequired'), true); return; }

  try {
    var body = {
      display_name: name,
      description: desc,
      category: cat,
      pricing: { amount: amount, unit: unit },
    };
    if (webhook) body.webhook_url = webhook;

    await session.fetch('/v1/actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    showToast(t('profile.services.published'));
    togglePublishForm();
    document.getElementById('svc-name').value = '';
    document.getElementById('svc-desc').value = '';
    document.getElementById('svc-webhook').value = '';
    document.getElementById('svc-price').value = '0';
    loadActions();
  } catch(e) { showToast(t('profile.error'), true); }
}

async function deleteAction(id) {
  if (!confirm(t('profile.services.unpublishConfirm'))) return;
  try {
    await session.fetch('/v1/actions/' + encodeURIComponent(id), { method: 'DELETE' });
    showToast(t('profile.services.unpublished'));
    loadActions();
  } catch(e) { showToast(t('profile.error'), true); }
}

var cataloguePage = 1;
async function loadCatalogue(page) {
  page = page || 1;
  cataloguePage = page;
  var el = document.getElementById('catalogue-list');
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.services.loading');
  var catFilter = document.getElementById('cat-filter').value;
  var url = '/v1/catalogue/actions?page=' + page + '&per_page=20';
  if (catFilter) url += '&category=' + catFilter;
  try {
    var resp = await fetch(NODE_URL + url);
    var data = await resp.json();
    var actions = data && data.data && data.data.actions ? data.data.actions : (data && data.data ? [data.data].flat() : []);
    if (actions.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.services.catalogueEmpty') + '</div>'; return; }
    var html = '';
    actions.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.display_name || a.id) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.category || 'general') + '</span></div>'
        + '<div class="card-subtitle">' + escHtml(a.description || '') + '</div>'
        + '<div class="card-subtitle" style="margin-top:.3rem">'
        + t('profile.work.provider') + ': ' + escHtml(a.provider_gaii || 'unknown')
        + (a.pricing && a.pricing.amount ? ' &bull; ' + t('profile.services.price') + ': <strong>' + a.pricing.amount + '</strong> ' + t('profile.stats.morsels').toLowerCase() + '/' + (a.pricing.unit || 'call') : ' &bull; ' + t('profile.services.free'))
        + '</div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.services.catalogueError') + '</div>'; }
}

// ── Boards ──
async function loadBoards() {
  var el = document.getElementById('boards-list');
  try {
    var data = await apiFetch('/v1/boards/subscriptions');
    var subs = data && data.data && data.data.subscriptions ? data.data.subscriptions : [];
    if (subs.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.boards.empty') + '</div>'; return; }
    var html = '';
    subs.forEach(function(s) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(s.board_id || s.boardId) + '</div>'
        + '<span class="badge badge-success">' + t('profile.boards.mine') + '</span></div>'
        + (s.filters ? '<div class="card-subtitle">Filters: ' + escHtml(JSON.stringify(s.filters)) + '</div>' : '')
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.boards.error') + '</div>'; }
}

async function loadAllBoards() {
  var el = document.getElementById('boards-browse-list');
  if (!el) return;
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.boards.browseLoading');
  try {
    var resp = await fetch(NODE_URL + '/v1/catalogue/boards');
    var data = await resp.json();
    var boards = data && data.data && data.data.boards ? data.data.boards : [];
    if (boards.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.boards.browseEmpty') + '</div>'; return; }
    var html = '';
    boards.forEach(function(b) {
      html += '<div class="card" style="cursor:pointer" onclick="viewBoard(\\'' + escHtml(b.id) + '\\', \\'' + escHtml(b.name || b.id).replace(/'/g, "\\\\'") + '\\')">'
        + '<div class="card-header"><div class="card-title">' + escHtml(b.name || b.id) + '</div>'
        + '<span class="badge ' + (b.visibility === 'public' ? 'badge-success' : 'badge-warn') + '">' + escHtml(b.visibility || 'public') + '</span></div>'
        + (b.description ? '<div class="card-subtitle">' + escHtml(b.description) + '</div>' : '')
        + '<div style="margin-top:.5rem"><button class="btn-sm" onclick="event.stopPropagation();subscribeBoard(\\'' + escHtml(b.id) + '\\')">' + t('profile.boards.subscribe') + '</button></div>'
        + '</div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.boards.browseError') + '</div>'; }
}

async function viewBoard(boardId, boardName) {
  var el = document.getElementById('boards-browse-list');
  el.innerHTML = '<div style="margin-bottom:1rem"><button class="btn-outline" onclick="loadAllBoards()">&larr; ' + t('profile.boards.backToBoards') + '</button> <strong>' + escHtml(boardName) + '</strong></div>'
    + '<div class="create-form" style="margin-bottom:1rem"><div class="form-row"><label>' + t('profile.boards.newPost') + '</label><textarea id="board-post-content" class="input-field" rows="2" placeholder="' + t('profile.boards.postPlaceholder') + '"></textarea></div>'
    + '<div class="form-actions"><button class="btn-primary" onclick="createPost(\\'' + escHtml(boardId) + '\\')">' + t('profile.boards.postBtn') + '</button></div></div>'
    + '<div id="board-posts"><span class="spinner"></span> ' + t('profile.boards.postsLoading') + '</div>';

  try {
    var resp = await fetch(NODE_URL + '/v1/boards/' + encodeURIComponent(boardId) + '/posts');
    var data = await resp.json();
    var posts = data && data.data && data.data.posts ? data.data.posts : [];
    var postsEl = document.getElementById('board-posts');
    if (posts.length === 0) { postsEl.innerHTML = '<div class="empty">' + t('profile.boards.postsEmpty') + '</div>'; return; }
    var html = '';
    posts.forEach(function(p) {
      html += '<div class="post-card">'
        + '<div class="post-content">' + escHtml(p.content || p.body || '') + '</div>'
        + '<div class="post-meta"><span>' + escHtml(p.author_gaii || p.gaii || 'anonymous') + '</span>'
        + '<span>' + (p.created_at ? new Date(p.created_at).toLocaleString() : '') + '</span></div>'
        + '<div class="post-reactions">';
      var emojis = ['\\u{1F44D}', '\\u{2764}\\u{FE0F}', '\\u{1F525}', '\\u{2B50}', '\\u{1F602}'];
      emojis.forEach(function(emoji) {
        var count = p.reactions && p.reactions[emoji] ? p.reactions[emoji].length : 0;
        html += '<button class="reaction-btn" onclick="reactToPost(\\'' + escHtml(boardId) + '\\', \\'' + escHtml(p.id || p.postId) + '\\', \\'' + emoji + '\\')">' + emoji + (count > 0 ? ' ' + count : '') + '</button>';
      });
      html += '</div></div>';
    });
    postsEl.innerHTML = html;
  } catch(e) { document.getElementById('board-posts').innerHTML = '<div class="empty">' + t('profile.boards.postsError') + '</div>'; }
}

async function createPost(boardId) {
  var content = document.getElementById('board-post-content').value.trim();
  if (!content) { showToast(t('profile.boards.writeFirst'), true); return; }
  try {
    await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content })
    });
    showToast(t('profile.boards.posted'));
    document.getElementById('board-post-content').value = '';
    viewBoard(boardId, boardId);
  } catch(e) { showToast(t('profile.error'), true); }
}

async function reactToPost(boardId, postId, emoji) {
  try {
    await session.fetch('/v1/boards/' + encodeURIComponent(boardId) + '/posts/' + encodeURIComponent(postId) + '/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji: emoji })
    });
    viewBoard(boardId, boardId);
  } catch(e) { showToast(t('profile.error'), true); }
}

// ── Apps ──
async function loadApps() {
  var el = document.getElementById('apps-list');
  try {
    var resp = await fetch(NODE_URL + '/v1/apps');
    var data = await resp.json();
    var apps = data && data.data && data.data.apps ? data.data.apps : [];
    // Filter to own apps
    var mine = apps.filter(function(a) { return a.owner === session.owner; });
    document.getElementById('stat-apps').textContent = mine.length;
    if (mine.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.apps.empty') + '</div>'; return; }
    var html = '';
    mine.forEach(function(a) {
      html += '<div class="card">'
        + '<div class="card-header"><div class="card-title">' + escHtml(a.filename || a.name) + '</div>'
        + '<span class="badge badge-info">' + escHtml(a.content_type || 'html') + '</span></div>'
        + '<div class="card-subtitle"><a href="' + escHtml(NODE_URL + '/v1/apps/' + (a.owner || session.owner) + '/' + (a.filename || a.name)) + '" target="_blank">' + t('profile.apps.download') + ' / Open</a>'
        + (a.size ? ' &bull; ' + Math.round(a.size/1024) + ' KB' : '')
        + '</div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.apps.error') + '</div>'; }
}

function toggleUploadForm() {
  var el = document.getElementById('upload-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function loadAllApps() {
  var el = document.getElementById('apps-gallery-list');
  if (!el) return;
  el.innerHTML = '<span class="spinner"></span> ' + t('profile.apps.galleryLoading');
  try {
    var resp = await fetch(NODE_URL + '/v1/apps');
    var data = await resp.json();
    var apps = data && data.data && data.data.apps ? data.data.apps : [];
    if (apps.length === 0) { el.innerHTML = '<div class="empty">' + t('profile.apps.galleryEmpty') + '</div>'; return; }
    var html = '<div class="app-grid">';
    apps.forEach(function(a) {
      var screenshotUrl = a.screenshot_url ? (NODE_URL + a.screenshot_url) : null;
      html += '<div class="app-card">'
        + '<div class="app-screenshot">'
        + (screenshotUrl
          ? '<img src="' + escHtml(screenshotUrl) + '" alt="' + escHtml(a.filename) + '" onerror="this.parentElement.innerHTML=\\'<div class=placeholder>\\u{1F4F1}</div>\\'">'
          : '<div class="placeholder">\\u{1F4F1}</div>')
        + '</div>'
        + '<div class="app-info"><div class="app-name">' + escHtml(a.filename) + '</div>'
        + '<div class="app-meta">' + escHtml(a.owner) + ' &bull; ' + Math.round((a.size || 0) / 1024) + ' KB'
        + (a.protected ? ' &bull; \\u{1F512} ' + t('profile.apps.protected') : '') + '</div>'
        + '<div style="margin-top:.5rem"><a href="' + escHtml(NODE_URL + (a.download_url || '/v1/apps/' + a.owner + '/' + a.filename)) + '" class="btn-sm" style="text-decoration:none;display:inline-block">' + t('profile.apps.download') + '</a></div>'
        + '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.apps.galleryError') + '</div>'; }
}

async function uploadApp() {
  var fileInput = document.getElementById('app-file');
  var ssInput = document.getElementById('app-screenshot');
  var codeInput = document.getElementById('app-access-code');

  if (!fileInput.files.length) { showToast(t('profile.apps.selectFile'), true); return; }
  var file = fileInput.files[0];

  var reader = new FileReader();
  reader.onload = async function() {
    var base64 = reader.result.split(',')[1];
    var body = {
      filename: file.name,
      content: base64,
      mime_type: file.type || 'text/html',
    };
    var code = codeInput.value.trim();
    if (code) body.access_code = code;

    // Handle screenshot
    if (ssInput.files.length) {
      var ssReader = new FileReader();
      ssReader.onload = async function() {
        body.screenshot = ssReader.result.split(',')[1];
        body.screenshot_mime_type = ssInput.files[0].type || 'image/png';
        await doUpload(body);
      };
      ssReader.readAsDataURL(ssInput.files[0]);
    } else {
      await doUpload(body);
    }
  };
  reader.readAsDataURL(file);
}

async function doUpload(body) {
  try {
    var resp = await session.fetch('/v1/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.apps.uploaded'));
      document.getElementById('app-file').value = '';
      document.getElementById('app-screenshot').value = '';
      document.getElementById('app-access-code').value = '';
      document.getElementById('upload-form').style.display = 'none';
      loadApps();
    } else {
      showToast(t('profile.apps.uploadFailed') + ': ' + (resp && resp.error ? resp.error.message : t('profile.unknownError')), true);
    }
  } catch(e) { showToast(t('profile.apps.uploadFailed'), true); }
}

// ── Federation ──
async function loadFederation() {
  var el = document.getElementById('federation-area');
  try {
    var resp = await fetch(NODE_URL + '/v1/federation/directory');
    var data = await resp.json();
    var peers = data && data.data && data.data.peers ? data.data.peers : [];
    if (peers.length === 0) {
      el.innerHTML = '<div class="empty">' + t('profile.federation.empty') + '</div>';
      return;
    }
    var html = '<div class="section-title" style="margin-top:0">' + t('profile.federation.peers') + '</div>';
    peers.forEach(function(p) {
      var alive = p.status === 'active' || p.alive;
      html += '<div class="card"><div class="peer-card">'
        + '<div><div class="card-title">' + escHtml(p.node_id || p.nodeId || p.url) + '</div>'
        + '<div class="card-subtitle">' + escHtml(p.url || '') + '</div></div>'
        + '<div class="peer-status"><span class="peer-dot ' + (alive ? 'alive' : 'dead') + '"></span>'
        + '<span style="font-size:.8rem;color:' + (alive ? 'var(--success)' : 'var(--danger)') + '">' + (alive ? t('profile.federation.online') : t('profile.federation.offline')) + '</span>'
        + '</div></div></div>';
    });
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty">' + t('profile.federation.error') + '</div>'; }
}

// ── Agent CTA ──
function updateAgentPrompt() {
  var el = document.getElementById('agent-connect-prompt');
  if (!el || !session) return;
  var ownerName = session.owner || 'unknown';
  var ghii = session.ghii || (ownerName + '@' + (window.AIMEAT && window.AIMEAT.auth ? window.AIMEAT.auth.nodeId : 'unknown'));
  var nodeUrl = NODE_URL;
  el.textContent = 'I want you to register a new automation agent on my AIMEAT node.\\n\\n'
    + 'IMPORTANT: I already have an account. Do NOT create a new owner. Use my existing identity.\\n\\n'
    + 'My GHII: ' + ghii + '\\n'
    + 'My owner name (for API calls): ' + ownerName + '\\n'
    + 'Node URL: ' + nodeUrl + '\\n\\n'
    + 'Steps:\\n'
    + '1. First, authenticate as my owner:\\n'
    + '   POST ' + nodeUrl + '/v1/auth/token\\n'
    + '   You need my owner private key to sign (ownerName + nodeId + timestamp) with Ed25519.\\n'
    + '   My owner key is stored in my browser (I will provide it if needed).\\n\\n'
    + '2. Register a new agent under my account:\\n'
    + '   POST ' + nodeUrl + '/v1/agents\\n'
    + '   Header: Authorization: Bearer <owner_jwt>\\n'
    + '   Body: {"name": "<choose-a-name>", "owner": "' + ownerName + '", "display_name": "<Your Agent Name>", "description": "<What this agent does>"}\\n'
    + '   The new agent will get a GAII in the format: <name>#' + ghii + '\\n'
    + '   SAVE the private_key from the response!\\n\\n'
    + '3. Authenticate as the new agent:\\n'
    + '   Sign (gaii + timestamp) with the agent\\'s Ed25519 private key\\n'
    + '   POST ' + nodeUrl + '/v1/auth/token with {"gaii": "<agent-gaii>", "timestamp": "<iso>", "signature": "<sig>"}\\n\\n'
    + '4. You\\'re connected! Use the JWT to access:\\n'
    + '   GET ' + nodeUrl + '/v1/catalogue \\u2014 Browse services\\n'
    + '   POST ' + nodeUrl + '/v1/memory \\u2014 Store/retrieve memories\\n'
    + '   GET ' + nodeUrl + '/v1/wallet \\u2014 Check balance\\n'
    + '   Full API spec: ' + nodeUrl + '/v1/spec\\n'
    + '   Operating instructions: ' + nodeUrl + '/v1/prompts/tier1';
}

function copyAgentPrompt() {
  var el = document.getElementById('agent-connect-prompt');
  if (!el) return;
  copyToClipboard(el.textContent).then(function() {
    var btn = document.querySelector('.copy-prompt-btn');
    btn.textContent = '\\u{2705} ' + t('profile.agents.copied');
    setTimeout(function(){ btn.textContent = t('profile.agents.copyPrompt'); }, 2000);
  });
}

function toggleInstructions(btn) {
  var el = document.getElementById('platform-instructions');
  var expanded = el.classList.toggle('expanded');
  var arrow = btn.querySelector('span');
  arrow.style.transform = expanded ? 'rotate(180deg)' : '';
  if (expanded && !el.dataset.loaded) {
    el.dataset.loaded = '1';
    renderPlatformPanels();
  }
}

function renderPlatformPanels() {
  var panels = {
    windows: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<p>Windows requires WSL2. Open PowerShell as Admin:</p>'
      + '<ol><li>Install WSL2: <code>wsl --install</code> (restart if prompted)</li>'
      + '<li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>',
    mac: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<ol><li>Install Node.js 22+: <code>brew install node</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Alternative: one-liner install</h4>'
      + '<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>',
    linux: '<h4>OpenClaw (Recommended)</h4>'
      + '<p><a href="https://openclaw.ai" target="_blank">OpenClaw</a> is an open-source AI automation agent \\u2014 perfect for AIMEAT.</p>'
      + '<ol><li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Alternative: one-liner install</h4>'
      + '<pre><code>curl -fsSL https://openclaw.ai/install.sh | bash</code></pre>',
    wsl2: '<h4>Setup WSL2 (if not already)</h4>'
      + '<ol><li>Open PowerShell as Admin: <code>wsl --install</code></li>'
      + '<li>Restart and set up your Linux username/password</li></ol>'
      + '<h4>Install OpenClaw</h4>'
      + '<ol><li>In WSL2 terminal, install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>',
    android: '<h4>Option A: Termux (CLI only)</h4>'
      + '<ol><li>Install <a href="https://f-droid.org/packages/com.termux/" target="_blank">Termux from F-Droid</a> (not Play Store)</li>'
      + '<li>Run: <code>pkg update && pkg install nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>Option B: andClaw (on-device with camera/mic)</h4>'
      + '<p><a href="https://play.google.com/store/apps/details?id=com.coderred.andclaw" target="_blank">andClaw</a> runs the OpenClaw gateway directly on your phone \\u2014 no server needed. '
      + 'It gives the agent access to your camera, microphone, screen, and sensors.</p>'
      + '<p><strong>\\u26A0\\u{FE0F} Heads up:</strong> This means an AI agent can see through your camera and hear your mic. '
      + 'Only use this if you understand the privacy implications and trust your LLM provider.</p>'
      + '<h4>Alternative: Use a cloud server</h4>'
      + '<p>Run OpenClaw on a remote server (see AWS/Cloud tab) and connect via WhatsApp or Telegram.</p>',
    aws: '<h4>Quick EC2 Setup</h4>'
      + '<ol><li>Launch an EC2 instance (Amazon Linux 2023 or Ubuntu, t3.micro is fine)</li>'
      + '<li>SSH in: <code>ssh -i key.pem ec2-user@your-ip</code></li>'
      + '<li>Install Node.js 22+: <code>curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo yum install -y nodejs</code></li>'
      + '<li>Install OpenClaw: <code>npm install -g openclaw@latest</code></li>'
      + '<li>Run: <code>openclaw onboard</code> to configure your LLM API key</li>'
      + '<li>Paste the agent prompt above into the OpenClaw session</li></ol>'
      + '<h4>For a persistent agent</h4>'
      + '<ol><li>Use <code>tmux</code> or <code>screen</code> to keep the session alive</li>'
      + '<li>Or set up a systemd service for always-on operation</li></ol>'
  };

  var html = '';
  Object.keys(panels).forEach(function(key) {
    html += '<div class="platform-panel' + (key === 'windows' ? ' active' : '') + '" id="platform-' + key + '">'
      + '<div class="platform-content">' + panels[key] + '</div></div>';
  });
  document.getElementById('platform-panels').innerHTML = html;
}

// Platform tab clicks
document.getElementById('platform-tabs').addEventListener('click', function(e) {
  var btn = e.target.closest('.platform-tab');
  if (!btn) return;
  var platform = btn.dataset.platform;
  document.querySelectorAll('.platform-tab').forEach(function(t){ t.classList.toggle('active', t.dataset.platform === platform); });
  document.querySelectorAll('.platform-panel').forEach(function(p){ p.classList.toggle('active', p.id === 'platform-' + platform); });
});

// ── Access Codes ──
async function loadAccess() {
  var el = document.getElementById('access-area');
  var html = '';

  // Session info
  html += '<h3 style="color:var(--love1);margin-bottom:.75rem">\\u{1F4BB} ' + t('profile.access.session') + '</h3>';
  html += '<div class="card">'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.owner') + '</span><span>' + escHtml(session.owner || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.ghii') + '</span><span>' + escHtml(session.ghii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.agentGaii') + '</span><span>' + escHtml(session.gaii || '-') + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.node') + '</span><span>' + escHtml(NODE_URL) + '</span></div>'
    + '<div class="mem-item"><span class="mem-key">' + t('profile.access.jwtValid') + '</span><span>' + (session.valid ? '<span class="badge badge-success">' + t('profile.access.yes') + '</span>' : '<span class="badge badge-danger">' + t('profile.access.expired') + '</span>') + '</span></div>'
    + '</div>';

  // Public key
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F510} ' + t('profile.access.publicKey') + '</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">' + escHtml(session.publicKey || 'N/A') + '</div></div>';

  // Owner key info
  var ownerKey = localStorage.getItem('aimeat_owner_key');
  if (ownerKey) {
    html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F5DD}\\u{FE0F} ' + t('profile.access.ownerKey') + '</h3>';
    html += '<div class="card" style="border-color:var(--warn);cursor:pointer" onclick="copyToClipboard(localStorage.getItem(&quot;aimeat_owner_key&quot;)).then(function(){showToast(&quot;' + t('profile.access.keyCopied').replace(/"/g, '&quot;') + '&quot;)})">'
      + '<div style="display:flex;justify-content:space-between;align-items:center">'
      + '<div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:blur(4px);transition:filter .2s" '
      + 'onmouseenter="this.style.filter=&quot;none&quot;" onmouseleave="this.style.filter=&quot;blur(4px)&quot;">'
      + escHtml(ownerKey)
      + '</div><span class="badge badge-warn">' + t('profile.access.hoverReveal') + '</span></div>'
      + '<div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\\u26A0 ' + t('profile.access.keepSafe') + '</div>'
      + '</div>';
  }

  // MCP endpoint
  html += '<h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\\u{1F517} ' + t('profile.access.mcpEndpoint') + '</h3>';
  html += '<div class="card"><div style="font-family:monospace;font-size:.85rem;color:var(--love3)">' + escHtml(NODE_URL + '/v1/mcp') + '</div>'
    + '<div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">' + t('profile.access.mcpDesc') + '</div></div>';

  el.innerHTML = html;
}

// ── Personal Nodes ──
var nodesData = [];

async function loadNodes() {
  var el = document.getElementById('nodes-list');
  try {
    var data = await apiFetch('/v1/personal/status');
    var nodes = [];
    if (data && data.data && data.data.node_id) {
      nodes.push(data.data);
    }
    if (nodes.length === 0 && data && data.error && data.error.code === 'NOT_FOUND') {
      nodes = [];
    }
    nodesData = nodes;
    document.getElementById('stat-nodes').textContent = nodes.length;

    if (nodes.length === 0) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
      return;
    }

    var html = '';
    nodes.forEach(function(node, idx) {
      var statusClass = node.status || 'offline';
      var statusLabel = t('profile.nodes.' + statusClass) || statusClass;
      var visBadge = node.visibility === 'public'
        ? '<span class="badge badge-success">' + t('profile.nodes.public') + '</span>'
        : '<span class="badge badge-muted">' + t('profile.nodes.private') + '</span>';
      var agentCount = node.agent_gaiis ? node.agent_gaiis.length : 0;
      var agentWord = agentCount === 1 ? t('profile.nodes.agent') : t('profile.nodes.agents');
      var mailboxCount = node.mailbox ? node.mailbox.items : 0;
      var tunnelUrl = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';

      html += '<div class="pn-card" id="pn-' + idx + '">'
        + '<div class="pn-header" onclick="toggleNodeCard(' + idx + ')">'
        + '<div class="pn-header-left">'
        + '<div class="pn-status-dot ' + statusClass + '"></div>'
        + '<span class="pn-name">' + escHtml(node.node_id) + '</span>'
        + '</div>'
        + '<div class="pn-badges">'
        + visBadge
        + ' <span class="badge badge-' + (statusClass === 'online' ? 'success' : statusClass === 'degraded' ? 'warn' : 'danger') + '">' + statusLabel + '</span>'
        + ' <span class="pn-arrow" id="pn-arrow-' + idx + '">\\u25BC</span>'
        + '</div></div>'
        + '<div class="pn-quick">' + agentCount + ' ' + agentWord + ' \\u2502 ' + t('profile.nodes.mailboxItems') + ': ' + mailboxCount + ' ' + t('profile.nodes.items') + '</div>'
        + '<div class="pn-details" id="pn-details-' + idx + '">';

      // Tunnel URL
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.tunnelUrl') + '</span>'
        + '<span class="pn-detail-value" style="display:flex;align-items:center;gap:.5rem"><code style="font-size:.75rem">' + escHtml(tunnelUrl) + '</code>'
        + '<button onclick="copyTunnelUrl()" style="padding:2px 8px;background:var(--card2);border:1px solid var(--border);border-radius:4px;color:var(--love4);cursor:pointer;font-size:.7rem">' + t('profile.nodes.copyUrl') + '</button></span></div>';

      // Agents
      html += '<div style="padding:.5rem 0"><span class="pn-detail-label">' + t('profile.nodes.agentList') + '</span>';
      if (node.agent_gaiis && node.agent_gaiis.length > 0) {
        html += '<div class="pn-agent-list">';
        node.agent_gaiis.forEach(function(g) { html += '<div class="pn-agent-item">' + escHtml(g) + '</div>'; });
        html += '</div>';
      } else {
        html += '<div style="font-size:.8rem;color:var(--muted);margin-top:.3rem">' + t('profile.nodes.noAgents') + '</div>';
      }
      html += '</div>';

      // Mailbox
      var mbUsed = node.mailbox ? node.mailbox.used_bytes : 0;
      var mbQuota = node.mailbox ? node.mailbox.quota_bytes : 0;
      var mbUsedMB = (mbUsed / 1024 / 1024).toFixed(1);
      var mbQuotaMB = (mbQuota / 1024 / 1024).toFixed(0);
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.mailbox') + '</span>'
        + '<span class="pn-detail-value">' + mailboxCount + ' ' + t('profile.nodes.items') + ' (' + mbUsedMB + ' ' + t('profile.nodes.mailboxOf') + ' ' + mbQuotaMB + ' MB)</span></div>';

      // Last seen
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.lastSeen') + '</span>'
        + '<span class="pn-detail-value">' + escHtml(node.last_seen ? timeAgo(node.last_seen) : '-') + '</span></div>';

      // Visibility toggle
      html += '<div class="pn-detail-row"><span class="pn-detail-label">' + t('profile.nodes.visibility') + '</span>'
        + '<div class="pn-vis-toggle">'
        + '<button class="pn-vis-btn ' + (node.visibility !== 'public' ? 'active' : '') + '" onclick="setNodeVis(\\'' + escHtml(node.node_id) + '\\',\\'private\\')">' + t('profile.nodes.private') + '</button>'
        + '<button class="pn-vis-btn ' + (node.visibility === 'public' ? 'active' : '') + '" onclick="setNodeVis(\\'' + escHtml(node.node_id) + '\\',\\'public\\')">' + t('profile.nodes.public') + '</button>'
        + '</div></div>';

      // Setup instructions
      html += '<div style="margin-top:.75rem"><button class="expand-btn" onclick="toggleSetup(' + idx + ')" style="font-size:.8rem;padding:6px 12px">' + t('profile.nodes.setupTitle') + ' <span style="transition:transform .2s">\\u25BC</span></button>'
        + '<div class="pn-setup" id="pn-setup-' + idx + '">'
        + '<ol>'
        + '<li>' + t('profile.nodes.setupStep1') + '</li>'
        + '<li>' + t('profile.nodes.setupStep2') + '</li>'
        + '<li>' + t('profile.nodes.setupStep3') + '</li>'
        + '<li>' + t('profile.nodes.setupStep4') + '</li>'
        + '</ol>'
        + '<a href="/docs/personal-node-setup-guide.md" target="_blank" style="color:var(--love1);font-size:.8rem">' + t('profile.nodes.setupDocs') + ' \\u2192</a>'
        + '</div></div>';

      // Detach button
      html += '<button class="pn-detach-btn" onclick="detachNode(\\'' + escHtml(node.node_id) + '\\')">' + t('profile.nodes.detachBtn') + '</button>';

      html += '</div></div>';
    });

    el.innerHTML = html;
  } catch(e) {
    document.getElementById('stat-nodes').textContent = '0';
    if (e && e.message && e.message.includes('NOT_FOUND')) {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.empty') + '</div>';
    } else {
      el.innerHTML = '<div class="empty">' + t('profile.nodes.error') + '</div>';
    }
  }
}

function copyTunnelUrl() {
  var url = NODE_URL.replace(/^http/, 'ws') + '/v1/personal/tunnel';
  copyToClipboard(url).then(function() { showToast(t('profile.nodes.copied')); });
}

function toggleNodeCard(idx) {
  var details = document.getElementById('pn-details-' + idx);
  var arrow = document.getElementById('pn-arrow-' + idx);
  if (!details) return;
  details.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open');
}

function toggleSetup(idx) {
  var el = document.getElementById('pn-setup-' + idx);
  if (el) el.classList.toggle('open');
}

function toggleAddNodeForm() {
  var form = document.getElementById('add-node-form');
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function timeAgo(iso) {
  var ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
  return Math.floor(ms / 86400000) + 'd ago';
}

async function setNodeVis(nodeId, vis) {
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: vis }),
    });
    showToast(t('profile.nodes.visUpdated'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}

async function registerNode() {
  var nodeId = document.getElementById('node-id-input').value.trim();
  if (!nodeId) { showToast(t('profile.nodes.registerFailed'), true); return; }
  if (!nodeId.startsWith('personal-')) nodeId = 'personal-' + nodeId;

  var visRadio = document.querySelector('input[name="node-vis"]:checked');
  var visibility = visRadio ? visRadio.value : 'private';

  var gaiisRaw = document.getElementById('node-gaiis-input').value.trim();
  var agentGaiis = gaiisRaw ? gaiisRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

  try {
    var resp = await session.fetch('/v1/personal/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: nodeId,
        owner_name: session.owner,
        public_key: session.publicKey || 'placeholder',
        agent_gaiis: agentGaiis,
        visibility: visibility,
      }),
    });
    if (resp && resp.ok !== false) {
      showToast(t('profile.nodes.registered'));
      toggleAddNodeForm();
      document.getElementById('node-id-input').value = '';
      document.getElementById('node-gaiis-input').value = '';
      loadNodes();
    } else {
      showToast((resp && resp.error && resp.error.message) || t('profile.nodes.registerFailed'), true);
    }
  } catch(e) {
    showToast(t('profile.nodes.registerFailed'), true);
  }
}

async function detachNode(nodeId) {
  if (!confirm(t('profile.nodes.detachConfirm'))) return;
  try {
    await session.fetch('/v1/personal/anchor/' + encodeURIComponent(nodeId), { method: 'DELETE' });
    showToast(t('profile.nodes.detached.toast'));
    loadNodes();
  } catch(e) {
    showToast(t('profile.error'), true);
  }
}

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
