/* patch-voice.js
   Non-invasive voice assistant (TTS) for Klinik Sentosa — Indonesian version.
   Menyapa di login, setelah login, dan saat logout.
   Usage: include after app.js:
   <link rel="stylesheet" href="patch-voice.css">
   <script src="patch-voice.js" defer></script>
*/

(function(){
  // ---------------- konfigurasi / template (Bahasa Indonesia) ----------------
  const loginIntroTemplates = [
    "Selamat datang di Klinik Sentosa. Klinik ini menyediakan layanan pendaftaran, pemeriksaan, resep, dan pembayaran dengan mudah. Semoga hari Anda menyenangkan.",
    "Selamat datang di Klinik Sentosa — pusat layanan kesehatan yang ramah. Kami siap membantu pendaftaran, konsultasi dokter, dan pengambilan obat.",
    "Halo! Terima kasih telah mengunjungi Klinik Sentosa. Silakan pilih peran Anda dan masuk untuk melanjutkan. Kami akan membantu proses pendaftaran hingga pembayaran."
  ];

  const postLoginTemplates = [
    (name) => `Selamat datang ${name} di Klinik Sentosa. Semoga kunjungan Anda menyenangkan — jika butuh bantuan, pilih menu di sebelah kiri.`,
    (name) => `Hai ${name}, selamat datang di Klinik Sentosa. Kami siap melayani pendaftaran dan pemeriksaan. Semoga sehat selalu!`,
    (name) => `Halo ${name}, Klinik Sentosa menyapa. Silakan cek jadwal, resep, atau pembayaran yang Anda perlukan. Terima kasih telah berkunjung.`
  ];

  const logoutTemplates = [
    "Terima kasih telah mengunjungi Klinik Sentosa. Semoga Anda sehat selalu. Sampai jumpa kembali.",
    "Terima kasih, kunjungan Anda kami hargai. Semoga hari Anda menyenangkan—sampai bertemu lagi di Klinik Sentosa.",
    "Terima kasih telah menggunakan layanan Klinik Sentosa. Jika butuh lagi, silakan kembali. Selamat jalan."
  ];

  const fallbackLang = 'id-ID'; // preferensi suara Indonesia jika tersedia

  // ---------------- util: pilih voice ----------------
  function pickVoice(preferredLang = fallbackLang) {
    const voices = speechSynthesis.getVoices();
    if (!voices || !voices.length) return null;
    // preferensi: full preferredLang -> 'id' prefix -> 'en' -> first available
    let v = voices.find(x => (x.lang||'').toLowerCase().startsWith(preferredLang.toLowerCase()));
    if (!v) v = voices.find(x => (x.lang||'').toLowerCase().startsWith('id'));
    if (!v) v = voices.find(x => (x.lang||'').toLowerCase().startsWith('en'));
    if (!v) v = voices[0];
    return v;
  }

  // ---------------- TTS speak util (dengan safety & UI hooks) ----------------
  function speak(text, opts = {}) {
    if (!('speechSynthesis' in window)) return;
    if (!voiceState.enabled) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate || 1;
      u.pitch = opts.pitch || 1;
      u.volume = (typeof opts.volume === 'number') ? opts.volume : 1;
      const v = pickVoice();
      if (v) u.voice = v;
      u.onstart = () => {
        showBubble(text.split(' ').slice(0,10).join(' ') + '…');
        animateMouth(true);
        const panel = document.getElementById('ks-ai-panel');
        if (panel) {
          panel.dataset.lastSpeak = text;
          const tnode = document.getElementById('ks-ai-text');
          if (tnode) tnode.textContent = text;
        }
      };
      u.onend = () => { hideBubble(); animateMouth(false); };
      try { speechSynthesis.cancel(); } catch(e){}
      speechSynthesis.speak(u);
    } catch(e) {
      console.warn('TTS speak error', e);
    }
  }

  // ---------------- small UI helpers (bubble + simple avatar mouth) ----------------
  let bubbleTimeout = null;
  function showBubble(txt) {
    let b = document.getElementById('ks-voice-bubble');
    if (!b) { b = document.createElement('div'); b.id = 'ks-voice-bubble'; document.body.appendChild(b); }
    b.textContent = txt;
    b.classList.add('show');
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    bubbleTimeout = setTimeout(()=> { b.classList.remove('show'); }, 5000);
  }
  function hideBubble(){ const b = document.getElementById('ks-voice-bubble'); if (b) b.classList.remove('show'); if (bubbleTimeout) clearTimeout(bubbleTimeout); }

  function animateMouth(start) {
    const mouth = document.getElementById('ks-ai-mouth');
    if (!mouth) return;
    if (start) mouth.classList.add('speak'); else mouth.classList.remove('speak');
  }

  // ---------------- voice state (simpan di localStorage) ----------------
  const voiceState = {
    enabled: true,
    set(v) { this.enabled = !!v; localStorage.setItem('ks_voice_enabled', this.enabled ? '1' : '0'); updateToggleUI(); updateAiPanelState(); },
    load() { this.enabled = localStorage.getItem('ks_voice_enabled') !== '0'; updateToggleUI(); updateAiPanelState(); }
  };

  // ---------------- UI: toggle & AI panel ----------------
  function ensureToggle() {
    if (document.getElementById('ks-voice-toggle')) return;
    const navRight = document.querySelector('.nav-right') || document.querySelector('.navbar-right') || document.querySelector('.navbar');
    if (!navRight) return;
    const btn = document.createElement('button');
    btn.id = 'ks-voice-toggle';
    btn.title = 'Toggle asisten suara (Ctrl+M)';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', ()=> { voiceState.set(!voiceState.enabled); });
    if (navRight.firstChild) navRight.insertBefore(btn, navRight.firstChild);
    else navRight.appendChild(btn);
    updateToggleUI();
  }

  function updateToggleUI(){
    const btn = document.getElementById('ks-voice-toggle');
    if (!btn) return;
    btn.classList.toggle('on', voiceState.enabled);
    btn.textContent = voiceState.enabled ? 'Suara: ON' : 'Suara: OFF';
  }

  function ensureAiPanel() {
    if (document.getElementById('ks-ai-panel')) return;
    const panel = document.createElement('div');
    panel.id = 'ks-ai-panel';
    panel.innerHTML = `
      <div id="ks-ai-avatar" aria-hidden="true">
        <div class="face">
          <div class="eye left"></div><div class="eye right"></div>
          <div class="mouth" id="ks-ai-mouth"></div>
        </div>
      </div>
      <div id="ks-ai-controls">
        <div id="ks-ai-text" aria-live="polite">Halo — Saya asisten Klinik Sentosa.</div>
        <div class="ks-buttons">
          <button id="ks-ai-replay" title="Putar ulang sapaan">🔁</button>
          <button id="ks-ai-mute" title="Matikan/aktifkan suara">🔊</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('ks-ai-replay').addEventListener('click', ()=> {
      const last = panel.dataset.lastSpeak;
      if (last) speak(last, {rate:1, pitch:1});
      else speakLoginIntroOnce();
    });
    document.getElementById('ks-ai-mute').addEventListener('click', ()=> { voiceState.set(!voiceState.enabled); });

    updateAiPanelState();
  }

  function updateAiPanelState() {
    const panel = document.getElementById('ks-ai-panel');
    if (!panel) return;
    panel.classList.toggle('off', !voiceState.enabled);
    const muteBtn = document.getElementById('ks-ai-mute');
    if (muteBtn) muteBtn.textContent = voiceState.enabled ? '🔊' : '🔈';
  }

  // ---------------- login intro (sekali per sesi) ----------------
  function speakLoginIntroOnce() {
    const key = 'ks_login_intro_shown_v1';
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const t = loginIntroTemplates[Math.floor(Math.random()*loginIntroTemplates.length)];
    const improv = ['Semoga Anda sehat hari ini.', 'Silakan gunakan sistem dengan nyaman.', 'Semoga pelayanan cepat dan ramah.'];
    const text = `${t} ${improv[Math.floor(Math.random()*improv.length)]}`;
    ensureAiPanel();
    if ('speechSynthesis' in window && speechSynthesis.getVoices().length === 0) {
      const onVoices = () => { speak(text, {rate:1, pitch:1}); speechSynthesis.removeEventListener('voiceschanged', onVoices); };
      speechSynthesis.addEventListener('voiceschanged', onVoices);
      setTimeout(()=> { try { speak(text, {rate:1, pitch:1}); } catch(e){} }, 800);
    } else {
      speak(text, {rate:1, pitch:1});
    }
  }

  // ---------------- helper: speak logout ----------------
  function handleLogoutSpeak() {
    ensureAiPanel();
    const t = logoutTemplates[Math.floor(Math.random()*logoutTemplates.length)];
    speak(t, {rate:1, pitch:1});
  }

  // ---------------- intercept sessionStorage (login & logout) ----------------
  function interceptSessionStorage() {
    try {
      // hijack setItem
      const originalSet = sessionStorage.setItem.bind(sessionStorage);
      sessionStorage.setItem = function(key, value) {
        originalSet(key, value);
        try {
          if (key === 'ks_user') {
            // consider login when value looks like JSON object with { ... }
            const str = (typeof value === 'string') ? value.trim() : '';
            const isLikelyLogin = str.startsWith('{') && str.endsWith('}');
            // small delay supaya app selesai menulis/transition
            setTimeout(()=> {
              if (isLikelyLogin) {
                try {
                  const u = JSON.parse(value || '{}');
                  const name = (u.name || u.username || 'Pengguna');
                  const tpl = postLoginTemplates[Math.floor(Math.random()*postLoginTemplates.length)];
                  const message = tpl(name);
                  ensureAiPanel();
                  const tnode = document.getElementById('ks-ai-text');
                  if (tnode) tnode.textContent = `Halo ${name}, selamat datang.`;
                  speak(message, {rate:1, pitch:1});
                } catch(e) {
                  console.warn('voice: parse ks_user failed', e);
                }
              } else {
                // value not an object -> treat as logout (example: setItem('ks_user','') or 'null')
                handleLogoutSpeak();
              }
            }, 240);
          }
        } catch(e){}
      };

      // hijack removeItem
      const originalRemove = sessionStorage.removeItem.bind(sessionStorage);
      sessionStorage.removeItem = function(key) {
        originalRemove(key);
        try {
          if (key === 'ks_user') {
            // logout detected
            setTimeout(()=> { handleLogoutSpeak(); }, 120);
          }
        } catch(e){}
      };

      // hijack clear (treat as logout if ks_user was present)
      const originalClear = sessionStorage.clear.bind(sessionStorage);
      sessionStorage.clear = function() {
        // check if ks_user existed
        const hadUser = sessionStorage.getItem('ks_user') !== null;
        originalClear();
        try {
          if (hadUser) setTimeout(()=> { handleLogoutSpeak(); }, 120);
        } catch(e){}
      };
    } catch(e){ console.warn('Tidak dapat mengintercept sessionStorage methods', e); }
  }

  // ---------------- keyboard shortcuts ----------------
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        voiceState.set(!voiceState.enabled);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        speakLoginIntroOnce();
      }
    });
  }

  // ---------------- CSS injection minimal (fallback) ----------------
  function autoInjectCSS() {
    if (document.querySelector('link[href="patch-voice.css"]')) return;
    const l = document.createElement('link'); l.rel='stylesheet'; l.href='patch-voice.css';
    document.head.appendChild(l);
    if (!document.getElementById('ks-voice-style')) {
      const s = document.createElement('style'); s.id = 'ks-voice-style';
      s.textContent = `
        #ks-voice-bubble { position: fixed; right: 16px; bottom: 24px; background: rgba(0,0,0,0.85); color: white; padding: 8px 12px; border-radius: 10px; font-family: sans-serif; font-size: 13px; opacity: 0; transform: translateY(8px); transition: opacity .18s, transform .18s; z-index: 99999; pointer-events: none; }
        #ks-voice-bubble.show { opacity: 1; transform: translateY(0); }
        #ks-voice-toggle { margin: 4px; padding: 6px 10px; border-radius: 6px; border: none; background: #eee; cursor: pointer; font-size: 13px; }
        #ks-voice-toggle.on { background: #2b8aef; color: white; }
        #ks-ai-panel { position: fixed; left: 16px; bottom: 24px; display: flex; gap: 10px; align-items: center; background: rgba(255,255,255,0.98); padding: 8px 10px; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,0.12); z-index: 99998; font-family: sans-serif; max-width: 360px; }
        #ks-ai-panel.off { opacity: 0.5; filter: grayscale(0.4); }
        #ks-ai-avatar { width:56px; height:56px; display:flex; align-items:center; justify-content:center; }
        #ks-ai-avatar .face { width:48px; height:48px; background: linear-gradient(180deg,#f2f5fb,#dfe9fb); border-radius: 50%; position: relative; display:flex; align-items:center; justify-content:center; }
        #ks-ai-avatar .eye { width:6px; height:6px; background:#333; border-radius:50%; position:absolute; top:16px; }
        #ks-ai-avatar .eye.left { left:14px; } #ks-ai-avatar .eye.right { right:14px; }
        #ks-ai-avatar .mouth { width:18px; height:8px; background:#333; border-radius: 0 0 10px 10px; position:absolute; bottom:12px; transform-origin:center; transition: transform .08s; }
        #ks-ai-avatar .mouth.speak { animation: mouthAnim .28s infinite; }
        @keyframes mouthAnim { 0% { transform: scaleY(1); } 50% { transform: scaleY(0.28); } 100% { transform: scaleY(1); } }
        #ks-ai-controls { display:flex; flex-direction:column; gap:6px; min-width:180px; }
        #ks-ai-text { font-size:13px; color:#111; max-height:44px; overflow:hidden; text-overflow:ellipsis; }
        .ks-buttons { display:flex; gap:6px; }
        .ks-buttons button { padding:6px 8px; border-radius:6px; border:none; background:#f0f0f0; cursor:pointer; font-size:14px; }
      `;
      document.head.appendChild(s);
    }
  }

  // ---------------- inisialisasi utama ----------------
  function init() {
    autoInjectCSS();
    ensureToggle();
    voiceState.load();
    ensureAiPanel();
    interceptSessionStorage();
    bindShortcuts();

    // jika login screen aktif saat load, jalankan sapaan login
    if (document.readyState === 'complete') {
      const loginScreen = document.querySelector('#login-screen');
      if (loginScreen && loginScreen.classList.contains('screen--active')) speakLoginIntroOnce();
    }

    // observe class changes di #login-screen untuk men-trigger sapaan lagi bila muncul
    const loginRoot = document.querySelector('#login-screen');
    if (loginRoot) {
      const obs = new MutationObserver(()=> { if (loginRoot.classList.contains('screen--active')) speakLoginIntroOnce(); });
      obs.observe(loginRoot, { attributes: true, attributeFilter: ['class'] });
    }

    // observe main-screen muncul untuk sapaan jika session sudah ada (cadangan)
    const mainRoot = document.querySelector('#main-screen');
    if (mainRoot) {
      const obs2 = new MutationObserver(()=> {
        if (mainRoot.classList.contains('screen--active')) {
          try {
            const sess = sessionStorage.getItem('ks_user');
            if (sess) {
              const u = JSON.parse(sess);
              const name = (u.name || u.username || 'Pengguna');
              const tpl = postLoginTemplates[Math.floor(Math.random()*postLoginTemplates.length)];
              speak(tpl(name), {rate:1, pitch:1});
            }
          } catch(e){}
        }
      });
      obs2.observe(mainRoot, { attributes:true, attributeFilter:['class'] });
    }
  }

  // jalankan
  if (document.readyState === 'complete') init();
  else window.addEventListener('DOMContentLoaded', init);
})();
