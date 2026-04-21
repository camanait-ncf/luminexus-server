// ═══════════════════════════════════════════════════════════
//  EYE ICON SVGS
//  eyeSlash = password hidden (line crossing eye) — DEFAULT
//  eyeOpen  = password visible (no line)
// ═══════════════════════════════════════════════════════════
const eyeSlash = `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const eyeOpen  = `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = isHidden ? eyeOpen : eyeSlash;
  btn.title = isHidden ? 'Hide password' : 'Show password';
}

// ═══════════════════════════════════════════════════════════
//  OVERLAY SYSTEM
// ═══════════════════════════════════════════════════════════
function openOverlay(id) { document.getElementById(id).classList.add('open'); document.body.style.overflow='hidden'; }
function closeOverlay(id) { document.getElementById(id).classList.remove('open'); document.body.style.overflow=''; }
document.addEventListener('keydown', e => { if(e.key==='Escape') { document.querySelectorAll('.overlay-page.open').forEach(el=>el.classList.remove('open')); document.body.style.overflow=''; } });

// ═══════════════════════════════════════════════════════════
//  TICKET SYSTEM
// ═══════════════════════════════════════════════════════════
let selectedTicketType = '';
function selectTicketType(el, type) {
  document.querySelectorAll('.ticket-type-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
  selectedTicketType = type;
}

async function submitTicket() {
  const name    = document.getElementById('ticket-name').value.trim();
  const subject = document.getElementById('ticket-subject').value.trim();
  const message = document.getElementById('ticket-message').value.trim();
  const errEl   = document.getElementById('ticket-err');
  errEl.className = 'login-err'; errEl.textContent = '';

  if (!message) { errEl.textContent = 'DESCRIPTION IS REQUIRED'; return; }

  const btn = document.getElementById('ticket-send-btn');
  btn.disabled = true; btn.textContent = 'SENDING...';

  try {
    const r = await fetch('/api/send-ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, subject, message, category: selectedTicketType })
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'SEND FAILED'; btn.disabled = false; btn.textContent = '📨 SEND TICKET'; return; }
    document.getElementById('ticket-form-wrap').style.display = 'none';
    document.getElementById('ticket-result').classList.add('show');
  } catch(e) {
    errEl.textContent = 'CONNECTION ERROR';
    btn.disabled = false; btn.textContent = '📨 SEND TICKET';
  }
}

function resetTicket() {
  selectedTicketType = '';
  document.querySelectorAll('.ticket-type-btn').forEach(b=>b.classList.remove('selected'));
  document.getElementById('ticket-name').value = '';
  document.getElementById('ticket-subject').value = '';
  document.getElementById('ticket-message').value = '';
  document.getElementById('ticket-err').textContent = '';
  document.getElementById('ticket-result').classList.remove('show');
  document.getElementById('ticket-form-wrap').style.display = 'block';
}

// ═══════════════════════════════════════════════════════════
//  CONTACT / COLLAB FORM
// ═══════════════════════════════════════════════════════════
async function submitCollab() {
  const name    = document.getElementById('collab-name').value.trim();
  const org     = document.getElementById('collab-org').value.trim();
  const email   = document.getElementById('collab-email').value.trim();
  const type    = document.getElementById('collab-type').value;
  const message = document.getElementById('collab-message').value.trim();
  const errEl   = document.getElementById('collab-err');
  errEl.className = 'login-err'; errEl.textContent = '';

  if (!email)   { errEl.textContent = 'EMAIL IS REQUIRED'; return; }
  if (!message) { errEl.textContent = 'MESSAGE IS REQUIRED'; return; }

  const btn = document.querySelector('#collab-form-wrap .ticket-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'SENDING...'; }

  try {
    const r = await fetch('/api/send-contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, org, email, type, message })
    });
    const d = await r.json();
    if (!r.ok) {
      errEl.textContent = d.error || 'SEND FAILED';
      if (btn) { btn.disabled = false; btn.textContent = '🤝 SEND INQUIRY'; }
      return;
    }
    document.getElementById('collab-form-wrap').style.display = 'none';
    document.getElementById('collab-result').style.display = 'block';
  } catch(e) {
    errEl.textContent = 'CONNECTION ERROR';
    if (btn) { btn.disabled = false; btn.textContent = '🤝 SEND INQUIRY'; }
  }
}

// ═══════════════════════════════════════════════════════════
//  FORGOT PASSWORD — 4-step: username → send OTP → verify OTP → reset
// ═══════════════════════════════════════════════════════════
let forgotUsername = '';

function showForgotForm() {
  document.getElementById('login-box').style.display = 'none';
  document.getElementById('signup-box').style.display = 'none';
  document.getElementById('forgot-box').style.display = 'block';
  document.getElementById('forgot-err').textContent = '';
  document.getElementById('forgot-step1').style.display = 'block';
  document.getElementById('forgot-step2').style.display = 'none';
  document.getElementById('forgot-step3').style.display = 'none';
  document.getElementById('forgot-step4').style.display = 'none';
  setForgotStep(1);
}

function setForgotStep(n) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('fstep-' + i);
    if (!el) continue;
    el.className = 'forgot-step' + (i < n ? ' done' : i === n ? ' active' : '');
    if (i < n) el.querySelector('.forgot-step-num').textContent = '✓';
    else el.querySelector('.forgot-step-num').textContent = i;
  }
}

async function forgotStep1() {
  const username = document.getElementById('forgot-user').value.trim();
  const errEl = document.getElementById('forgot-err');
  errEl.className = 'login-err'; errEl.textContent = '';
  if (!username) { errEl.textContent = 'ENTER YOUR USERNAME'; return; }
  const btn = document.querySelector('#forgot-step1 .login-btn');
  btn.disabled = true; btn.textContent = 'SENDING...';
  try {
    const r = await fetch('/api/forgot-password/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const d = await r.json();
    if (!r.ok) {
      if (d.error === 'SUPERADMIN_PROTECTED') {
        errEl.textContent = '🔒 SUPERADMIN PASSWORD CANNOT BE CHANGED VIA THIS PORTAL';
      } else {
        errEl.textContent = d.message || d.error || 'ACCOUNT NOT FOUND';
      }
      btn.disabled = false; btn.textContent = 'SEND CODE →'; return;
    }
    forgotUsername = username;
    document.getElementById('forgot-verified-user').textContent = username;
    document.getElementById('forgot-masked-email').textContent = d.maskedEmail || 'your registered email';
    document.getElementById('forgot-step1').style.display = 'none';
    document.getElementById('forgot-step2').style.display = 'block';
    setForgotStep(2);
    btn.disabled = false; btn.textContent = 'SEND CODE →';
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; btn.disabled = false; btn.textContent = 'SEND CODE →'; }
}

async function forgotStep2() {
  const otp = document.getElementById('forgot-otp').value.trim();
  const errEl = document.getElementById('forgot-err');
  errEl.className = 'login-err'; errEl.textContent = '';
  if (!otp) { errEl.textContent = 'ENTER THE VERIFICATION CODE'; return; }
  const btn = document.querySelector('#forgot-step2 .login-btn');
  btn.disabled = true; btn.textContent = 'VERIFYING...';
  try {
    const r = await fetch('/api/forgot-password/verify-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: forgotUsername, otp })
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'INVALID CODE'; btn.disabled = false; btn.textContent = 'VERIFY CODE →'; return; }
    document.getElementById('forgot-step2').style.display = 'none';
    document.getElementById('forgot-step3').style.display = 'block';
    setForgotStep(3);
    btn.disabled = false; btn.textContent = 'VERIFY CODE →';
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; btn.disabled = false; btn.textContent = 'VERIFY CODE →'; }
}

async function forgotStep3() {
  const newPass  = document.getElementById('forgot-new-pass').value;
  const confPass = document.getElementById('forgot-conf-pass').value;
  const errEl    = document.getElementById('forgot-err');
  errEl.className = 'login-err'; errEl.textContent = '';
  if (!newPass)             { errEl.textContent = 'ENTER NEW PASSWORD'; return; }
  if (newPass.length < 6)   { errEl.textContent = 'PASSWORD MIN 6 CHARACTERS'; return; }
  if (newPass !== confPass) { errEl.textContent = 'PASSWORDS DO NOT MATCH'; return; }
  const btn = document.querySelector('#forgot-step3 .login-btn');
  btn.disabled = true; btn.textContent = 'SAVING...';
  try {
    const r = await fetch('/api/forgot-password/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: forgotUsername, newPassword: newPass })
    });
    const d = await r.json();
    if (!r.ok) {
      if (d.error === 'SUPERADMIN_PROTECTED') {
        errEl.textContent = '🔒 SUPERADMIN PASSWORD CANNOT BE CHANGED VIA THIS PORTAL';
      } else {
        errEl.textContent = d.error || 'RESET FAILED';
      }
      btn.disabled = false; btn.textContent = 'SET NEW PASSWORD →'; return;
    }
    document.getElementById('forgot-step3').style.display = 'none';
    document.getElementById('forgot-step4').style.display = 'block';
    setForgotStep(4);
    setTimeout(() => { showLoginForm(); document.getElementById('login-user').value = forgotUsername; }, 3000);
    btn.disabled = false; btn.textContent = 'SET NEW PASSWORD →';
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; btn.disabled = false; btn.textContent = 'SET NEW PASSWORD →'; }
}

// ═══════════════════════════════════════════════════════════
//  AUTH STATE
// ═══════════════════════════════════════════════════════════
let sessionToken = localStorage.getItem('lx_token');
let sessionUser  = localStorage.getItem('lx_user');
let sessionRole  = localStorage.getItem('lx_role');
let sessionLinkedDevice = localStorage.getItem('lx_device') ?? null;

function authHeaders() { return {'x-session-token': sessionToken}; }
async function exportFile(type) { window.location.href = `/api/export/${type}?token=${sessionToken}`; }

// ═══════════════════════════════════════════════════════════
//  LOGIN
// ═══════════════════════════════════════════════════════════
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-err');
  if (!username || !password) { errEl.textContent = 'ENTER USERNAME AND PASSWORD'; return; }
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'LOGIN FAILED'; return; }
    sessionToken = d.token; sessionUser = d.username;
    sessionRole  = d.role || 'admin';
    sessionLinkedDevice = d.linkedDeviceId || '';
    localStorage.setItem('lx_token',  sessionToken);
    localStorage.setItem('lx_user',   sessionUser);
    localStorage.setItem('lx_role',   sessionRole);
    localStorage.setItem('lx_device', sessionLinkedDevice);
    routeAfterAuth();
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; }
}

// ═══════════════════════════════════════════════════════════
//  ROUTING
// ═══════════════════════════════════════════════════════════
function routeAfterAuth() {
  document.getElementById('login-screen').classList.add('hidden');
  if (sessionRole === 'superadmin') { showSuperadminDashboard(); return; }
  if (!sessionLinkedDevice) { showLinkScreen(); } else { showDashboard(); }
}

// ═══════════════════════════════════════════════════════════
//  LINK DEVICE SCREEN
// ═══════════════════════════════════════════════════════════
function showLinkScreen() {
  document.getElementById('link-screen').classList.add('visible');
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('link-success-bar').style.display = 'none';
  document.getElementById('link-fail-bar').style.display    = 'none';
  document.getElementById('void-data-hint').classList.remove('show');
  document.getElementById('link-err').textContent = '';
  document.getElementById('skip-link-btn').style.display = 'block';
}

async function doLinkDevice() {
  const deviceId   = document.getElementById('link-device-id').value.trim();
  const devicePass = document.getElementById('link-device-pass').value;
  const errEl      = document.getElementById('link-err');
  const btn        = document.getElementById('link-btn');
  errEl.textContent = '';
  document.getElementById('link-success-bar').style.display = 'none';
  document.getElementById('link-fail-bar').style.display    = 'none';
  document.getElementById('void-data-hint').classList.remove('show');
  if (!deviceId || !devicePass) { errEl.textContent = 'ENTER BOTH DEVICE ID AND PASSWORD'; return; }
  btn.disabled = true; btn.textContent = 'LINKING...';
  try {
    const r = await fetch('/api/link-device', { method:'POST', headers:{'Content-Type':'application/json',...authHeaders()}, body: JSON.stringify({deviceId, devicePassword: devicePass}) });
    const d = await r.json();
    if (r.ok) {
      sessionLinkedDevice = deviceId;
      localStorage.setItem('lx_device', deviceId);
      document.getElementById('link-success-bar').style.display = 'flex';
      document.getElementById('skip-link-btn').style.display    = 'none';
      btn.textContent = '✓ LINKED — OPENING DASHBOARD...';
      setTimeout(() => { document.getElementById('link-screen').classList.remove('visible'); showDashboard(); }, 1400);
    } else {
      document.getElementById('link-fail-bar').style.display = 'flex';
      document.getElementById('void-data-hint').classList.add('show');
      errEl.textContent = d.error || 'LINK FAILED';
      btn.disabled = false; btn.textContent = '⊞ LINK DEVICE';
    }
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; btn.disabled = false; btn.textContent = '⊞ LINK DEVICE'; }
}

function skipLinkDevice() {
  sessionLinkedDevice = ''; localStorage.setItem('lx_device', '');
  document.getElementById('link-screen').classList.remove('visible');
  showDashboard();
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD SHOW
// ═══════════════════════════════════════════════════════════
function showDashboard() {
  document.getElementById('superadmin-dashboard').classList.remove('visible');
  document.getElementById('dashboard').classList.add('visible');
  document.getElementById('hdr-user').textContent = sessionUser;
  document.getElementById('settings-username').textContent = sessionUser;
  applyDeviceLinkedState();
  bootDashboard();
}

function applyDeviceLinkedState() {
  const linked = !!sessionLinkedDevice;
  ['hud-void-overlay','thermal-void-overlay','chart-void-overlay'].forEach(id => {
    document.getElementById(id).classList.toggle('show', !linked);
  });
  const badge = document.getElementById('hdr-device-badge');
  if (linked) { document.getElementById('hdr-device-id').textContent = sessionLinkedDevice; badge.classList.add('show'); }
  else badge.classList.remove('show');
  document.getElementById('linked-device-info').style.display   = linked ? 'block' : 'none';
  document.getElementById('unlinked-device-form').style.display = linked ? 'none'  : 'block';
  const devPassSection = document.getElementById('dev-pass-section');
  devPassSection.style.display = linked ? 'block' : 'none';
  if (linked) document.getElementById('dev-id').value = sessionLinkedDevice;
}

async function doLinkDeviceFromSettings() {
  const deviceId   = document.getElementById('settings-dev-link-id').value.trim();
  const devicePass = document.getElementById('settings-dev-link-pass').value;
  const msgEl      = document.getElementById('settings-link-msg');
  msgEl.className  = 'settings-msg';
  if (!deviceId || !devicePass) { msgEl.className='settings-msg err'; msgEl.textContent='ALL FIELDS REQUIRED'; return; }
  try {
    const r = await fetch('/api/link-device', { method:'POST', headers:{'Content-Type':'application/json',...authHeaders()}, body: JSON.stringify({deviceId, devicePassword: devicePass}) });
    const d = await r.json();
    if (!r.ok) { msgEl.className='settings-msg err'; msgEl.textContent = d.error || 'LINK FAILED'; return; }
    sessionLinkedDevice = deviceId; localStorage.setItem('lx_device', deviceId);
    msgEl.className = 'settings-msg ok'; msgEl.textContent = `✓ DEVICE ${deviceId} LINKED SUCCESSFULLY`;
    applyDeviceLinkedState(); loadDevices();
    if (ws) ws.close(); connect();
  } catch(e) { msgEl.className='settings-msg err'; msgEl.textContent='CONNECTION ERROR'; }
}

async function doUnlinkDevice() {
  const msgEl = document.getElementById('unlink-msg');
  if (!confirm('Unlink this device? You will stop receiving data until you link a new one.')) return;
  try {
    const r = await fetch('/api/link-device', { method:'DELETE', headers: authHeaders() });
    const d = await r.json();
    if (!r.ok) { msgEl.className='settings-msg err'; msgEl.textContent = d.error || 'UNLINK FAILED'; return; }
    sessionLinkedDevice = ''; localStorage.setItem('lx_device', '');
    msgEl.className = 'settings-msg ok'; msgEl.textContent = '✓ DEVICE UNLINKED';
    applyDeviceLinkedState();
    if (ws) ws.close();
  } catch(e) { msgEl.className='settings-msg err'; msgEl.textContent='CONNECTION ERROR'; }
}

// ═══════════════════════════════════════════════════════════
//  LOGOUT
// ═══════════════════════════════════════════════════════════
async function doLogout() {
  await fetch('/api/logout', {method:'POST', headers: authHeaders()}).catch(()=>{});
  sessionToken = null; sessionUser = null; sessionRole = null; sessionLinkedDevice = null;
  localStorage.removeItem('lx_token'); localStorage.removeItem('lx_user');
  localStorage.removeItem('lx_role');  localStorage.removeItem('lx_device');
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('superadmin-dashboard').classList.remove('visible');
  document.getElementById('link-screen').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
  showLoginForm();
  document.getElementById('login-pass').value = '';
  document.getElementById('login-err').textContent = '';
}

// ═══════════════════════════════════════════════════════════
//  SUPERADMIN
// ═══════════════════════════════════════════════════════════
function showSuperadminDashboard() {
  document.getElementById('dashboard').classList.remove('visible');
  document.getElementById('superadmin-dashboard').classList.add('visible');
  document.getElementById('sa-hdr-user').textContent = sessionUser;
  bootSuperadmin();
}

// ═══════════════════════════════════════════════════════════
//  PAGE LOAD — restore session
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  ['login-user','login-pass'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); }); });
  ['reg-otp','reg-user','reg-pass','reg-code'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); }); });
  ['reg-email'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') regSendOTP(); }); });
  ['link-device-id','link-device-pass'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') doLinkDevice(); }); });
  ['forgot-user'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') forgotStep1(); }); });
  ['forgot-otp'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') forgotStep2(); }); });
  ['forgot-new-pass','forgot-conf-pass'].forEach(id => { document.getElementById(id)?.addEventListener('keydown', e => { if(e.key==='Enter') forgotStep3(); }); });
  const codeInput = document.getElementById('reg-code');
  if (codeInput) { codeInput.addEventListener('input', function() { this.value = this.value.toUpperCase().replace(/[^A-Z0-9-]/g,''); }); }
  const otpInput = document.getElementById('reg-otp');
  if (otpInput) { otpInput.addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g,''); }); }
  const forgotOtp = document.getElementById('forgot-otp');
  if (forgotOtp) { forgotOtp.addEventListener('input', function() { this.value = this.value.replace(/[^0-9]/g,''); }); }
});

window.addEventListener('load', async () => {
  if (sessionToken) {
    try {
      const r = await fetch('/api/me', {headers: authHeaders()});
      if (r.ok) {
        const d = await r.json();
        sessionRole         = d.role || sessionRole || 'admin';
        sessionLinkedDevice = d.linkedDeviceId || '';
        localStorage.setItem('lx_role',   sessionRole);
        localStorage.setItem('lx_device', sessionLinkedDevice);
        routeAfterAuth(); return;
      }
    } catch(e) {}
    localStorage.removeItem('lx_token'); localStorage.removeItem('lx_user');
    localStorage.removeItem('lx_role');  localStorage.removeItem('lx_device');
  }
});

function showLoginForm() { document.getElementById('signup-box').style.display='none'; document.getElementById('forgot-box').style.display='none'; document.getElementById('login-box').style.display='block'; document.getElementById('login-err').textContent=''; }

// ═══════════════════════════════════════════════════════════
//  SIGNUP / REGISTER — 2-step: send OTP → verify + create
// ═══════════════════════════════════════════════════════════
function showRegisterForm() {
  document.getElementById('login-box').style.display = 'none';
  document.getElementById('forgot-box').style.display = 'none';
  document.getElementById('signup-box').style.display = 'block';
  document.getElementById('reg-err').textContent = '';
  document.getElementById('reg-err').className = 'login-err';
  document.getElementById('reg-step1').style.display = 'block';
  document.getElementById('reg-step2').style.display = 'none';
  document.getElementById('reg-email').value = '';
  document.getElementById('reg-otp-err').textContent = '';
  const btn = document.getElementById('reg-send-otp-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'SEND VERIFICATION CODE →'; }
}

async function regSendOTP() {
  const email = document.getElementById('reg-email').value.trim();
  const errEl = document.getElementById('reg-otp-err');
  errEl.className = 'login-err'; errEl.textContent = '';
  if (!email) { errEl.textContent = 'EMAIL IS REQUIRED'; return; }
  const btn = document.getElementById('reg-send-otp-btn');
  btn.disabled = true; btn.textContent = 'SENDING...';
  try {
    const r = await fetch('/api/register/send-otp', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'FAILED TO SEND CODE'; btn.disabled = false; btn.textContent = 'SEND VERIFICATION CODE →'; return; }
    document.getElementById('reg-email-display').textContent = email;
    document.getElementById('reg-step1').style.display = 'none';
    document.getElementById('reg-step2').style.display = 'block';
    errEl.className = 'login-err ok'; errEl.textContent = '✓ CODE SENT — CHECK YOUR EMAIL';
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; btn.disabled = false; btn.textContent = 'SEND VERIFICATION CODE →'; }
}

async function doRegister() {
  const username   = document.getElementById('reg-user').value.trim();
  const password   = document.getElementById('reg-pass').value;
  const inviteCode = document.getElementById('reg-code').value.trim().toUpperCase();
  const email      = document.getElementById('reg-email').value.trim();
  const otp        = document.getElementById('reg-otp').value.trim();
  const errEl      = document.getElementById('reg-err');
  errEl.className = 'login-err';
  if (!username || !password || !inviteCode || !otp) { errEl.textContent = 'ALL FIELDS ARE REQUIRED'; return; }
  if (password.length < 6) { errEl.textContent = 'PASSWORD MIN 6 CHARACTERS'; return; }
  if (!inviteCode.startsWith('LX-') || inviteCode.length < 9) { errEl.textContent = 'INVALID CODE FORMAT (e.g. LX-A3F7K2)'; return; }
  try {
    const r = await fetch('/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, inviteCode, email, otp })
    });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'REGISTRATION FAILED'; return; }
    errEl.className = 'login-err ok'; errEl.textContent = '✓ ACCOUNT CREATED — LOG IN TO LINK YOUR ESP DEVICE';
    document.getElementById('reg-user').value = '';
    document.getElementById('reg-pass').value = '';
    document.getElementById('reg-code').value = '';
    document.getElementById('reg-otp').value = '';
    setTimeout(() => { showLoginForm(); document.getElementById('login-user').value = username; document.getElementById('login-user').focus(); }, 1800);
  } catch(e) { errEl.textContent = 'CONNECTION ERROR'; }
}

// ═══════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════
function switchTab(name, evt) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  if (evt&&evt.currentTarget) evt.currentTarget.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if (name==='alerts')   loadAlerts();
  if (name==='settings') loadDevices();
}

// ═══════════════════════════════════════════════════════════
//  ALERT LOG
// ═══════════════════════════════════════════════════════════
async function loadAlerts() {
  const limit = document.getElementById('alert-limit')?.value||100;
  const filter = document.getElementById('alert-filter')?.value||'';
  const loadEl = document.getElementById('alerts-loading');
  const tableEl = document.getElementById('alert-table');
  const emptyEl = document.getElementById('alert-empty');
  loadEl.style.display='block'; tableEl.style.display='none'; emptyEl.style.display='none';
  try {
    let url = `/api/alerts?limit=${limit}`; if (filter) url+=`&type=${filter}`;
    const r = await fetch(url, {headers: authHeaders()});
    if (!r.ok) { loadEl.textContent='NO DATA — LINK YOUR DEVICE FIRST'; return; }
    const rows = await r.json();
    if (!filter) {
      let fc=0,hc=0,rc=0;
      rows.forEach(r=>{ if(r.alert_type==='FIRE')fc++; else if(r.alert_type==='HUMAN')hc++; else if(r.alert_type==='HIGH_RISK')rc++; });
      document.getElementById('sum-fire').textContent=fc; document.getElementById('sum-human').textContent=hc; document.getElementById('sum-risk').textContent=rc;
      const tab=document.getElementById('alerts-tab-btn');
      if(rows.length) tab.classList.add('has-alerts'); else tab.classList.remove('has-alerts');
    }
    loadEl.style.display='none';
    if (!rows.length) { emptyEl.style.display='block'; return; }
    const tbody=document.getElementById('alert-tbody'); tbody.innerHTML='';
    rows.forEach(row => {
      const tr=document.createElement('tr');
      const ts=new Date(row.recorded_at).toLocaleString('en-GB',{hour12:false});
      tr.innerHTML=`<td style="color:var(--dim);white-space:nowrap">${ts}</td><td><span class="alert-type-badge type-${row.alert_type}">${row.alert_type.replace('_',' ')}</span></td><td style="color:var(--cyan)">${row.device_id||'—'}</td><td>${row.temp!=null?row.temp.toFixed(1)+'°C':'—'}</td><td>${row.hum!=null?row.hum.toFixed(0)+'%':'—'}</td><td style="color:${row.risk>=65?'var(--red)':row.risk>=30?'var(--yellow)':'var(--green)'}">${row.risk??'—'}</td><td>${row.max_temp!=null?row.max_temp.toFixed(1)+'°C':'—'}</td><td style="color:var(--dim);font-size:.65rem">${row.details||'—'}</td>`;
      tbody.appendChild(tr);
    });
    tableEl.style.display='table';
  } catch(e) { loadEl.textContent='ERROR LOADING ALERTS'; }
}

// ═══════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════
async function changePassword() {
  const cur=document.getElementById('cur-pass').value; const nw=document.getElementById('new-pass').value; const conf=document.getElementById('conf-pass').value;
  const msg=document.getElementById('pass-msg');
  if (!cur||!nw||!conf) { msg.className='settings-msg err'; msg.textContent='ALL FIELDS REQUIRED'; return; }
  if (nw!==conf) { msg.className='settings-msg err'; msg.textContent='PASSWORDS DO NOT MATCH'; return; }
  if (nw.length<6) { msg.className='settings-msg err'; msg.textContent='MIN 6 CHARACTERS'; return; }
  try {
    const r=await fetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({currentPassword:cur,newPassword:nw})});
    const d=await r.json();
    if (!r.ok) { msg.className='settings-msg err'; msg.textContent=d.error; return; }
    msg.className='settings-msg ok'; msg.textContent='PASSWORD UPDATED SUCCESSFULLY';
    document.getElementById('cur-pass').value=''; document.getElementById('new-pass').value=''; document.getElementById('conf-pass').value='';
  } catch(e) { msg.className='settings-msg err'; msg.textContent='ERROR'; }
}

async function changeDevicePassword() {
  const id=document.getElementById('dev-id').value.trim(); const pass=document.getElementById('dev-pass').value;
  const msg=document.getElementById('dev-msg');
  if (!id||!pass) { msg.className='settings-msg err'; msg.textContent='ALL FIELDS REQUIRED'; return; }
  if (pass.length<6) { msg.className='settings-msg err'; msg.textContent='MIN 6 CHARACTERS'; return; }
  if (!sessionLinkedDevice) { msg.className='settings-msg err'; msg.textContent='LINK YOUR DEVICE FIRST'; return; }
  try {
    const r=await fetch('/api/device/change-password',{method:'POST',headers:{'Content-Type':'application/json',...authHeaders()},body:JSON.stringify({deviceId:id,newPassword:pass})});
    const d=await r.json();
    if (!r.ok) { msg.className='settings-msg err'; msg.textContent=d.error; return; }
    msg.className='settings-msg ok'; msg.textContent='✓ DEVICE PASSWORD UPDATED — FLASH NEW SKETCH';
    document.getElementById('dev-pass').value='';
  } catch(e) { msg.className='settings-msg err'; msg.textContent='ERROR'; }
}

async function loadDevices() {
  try {
    const r=await fetch('/api/devices',{headers: authHeaders()});
    const devs=await r.json();
    const el=document.getElementById('device-list-info');
    if (!el) return;
    if (!devs.length) { el.innerHTML='<div style="font-size:.7rem;color:var(--dim)">NO DEVICE LINKED</div>'; return; }
    el.innerHTML=devs.map(d=>`
      <div class="device-info-row">DEVICE ID <span>${d.device_id}</span></div>
      <div class="device-info-row">NAME      <span>${d.device_name||'—'}</span></div>
      <div class="device-info-row">LAST SEEN <span style="color:var(--dim)">${d.last_seen?new Date(d.last_seen).toLocaleString('en-GB',{hour12:false}):'NEVER'}</span></div>
    `).join('<hr style="border-color:#0ff1;margin:7px 0;">');
    if (devs.length===1) document.getElementById('dev-id').value=devs[0].device_id;
  } catch(e) {}
}

// (See app-superadmin.js for superadmin functions)
// (See app-charts.js for chart functions)
// (See app-dashboard.js for dashboard and WebSocket functions)
