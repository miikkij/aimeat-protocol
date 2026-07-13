/**
 * @file src/routes/profile/styles.ts
 * @description Inline CSS for the legacy SSR profile page as a template string. Extracted from src/routes/profile.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/profile.ts (max-file-lines)
 */
export const PROFILE_CSS = `*{margin:0;padding:0;box-sizing:border-box}
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
}`;
