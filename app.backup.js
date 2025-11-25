/* app.patched.js — Klinik Sentosa (Original + Non-invasive Patches)
   - mempertahankan kode asli (fungsi, UI, alur)
   - menambahkan: DOM-ready init, ARIA/keyboard for roles, TTS UI sync,
     prescription propagation (Dokter -> Apoteker), cross-tab sync hint,
     event compatibility (patch:* + user-logged-in + ks-login-success)
   - Jangan lupa backup file lama sebelum replace.
*/

/* ---------- tiny DOM helpers (kept) ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const create = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'id') el.id = v;
    else el.setAttribute(k, v);
  });
  kids.flat().forEach(k => { if (typeof k === 'string') el.appendChild(document.createTextNode(k)); else if (k) el.appendChild(k); });
  return el;
};

/* ---------- Demo users (kept) ---------- */
const demoUsers = [
  { username: 'petugas1', role: 'Petugas Administrasi', name: 'Petugas A' },
  { username: 'dokter1', role: 'Dokter', name: 'dr. Andi' },
  { username: 'apoteker1', role: 'Apoteker', name: 'Apoteker A' },
  { username: 'kasir1', role: 'Kasir', name: 'Kasir A' },
  { username: 'manajer1', role: 'Manajer Klinik', name: 'Manajer' },
  { username: 'pasien1', role: 'Pasien', name: 'Budi Santoso' }
];

/* ---------- UI cache placeholders (will be set on DOMContentLoaded) ---------- */
let roleButtons = [];
let selectedRoleSpan = null;
let loginForm = null;
let loginError = null;
let loginScreen = null;
let mainScreen = null;
let overlay = null;
let navLinks = null;
let navUserRole = null;
let navUsername = null;
let logoutBtn = null;
let btnFillDemo = null;

let selectedRole = 'Petugas Administrasi';
let currentUser = null;           // logged user
let appData = {};                // per-role data (payments, stock, prescriptions, appointments optional)
const GLOBAL_PATIENTS_KEY = 'ks_global_patients'; // patients shared among relevant actors

/* ---------- utilities (kept) ---------- */
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const roleKey = role => role ? role.toLowerCase().replace(/\s+/g,'') : 'unknown';
const dataKeyForRole = r => `ks_data_${roleKey(r)}`;

function uid(prefix='id') { return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function logActivity(text) {
  if (!appData) return;
  appData.logs = appData.logs || [];
  appData.logs.unshift({id: uid('log'), text, at: new Date().toISOString()});
  saveDataForRole(currentUser && currentUser.role ? currentUser.role : 'system');
}

/* ---------- safe JSON parse for localStorage (kept) ---------- */
function safeJsonParseKey(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch(e) {
    console.warn('[safeJsonParseKey] corrupt key:', key, e);
    try { localStorage.setItem(`${key}_corrupt_${Date.now()}`, localStorage.getItem(key)); } catch(e2){}
    localStorage.removeItem(key);
    return fallback;
  }
}

/* ---------- modal + toast (kept) ---------- */
function ensureShells() {
  if (!$('#ks-modal-root')) {
    const modal = create('div',{id:'ks-modal-root', class:'ks-modal-root hidden'});
    modal.innerHTML = `<div class="ks-modal-backdrop"></div><div class="ks-modal-panel" role="dialog" aria-modal="true"></div>`;
    document.body.appendChild(modal);
  }
  if (!$('#ks-toast-root')) {
    const t = create('div',{id:'ks-toast-root', class:'ks-toast-root'});
    document.body.appendChild(t);
  }
}
function showModal(htmlOrNode, opts = {}) {
  ensureShells();
  const root = $('#ks-modal-root');
  const panel = root.querySelector('.ks-modal-panel');
  panel.innerHTML = '';
  if (typeof htmlOrNode === 'string') panel.innerHTML = htmlOrNode;
  else panel.appendChild(htmlOrNode);
  root.classList.remove('hidden');
  document.body.classList.add('ks-modal-open');
  root.querySelector('.ks-modal-backdrop').onclick = () => {
    if (!opts.lock) hideModal();
  };
}
function hideModal(){ const r = $('#ks-modal-root'); if (!r) return; r.classList.add('hidden'); document.body.classList.remove('ks-modal-open'); }
function toast(msg, opts={timeout:2500}) {
  ensureShells();
  const root = $('#ks-toast-root');
  const el = create('div', {class: 'ks-toast'}, escapeHtml(msg));
  root.appendChild(el);
  setTimeout(()=> {
    el.classList.add('ks-fadeout');
    setTimeout(()=> el.remove(), 400);
  }, opts.timeout || 2000);
}

/* ---------- DOM-ready init (role buttons, demo, accessibility, cache) ---------- */
document.addEventListener('DOMContentLoaded', () => {
  // cache DOM nodes (safe after DOMContentLoaded)
  roleButtons = $$('.role-option') || [];
  selectedRoleSpan = $('#selected-role');
  loginForm = $('#login-form');
  loginError = $('#login-error');
  loginScreen = $('#login-screen');
  mainScreen = $('#main-screen');
  overlay = $('#login-overlay');
  navLinks = $('#nav-links');
  navUserRole = $('#nav-user-role');
  navUsername = $('#nav-username');
  logoutBtn = $('#logout-btn');
  btnFillDemo = $('#btn-fill-demo');

  // ensure initial selectedRole is in sync with UI
  selectedRole = roleButtons.find(b => b.classList.contains('role-option--active'))?.dataset.role || 'Petugas Administrasi';
  if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;

  // role buttons: click + keyboard + aria
  roleButtons.forEach((btn, idx) => {
    btn.setAttribute('role','button');
    btn.setAttribute('tabindex','0');
    btn.setAttribute('aria-pressed', btn.classList.contains('role-option--active') ? 'true' : 'false');

    btn.addEventListener('click', () => {
      roleButtons.forEach(r => { r.classList.remove('role-option--active'); r.setAttribute('aria-pressed','false'); });
      btn.classList.add('role-option--active');
      btn.setAttribute('aria-pressed','true');
      selectedRole = btn.dataset.role;
      if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); roleButtons[(idx+1)%roleButtons.length].focus(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); roleButtons[(idx-1+roleButtons.length)%roleButtons.length].focus(); }
    });
  });

  // demo fill button feedback
  if (btnFillDemo) {
    btnFillDemo.addEventListener('click', () => {
      const demo = demoUsers.find(u => u.role.toLowerCase() === selectedRole.toLowerCase());
      if (demo) {
        $('#username').value = demo.username;
        $('#password').value = 'demo';
        if (loginError) loginError.textContent = '';
      } else {
        if (loginError) loginError.textContent = 'Tidak ada demo user untuk role ini.';
        setTimeout(()=> { if (loginError) loginError.textContent = ''; }, 2600);
      }
    });
  }

  // Sync TTS toggle UI state for styling & accessibility (if injected)
  const ttsBtn = document.getElementById('tts-toggle');
  if (ttsBtn) {
    const enabled = localStorage.getItem('klinik_sentosa_tts_enabled') !== "false";
    if (enabled) { ttsBtn.classList.add('toggled'); ttsBtn.setAttribute('aria-pressed','true'); ttsBtn.textContent = 'TTS: ON'; }
    else { ttsBtn.classList.remove('toggled'); ttsBtn.setAttribute('aria-pressed','false'); ttsBtn.textContent = 'TTS: OFF'; }

    ttsBtn.addEventListener('click', () => {
      const isOn = ttsBtn.classList.toggle('toggled');
      ttsBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    });
  }
});

/* ---------- role selector (kept fallback, in case DOM ready wasn't used earlier) ---------- */
roleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    roleButtons.forEach(r => r.classList.remove('role-option--active'));
    btn.classList.add('role-option--active');
    selectedRole = btn.dataset.role;
    if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
  });
});

/* ---------- demo fill (kept fallback) ---------- */
if (btnFillDemo) {
  btnFillDemo.addEventListener('click', () => {
    const demo = demoUsers.find(u => u.role.toLowerCase() === selectedRole.toLowerCase());
    if (demo) {
      $('#username').value = demo.username;
      $('#password').value = 'demo';
      if (loginError) loginError.textContent = '';
    } else {
      if (loginError) loginError.textContent = 'Tidak ada demo user untuk role ini.';
    }
  });
}

/* ---------- auto-select role based on username (kept) ---------- */
$('#username')?.addEventListener('blur', () => {
  try {
    const val = $('#username').value.trim();
    if (!val) return;
    const u = findDemoUser(val);
    if (u) {
      const btn = roleButtons.find(b => b.dataset.role && b.dataset.role.toLowerCase() === u.role.toLowerCase());
      if (btn) {
        roleButtons.forEach(r => r.classList.remove('role-option--active'));
        btn.classList.add('role-option--active');
        selectedRole = btn.dataset.role;
        if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
      }
    }
  } catch(e){ /* noop */ }
});

/* ---------- auth helper (kept) ---------- */
function findDemoUser(username){
  if (!username) return null;
  return demoUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
}

/* ---------- GLOBAL patients helpers (kept) ---------- */
function loadGlobalPatients(){
  try {
    const parsed = safeJsonParseKey(GLOBAL_PATIENTS_KEY, null);
    if (parsed !== null) return parsed;
  } catch(e){ console.warn('loadGlobalPatients fail', e); }
  const init = [];
  try { localStorage.setItem(GLOBAL_PATIENTS_KEY, JSON.stringify(init)); } catch(e){}
  return init;
}
function saveGlobalPatients(list){
  try {
    localStorage.setItem(GLOBAL_PATIENTS_KEY, JSON.stringify(list));
  } catch(e){ console.warn('saveGlobalPatients fail', e); }
}

/* ---------- per-role data store (kept) ---------- */
function loadDataForRole(role){
  const k = dataKeyForRole(role);
  try {
    const parsed = safeJsonParseKey(k, null);
    if (parsed !== null) {
      appData = parsed;
      return appData;
    }
  } catch(e){ console.warn('loadDataForRole fail', e); }
  appData = {
    appointments: [],
    payments: [],
    prescriptions: [],
    stock: [],
    logs: [],
    medicalRecords: []
  };
  saveDataForRole(role);
  return appData;
}
function saveDataForRole(role){
  const k = dataKeyForRole(role);
  try {
    localStorage.setItem(k, JSON.stringify(appData));
  } catch(e){ console.warn('saveDataForRole fail', e); }
}

/* ---------- modal + list helpers improved: attach handlers directly where possible (kept) ---------- */

/* ---------- login handler (with focus on empty fields & guarded dispatch for voice) ---------- */
if (typeof loginForm !== 'undefined' && loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (loginError) loginError.textContent = '';

    const username = ($('#username')?.value || '').trim();
    const password = ($('#password')?.value || '').trim(); // demo only
    if (!username || !password) {
      if (loginError) loginError.textContent = 'Username dan password tidak boleh kosong.';
      $('#username')?.focus();
      return;
    }

    const user = findDemoUser(username);
    if (!user) {
      if (loginError) loginError.textContent = 'User tidak ditemukan (gunakan demo username).';
      $('#username')?.focus();
      return;
    }
    if (user.role.toLowerCase() !== selectedRole.toLowerCase()) {
      if (loginError) loginError.textContent = `Role terpilih (${selectedRole}) tidak sesuai dengan user (${user.role}). Pilih role yang sesuai.`; 
      // auto-select correct role to help user
      const btn = roleButtons.find(b => b.dataset.role && b.dataset.role.toLowerCase() === user.role.toLowerCase());
      if (btn) {
        roleButtons.forEach(r => r.classList.remove('role-option--active'));
        btn.classList.add('role-option--active');
        selectedRole = btn.dataset.role;
        if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
      }
      return;
    }

    // set session (no overlay or timeout) — immediate smooth transition
    sessionStorage.setItem('ks_user', JSON.stringify(user));
    currentUser = user;

    // load global patients and role data
    loadGlobalPatients();
    loadDataForRole(currentUser.role);

    // animate transition: fade login out and fade in main (handled by CSS transitions)
    if (loginScreen) {
      loginScreen.style.transition = 'opacity .35s ease, transform .35s ease';
      loginScreen.style.opacity = '0';
      loginScreen.style.transform = 'translateY(8px)';
    }
    setTimeout(()=> {
      if (loginScreen) { loginScreen.classList.remove('screen--active'); loginScreen.style.display = 'none'; }
      if (mainScreen) { mainScreen.classList.add('screen--active'); mainScreen.style.display = 'block'; mainScreen.setAttribute('aria-hidden','false'); mainScreen.style.opacity = '0'; mainScreen.style.transform = 'translateY(6px)'; mainScreen.style.transition = 'opacity .45s ease, transform .45s ease'; setTimeout(()=> { mainScreen.style.opacity = '1'; mainScreen.style.transform = 'translateY(0)'; }, 20); }
      prepareDashboardFor(currentUser);
    }, 240);

    toast(`Selamat datang, ${user.name}`);

    // --- PATCH: dispatch login events for other patches/listeners ---
    setTimeout(() => {
      const detail = { name: user.name || user.username, role: user.role, username: user.username };
      try {
        // avoid duplicate notifications
        if (!window.__ks_voice_notified) {
          document.dispatchEvent(new CustomEvent('user-logged-in', { detail }));
          document.dispatchEvent(new CustomEvent('ks-login-success', { detail }));
          // compatibility events used by patch-additions / patch-voice
          document.dispatchEvent(new CustomEvent('patch:loginAttempt', { detail }));
          document.dispatchEvent(new CustomEvent('patch:loginSubmitted', { detail }));
          // older naming variant for window
          window.dispatchEvent(new CustomEvent('patch:loginAttempt', { detail }));
          window.dispatchEvent(new CustomEvent('patch:loginSubmitted', { detail }));
          window.__ks_voice_notified = true;
        }
      } catch (e) { console.warn('dispatch login events failed', e); }
    }, 350);
    // --- end PATCH ---
  });
} else {
  // If loginForm binding wasn't present at initial parse, wait until DOMContentLoaded to bind (defensive)
  document.addEventListener('DOMContentLoaded', () => {
    const lf = $('#login-form');
    if (!lf) return;
    lf.addEventListener('submit', (e) => {
      // duplicate logic is intentionally lightweight — original binding above will handle most cases.
      e.preventDefault();
      const username = ($('#username')?.value || '').trim();
      const password = ($('#password')?.value || '').trim();
      if (!username || !password) { if ($('#login-error')) $('#login-error').textContent = 'Username dan password tidak boleh kosong.'; return; }
      const user = findDemoUser(username);
      if (!user) { if ($('#login-error')) $('#login-error').textContent = 'User tidak ditemukan.'; return; }
      sessionStorage.setItem('ks_user', JSON.stringify(user)); currentUser = user; loadGlobalPatients(); loadDataForRole(currentUser.role); prepareDashboardFor(currentUser);
      toast(`Selamat datang, ${user.name}`);
      setTimeout(()=> {
        try {
          const detail = { name: user.name || user.username, role: user.role, username: user.username };
          if (!window.__ks_voice_notified) { document.dispatchEvent(new CustomEvent('user-logged-in',{detail})); window.__ks_voice_notified = true; }
        } catch(e){}
      },350);
    });
  });
}

/* ---------- logout ---------- */
if (logoutBtn) {
  if (!logoutBtn.dataset.bound) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.removeItem('ks_user');
      if (mainScreen) { mainScreen.style.display = 'none'; mainScreen.classList.remove('screen--active'); }
      if (loginScreen) { loginScreen.style.display = ''; loginScreen.classList.add('screen--active'); loginScreen.style.opacity = '1'; loginScreen.style.transform = 'none'; }
      if (navLinks) navLinks.innerHTML = '';
      if (navUsername) navUsername.textContent = '';
      if (navUserRole) navUserRole.textContent = '';
      appData = {};
      toast('Anda telah logout');
      // reset voice-notified guard
      window.__ks_voice_notified = false;
    });
    logoutBtn.dataset.bound = '1';
  }
} else {
  // defensive: bind on DOMContentLoaded if necessary
  document.addEventListener('DOMContentLoaded', () => {
    const lb = $('#logout-btn');
    if (!lb) return;
    if (!lb.dataset.bound) {
      lb.addEventListener('click', () => {
        sessionStorage.removeItem('ks_user');
        if (mainScreen) { mainScreen.style.display = 'none'; mainScreen.classList.remove('screen--active'); }
        if (loginScreen) { loginScreen.style.display = ''; loginScreen.classList.add('screen--active'); loginScreen.style.opacity = '1'; loginScreen.style.transform = 'none'; }
        if (navLinks) navLinks.innerHTML = '';
        if (navUsername) navUsername.textContent = '';
        if (navUserRole) navUserRole.textContent = '';
        appData = {};
        toast('Anda telah logout');
        window.__ks_voice_notified = false;
      });
      lb.dataset.bound = '1';
    }
  });
}

/* ---------- nav links render (kept) ---------- */
function renderNavLinks(role) {
  if (!navLinks) return;
  navLinks.innerHTML = '';
  const addLink = (label, onClick) => {
    const a = create('a', {href:'#', class:'nav-link'});
    a.textContent = label;
    a.addEventListener('click', (e) => { e.preventDefault(); onClick && onClick(); });
    navLinks.appendChild(a);
  };
  addLink('Beranda', ()=> showHome());
  if (['Petugas Administrasi', 'Dokter', 'Perawat', 'Apoteker'].includes(role)) addLink('Pendaftaran', ()=> openPatientList());
  if (['Apoteker', 'Petugas Administrasi'].includes(role)) addLink('Apotek', ()=> openStock());
  if (['Kasir', 'Petugas Administrasi'].includes(role)) addLink('Pembayaran', ()=> openPayments());
  if (role === 'Manajer Klinik') addLink('Laporan', ()=> openReports());
  addLink('Tentang', ()=> showAbout());
}

/* ---------- prepare dashboard main (kept + patched sync hook) ---------- */
function prepareDashboardFor(user){
  if (!user) return;
  if (navUserRole) navUserRole.textContent = user.role;
  if (navUsername) navUsername.textContent = `• ${user.name || user.username}`;

  // If user is Apoteker, ensure prescriptions are synced from all roles
  try {
    if (user.role && user.role.toLowerCase() === 'apoteker') {
      // sync merged prescriptions into Apoteker storage before loading
      try { syncAllPrescriptionsForRole('Apoteker'); } catch(e) {}
      loadDataForRole('Apoteker');
    } else {
      loadDataForRole(user.role);
    }
  } catch(e){ loadDataForRole(user.role); }

  renderNavLinks(user.role);

  $$('.role-dashboard').forEach(d => d.classList.add('hidden'));
  const container = getDashContainerByRoleKey(user.role);
  if (!container) return;

  switch(user.role) {
    case 'Petugas Administrasi': buildPetugasDashboard(); break;
    case 'Dokter': buildDokterDashboard(); break;
    case 'Perawat': buildPerawatDashboard(); break;
    case 'Kasir': buildKasirDashboard(); break;
    case 'Apoteker': buildApotekerDashboard(); break;
    case 'Manajer Klinik': buildManajerDashboard(); break;
    case 'Pasien': buildPasienDashboard(); break;
    default: container.innerHTML = `<div class="card-title">Halo</div><p>Role belum di-setup</p>`;
  }
}

/* ---------- map role -> container (kept) ---------- */
function getDashContainerByRoleKey(key){
  const normalized = (key||'').trim().toLowerCase();
  const map = {
    'petugas administrasi':'#dash-petugas',
    'dokter':'#dash-dokter',
    'perawat':'#dash-perawat',
    'kasir':'#dash-kasir',
    'apoteker':'#dash-apoteker',
    'manajer klinik':'#dash-manajer',
    'pasien':'#dash-pasien'
  };
  const sel = map[normalized];
  if (!sel) return null;
  const el = $(sel);
  if (el) { el.innerHTML = ''; el.classList.remove('hidden'); el.classList.add('ks-anim-card'); setTimeout(()=> el.classList.remove('ks-anim-card'), 700); }
  return el;
}

/* ---------- helpers: datetime-local conversion (kept) ---------- */
function toInputDatetimeLocal(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2,'0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/* ---------- PATIENTS (kept) ---------- */
function openPatientList() {
  const patients = loadGlobalPatients();
  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Daftar Pasien (Global)'));

  const actionsRow = create('div', {class:'ks-list-actions'});
  if (currentUser && currentUser.role === 'Petugas Administrasi') {
    const addBtn = create('button', {class:'btn btn-primary', id:'ks-btn-newpatient'}, 'Tambah Pasien');
    addBtn.addEventListener('click', ()=> showPatientForm());
    actionsRow.appendChild(addBtn);
  } else {
    actionsRow.appendChild(create('div', {style:'color:var(--muted)'}, 'Hanya Petugas Administrasi dapat menambah pasien'));
  }
  html.appendChild(actionsRow);

  const listWrap = create('div', {class:'ks-list'});
  if (patients.length) {
    patients.forEach(p => {
      const item = create('div', {class:'ks-list-item'});
      item.appendChild(create('div', {class:'ks-list-main'}, `${escapeHtml(p.name)} — ${escapeHtml(p.phone||'-')}`));
      const meta = create('div', {class:'ks-list-meta'});
      const btnView = create('button', {class:'action-btn small'}, 'Lihat');
      btnView.addEventListener('click', ()=> showPatientDetails(p.id));
      meta.appendChild(btnView);
      if (currentUser && currentUser.role === 'Petugas Administrasi') {
        const btnEdit = create('button', {class:'action-btn small'}, 'Edit');
        btnEdit.addEventListener('click', ()=> showPatientForm(p.id));
        const btnDel = create('button', {class:'action-btn small'}, 'Hapus');
        btnDel.addEventListener('click', ()=> {
          if (confirm('Hapus pasien ini?')) {
            let list = loadGlobalPatients();
            list = list.filter(x=>x.id!==p.id);
            saveGlobalPatients(list);
            toast('Pasien dihapus');
            hideModal();
          }
        });
        meta.appendChild(btnEdit);
        meta.appendChild(btnDel);
      }
      item.appendChild(meta);
      listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div', {class:'ks-empty'}, 'Belum ada pasien.'));
  }
  html.appendChild(listWrap);
  showModal(html, {lock:false});
}

function showPatientDetails(id) {
  const list = loadGlobalPatients();
  const p = list.find(x => x.id === id);
  if (!p) { toast('Pasien tidak ditemukan'); return; }
  const records = getAllMedicalRecordsForPatient(id);
  const html = create('div', {class:'ks-card'});
  html.appendChild(create('h3', {class:'card-title'}, `Detail: ${escapeHtml(p.name)}`));
  html.appendChild(create('div', {class:'kv-row'}, [create('div',{}, 'Telepon:'), create('div',{}, escapeHtml(p.phone||'-'))]));
  html.appendChild(create('div', {class:'kv-row'}, [create('div',{}, 'Tanggal Lahir:'), create('div',{}, escapeHtml(p.dob||'-'))]));
  const recSection = create('div', {}, create('h4', {}, 'Rekam Medis:'));
  if (records.length) {
    const ul = create('ul', {});
    records.forEach(r => ul.appendChild(create('li', {}, `${new Date(r.datetime).toLocaleString()} — ${escapeHtml(r.doctor)}: ${escapeHtml((r.notes||'').substring(0,120))}`)));
    recSection.appendChild(ul);
  } else {
    recSection.appendChild(create('div', {class:'ks-empty'}, 'Belum ada rekam medis.'));
  }
  html.appendChild(recSection);

  const btnRow = create('div', {style:'margin-top:12px'});
  if (currentUser && ['Dokter','Perawat'].includes(currentUser.role)) {
    const addBtn = create('button',{class:'btn btn-primary', id:'ks-add-med'}, 'Tambah Rekam Medis');
    addBtn.addEventListener('click', ()=> showMedicalRecordForm(id));
    btnRow.appendChild(addBtn);
  }
  const closeBtn = create('button', {class:'btn btn-outline', id:'ks-btn-close'}, 'Tutup');
  closeBtn.addEventListener('click', hideModal);
  btnRow.appendChild(closeBtn);
  html.appendChild(btnRow);

  showModal(html);
}

function showPatientForm(id) {
  if (!(currentUser && currentUser.role === 'Petugas Administrasi')) { toast('Hanya Petugas Administrasi dapat menambah atau mengedit pasien'); return; }
  const list = loadGlobalPatients();
  const editing = !!id;
  const p = editing ? list.find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-patient-form'});
  form.appendChild(create('h3', {class:'card-title'}, editing ? 'Edit Pasien' : 'Tambah Pasien'));
  form.appendChild(create('label', {}, 'Nama', create('input', {type:'text', id:'ks-patient-name', value: p.name || ''})));
  form.appendChild(create('label', {}, 'Telepon', create('input', {type:'text', id:'ks-patient-phone', value: p.phone || ''})));
  form.appendChild(create('label', {}, 'Tanggal Lahir', create('input', {type:'date', id:'ks-patient-dob', value: p.dob || ''})));
  form.appendChild(create('label', {}, 'Catatan', create('textarea', {id:'ks-patient-notes'}, p.notes || '')));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const submitBtn = create('button', {type:'submit', class:'btn btn-primary'}, editing ? 'Simpan' : 'Buat');
  const cancelBtn = create('button', {type:'button', class:'btn btn-outline', id:'ks-pat-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(submitBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = $('#ks-patient-name').value.trim();
    if (!name) return alert('Masukkan nama pasien');
    const phone = $('#ks-patient-phone').value.trim();
    const dob = $('#ks-patient-dob').value;
    const notes = $('#ks-patient-notes').value.trim();
    let list2 = loadGlobalPatients();
    if (editing) {
      list2 = list2.map(x => x.id === id ? {...x, name, phone, dob, notes} : x);
      saveGlobalPatients(list2);
      toast('Pasien diperbarui');
    } else {
      const newP = {id: uid('pat'), name, phone, dob, notes};
      list2.unshift(newP);
      saveGlobalPatients(list2);
      toast('Pasien baru ditambahkan');
    }
    hideModal();
  });
}

/* ---------- MEDICAL RECORDS (kept) ---------- */
function addMedicalRecord(patientId, doctorName, notes) {
  const rec = {id: uid('med'), patientId, doctor: doctorName, notes, datetime: new Date().toISOString()};
  appData.medicalRecords = appData.medicalRecords || [];
  appData.medicalRecords.unshift(rec);
  saveDataForRole(currentUser.role);
  logActivity(`Rekam medis: ${patientId} oleh ${doctorName}`);
  return rec;
}
function getAllMedicalRecordsForPatient(patientId) {
  const roles = ['Petugas Administrasi','Dokter','Perawat','Kasir','Apoteker','Manajer Klinik','Pasien'];
  let results = [];
  roles.forEach(r => {
    try {
      const raw = safeJsonParseKey(dataKeyForRole(r), null);
      if (!raw) return;
      const d = raw;
      if (d && d.medicalRecords) {
        results = results.concat(Array.isArray(d.medicalRecords) ? d.medicalRecords.filter(m => m.patientId === patientId) : []);
      }
    } catch(e){}
  });
  return results.sort((a,b)=> new Date(b.datetime) - new Date(a.datetime));
}
function showMedicalRecordForm(patientId) {
  if (!currentUser || !['Dokter','Perawat'].includes(currentUser.role)) { toast('Hanya Dokter/Perawat dapat menambah rekam medis'); return; }
  const form = create('form', {class:'ks-form', id:'ks-med-form'});
  form.appendChild(create('h3', {class:'card-title'}, 'Tambah Rekam Medis'));
  const sel = create('select',{id:'ks-med-patient'});
  (loadGlobalPatients().map(p => sel.appendChild(create('option',{value:p.id}, p.name))));
  form.appendChild(create('label', {}, 'Pasien', sel));
  form.appendChild(create('label', {}, 'Catatan pemeriksaan', create('textarea',{id:'ks-med-notes'})));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const saveBtn = create('button',{type:'submit', class:'btn btn-primary'}, 'Simpan');
  const cancelBtn = create('button',{type:'button', class:'btn btn-outline', id:'ks-med-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(saveBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  if (patientId) $('#ks-med-patient').value = patientId;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const pid = $('#ks-med-patient').value;
    const notes = $('#ks-med-notes').value.trim();
    if (!pid || !notes) return alert('Isi pasien dan catatan');
    addMedicalRecord(pid, currentUser.name, notes);
    hideModal();
    toast('Rekam medis tersimpan');
  });
}

/* ---------- APPOINTMENTS (kept) ---------- */
function openAppointments() {
  loadDataForRole(currentUser.role);
  const items = appData.appointments || [];
  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Janji Temu'));
  const actions = create('div', {class:'ks-list-actions'});
  const newBtn = create('button', {class:'btn btn-primary', id:'ks-btn-newappt'}, 'Buat Janji');
  newBtn.addEventListener('click', ()=> showAppointmentForm());
  actions.appendChild(newBtn); html.appendChild(actions);
  const listWrap = create('div', {class:'ks-list'});
  if (items.length) {
    items.forEach(a => {
      const pat = (loadGlobalPatients()||[]).find(p=>p.id===a.patientId) || {name:'-'};
      const item = create('div', {class:'ks-list-item'});
      item.appendChild(create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — ${new Date(a.datetime).toLocaleString()}`));
      const meta = create('div', {class:'ks-list-meta'});
      const btnEdit = create('button', {class:'action-btn small'}, 'Edit');
      btnEdit.addEventListener('click', ()=> showAppointmentForm(a.id));
      const btnDel = create('button', {class:'action-btn small'}, 'Hapus');
      btnDel.addEventListener('click', ()=> {
        if (confirm('Hapus janji?')) {
          appData.appointments = (appData.appointments||[]).filter(x=>x.id!==a.id); saveDataForRole(currentUser.role);
          toast('Janji dihapus');
          hideModal();
        }
      });
      const btnCall = create('button', {class:'action-btn small'}, 'Panggil');
      btnCall.addEventListener('click', ()=> toast('Panggilan antrian: ' + a.id));
      meta.appendChild(btnEdit); meta.appendChild(btnDel); meta.appendChild(btnCall);
      item.appendChild(meta); listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div', {class:'ks-empty'}, 'Belum ada janji.'));
  }
  html.appendChild(listWrap);
  showModal(html);
}
function showAppointmentForm(id) {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) {
    if (!confirm('Belum ada pasien. Tambah pasien sekarang?')) return;
    showPatientForm();
    return;
  }
  const editing = !!id;
  const a = editing ? (appData.appointments||[]).find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-appt-form'});
  form.appendChild(create('h3', {class:'card-title'}, editing ? 'Edit Janji' : 'Buat Janji'));
  const sel = create('select', {id:'ks-appt-patient'});
  (loadGlobalPatients()||[]).forEach(p => sel.appendChild(create('option', {value:p.id}, p.name)));
  form.appendChild(create('label', {}, 'Pilih Pasien', sel));
  form.appendChild(create('label', {}, 'Dokter (nama)', create('input', {type:'text', id:'ks-appt-doctor', value: a.doctor || ''})));
  form.appendChild(create('label', {}, 'Tanggal & Waktu', create('input', {type:'datetime-local', id:'ks-appt-dt', value: a.datetime ? toInputDatetimeLocal(a.datetime) : ''})));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const saveBtn = create('button', {type:'submit', class:'btn btn-primary'}, editing ? 'Simpan' : 'Buat');
  const cancelBtn = create('button', {type:'button', class:'btn btn-outline', id:'ks-appt-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(saveBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  if (editing) {
    $('#ks-appt-patient').value = a.patientId;
    $('#ks-appt-doctor').value = a.doctor || '';
    $('#ks-appt-dt').value = a.datetime ? toInputDatetimeLocal(a.datetime) : '';
  }
  form.addEventListener('submit', (ev)=>{
    ev.preventDefault();
    const patientId = $('#ks-appt-patient').value;
    const doctor = $('#ks-appt-doctor').value.trim();
    const dt = $('#ks-appt-dt').value;
    if (!patientId || !dt) return alert('Pilih pasien dan waktu');
    if (editing) {
      const idx = appData.appointments.findIndex(x=>x.id===id);
      appData.appointments[idx] = {...appData.appointments[idx], patientId, doctor, datetime: new Date(dt).toISOString()};
      toast('Janji diupdate'); logActivity(`Janji diupdate: ${id}`);
    } else {
      const newA = {id: uid('appt'), patientId, doctor, datetime: new Date(dt).toISOString(), status:'scheduled'};
      appData.appointments.unshift(newA);
      toast('Janji dibuat'); logActivity(`Janji dibuat untuk pasien ${patientId}`);
    }
    saveDataForRole(currentUser.role);
    hideModal();
  });
}

/* ---------- PAYMENTS (kept) ---------- */
function openPayments() {
  loadDataForRole(currentUser.role);
  const items = appData.payments || [];
  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Pembayaran'));
  const actions = create('div', {class:'ks-list-actions'});
  const newBtn = create('button', {class:'btn btn-primary', id:'ks-new-pay'}, 'Buat Pembayaran');
  newBtn.addEventListener('click', ()=> showPaymentForm());
  actions.appendChild(newBtn); html.appendChild(actions);
  const listWrap = create('div', {class:'ks-list'});
  if (items.length) {
    items.forEach(p => {
      const pat = (loadGlobalPatients()||[]).find(x=>x.id===p.patientId) || {name:'-'};
      const item = create('div', {class:'ks-list-item'});
      item.appendChild(create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — Rp ${p.amount}`));
      const meta = create('div', {class:'ks-list-meta'});
      meta.appendChild(create('div', {}, new Date(p.datetime).toLocaleString()));
      item.appendChild(meta); listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div', {class:'ks-empty'}, 'Belum ada pembayaran.'));
  }
  html.appendChild(listWrap);
  showModal(html);
}
function showPaymentForm() {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) { toast('Tambah pasien dulu'); return; }
  const form = create('form', {class:'ks-form', id:'ks-pay-form'});
  form.appendChild(create('h3', {class:'card-title'}, 'Pembayaran Baru'));
  const sel = create('select', {id:'ks-pay-patient'});
  (loadGlobalPatients()||[]).forEach(p=> sel.appendChild(create('option',{value:p.id}, p.name)));
  form.appendChild(create('label', {}, 'Pilih Pasien', sel));
  form.appendChild(create('label', {}, 'Jumlah (Rp)', create('input', {type:'number', id:'ks-pay-amount', value:''})));
  form.appendChild(create('label', {}, 'Metode', create('input', {type:'text', id:'ks-pay-method', value:'Tunai'})));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const payBtn = create('button', {type:'submit', class:'btn btn-primary'}, 'Bayar');
  const cancelBtn = create('button', {type:'button', class:'btn btn-outline', id:'ks-pay-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(payBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  form.addEventListener('submit', (e)=> {
    e.preventDefault();
    const patientId = $('#ks-pay-patient').value;
    const amount = Number($('#ks-pay-amount').value) || 0;
    const method = $('#ks-pay-method').value || 'Tunai';
    if (!patientId || amount <= 0) return alert('Masukkan pasien & jumlah valid');
    const rec = {id: uid('pay'), patientId, amount, method, note:'', datetime: new Date().toISOString()};
    appData.payments.unshift(rec);
    saveDataForRole(currentUser.role);
    logActivity(`Pembayaran: ${rec.id} pasien:${patientId} rp ${amount}`);
    toast('Pembayaran disimpan');
    hideModal();
  });
}

/* ---------- STOCK (kept) ---------- */
function openStock() {
  loadDataForRole(currentUser.role);
  const stock = appData.stock || [];
  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Manajemen Stok Obat'));
  const actions = create('div', {class:'ks-list-actions'});
  const newBtn = create('button', {class:'btn btn-primary', id:'ks-stock-new'}, 'Tambah Obat');
  newBtn.addEventListener('click', ()=> showStockForm());
  actions.appendChild(newBtn); html.appendChild(actions);
  const listWrap = create('div', {class:'ks-list'});
  if (stock.length) {
    stock.forEach(s => {
      const item = create('div', {class:'ks-list-item'});
      item.appendChild(create('div', {class:'ks-list-main'}, `${escapeHtml(s.name)} — ${s.qty} ${s.unit || ''}`));
      const meta = create('div', {class:'ks-list-meta'});
      const btnEdit = create('button', {class:'action-btn small'}, 'Edit');
      btnEdit.addEventListener('click', ()=> showStockForm(s.id));
      const btnDel = create('button', {class:'action-btn small'}, 'Hapus');
      btnDel.addEventListener('click', ()=> {
        if (confirm('Hapus item stok?')) {
          appData.stock = (appData.stock||[]).filter(x=>x.id!==s.id); saveDataForRole(currentUser.role);
          toast('Item stok dihapus');
          hideModal();
        }
      });
      meta.appendChild(btnEdit); meta.appendChild(btnDel);
      item.appendChild(meta); listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div', {class:'ks-empty'}, 'Belum ada data stok.'));
  }
  html.appendChild(listWrap);
  showModal(html);
}
function showStockForm(id) {
  const editing = !!id;
  const s = editing ? (appData.stock||[]).find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-stock-form'});
  form.appendChild(create('h3', {class:'card-title'}, editing ? 'Edit Item Stok' : 'Tambah Item Stok'));
  form.appendChild(create('label', {}, 'Nama Obat', create('input', {id:'ks-stock-name', value: s.name || ''})));
  form.appendChild(create('label', {}, 'Jumlah', create('input', {id:'ks-stock-qty', type:'number', value: s.qty || 0})));
  form.appendChild(create('label', {}, 'Satuan', create('input', {id:'ks-stock-unit', value: s.unit || ''})));
  form.appendChild(create('label', {}, 'Ambang (min)', create('input', {id:'ks-stock-min', type:'number', value: s.minThreshold || 0})));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const saveBtn = create('button', {type:'submit', class:'btn btn-primary'}, 'Simpan');
  const cancelBtn = create('button', {type:'button', class:'btn btn-outline', id:'ks-stock-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(saveBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  form.addEventListener('submit', (ev)=> {
    ev.preventDefault();
    const name = $('#ks-stock-name').value.trim();
    const qty = Number($('#ks-stock-qty').value) || 0;
    const unit = $('#ks-stock-unit').value.trim();
    const min = Number($('#ks-stock-min').value) || 0;
    if (!name) return alert('Nama obat dibutuhkan');
    if (editing) {
      const idx = appData.stock.findIndex(x=>x.id===id);
      appData.stock[idx] = {...appData.stock[idx], name, qty, unit, minThreshold: min};
      toast('Item stok diupdate');
      logActivity(`Stok update: ${name}`);
    } else {
      const it = {id: uid('stk'), name, qty, unit, minThreshold: min};
      appData.stock.unshift(it);
      toast('Item stok ditambahkan');
      logActivity(`Stok tambah: ${name}`);
    }
    saveDataForRole(currentUser.role);
    hideModal();
  });
}

/* ---------- PRESCRIPTIONS (kept but patched to propagate) ---------- */
function openPrescriptions(){
  // If current user is Apoteker, ensure their storage is synced from all roles first
  try {
    if (currentUser && currentUser.role && currentUser.role.toLowerCase() === 'apoteker') {
      syncAllPrescriptionsForRole('Apoteker');
      loadDataForRole('Apoteker');
    } else {
      loadDataForRole(currentUser.role);
    }
  } catch(e){ loadDataForRole(currentUser.role); }

  const list = appData.prescriptions || [];
  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Resep & Obat'));
  const actions = create('div', {class:'ks-list-actions'});
  const newBtn = create('button', {class:'btn btn-primary', id:'ks-presc-new'}, 'Buat Resep');
  newBtn.addEventListener('click', ()=> showPrescriptionForm());
  actions.appendChild(newBtn); html.appendChild(actions);
  const listWrap = create('div', {class:'ks-list'});
  if (list.length) {
    list.forEach(p => {
      const pat = (loadGlobalPatients()||[]).find(x=>x.id===p.patientId) || {name:'-'};
      const item = create('div', {class:'ks-list-item'});
      item.appendChild(create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — ${new Date(p.datetime).toLocaleString()}`));
      const meta = create('div', {class:'ks-list-meta'});
      const takeBtn = create('button',{class:'action-btn small'}, p.pickedUp ? 'Sudah Ambil' : 'Ambil');
      takeBtn.addEventListener('click', ()=> {
        const idx = appData.prescriptions.findIndex(x=>x.id===p.id);
        if (idx>=0) { appData.prescriptions[idx].pickedUp = true; saveDataForRole(currentUser.role); toast('Resep ditandai sudah diambil'); hideModal(); }
      });
      meta.appendChild(takeBtn); item.appendChild(meta); listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div', {class:'ks-empty'}, 'Belum ada resep.'));
  }
  html.appendChild(listWrap);
  showModal(html);
}
function showPrescriptionForm() {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) { toast('Tambah pasien dulu'); return; }
  const form = create('form', {class:'ks-form', id:'ks-presc-form'});
  form.appendChild(create('h3', {class:'card-title'}, 'Buat Resep'));
  const sel = create('select',{id:'ks-presc-patient'});
  (loadGlobalPatients()||[]).forEach(p=> sel.appendChild(create('option', {value:p.id}, p.name)));
  form.appendChild(create('label', {}, 'Pilih Pasien', sel));
  form.appendChild(create('label', {}, 'Item (pisahkan koma)', create('input',{id:'ks-presc-items', placeholder:'Paracetamol 10mg x2, Amoxicillin 500mg x7'})));
  const btnWrap = create('div', {style:'margin-top:12px;display:flex;gap:8px'});
  const saveBtn = create('button', {type:'submit', class:'btn btn-primary'}, 'Simpan');
  const cancelBtn = create('button', {type:'button', class:'btn btn-outline', id:'ks-presc-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(saveBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  form.addEventListener('submit', (ev)=> {
    ev.preventDefault();
    const pid = $('#ks-presc-patient').value;
    const itemsText = $('#ks-presc-items').value.trim();
    const items = itemsText ? itemsText.split(',').map(i=> ({name:i.trim()})) : [];
    const rec = {id: uid('presc'), patientId: pid, items, issuedBy: currentUser.name, datetime: new Date().toISOString(), pickedUp:false};
    appData.prescriptions.unshift(rec);
    saveDataForRole(currentUser.role);
    logActivity(`Resep dibuat untuk pasien ${pid}`);
    toast('Resep tersimpan');

    // --- PATCH: notify & propagate prescription to Apoteker + Petugas ---
    try {
      // dispatch inline event for our propagation listener
      document.dispatchEvent(new CustomEvent('prescription-saved-inline', { detail: rec }));
      try { localStorage.setItem('ks_presc_last_sync', JSON.stringify({ts:Date.now(), id: rec.id})); } catch(e){}
    } catch(e){ console.warn('presc save dispatch fail', e); }
    // --- end patch ---

    hideModal();
  });
}

/* ---------- REPORTS (kept) ---------- */
function openReports() {
  loadDataForRole(currentUser.role);
  const totalPatients = (loadGlobalPatients()||[]).length;
  const totalAppointments = (appData.appointments||[]).length;
  const totalPayments = (appData.payments||[]).reduce((s,p)=>s+(p.amount||0),0);
  const lowStock = (appData.stock||[]).filter(s=> s.qty <= (s.minThreshold||0));
  const html = create('div', {class:'ks-card'});
  html.appendChild(create('h3', {class:'card-title'}, 'Laporan Harian (Ringkas)'));
  html.appendChild(create('div', {class:'kv-row'}, [create('div',{},'Jumlah Pasien (global)'), create('div',{}, String(totalPatients))]));
  html.appendChild(create('div', {class:'kv-row'}, [create('div',{},'Jumlah Janji (role)'), create('div',{}, String(totalAppointments))]));
  html.appendChild(create('div', {class:'kv-row'}, [create('div',{},'Pendapatan (Rp)'), create('div',{}, String(totalPayments))]));
  const lowWrap = create('div', {style:'margin-top:12px'}, create('h4', {}, 'Stok yang perlu diorder'));
  if (lowStock.length) {
    const ul = create('ul');
    lowStock.forEach(s => ul.appendChild(create('li', {}, `${escapeHtml(s.name)} (${s.qty})`)));
    lowWrap.appendChild(ul);
  } else lowWrap.appendChild(create('div', {}, 'Tidak ada'));
  html.appendChild(lowWrap);
  showModal(html);
}

/* ---------- helpers: home/about (kept) ---------- */
function showHome() {
  const root = getDashContainerByRoleKey(currentUser.role);
  if (!root) return;
  const patientsCount = (loadGlobalPatients()||[]).length;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="workspace">
      <h3>Ringkasan</h3>
      <div class="kv-row"><div>Pasien (global)</div><div>${patientsCount}</div></div>
      <div class="kv-row"><div>Janji (role)</div><div>${(appData.appointments||[]).length}</div></div>
      <div class="kv-row"><div>Pembayaran (role)</div><div>${(appData.payments||[]).length}</div></div>
    </div>
  `;
}
function showAbout(){
  const root = getDashContainerByRoleKey(currentUser.role);
  if (!root) return;
  root.innerHTML = `<div class="card-title">Tentang Klinik Sentosa</div><p class="kv-row">Sistem demo mengikuti use-case: Pendaftaran, Penjadwalan, Pemeriksaan, Resep, Pembayaran, Stok, Laporan, Akses Data Pasien.</p>`;
}

/* ---------- role dashboards (kept) ---------- */
function buildPetugasDashboard() {
  const root = getDashContainerByRoleKey('Petugas Administrasi'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-open-pat">Pendaftaran Pasien</button>
      <button class="action-btn" id="ks-open-appt">Penjadwalan Dokter</button>
      <button class="action-btn" id="ks-open-pay">Pembayaran</button>
    </div>
  `;
  $('#ks-open-pat')?.addEventListener('click', openPatientList);
  $('#ks-open-appt')?.addEventListener('click', openAppointments);
  $('#ks-open-pay')?.addEventListener('click', openPayments);
}
function buildDokterDashboard() {
  const root = getDashContainerByRoleKey('Dokter'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-my-appts">Antrian & Janji</button>
      <button class="action-btn" id="ks-add-record">Pemeriksaan / Rekam Medis</button>
      <button class="action-btn" id="ks-presc">Pembuatan Resep</button>
    </div>
  `;
  $('#ks-my-appts')?.addEventListener('click', openAppointments);
  $('#ks-add-record')?.addEventListener('click', ()=> showMedicalRecordForm());
  $('#ks-presc')?.addEventListener('click', openPrescriptions);
}
function buildPerawatDashboard(){
  const root = getDashContainerByRoleKey('Perawat'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-open-pat2">Akses Data Pasien</button>
      <button class="action-btn" id="ks-nursing-notes">Pemeriksaan & Catatan</button>
    </div>
  `;
  $('#ks-open-pat2')?.addEventListener('click', openPatientList);
  $('#ks-nursing-notes')?.addEventListener('click', ()=> showMedicalRecordForm());
}
function buildKasirDashboard(){
  const root = getDashContainerByRoleKey('Kasir'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-open-pay2">Pembayaran</button>
      <button class="action-btn" id="ks-report-cash">Laporan Kas</button>
    </div>
  `;
  $('#ks-open-pay2')?.addEventListener('click', openPayments);
  $('#ks-report-cash')?.addEventListener('click', openReports);
}
function buildApotekerDashboard(){
  const root = getDashContainerByRoleKey('Apoteker'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-open-stock">Manajemen Stok Obat</button>
      <button class="action-btn" id="ks-open-presc">Resep Masuk</button>
    </div>
  `;
  $('#ks-open-stock')?.addEventListener('click', openStock);
  $('#ks-open-presc')?.addEventListener('click', openPrescriptions);
}
function buildManajerDashboard(){
  const root = getDashContainerByRoleKey('Manajer Klinik'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions">
      <button class="action-btn" id="ks-open-reports">Lihat Laporan</button>
      <button class="action-btn" id="ks-export">Export CSV</button>
    </div>
  `;
  $('#ks-open-reports')?.addEventListener('click', openReports);
  $('#ks-export')?.addEventListener('click', ()=> {
    const csv = `Key,Value\nPatients,${(loadGlobalPatients()||[]).length}\nAppointments,${(appData.appointments||[]).length}\nPayments,${(appData.payments||[]).length}`;
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'report.csv'; a.click(); URL.revokeObjectURL(url);
    toast('CSV diexport (unduhan dimulai)');
  });
}
function buildPasienDashboard(){
  const root = getDashContainerByRoleKey('Pasien'); if (!root) return;
  root.innerHTML = `
    <div class="card-title">Halo, ${escapeHtml(currentUser.name)}</div>
    <div class="quick-actions patient-quick">
      <button class="patient-btn" id="ks-my-appointments">Lihat Janji Saya</button>
      <button class="patient-btn" id="ks-my-history">Riwayat Kunjungan</button>
      <button class="patient-btn" id="ks-new-queue">Daftar Antrian Baru</button>
    </div>
  `;
  $('#ks-my-appointments')?.addEventListener('click', ()=> { if (typeof showMyAppointmentsModal === 'function') showMyAppointmentsModal(); else openAppointments(); });
  $('#ks-my-history')?.addEventListener('click', ()=> { if (typeof showMyHistoryModal === 'function') showMyHistoryModal(); else toast('Fitur riwayat belum tersedia'); });
  $('#ks-new-queue')?.addEventListener('click', ()=> { if (typeof showNewQueueForm === 'function') showNewQueueForm(); else toast('Fitur daftar antrian belum tersedia'); });
}

/* ---------- session restore on load (kept + patched notify) ---------- */
document.addEventListener('DOMContentLoaded', ()=> {
  ensureShells();
  const sess = sessionStorage.getItem('ks_user');
  if (sess) {
    try {
      currentUser = JSON.parse(sess);
      const matchBtn = $$('.role-option').find(b => b.dataset.role && b.dataset.role.toLowerCase() === (currentUser.role||'').toLowerCase());
      if (matchBtn) {
        $$('.role-option').forEach(r=> r.classList.remove('role-option--active'));
        matchBtn.classList.add('role-option--active');
        selectedRole = matchBtn.dataset.role;
        if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
      }
      if (loginScreen) { loginScreen.style.display = 'none'; loginScreen.classList.remove('screen--active'); }
      if (mainScreen) { mainScreen.style.display = 'block'; mainScreen.classList.add('screen--active'); mainScreen.setAttribute('aria-hidden','false'); }
      loadDataForRole(currentUser.role);
      prepareDashboardFor(currentUser);

      // --- PATCH: restore session -> notify voice/other listeners that user is "already logged in"
      setTimeout(() => {
        try {
          const detail = { name: currentUser.name || currentUser.username, role: currentUser.role, username: currentUser.username };
          if (!window.__ks_voice_notified) {
            document.dispatchEvent(new CustomEvent('user-logged-in', { detail }));
            // compatibility
            document.dispatchEvent(new CustomEvent('patch:loginAttempt', { detail }));
            document.dispatchEvent(new CustomEvent('patch:loginSubmitted', { detail }));
            window.__ks_voice_notified = true;
          }
        } catch(e) { console.warn('dispatch user-logged-in on restore failed', e); }
      }, 450);
      // --- end PATCH ---

    } catch(e) { console.warn('restore fail', e); }
  }
});

/* expose small debug object (kept) */
window.__ks = {
  loadDataForRole, saveDataForRole, appData,
  dataKeyForRole, roleKey, loadGlobalPatients, saveGlobalPatients
};

/* ------------------ PATCH ADDITIONS (non-invasive) ------------------ */

/* 1) Patient helpers & handlers (kept + exposed) */
function getOrCreatePatientForCurrentUser() {
  if (!currentUser) return null;
  const name = currentUser.name || currentUser.username || '';
  let list = loadGlobalPatients() || [];
  let p = list.find(x => (x.name||'').toLowerCase() === name.toLowerCase());
  if (!p) {
    p = { id: uid('pat'), name: name, phone: '', dob: '', notes: `Auto-created for user ${currentUser.username}` };
    list.unshift(p);
    saveGlobalPatients(list);
    toast('Profil pasien otomatis dibuat untuk akun Anda');
  }
  return p.id;
}

function showMyAppointmentsModal() {
  const pid = getOrCreatePatientForCurrentUser();
  if (!pid) { toast('Data pasien tidak tersedia'); return; }

  const roles = ['Petugas Administrasi','Dokter','Perawat','Kasir','Apoteker','Manajer Klinik','Pasien'];
  let appts = [];
  roles.forEach(r => {
    try {
      const raw = safeJsonParseKey(dataKeyForRole(r), null);
      if (!raw) return;
      const d = raw;
      if (d && Array.isArray(d.appointments)) {
        appts = appts.concat(d.appointments.filter(a => a.patientId === pid));
      }
    } catch(e){}
  });

  const html = create('div', {class:'ks-listwrap'});
  html.appendChild(create('h3', {class:'card-title'}, 'Janji Saya'));
  const listWrap = create('div', {class:'ks-list'});
  if (appts.length) {
    appts.forEach(a => {
      const item = create('div',{class:'ks-list-item'});
      item.appendChild(create('div',{class:'ks-list-main'}, `${new Date(a.datetime).toLocaleString()} — ${escapeHtml(a.doctor||'-')}`));
      item.appendChild(create('div',{class:'ks-list-meta'}, [ create('div',{}, a.status || '') ]));
      listWrap.appendChild(item);
    });
  } else {
    listWrap.appendChild(create('div',{class:'ks-empty'}, 'Belum ada janji.'));
  }
  html.appendChild(listWrap);
  showModal(html);
}

function showMyHistoryModal() {
  const pid = getOrCreatePatientForCurrentUser();
  if (!pid) { toast('Data pasien tidak tersedia'); return; }
  const records = getAllMedicalRecordsForPatient(pid);
  const html = create('div',{class:'ks-card'});
  html.appendChild(create('h3',{class:'card-title'}, 'Riwayat Kunjungan / Rekam Medis'));
  if (records.length) {
    const div = create('div', {}, create('ul', {}, records.map(r => create('li', {}, `${new Date(r.datetime).toLocaleString()} — ${escapeHtml(r.doctor)}: ${escapeHtml(r.notes)}`))));
    html.appendChild(div);
  } else {
    html.appendChild(create('div',{class:'ks-empty'}, 'Belum ada riwayat.'));
  }
  const closeBtn = create('button',{class:'btn btn-outline', id:'ks-hist-close'}, 'Tutup');
  closeBtn.addEventListener('click', hideModal);
  html.appendChild(create('div',{style:'margin-top:12px'}, closeBtn));
  showModal(html);
}

function showNewQueueForm() {
  const pid = getOrCreatePatientForCurrentUser();
  if (!pid) { toast('Data pasien tidak tersedia'); return; }

  const form = create('form',{class:'ks-form'});
  form.appendChild(create('h3',{class:'card-title'}, 'Daftar Antrian / Buat Janji'));
  form.appendChild(create('label', {}, 'Nama Pasien', create('input',{type:'text', value: (currentUser.name||''), disabled:true})));
  form.appendChild(create('label', {}, 'Dokter (nama)', create('input',{type:'text', id:'ks-newq-doctor', placeholder:'dr. Contoh'})));
  form.appendChild(create('label', {}, 'Tanggal & Waktu', create('input',{type:'datetime-local', id:'ks-newq-dt'})));
  const btnWrap = create('div',{style:'margin-top:12px;display:flex;gap:8px'});
  const submitBtn = create('button',{type:'submit', class:'btn btn-primary'}, 'Daftar');
  const cancelBtn = create('button',{type:'button', class:'btn btn-outline', id:'ks-newq-cancel'}, 'Batal');
  cancelBtn.addEventListener('click', hideModal);
  btnWrap.appendChild(submitBtn); btnWrap.appendChild(cancelBtn);
  form.appendChild(btnWrap);

  showModal(form);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const doctor = $('#ks-newq-doctor').value.trim();
    const dt = $('#ks-newq-dt').value;
    if (!dt) return alert('Pilih tanggal & waktu untuk antrian');
    const roleKeyName = dataKeyForRole('Pasien');
    let roleData = { appointments: [] };
    try { roleData = safeJsonParseKey(roleKeyName, roleData); } catch(e){}
    const newA = { id: uid('appt'), patientId: pid, doctor, datetime: new Date(dt).toISOString(), status: 'scheduled', createdBy: currentUser.username };
    roleData.appointments = roleData.appointments || [];
    roleData.appointments.unshift(newA);
    try { localStorage.setItem(roleKeyName, JSON.stringify(roleData)); } catch(e){}
    toast('Antrian / janji berhasil dibuat');
    hideModal();
  });
}

/* 2) Panel enter/exit animation utility (kept) */
(function(){
  function animateShowPanel(newEl) {
    if (!newEl) return;
    const allPanels = Array.from(document.querySelectorAll('.role-dashboard'));
    const prev = allPanels.find(p => !p.classList.contains('hidden') && p !== newEl);
    if (prev && prev !== newEl) {
      prev.classList.add('patch-exit');
      prev.addEventListener('animationend', function onEnd() {
        prev.removeEventListener('animationend', onEnd);
        prev.classList.add('hidden');
        prev.classList.remove('patch-exit');
        newEl.classList.remove('hidden');
        newEl.classList.add('patch-enter');
        newEl.addEventListener('animationend', function onIn() {
          newEl.removeEventListener('animationend', onIn);
          newEl.classList.remove('patch-enter');
        }, { once: true });
      }, { once: true });
    } else {
      newEl.classList.remove('hidden');
      newEl.classList.add('patch-enter');
      newEl.addEventListener('animationend', function onIn() {
        newEl.removeEventListener('animationend', onIn);
        newEl.classList.remove('patch-enter');
      }, { once: true });
    }
  }

  window.animateShowPanel = animateShowPanel;

  document.addEventListener('click', (e) => {
    const a = e.target.closest('.nav-link');
    if (!a) return;
    setTimeout(()=> {
      const sess = sessionStorage.getItem('ks_user');
      if (!sess) return;
      try {
        const cur = JSON.parse(sess);
        const sel = getDashContainerByRoleKey(cur.role);
        if (sel) animateShowPanel(sel);
      } catch(e){}
    }, 120);
  }, true);
})();

/* 3) Real-time stat animation toggle (kept) */
let realtimeStatsInterval = null;
let realtimeAnimating = false;

function animateNumber(el, from, to, duration=900) {
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const ease = (t<0.5) ? (2*t*t) : (-1 + (4 - 2*t)*t);
    const v = Math.round(from + (to - from) * ease);
    el.textContent = v.toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function startRealtimeStats(elMap) {
  if (realtimeStatsInterval) clearInterval(realtimeStatsInterval);
  realtimeAnimating = true;
  realtimeStatsInterval = setInterval(()=> {
    const currentPatients = (loadGlobalPatients()||[]).length;
    const appts = (appData.appointments||[]).length;
    const paymentsTotal = (appData.payments||[]).reduce((s,p)=>s+(p.amount||0),0);
    const pTo = currentPatients + Math.floor((Math.random()*3)-1);
    const aTo = Math.max(0, appts + Math.floor((Math.random()*3)-1));
    const payTo = Math.max(0, paymentsTotal + Math.floor((Math.random()*5000)-2000));
    animateNumber(elMap.patients, Number(elMap.patients.dataset.current||0), pTo, 700);
    animateNumber(elMap.appts, Number(elMap.appts.dataset.current||0), aTo, 700);
    animateNumber(elMap.payments, Number(elMap.payments.dataset.current||0), payTo, 700);
    elMap.patients.dataset.current = pTo;
    elMap.appts.dataset.current = aTo;
    elMap.payments.dataset.current = payTo;
  }, 1400);
}

function stopRealtimeStats() {
  if (realtimeStatsInterval) clearInterval(realtimeStatsInterval);
  realtimeStatsInterval = null;
  realtimeAnimating = false;
}

window.getOrCreatePatientForCurrentUser = getOrCreatePatientForCurrentUser;
window.showMyAppointmentsModal = showMyAppointmentsModal;
window.showMyHistoryModal = showMyHistoryModal;
window.showNewQueueForm = showNewQueueForm;
window.startRealtimeStats = startRealtimeStats;
window.stopRealtimeStats = stopRealtimeStats;

/* ------------------ PATCH: Propagate & sync prescriptions across roles ------------------ */
/*
  Tujuan:
   - Saat Dokter membuat resep, salinan resep otomatis masuk ke penyimpanan role "Apoteker".
   - Ketika Apoteker membuka Resep (atau dashboardnya), sinkronisasi memastikan resep dari Dokter
     tampil di Apoteker (merge & dedup).
   - Tidak menghapus kode lama; ini hanya menambahkan langkah propgasi/sinkronisasi.
*/

function propagatePrescriptionToRole(targetRole, presc) {
  if (!targetRole || !presc || !presc.id) return;
  const key = dataKeyForRole(targetRole);
  let targetData = safeJsonParseKey(key, null);
  if (!targetData) {
    targetData = { appointments: [], payments: [], prescriptions: [], stock: [], logs: [], medicalRecords: [] };
  }
  targetData.prescriptions = Array.isArray(targetData.prescriptions) ? targetData.prescriptions : [];
  // deduplicate by id
  const exists = targetData.prescriptions.find(p => p.id === presc.id);
  if (!exists) {
    // make a shallow copy and annotate origin
    const copy = Object.assign({}, presc, { propagatedFrom: currentUser ? currentUser.role : 'system', propagatedAt: new Date().toISOString() });
    targetData.prescriptions.unshift(copy);
    try { localStorage.setItem(key, JSON.stringify(targetData)); } catch(e){ console.warn('propagatePrescriptionToRole save fail', e); }
  }
}

function syncAllPrescriptionsForRole(role) {
  if (!role) return;
  // collect prescriptions from all role keys
  const roles = ['Petugas Administrasi','Dokter','Perawat','Kasir','Apoteker','Manajer Klinik','Pasien'];
  const collected = [];
  roles.forEach(r => {
    try {
      const raw = safeJsonParseKey(dataKeyForRole(r), null);
      if (!raw || !Array.isArray(raw.prescriptions)) return;
      raw.prescriptions.forEach(p => {
        if (p && p.id) collected.push(p);
      });
    } catch(e) { /* noop */ }
  });
  // deduplicate by id (keep newest by datetime if available)
  const byId = {};
  collected.forEach(p => {
    if (!p || !p.id) return;
    if (!byId[p.id]) byId[p.id] = p;
    else {
      const existing = byId[p.id];
      const a = new Date(existing.datetime || existing.propagatedAt || 0).getTime();
      const b = new Date(p.datetime || p.propagatedAt || 0).getTime();
      if (b > a) byId[p.id] = p;
    }
  });
  const merged = Object.values(byId).sort((a,b) => (new Date(b.datetime||b.propagatedAt||0) - new Date(a.datetime||a.propagatedAt||0)));

  // write merged prescriptions into the target role storage
  const key = dataKeyForRole(role);
  let roleData = safeJsonParseKey(key, null);
  if (!roleData) {
    roleData = { appointments: [], payments: [], prescriptions: [], stock: [], logs: [], medicalRecords: [] };
  }
  // keep other fields intact, replace prescriptions with merged (but ensure we don't lose local-only prescriptions)
  const localPresc = Array.isArray(roleData.prescriptions) ? roleData.prescriptions : [];
  // Merge with localPresc by id (local overrides if same id)
  const mergedById = {};
  merged.forEach(p => mergedById[p.id] = p);
  localPresc.forEach(lp => mergedById[lp.id] = lp);
  const finalPresc = Object.values(mergedById).sort((a,b) => (new Date(b.datetime||b.propagatedAt||0) - new Date(a.datetime||a.propagatedAt||0)));
  roleData.prescriptions = finalPresc;
  try { localStorage.setItem(key, JSON.stringify(roleData)); } catch(e){ console.warn('syncAllPrescriptionsForRole save fail', e); }
  // if the current appData corresponds to this role, update in-memory too
  if (currentUser && currentUser.role && currentUser.role.toLowerCase() === role.toLowerCase()) {
    loadDataForRole(role); // reload into appData
  }
}

/* Hook into prescription creation: enhance existing showPrescriptionForm() submit flow.
   We listen for custom event 'prescription-saved-inline' which we dispatch from the submit handler.
*/
document.addEventListener('prescription-saved-inline', (ev) => {
  try {
    const rec = ev.detail;
    if (!rec || !rec.id) return;
    // propagate to Apoteker
    propagatePrescriptionToRole('Apoteker', rec);
    // optionally also propagate to Petugas Administrasi so they can see prescriptions
    propagatePrescriptionToRole('Petugas Administrasi', rec);
    // dispatch a global event for UI updates
    try { window.dispatchEvent(new CustomEvent('prescription-created', { detail: rec })); } catch(e){}
  } catch(e) { console.warn('prescription-saved-inline handler fail', e); }
});

/* Ensure Apoteker sees merged prescriptions when opening prescriptions and when dashboard prepared */
const _orig_openPrescriptions = openPrescriptions;
openPrescriptions = function(...args) {
  try {
    if (currentUser && currentUser.role && currentUser.role.toLowerCase() === 'apoteker') {
      syncAllPrescriptionsForRole('Apoteker');
      loadDataForRole('Apoteker');
    }
  } catch(e){ console.warn('pre-sync openPrescriptions failed', e); }
  return _orig_openPrescriptions.apply(this, args);
};

const _orig_prepareDashboardFor = prepareDashboardFor;
prepareDashboardFor = function(user) {
  try {
    if (user && user.role && user.role.toLowerCase() === 'apoteker') {
      syncAllPrescriptionsForRole('Apoteker');
      loadDataForRole('Apoteker');
    }
  } catch(e){ console.warn('pre-sync prepareDashboardFor failed', e); }
  return _orig_prepareDashboardFor.apply(this, arguments);
};

/* Bonus: listen for cross-window localStorage hint to reload if another tab changed prescriptions */
window.addEventListener('storage', (e) => {
  try {
    if (e.key === 'ks_presc_last_sync') {
      // another tab updated prescriptions; if I'm apoteker, resync
      if (currentUser && currentUser.role && currentUser.role.toLowerCase() === 'apoteker') {
        syncAllPrescriptionsForRole('Apoteker');
        loadDataForRole('Apoteker');
        toast('Data resep tersinkronisasi (pembaruan baru)');
      }
    }
  } catch(e) {}
});

/* End of app.patched.js */
