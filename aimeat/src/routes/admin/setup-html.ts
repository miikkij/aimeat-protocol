/**
 * @file src/routes/admin/setup-html.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin setup page HTML — the password login page and the setup wizard
 *   (Login + Register tabs) served by the admin setup routes. Extracted from
 *   src/routes/admin.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/admin.ts (max-file-lines)
 */

// ── Admin Login Page HTML ──
export const ADMIN_LOGIN_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh}
.box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;width:380px;text-align:center}
h1{font-size:1.4rem;margin-bottom:8px}
.sub{color:#94a3b8;font-size:.85rem;margin-bottom:24px}
input{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:.95rem;margin-bottom:16px}
input:focus{outline:none;border-color:#3b82f6}
button{width:100%;padding:10px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer}
button:hover{background:#2563eb}
button:disabled{opacity:.5;cursor:not-allowed}
.hint{color:#64748b;font-size:.75rem;margin-top:16px}
.err{color:#ef4444;font-size:.85rem;margin-top:8px;display:none}
</style></head><body>
<div class="box">
<h1>&#x2764;&#xFE0F; AIMEAT Admin</h1>
<p class="sub">Enter the admin password to continue</p>
<form id="loginForm">
<input type="password" id="pw" placeholder="Admin password" autofocus autocomplete="current-password"/>
<button type="submit" id="btn">Continue</button>
</form>
<p id="errMsg" class="err"></p>
<p class="hint">Password is printed when the server starts, or set via AIMEAT_ADMIN_PASSWORD</p>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', go);
async function go(e){
  e.preventDefault();
  var pw=document.getElementById('pw').value;
  if(!pw)return;
  var btn=document.getElementById('btn');
  btn.disabled=true;btn.textContent='Authenticating...';
  document.getElementById('errMsg').style.display='none';
  try{
    var r=await fetch('/v1/admin/setup/auth',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Password':pw},body:'{}'});
    var d=await r.json();
    if(!d.ok){document.getElementById('errMsg').textContent=d.error||'Invalid password';document.getElementById('errMsg').style.display='block';btn.disabled=false;btn.textContent='Continue';return;}
    // Cookie is set by the server response — just reload the page
    location.href='/v1/admin/setup';
  }catch(ex){document.getElementById('errMsg').textContent='Network error';document.getElementById('errMsg').style.display='block';btn.disabled=false;btn.textContent='Continue';}
}
</script>
</body></html>`;

// ── Admin Setup Wizard HTML (Login + Register tabs) ──
export const ADMIN_SETUP_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>AIMEAT Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;
--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#3b82f6;--cyan:#06b6d4}
body{background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;padding:20px;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding-top:60px}
.container{max-width:480px;width:100%}
h1{font-size:1.5rem;margin-bottom:4px;text-align:center}
.sub{color:var(--muted);font-size:.85rem;margin-bottom:24px;text-align:center}

/* Tabs */
.tabs{display:flex;gap:0;margin-bottom:0;border-bottom:2px solid var(--border)}
.tab{flex:1;padding:12px 16px;text-align:center;font-size:.95rem;font-weight:600;cursor:pointer;border:none;background:transparent;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--cyan);border-bottom-color:var(--cyan)}
.tab-panel{display:none}
.tab-panel.active{display:block}

.card{background:var(--card);border:1px solid var(--border);border-radius:0 0 10px 10px;padding:24px;margin-bottom:16px}
.card.standalone{border-radius:10px}
label{display:block;color:var(--muted);font-size:.8rem;margin-bottom:4px;margin-top:14px}
label:first-child{margin-top:0}
input[type=text],input[type=password],textarea{width:100%;padding:10px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:.9rem;font-family:inherit}
textarea{resize:vertical;min-height:60px;font-family:'SF Mono',Consolas,monospace;font-size:.8rem}
input:focus,textarea:focus{outline:none;border-color:var(--blue)}
button{padding:12px 24px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:16px;width:100%}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-green{background:var(--green);color:#000;display:inline-block;text-decoration:none;text-align:center;padding:12px 24px;border-radius:8px;font-weight:600;font-size:.95rem;margin-top:16px;width:100%}
.btn-green:hover{opacity:.85}
.result{margin-top:14px;padding:12px;border-radius:8px;font-size:.85rem;word-break:break-all}
.result-ok{background:#16a34a18;border:1px solid #16a34a55;color:var(--green)}
.result-err{background:#dc262618;border:1px solid #dc262655;color:var(--red)}
.key-box{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:var(--bg);padding:8px;border-radius:6px;border:1px solid var(--border);margin-top:6px;word-break:break-all;user-select:all}
.hidden{display:none}
a{color:var(--cyan);text-decoration:none}
a:hover{text-decoration:underline}
.warn{color:var(--yellow);font-size:.8rem;margin-top:8px}
.divider{border-top:1px solid var(--border);margin:20px 0;position:relative}
.divider span{position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--card);padding:0 12px;color:var(--muted);font-size:.75rem}
.success-panel{text-align:center;padding:16px 0}
.success-panel h3{color:var(--green);font-size:1.1rem;margin-bottom:8px}
.desc{font-size:.9rem;color:var(--muted);margin-bottom:4px}
.toggle-link{color:var(--muted);font-size:.75rem;margin-top:12px;text-align:center}
.roles-text{color:var(--muted);font-size:.85rem;margin-bottom:4px}
.jwt-section{margin-top:14px;text-align:left}
.pw-hint{color:var(--muted);font-size:.72rem;margin-top:2px}
.label-tag{color:var(--cyan);font-size:.7rem}
</style></head><body>
<div class="container">
<h1>&#x2764;&#xFE0F; AIMEAT</h1>
<p class="sub">Node: <strong>{{NODE_ID}}</strong></p>

<div class="tabs">
  <button class="tab active" data-tab="login">Login</button>
  <button class="tab" data-tab="register">Register</button>
</div>

<!-- ═══ LOGIN TAB ═══ -->
<div class="tab-panel active" id="panel-login">
<div class="card">
  <!-- Password Login (default for humans) -->
  <div id="loginPasswordMode">
    <p class="desc">Sign in with your username and password.</p>
    <label>Username</label>
    <input type="text" id="loginUser" placeholder="e.g. myname" autocomplete="username" autofocus/>
    <label>Password</label>
    <input type="password" id="loginPass" placeholder="Your password" autocomplete="current-password"/>
    <button class="btn-primary" id="btnPwLogin">Login</button>
    <p class="toggle-link">
      <a href="#" id="toggleToKeyLogin">Advanced: Login with private key</a>
    </p>
  </div>
  <!-- Key Login (advanced, for developers/agents) -->
  <div id="loginKeyMode" class="hidden">
    <p class="desc">Sign in with your owner name and private key.</p>
    <label>Owner Name</label>
    <input type="text" id="loginOwner" placeholder="e.g. myname" autocomplete="off"/>
    <label>Private Key</label>
    <textarea id="loginKey" placeholder="Paste your private key here" rows="3"></textarea>
    <button class="btn-primary" id="btnLogin">Login</button>
    <p class="toggle-link">
      <a href="#" id="toggleToPwLogin">Back to password login</a>
    </p>
  </div>
  <div id="loginResult" class="hidden"></div>
  <div id="loginSuccess" class="hidden">
    <div class="success-panel">
      <h3>&#x2713; Authenticated</h3>
      <p class="roles-text" id="loginRoles"></p>
      <a id="loginDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
      <div class="jwt-section">
        <label>JWT Token (for API use)</label>
        <div class="key-box" id="loginJwtBox"></div>
      </div>
    </div>
  </div>
</div>
</div>

<!-- ═══ REGISTER TAB ═══ -->
<div class="tab-panel" id="panel-register">
<div class="card">
  <p class="desc">Create a new owner account. The first owner gets the <strong>operator</strong> role.</p>
  <label>Owner Name</label>
  <input type="text" id="regOwner" placeholder="e.g. myname" autocomplete="off"/>
  <label>Display Name (optional)</label>
  <input type="text" id="regDisplay" placeholder="e.g. Node Operator"/>
  <label>Password <span class="label-tag">(recommended)</span></label>
  <input type="password" id="regPassword" placeholder="Set a login password" autocomplete="new-password"/>
  <p class="pw-hint">With a password you can login from any device without keys.</p>
  <button class="btn-primary" id="btnRegister">Create Account</button>
  <div id="regResult" class="hidden"></div>
  <div id="regKeys" class="hidden">
    <div class="divider"><span>YOUR KEYS</span></div>
    <div class="warn">&#x26A0; Save your private key NOW — it cannot be recovered!</div>
    <label>Private Key</label>
    <div class="key-box" id="regPrivateKey"></div>
    <label>Public Key</label>
    <div class="key-box" id="regPublicKey"></div>
    <div class="divider"><span>CONTINUE</span></div>
    <button class="btn-primary" id="btnRegToken">Login &amp; Open Dashboard</button>
    <div id="regTokenResult" class="hidden"></div>
    <div id="regSuccess" class="hidden">
      <div class="success-panel">
        <h3>&#x2713; Authenticated</h3>
        <p class="roles-text" id="regRoles"></p>
        <a id="regDashLink" href="#" class="btn-green">Open Dashboard &#x2192;</a>
        <div class="jwt-section">
          <label>JWT Token (for API use)</label>
          <div class="key-box" id="regJwtBox"></div>
        </div>
      </div>
    </div>
  </div>
</div>
</div>

</div>
<script>
let regOwner='',regKey='';

function switchTab(name){
  document.querySelectorAll('.tab').forEach(function(t){t.classList.remove('active')});
  document.querySelectorAll('.tab-panel').forEach(function(p){p.classList.remove('active')});
  document.querySelector('.tab[data-tab="'+name+'"]').classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}

function toggleLoginMode(e){
  e.preventDefault();
  document.getElementById('loginPasswordMode').classList.toggle('hidden');
  document.getElementById('loginKeyMode').classList.toggle('hidden');
}

async function api(method,path,body){
  const h={'Content-Type':'application/json'};
  const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  return r.json();
}

async function apiNoAdmin(method,path,body){
  const h={'Content-Type':'application/json'};
  const r=await fetch(path,{method,headers:h,body:body?JSON.stringify(body):undefined});
  return r.json();
}

function show(id,html,cls){const el=document.getElementById(id);el.className='result '+(cls||'');el.innerHTML=html;el.classList.remove('hidden');}
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}

function showLoginSuccess(token,roles,dashUrl){
  document.getElementById('loginResult').classList.add('hidden');
  document.getElementById('loginRoles').textContent='Roles: '+(Array.isArray(roles)?roles.join(', '):roles);
  document.getElementById('loginDashLink').href=dashUrl||'/v1/admin';
  document.getElementById('loginJwtBox').textContent=token;
  document.getElementById('loginSuccess').classList.remove('hidden');
}

/* ── PASSWORD LOGIN ── */
async function doPasswordLogin(){
  const user=document.getElementById('loginUser').value.trim();
  const pass=document.getElementById('loginPass').value;
  if(!user||!pass){show('loginResult','Username and password are required','result-err');return;}
  document.getElementById('btnPwLogin').disabled=true;
  document.getElementById('btnPwLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await apiNoAdmin('POST','/v1/ghii/login',{username:user,password:pass});
    if(r.error_code||!r.data){
      show('loginResult',esc((r.error&&r.error.message)||r.error||(r.data&&r.data.error)||'Login failed'),'result-err');
      document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';return;
    }
    var d=r.data;
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load.
    // SECURITY (M-5): never persist a private key here — nothing reads it, and a stored
    // private key is pure XSS-theft surface. Only the non-secret session fields + the JWT.
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:d.owner.name,gaii:d.agent.gaii,ghii:d.ghii.ghii,jwt:d.token}));}catch(e){}
    showLoginSuccess(d.token,['owner','operator'],'/v1/admin');
    document.getElementById('btnPwLogin').textContent='Login';
    document.getElementById('btnPwLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnPwLogin').disabled=false;document.getElementById('btnPwLogin').textContent='Login';}
}

/* ── KEY LOGIN ── */
async function doLogin(){
  const owner=document.getElementById('loginOwner').value.trim();
  const key=document.getElementById('loginKey').value.trim();
  if(!owner||!key){show('loginResult','Owner name and private key are required','result-err');return;}
  document.getElementById('btnLogin').disabled=true;
  document.getElementById('btnLogin').textContent='Signing in...';
  document.getElementById('loginSuccess').classList.add('hidden');
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:owner,private_key:key});
    if(!r.ok){show('loginResult',esc((r.error&&r.error.message)||r.error||'Login failed'),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';return;}
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:owner,jwt:r.token,publicKey:''}));}catch(e){}
    showLoginSuccess(r.token,r.roles,r.dashboard_url);
    document.getElementById('btnLogin').textContent='Login';
    document.getElementById('btnLogin').disabled=false;
  }catch(e){show('loginResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnLogin').disabled=false;document.getElementById('btnLogin').textContent='Login';}
}

/* ── REGISTER ── */
async function doRegister(){
  const name=document.getElementById('regOwner').value.trim();
  const dname=document.getElementById('regDisplay').value.trim();
  const password=document.getElementById('regPassword').value;
  if(!name){show('regResult','Owner name is required','result-err');return;}
  document.getElementById('btnRegister').disabled=true;
  try{
    const body={name:name,display_name:dname||undefined};
    if(password&&password.length>=4)body.password=password;
    const r=await api('POST','/v1/admin/setup/register',body);
    if(!r.ok){show('regResult',esc((r.error&&r.error.message)||r.error||'Registration failed'),'result-err');document.getElementById('btnRegister').disabled=false;return;}
    regOwner=r.owner.name;regKey=r.private_key;
    var roles=r.owner.roles.join(', ');
    var msg='<strong>Account created!</strong> Roles: '+roles;
    if(r.has_password)msg+='<br/><span class="label-tag">Password login enabled — you can login with your username and password.</span>';
    show('regResult',msg,'result-ok');
    document.getElementById('regPrivateKey').textContent=r.private_key;
    document.getElementById('regPublicKey').textContent=r.public_key;
    document.getElementById('regKeys').classList.remove('hidden');
  }catch(e){show('regResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegister').disabled=false;}
}

async function doRegToken(){
  if(!regOwner||!regKey){show('regTokenResult','Register first','result-err');return;}
  document.getElementById('btnRegToken').disabled=true;
  document.getElementById('btnRegToken').textContent='Signing in...';
  try{
    const r=await api('POST','/v1/admin/setup/token',{owner:regOwner,private_key:regKey});
    if(!r.ok){show('regTokenResult',esc((r.error&&r.error.message)||r.error||'Token request failed'),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';return;}
    // Store session in localStorage so aimeat-auth.js picks it up on dashboard load
    try{localStorage.setItem('aimeat_session',JSON.stringify({owner:regOwner,jwt:r.token,publicKey:''}));}catch(e){}
    document.getElementById('regTokenResult').classList.add('hidden');
    document.getElementById('regRoles').textContent='Roles: '+r.roles.join(', ');
    document.getElementById('regDashLink').href=r.dashboard_url;
    document.getElementById('regJwtBox').textContent=r.token;
    document.getElementById('regSuccess').classList.remove('hidden');
    document.getElementById('btnRegToken').classList.add('hidden');
  }catch(e){show('regTokenResult','Network error: '+esc(e.message),'result-err');document.getElementById('btnRegToken').disabled=false;document.getElementById('btnRegToken').textContent='Login & Open Dashboard';}
}

/* ── Bind event listeners ── */
document.querySelectorAll('.tab[data-tab]').forEach(function(t){t.addEventListener('click',function(){switchTab(t.getAttribute('data-tab'))})});
document.getElementById('toggleToKeyLogin').addEventListener('click',toggleLoginMode);
document.getElementById('toggleToPwLogin').addEventListener('click',toggleLoginMode);
document.getElementById('btnPwLogin').addEventListener('click',doPasswordLogin);
document.getElementById('btnLogin').addEventListener('click',doLogin);
document.getElementById('btnRegister').addEventListener('click',doRegister);
document.getElementById('btnRegToken').addEventListener('click',doRegToken);
</script>
</body></html>`;
