/* app.js — Klinik Sentosa (Updated)
   - Removed long loading delay and overlay; replaced with smooth transition animations
   - Patients are now GLOBAL (shared) so Petugas Admin, Dokter, Perawat can access the same patients
   - Medical records implemented (dokter/perawat can add/view)
   - Other modules still per-role (payments, stock, prescriptions) but usecases respected
   - Modal & toast utilities remain; UI unchanged otherwise
*/

/* ---------- tiny DOM helpers ---------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const create = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v);
  });
  kids.flat().forEach(k => { if (typeof k === 'string') el.appendChild(document.createTextNode(k)); else if (k) el.appendChild(k); });
  return el;
};

/* ---------- Demo users ---------- */
const demoUsers = [
  { username: 'petugas1', role: 'Petugas Administrasi', name: 'Petugas A' },
  { username: 'dokter1', role: 'Dokter', name: 'dr. Andi' },
  { username: 'apoteker1', role: 'Apoteker', name: 'Apoteker A' },
  { username: 'kasir1', role: 'Kasir', name: 'Kasir A' },
  { username: 'manajer1', role: 'Manajer Klinik', name: 'Manajer' },
  { username: 'pasien1', role: 'Pasien', name: 'Budi Santoso' }
];

/* ---------- UI cache ---------- */
const roleButtons = $$('.role-option') || [];
const selectedRoleSpan = $('#selected-role');
const loginForm = $('#login-form');
const loginError = $('#login-error');
const loginScreen = $('#login-screen');
const mainScreen = $('#main-screen');
const overlay = $('#login-overlay');
const navLinks = $('#nav-links');
const navUserRole = $('#nav-user-role');
const navUsername = $('#nav-username');
const logoutBtn = $('#logout-btn');
const btnFillDemo = $('#btn-fill-demo');

let selectedRole = roleButtons.find(b => b.classList.contains('role-option--active'))?.dataset.role || 'Petugas Administrasi';
let currentUser = null;           // logged user
let appData = {};                // per-role data (payments, stock, prescriptions, appointments optional)
const GLOBAL_PATIENTS_KEY = 'ks_global_patients'; // patients shared among relevant actors

/* ---------- utilities ---------- */
const escapeHtml = (s='') => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const roleKey = role => role ? role.toLowerCase().replace(/\s+/g,'') : 'unknown';
const dataKeyForRole = r => `ks_data_${roleKey(r)}`;

/* ---------- modal + toast (unchanged) ---------- */
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

/* ---------- role selector ---------- */
roleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    roleButtons.forEach(r => r.classList.remove('role-option--active'));
    btn.classList.add('role-option--active');
    selectedRole = btn.dataset.role;
    if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
  });
});

/* ---------- demo fill ---------- */
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

/* ---------- auth helper ---------- */
function findDemoUser(username){
  if (!username) return null;
  return demoUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
}

/* ---------- GLOBAL patients helpers ----------
   Patients are shared among Petugas Admin, Dokter, Perawat, and optionally Pasien (view own)
*/
function loadGlobalPatients(){
  try {
    const raw = localStorage.getItem(GLOBAL_PATIENTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch(e){ console.warn('loadGlobalPatients fail', e); }
  const init = [];
  localStorage.setItem(GLOBAL_PATIENTS_KEY, JSON.stringify(init));
  return init;
}
function saveGlobalPatients(list){
  try {
    localStorage.setItem(GLOBAL_PATIENTS_KEY, JSON.stringify(list));
  } catch(e){ console.warn('saveGlobalPatients fail', e); }
}

/* ---------- per-role data store (payments, stock, prescriptions, appointments optional) ---------- */
function loadDataForRole(role){
  const k = dataKeyForRole(role);
  try {
    const raw = localStorage.getItem(k);
    if (raw) {
      appData = JSON.parse(raw);
      return appData;
    }
  } catch(e){ console.warn('loadDataForRole fail', e); }
  appData = {
    appointments: [],
    payments: [],
    prescriptions: [],
    stock: [],
    logs: [],
    medicalRecords: [] // per-role storage for records if needed (doctors will save here too)
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
function uid(prefix='id') { return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function logActivity(text) {
  if (!appData) return;
  appData.logs = appData.logs || [];
  appData.logs.unshift({id: uid('log'), text, at: new Date().toISOString()});
  saveDataForRole(currentUser.role);
}

/* ---------- login handler (no artificial loading) ---------- */
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (loginError) loginError.textContent = '';

    const username = ($('#username')?.value || '').trim();
    const password = ($('#password')?.value || '').trim(); // demo only
    if (!username || !password) {
      if (loginError) loginError.textContent = 'Username dan password tidak boleh kosong.';
      return;
    }

    const user = findDemoUser(username);
    if (!user) {
      if (loginError) loginError.textContent = 'User tidak ditemukan (gunakan demo username).';
      return;
    }
    if (user.role.toLowerCase() !== selectedRole.toLowerCase()) {
      if (loginError) loginError.textContent = `Role terpilih (${selectedRole}) tidak sesuai dengan user (${user.role}). Pilih role yang sesuai.`;
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
    });
    logoutBtn.dataset.bound = '1';
  }
}

/* ---------- nav links render ---------- */
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

/* ---------- prepare dashboard main ---------- */
function prepareDashboardFor(user){
  if (!user) return;
  if (navUserRole) navUserRole.textContent = user.role;
  if (navUsername) navUsername.textContent = `• ${user.name || user.username}`;

  loadDataForRole(user.role);
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

/* ---------- map role -> container ---------- */
function getDashContainerByRoleKey(key){
  const map = {
    'Petugas Administrasi': '#dash-petugas',
    'Dokter': '#dash-dokter',
    'Perawat': '#dash-perawat',
    'Kasir': '#dash-kasir',
    'Apoteker': '#dash-apoteker',
    'Manajer Klinik': '#dash-manajer',
    'Pasien': '#dash-pasien'
  };
  const sel = map[key];
  if (!sel) return null;
  const el = $(sel);
  if (el) { el.innerHTML = ''; el.classList.remove('hidden'); el.classList.add('ks-anim-card'); setTimeout(()=> el.classList.remove('ks-anim-card'), 700); }
  return el;
}

/* ---------- FEATURES implementing Use Case Scenario ---------- */

/* ---------- PATIENTS (now GLOBAL) ---------- */
function openPatientList() {
  const patients = loadGlobalPatients();
  const html = create('div', {class:'ks-listwrap'}, [
    create('h3', {class:'card-title'}, 'Daftar Pasien (Global)'),
    create('div', {class:'ks-list-actions'}, [
      // only Petugas Admin can add patients (use case)
      (currentUser.role === 'Petugas Administrasi') ? create('button', {class:'btn btn-primary', id:'ks-btn-newpatient'}, 'Tambah Pasien') : create('div', {style:'color:var(--muted)'}, 'Hanya Petugas Administrasi dapat menambah pasien')
    ]),
    create('div', {class:'ks-list'}, patients.length ? patients.map(p => {
      return create('div', {class:'ks-list-item'}, [
        create('div', {class:'ks-list-main'}, `${escapeHtml(p.name)} — ${escapeHtml(p.phone||'-')}`),
        create('div', {class:'ks-list-meta'}, [
          create('button', {class:'action-btn small', 'data-id':p.id}, 'Lihat'),
          (currentUser.role === 'Petugas Administrasi') ? create('button', {class:'action-btn small', 'data-edit':p.id}, 'Edit') : null,
          (currentUser.role === 'Petugas Administrasi') ? create('button', {class:'action-btn small', 'data-del':p.id}, 'Hapus') : null
        ].filter(Boolean))
      ]);
    }) : create('div', {class:'ks-empty'}, 'Belum ada pasien.'))
  ]);
  showModal(html, {lock:false});

  if (currentUser.role === 'Petugas Administrasi') {
    $('#ks-btn-newpatient')?.addEventListener('click', ()=> showPatientForm());
  }
  $$('#ks-modal-root .ks-list-item .action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id') || btn.getAttribute('data-edit') || btn.getAttribute('data-del');
      if (btn.getAttribute('data-id')) showPatientDetails(id);
      else if (btn.getAttribute('data-edit')) showPatientForm(id);
      else if (btn.getAttribute('data-del')) {
        if (confirm('Hapus pasien ini?')) {
          let list = loadGlobalPatients();
          list = list.filter(x=>x.id!==id);
          saveGlobalPatients(list);
          toast('Pasien dihapus');
          hideModal();
        }
      }
    });
  });
}
function showPatientDetails(id) {
  const list = loadGlobalPatients();
  const p = list.find(x => x.id === id);
  if (!p) { toast('Pasien tidak ditemukan'); return; }
  // show patient details and medical records quick access
  const records = getAllMedicalRecordsForPatient(id);
  const html = create('div', {class:'ks-card'}, [
    create('h3', {class:'card-title'}, `Detail: ${escapeHtml(p.name)}`),
    create('div', {class:'kv-row'}, [create('div',{}, 'Telepon:'), create('div',{}, escapeHtml(p.phone||'-'))]),
    create('div', {class:'kv-row'}, [create('div',{}, 'Tanggal Lahir:'), create('div',{}, escapeHtml(p.dob||'-'))]),
    create('div', {}, create('h4', {}, 'Rekam Medis:'), records.length ? create('ul', {}, records.map(r => create('li', {}, `${new Date(r.datetime).toLocaleString()} — ${escapeHtml(r.doctor)}: ${escapeHtml(r.notes.substring(0,120))}`))) : create('div', {class:'ks-empty'}, 'Belum ada rekam medis.')),
    create('div', {style:'margin-top:12px'}, [
      // if dokter or perawat, allow to add medical record
      (['Dokter','Perawat'].includes(currentUser.role)) ? create('button',{class:'btn btn-primary', id:'ks-add-med'}, 'Tambah Rekam Medis') : null,
      create('button', {class:'btn btn-outline', id:'ks-btn-close'}, 'Tutup')
    ].filter(Boolean))
  ]);
  showModal(html);
  $('#ks-btn-close').addEventListener('click', hideModal);
  $('#ks-add-med')?.addEventListener('click', ()=> showMedicalRecordForm(id));
}
function showPatientForm(id) {
  // only Petugas Admin allowed here
  if (currentUser.role !== 'Petugas Administrasi') { toast('Hanya Petugas Administrasi dapat menambah atau mengedit pasien'); return; }
  const list = loadGlobalPatients();
  const editing = !!id;
  const p = editing ? list.find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-patient-form'}, [
    create('h3', {class:'card-title'}, editing ? 'Edit Pasien' : 'Tambah Pasien'),
    create('label', {}, 'Nama', create('input', {type:'text', id:'ks-patient-name', value: p.name || ''})),
    create('label', {}, 'Telepon', create('input', {type:'text', id:'ks-patient-phone', value: p.phone || ''})),
    create('label', {}, 'Tanggal Lahir', create('input', {type:'date', id:'ks-patient-dob', value: p.dob || ''})),
    create('label', {}, 'Catatan', create('textarea', {id:'ks-patient-notes'}, p.notes || '')),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button', {type:'submit', class:'btn btn-primary'}, editing ? 'Simpan' : 'Buat'),
      create('button', {type:'button', class:'btn btn-outline', id:'ks-pat-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-pat-cancel').addEventListener('click', hideModal);
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

/* ---------- MEDICAL RECORDS (Pemeriksaan oleh Dokter) ----------
   Stored per-role (doctor's role) but also accessible via global query (getAllMedicalRecordsForPatient)
*/
function addMedicalRecord(patientId, doctorName, notes) {
  const rec = {id: uid('med'), patientId, doctor: doctorName, notes, datetime: new Date().toISOString()};
  // store in current role's appData.medicalRecords for audit/history
  appData.medicalRecords = appData.medicalRecords || [];
  appData.medicalRecords.unshift(rec);
  saveDataForRole(currentUser.role);
  // also log
  logActivity(`Rekam medis: ${patientId} oleh ${doctorName}`);
  return rec;
}
function getAllMedicalRecordsForPatient(patientId) {
  // search all role keys and gather medicalRecords for that patient (simulate shared access)
  const roles = ['Petugas Administrasi','Dokter','Perawat','Kasir','Apoteker','Manajer Klinik','Pasien'];
  let results = [];
  roles.forEach(r => {
    try {
      const raw = localStorage.getItem(dataKeyForRole(r));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d && d.medicalRecords) {
        results = results.concat(d.medicalRecords.filter(m => m.patientId === patientId));
      }
    } catch(e){}
  });
  // also include any server-wide list (none) — return sorted by date desc
  return results.sort((a,b)=> new Date(b.datetime) - new Date(a.datetime));
}
function showMedicalRecordForm(patientId) {
  if (!['Dokter','Perawat'].includes(currentUser.role)) { toast('Hanya Dokter/Perawat dapat menambah rekam medis'); return; }
  const form = create('form', {class:'ks-form', id:'ks-med-form'}, [
    create('h3', {class:'card-title'}, 'Tambah Rekam Medis'),
    create('label', {}, 'Pasien', create('select',{id:'ks-med-patient'}, loadGlobalPatients().map(p => create('option',{value:p.id}, p.name)))),
    create('label', {}, 'Catatan pemeriksaan', create('textarea',{id:'ks-med-notes'})),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button',{type:'submit', class:'btn btn-primary'}, 'Simpan'),
      create('button',{type:'button', class:'btn btn-outline', id:'ks-med-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-med-cancel').addEventListener('click', hideModal);
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

/* ---------- APPOINTMENTS (Penjadwalan Dokter) ---------- */
/* Appointments are per-role but created here for demo; Petugas Admin & Dokter can manage */
function openAppointments() {
  loadDataForRole(currentUser.role);
  const items = appData.appointments || [];
  const html = create('div', {class:'ks-listwrap'}, [
    create('h3', {class:'card-title'}, 'Janji Temu'),
    create('div', {class:'ks-list-actions'}, [
      create('button', {class:'btn btn-primary', id:'ks-btn-newappt'}, 'Buat Janji')
    ]),
    create('div', {class:'ks-list'}, items.length ? items.map(a => {
      const pat = (loadGlobalPatients()||[]).find(p=>p.id===a.patientId) || {name:'-'} ;
      return create('div', {class:'ks-list-item'}, [
        create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — ${new Date(a.datetime).toLocaleString()}`),
        create('div', {class:'ks-list-meta'}, [
          create('button', {class:'action-btn small', 'data-edit':a.id}, 'Edit'),
          create('button', {class:'action-btn small', 'data-del':a.id}, 'Hapus'),
          create('button', {class:'action-btn small', 'data-call':a.id}, 'Panggil')
        ])
      ]);
    }) : create('div', {class:'ks-empty'}, 'Belum ada janji.'))
  ]);
  showModal(html);
  $('#ks-btn-newappt')?.addEventListener('click', ()=> showAppointmentForm());
  $$('#ks-modal-root .ks-list-item .action-btn').forEach(btn => {
    btn.addEventListener('click', ()=> {
      const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del') || btn.getAttribute('data-call');
      if (btn.getAttribute('data-edit')) showAppointmentForm(id);
      else if (btn.getAttribute('data-del')) {
        if (confirm('Hapus janji?')) {
          appData.appointments = (appData.appointments||[]).filter(x=>x.id!==id); saveDataForRole(currentUser.role);
          toast('Janji dihapus');
          hideModal();
        }
      } else if (btn.getAttribute('data-call')) {
        toast('Panggilan antrian: ' + id);
      }
    });
  });
}
function showAppointmentForm(id) {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) {
    if (!confirm('Belum ada pasien. Tambah pasien sekarang?')) return;
    showPatientForm();
    return;
  }
  const editing = !!id;
  const a = editing ? (appData.appointments||[]).find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-appt-form'}, [
    create('h3', {class:'card-title'}, editing ? 'Edit Janji' : 'Buat Janji'),
    create('label', {}, 'Pilih Pasien', create('select', {id:'ks-appt-patient'}, (loadGlobalPatients()||[]).map(p => create('option', {value:p.id}, p.name)))),
    create('label', {}, 'Dokter (nama)', create('input', {type:'text', id:'ks-appt-doctor', value: a.doctor || ''})),
    create('label', {}, 'Tanggal & Waktu', create('input', {type:'datetime-local', id:'ks-appt-dt', value: a.datetime ? new Date(a.datetime).toISOString().slice(0,16) : ''})),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button', {type:'submit', class:'btn btn-primary'}, editing ? 'Simpan' : 'Buat'),
      create('button', {type:'button', class:'btn btn-outline', id:'ks-appt-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-appt-cancel').addEventListener('click', hideModal);
  if (editing) {
    $('#ks-appt-patient').value = a.patientId;
    $('#ks-appt-doctor').value = a.doctor || '';
    $('#ks-appt-dt').value = a.datetime ? new Date(a.datetime).toISOString().slice(0,16) : '';
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

/* ---------- PAYMENTS (Kasir) ---------- */
/* Keep per-role payments but Petugas Admin may also create payments */
function openPayments() {
  loadDataForRole(currentUser.role);
  const items = appData.payments || [];
  const html = create('div', {class:'ks-listwrap'}, [
    create('h3', {class:'card-title'}, 'Pembayaran'),
    create('div', {class:'ks-list-actions'}, [ create('button', {class:'btn btn-primary', id:'ks-new-pay'}, 'Buat Pembayaran') ]),
    create('div', {class:'ks-list'}, items.length ? items.map(p => {
      const pat = (loadGlobalPatients()||[]).find(x=>x.id===p.patientId) || {name:'-'} ;
      return create('div', {class:'ks-list-item'}, [
        create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — Rp ${p.amount}`),
        create('div', {class:'ks-list-meta'}, [
          create('div', {}, new Date(p.datetime).toLocaleString())
        ])
      ]);
    }) : create('div', {class:'ks-empty'}, 'Belum ada pembayaran.'))
  ]);
  showModal(html);
  $('#ks-new-pay')?.addEventListener('click', ()=> showPaymentForm());
}
function showPaymentForm() {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) { toast('Tambah pasien dulu'); return; }
  const form = create('form', {class:'ks-form', id:'ks-pay-form'}, [
    create('h3', {class:'card-title'}, 'Pembayaran Baru'),
    create('label', {}, 'Pilih Pasien', create('select', {id:'ks-pay-patient'}, (loadGlobalPatients()||[]).map(p => create('option', {value:p.id}, p.name)))),
    create('label', {}, 'Jumlah (Rp)', create('input', {type:'number', id:'ks-pay-amount', value:''})),
    create('label', {}, 'Metode', create('input', {type:'text', id:'ks-pay-method', value:'Tunai'})),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button', {type:'submit', class:'btn btn-primary'}, 'Bayar'),
      create('button', {type:'button', class:'btn btn-outline', id:'ks-pay-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-pay-cancel').addEventListener('click', hideModal);
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

/* ---------- STOCK (Apoteker) ---------- */
function openStock() {
  loadDataForRole(currentUser.role);
  const stock = appData.stock || [];
  const html = create('div', {class:'ks-listwrap'}, [
    create('h3', {class:'card-title'}, 'Manajemen Stok Obat'),
    create('div', {class:'ks-list-actions'}, [ create('button', {class:'btn btn-primary', id:'ks-stock-new'}, 'Tambah Obat') ]),
    create('div', {class:'ks-list'}, stock.length ? stock.map(s => {
      return create('div', {class:'ks-list-item'}, [
        create('div', {class:'ks-list-main'}, `${escapeHtml(s.name)} — ${s.qty} ${s.unit || ''}`),
        create('div', {class:'ks-list-meta'}, [
          create('button', {class:'action-btn small','data-edit':s.id}, 'Edit'),
          create('button', {class:'action-btn small','data-del':s.id}, 'Hapus')
        ])
      ]);
    }) : create('div', {class:'ks-empty'}, 'Belum ada data stok.'))
  ]);
  showModal(html);
  $('#ks-stock-new')?.addEventListener('click', ()=> showStockForm());
  $$('#ks-modal-root .ks-list-item .action-btn').forEach(b => {
    b.addEventListener('click', ()=> {
      const id = b.getAttribute('data-edit') || b.getAttribute('data-del');
      if (b.getAttribute('data-edit')) showStockForm(id);
      else if (b.getAttribute('data-del')) {
        if (confirm('Hapus item stok?')) {
          appData.stock = (appData.stock||[]).filter(x=>x.id!==id); saveDataForRole(currentUser.role);
          toast('Item stok dihapus');
          hideModal();
        }
      }
    });
  });
}
function showStockForm(id) {
  const editing = !!id;
  const s = editing ? (appData.stock||[]).find(x=>x.id===id) : {};
  const form = create('form', {class:'ks-form', id:'ks-stock-form'}, [
    create('h3', {class:'card-title'}, editing ? 'Edit Item Stok' : 'Tambah Item Stok'),
    create('label', {}, 'Nama Obat', create('input', {id:'ks-stock-name', value: s.name || ''})),
    create('label', {}, 'Jumlah', create('input', {id:'ks-stock-qty', type:'number', value: s.qty || 0})),
    create('label', {}, 'Satuan', create('input', {id:'ks-stock-unit', value: s.unit || ''})),
    create('label', {}, 'Ambang (min)', create('input', {id:'ks-stock-min', type:'number', value: s.minThreshold || 0})),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button', {type:'submit', class:'btn btn-primary'}, 'Simpan'),
      create('button', {type:'button', class:'btn btn-outline', id:'ks-stock-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-stock-cancel').addEventListener('click', hideModal);
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

/* ---------- PRESCRIPTIONS (Dokter + Apoteker) ---------- */
function openPrescriptions(){
  loadDataForRole(currentUser.role);
  const list = appData.prescriptions || [];
  const html = create('div', {class:'ks-listwrap'}, [
    create('h3', {class:'card-title'}, 'Resep & Obat'),
    create('div', {class:'ks-list-actions'}, [ create('button', {class:'btn btn-primary', id:'ks-presc-new'}, 'Buat Resep') ]),
    create('div', {class:'ks-list'}, list.length ? list.map(p => {
      const pat = (loadGlobalPatients()||[]).find(x=>x.id===p.patientId) || {name:'-'};
      return create('div', {class:'ks-list-item'}, [
        create('div', {class:'ks-list-main'}, `${escapeHtml(pat.name)} — ${new Date(p.datetime).toLocaleString()}`),
        create('div', {class:'ks-list-meta'}, [ create('button',{class:'action-btn small','data-id':p.id}, p.pickedUp ? 'Sudah Ambil' : 'Ambil') ])
      ]);
    }) : create('div', {class:'ks-empty'}, 'Belum ada resep.'))
  ]);
  showModal(html);
  $('#ks-presc-new')?.addEventListener('click', ()=> showPrescriptionForm());
  $$('#ks-modal-root .ks-list-item .action-btn').forEach(b => {
    b.addEventListener('click', ()=> {
      const id = b.getAttribute('data-id');
      const idx = appData.prescriptions.findIndex(x=>x.id===id);
      if (idx>=0) {
        appData.prescriptions[idx].pickedUp = true;
        saveDataForRole(currentUser.role);
        toast('Resep ditandai sudah diambil');
        hideModal();
      }
    });
  });
}
function showPrescriptionForm() {
  if (!(loadGlobalPatients() && loadGlobalPatients().length)) { toast('Tambah pasien dulu'); return; }
  const form = create('form', {class:'ks-form', id:'ks-presc-form'}, [
    create('h3', {class:'card-title'}, 'Buat Resep'),
    create('label', {}, 'Pilih Pasien', create('select',{id:'ks-presc-patient'}, (loadGlobalPatients()||[]).map(p=> create('option', {value:p.id}, p.name)))),
    create('label', {}, 'Item (pisahkan koma)', create('input',{id:'ks-presc-items', placeholder:'Paracetamol 10mg x2, Amoxicillin 500mg x7'})),
    create('div', {style:'margin-top:12px;display:flex;gap:8px'}, [
      create('button', {type:'submit', class:'btn btn-primary'}, 'Simpan'),
      create('button', {type:'button', class:'btn btn-outline', id:'ks-presc-cancel'}, 'Batal')
    ])
  ]);
  showModal(form);
  $('#ks-presc-cancel').addEventListener('click', hideModal);
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
    hideModal();
  });
}

/* ---------- REPORTS (Manajer) ---------- */
function openReports() {
  loadDataForRole(currentUser.role);
  const totalPatients = (loadGlobalPatients()||[]).length;
  const totalAppointments = (appData.appointments||[]).length;
  const totalPayments = (appData.payments||[]).reduce((s,p)=>s+(p.amount||0),0);
  const lowStock = (appData.stock||[]).filter(s=> s.qty <= (s.minThreshold||0));
  const html = create('div', {class:'ks-card'}, [
    create('h3', {class:'card-title'}, 'Laporan Harian (Ringkas)'),
    create('div', {class:'kv-row'}, [create('div',{},'Jumlah Pasien (global)'), create('div',{}, String(totalPatients))]),
    create('div', {class:'kv-row'}, [create('div',{},'Jumlah Janji (role)'), create('div',{}, String(totalAppointments))]),
    create('div', {class:'kv-row'}, [create('div',{},'Pendapatan (Rp)'), create('div',{}, String(totalPayments))]),
    create('div', {style:'margin-top:12px'}, create('h4', {}, 'Stok yang perlu diorder'), lowStock.length ? create('ul', {}, lowStock.map(s => create('li', {}, `${escapeHtml(s.name)} (${s.qty})`))) : create('div', {}, 'Tidak ada'))
  ]);
  showModal(html);
}

/* ---------- helpers: home/about ---------- */
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

/* ---------- role dashboards ---------- */
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
    <div class="quick-actions">
      <button class="action-btn" id="ks-my-appointments">Lihat Janji Saya</button>
      <button class="action-btn" id="ks-my-history">Riwayat Kunjungan</button>
      <button class="action-btn" id="ks-new-queue">Daftar Antrian Baru</button>
    </div>
  `;
  $('#ks-my-appointments')?.addEventListener('click', openAppointments);
  $('#ks-my-history')?.addEventListener('click', ()=> toast('Riwayat kunjungan (contoh)'));
  $('#ks-new-queue')?.addEventListener('click', ()=> { toast('Mendaftar antrian (contoh)'); });
}

/* ---------- session restore on load ---------- */
document.addEventListener('DOMContentLoaded', ()=> {
  ensureShells();
  const sess = sessionStorage.getItem('ks_user');
  if (sess) {
    try {
      currentUser = JSON.parse(sess);
      const matchBtn = roleButtons.find(b => b.dataset.role && b.dataset.role.toLowerCase() === (currentUser.role||'').toLowerCase());
      if (matchBtn) {
        roleButtons.forEach(r=> r.classList.remove('role-option--active'));
        matchBtn.classList.add('role-option--active');
        selectedRole = matchBtn.dataset.role;
        if (selectedRoleSpan) selectedRoleSpan.textContent = selectedRole;
      }
      if (loginScreen) { loginScreen.style.display = 'none'; loginScreen.classList.remove('screen--active'); }
      if (mainScreen) { mainScreen.style.display = 'block'; mainScreen.classList.add('screen--active'); mainScreen.setAttribute('aria-hidden','false'); }
      loadDataForRole(currentUser.role);
      prepareDashboardFor(currentUser);
    } catch(e){ console.warn('restore fail', e); }
  }
});

/* expose small debug object */
window.__ks = {
  loadDataForRole, saveDataForRole, appData,
  dataKeyForRole, roleKey, loadGlobalPatients, saveGlobalPatients
};
