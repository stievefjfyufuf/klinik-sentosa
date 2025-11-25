(function(){
  const $ = s => document.querySelector(s);
  const create = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    Object.entries(attrs||{}).forEach(([k,v])=>{ if (k==='class') el.className=v; else if (k==='html') el.innerHTML=v; else if (k==='value') el.value=v; else el.setAttribute(k,v); });
    kids.flat().forEach(k=> { if (typeof k==='string') el.appendChild(document.createTextNode(k)); else if (k) el.appendChild(k); });
    return el;
  };

  function attachPatientHandlersOnce() {
    const btnAppts = $('#ks-my-appointments');
    const btnHist  = $('#ks-my-history');
    const btnNewQ  = $('#ks-new-queue');
    if (!btnAppts && !btnHist && !btnNewQ) return;
    // bind but avoid duplicate
    if (btnAppts && !btnAppts.dataset.bound) { btnAppts.addEventListener('click', ()=> { if (typeof window.showMyAppointmentsModal === 'function') window.showMyAppointmentsModal(); else alert('Janji: tidak tersedia'); }); btnAppts.dataset.bound = '1'; }
    if (btnHist  && !btnHist.dataset.bound)  { btnHist.addEventListener('click', ()=> { if (typeof window.showMyHistoryModal === 'function') window.showMyHistoryModal(); else alert('Riwayat: tidak tersedia'); }); btnHist.dataset.bound = '1'; }
    if (btnNewQ  && !btnNewQ.dataset.bound)  { btnNewQ.addEventListener('click', ()=> { if (typeof window.showNewQueueForm === 'function') window.showNewQueueForm(); else alert('Daftar antrian: tidak tersedia'); }); btnNewQ.dataset.bound = '1'; }
  }

  // wait until DOM + app.js ready
  function ready(cb) {
    if (document.readyState === 'complete' && window.__ks) return cb();
    const i = setInterval(()=> { if (document.readyState === 'complete' && window.__ks) { clearInterval(i); cb(); } }, 120);
    setTimeout(()=> clearInterval(i), 10000);
  }

  ready(()=> {
    // initial attach
    attachPatientHandlersOnce();
    // observe pasien panel so when rebuilt we reattach
    const p = document.querySelector('#dash-pasien');
    if (p) {
      const obs = new MutationObserver(()=> attachPatientHandlersOnce());
      obs.observe(p, {childList:true, subtree:true});
    }
    // keyboard shortcut Ctrl+R toggle realtime if exists
    document.addEventListener('keydown', e => { if (e.ctrlKey && e.key.toLowerCase()==='r') { const t = document.getElementById('stat-toggle'); if (t) t.click(); }});
    console.log('patch-additions initialized');
  });
})();
