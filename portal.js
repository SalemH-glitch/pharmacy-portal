'use strict';

const SB_URL = 'https://nqxtbjrpddzgkfsdsywg.supabase.co';
const SB_KEY = 'sb_publishable_OZbSJoNrKxXuOrWdkg_icA_ydRvwYGV';
const sb = supabase.createClient(SB_URL, SB_KEY);

const TOOLS = [
  {
    name: 'Dextrose Calculator',
    desc: 'Mixing modes for TPN, pediatric fluids, and NICU dextrose preparation.',
    url:  'https://salemh-glitch.github.io/dextrose-reconstitution-calculator/',
    color: '#1565C0',
    abbr: 'Dx',
  },
  {
    name: 'Dilution Calculator',
    desc: 'C₁V₁=C₂V₂ dilution calculator with 76 pre-loaded medications and diluents.',
    url:  'https://salemh-glitch.github.io/pharmacy-dilution-calculator/',
    color: '#2E7D32',
    abbr: 'Di',
  },
  {
    name: 'PK / TDM Calculator',
    desc: 'Pharmacokinetic and therapeutic drug monitoring calculations from serum levels.',
    url:  'https://salemh-glitch.github.io/pk-tdm-calculator/',
    color: '#6A1B9A',
    abbr: 'PK',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + (iso.includes('T') ? '' : 'T00:00:00'));
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

function capitalize(s) {
  return String(s || '').replace(/(^|\s)\S/g, c => c.toUpperCase());
}

function appTagLabel(app) {
  const map = { dextrose: 'Dextrose', dilution: 'Dilution', 'pk-tdm': 'PK/TDM' };
  return map[app] || capitalize(app);
}

function summarizeCalc(c) {
  const r = c.result;
  const i = c.inputs;
  if (!r) return '—';
  try {
    if (c.app === 'dextrose') {
      if (r.stockVol !== undefined) return `${r.stockVol}mL D${r.stockConc}W → D${r.targetConc}W ${r.finalVol}mL`;
      if (r.finalConc !== undefined) return `Mix → D${r.finalConc}W ${r.finalVol}mL`;
      if (r.nsVol !== undefined) return `D${r.targetConc} + NS ${r.finalVol}mL`;
    }
    if (c.app === 'pk-tdm') {
      return i?.drug ? `${i.drug} PK analysis` : 'PK/TDM calculation';
    }
    if (c.app === 'dilution') {
      return i?.drug ? `${i.drug} dilution` : 'Dilution calculation';
    }
    const s = JSON.stringify(r);
    return s.length > 70 ? s.slice(0, 70) + '…' : s;
  } catch { return '—'; }
}

// ── Auth ──────────────────────────────────────────────────────────────────

async function requireAuth(redirectTo) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = 'index.html' + (redirectTo ? '?returnTo=' + encodeURIComponent(redirectTo) : '');
    return null;
  }
  return session;
}

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('full_name').eq('id', userId).single();
  return data;
}

function wireSignOut() {
  document.getElementById('nav-signout')?.addEventListener('click', async () => {
    await sb.auth.signOut();
    window.location.href = 'index.html';
  });
}

async function setNavUser(session) {
  const profile = await getProfile(session.user.id);
  const el = document.getElementById('nav-user');
  if (el) el.textContent = profile?.full_name || session.user.email;
}

// ── Patient Modal (new + edit) ────────────────────────────────────────────

function calcCrCl(dob, weightKg, scrMgDl, gender) {
  if (!dob || !weightKg || !scrMgDl || !gender) return null;
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  if (age <= 0 || scrMgDl <= 0) return null;
  let crcl = ((140 - age) * weightKg) / (72 * scrMgDl);
  if (gender === 'Female') crcl *= 0.85;
  return Math.max(0, Math.round(crcl * 10) / 10);
}

function showPatientModal(existing, onSuccess) {
  const isEdit = !!existing;
  const p = existing || {};

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>${isEdit ? 'Edit Patient — ' + escHtml(p.patient_id || '') : 'New Patient'}</h3>
        <button class="modal-close" id="mc-close" type="button">&#x2715;</button>
      </div>
      <div class="modal-body">
        <div id="modal-error" class="auth-error hidden"></div>
        <div class="modal-grid">
          <div class="field-group">
            <label for="mf-fn">First Name *</label>
            <input type="text" id="mf-fn" value="${escHtml(p.first_name||'')}">
          </div>
          <div class="field-group">
            <label for="mf-ln">Last Name *</label>
            <input type="text" id="mf-ln" value="${escHtml(p.last_name||'')}">
          </div>
          <div class="field-group">
            <label for="mf-dob">Date of Birth</label>
            <input type="date" id="mf-dob" value="${p.date_of_birth||''}">
          </div>
          <div class="field-group">
            <label for="mf-gender">Gender</label>
            <select id="mf-gender">
              <option value="">Select…</option>
              <option value="Male"   ${p.gender==='Male'   ?'selected':''}>Male</option>
              <option value="Female" ${p.gender==='Female' ?'selected':''}>Female</option>
              <option value="Other"  ${p.gender==='Other'  ?'selected':''}>Other</option>
            </select>
          </div>
          <div class="field-group">
            <label for="mf-wt">Weight (kg)</label>
            <input type="number" id="mf-wt" value="${p.weight_kg||''}" step="0.1" min="0">
          </div>
          <div class="field-group">
            <label for="mf-ht">Height (cm)</label>
            <input type="number" id="mf-ht" value="${p.height_cm||''}" step="0.1" min="0">
          </div>
          <div class="field-group">
            <label for="mf-scr">Serum Creatinine (mg/dL)</label>
            <input type="number" id="mf-scr" value="${p.scr_mg_dl||''}" step="0.01" min="0">
          </div>
          <div class="field-group">
            <label for="mf-crcl">CrCl (mL/min)</label>
            <input type="number" id="mf-crcl" value="${p.crcl_ml_min||''}" step="0.1" min="0" placeholder="Auto-calculated">
            <span class="field-hint">Cockcroft-Gault — auto-fills when SCr, weight, DOB, and gender are set</span>
          </div>
          <div class="field-group modal-full">
            <label for="mf-allergies">Allergies</label>
            <input type="text" id="mf-allergies" value="${escHtml(p.allergies||'')}" placeholder="e.g. Penicillin, Sulfa">
          </div>
          <div class="field-group">
            <label for="mf-mrn">Hospital MRN (optional)</label>
            <input type="text" id="mf-mrn" value="${escHtml(p.mrn||'')}">
          </div>
          <div class="field-group modal-full">
            <label for="mf-notes">Notes</label>
            <textarea id="mf-notes" rows="2">${escHtml(p.notes||'')}</textarea>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="mc-cancel" type="button">Cancel</button>
        <button class="auth-btn" id="mc-save" type="button" style="width:auto;padding:9px 22px">
          ${isEdit ? 'Save Changes' : 'Create Patient'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const closeModal = () => {
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  };

  document.getElementById('mc-close')?.addEventListener('click', closeModal);
  document.getElementById('mc-cancel')?.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  // Auto-calculate CrCl
  const updateCrCl = () => {
    const crcl = calcCrCl(
      document.getElementById('mf-dob').value,
      parseFloat(document.getElementById('mf-wt').value),
      parseFloat(document.getElementById('mf-scr').value),
      document.getElementById('mf-gender').value
    );
    if (crcl !== null) document.getElementById('mf-crcl').value = crcl;
  };
  ['mf-dob','mf-wt','mf-scr','mf-gender'].forEach(id =>
    document.getElementById(id)?.addEventListener('change', updateCrCl)
  );

  // Save
  document.getElementById('mc-save')?.addEventListener('click', async () => {
    const fn = document.getElementById('mf-fn').value.trim();
    const ln = document.getElementById('mf-ln').value.trim();
    const errEl = document.getElementById('modal-error');

    if (!fn || !ln) { showError(errEl, 'First name and last name are required.'); return; }

    const saveBtn = document.getElementById('mc-save');
    saveBtn.textContent = 'Saving…';
    saveBtn.disabled = true;

    const payload = {
      first_name:  fn,
      last_name:   ln,
      date_of_birth: document.getElementById('mf-dob').value    || null,
      gender:        document.getElementById('mf-gender').value  || null,
      weight_kg:     parseFloat(document.getElementById('mf-wt').value)     || null,
      height_cm:     parseFloat(document.getElementById('mf-ht').value)     || null,
      scr_mg_dl:     parseFloat(document.getElementById('mf-scr').value)    || null,
      crcl_ml_min:   parseFloat(document.getElementById('mf-crcl').value)   || null,
      allergies:     document.getElementById('mf-allergies').value.trim()   || null,
      mrn:           document.getElementById('mf-mrn').value.trim()         || null,
      notes:         document.getElementById('mf-notes').value.trim()       || null,
    };

    let error, data;
    if (isEdit) {
      const res = await sb.from('patients')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select().single();
      error = res.error;
      data = res.data;
    } else {
      const { data: { session } } = await sb.auth.getSession();
      const res = await sb.from('patients')
        .insert({ ...payload, created_by: session.user.id })
        .select().single();
      error = res.error;
      data = res.data;
    }

    if (error) {
      showError(errEl, error.message);
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create Patient';
      saveBtn.disabled = false;
      return;
    }

    closeModal();
    if (onSuccess) await onSuccess(data);
  });
}

// ── Page: Login ───────────────────────────────────────────────────────────

function initLoginPage() {
  sb.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      window.location.href = returnTo || 'dashboard.html';
    }
  });

  document.getElementById('to-register')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
  });

  document.getElementById('to-login')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });

  // Login
  document.getElementById('login-btn')?.addEventListener('click', async () => {
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl    = document.getElementById('login-error');
    hideError(errEl);

    if (!email || !password) { showError(errEl, 'Email and password are required.'); return; }

    const btn = document.getElementById('login-btn');
    btn.textContent = 'Signing in…';
    btn.disabled = true;

    const { error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      showError(errEl, error.message);
      btn.textContent = 'Sign In';
      btn.disabled = false;
      return;
    }

    const returnTo = new URLSearchParams(window.location.search).get('returnTo');
    window.location.href = returnTo || 'dashboard.html';
  });

  // Register
  document.getElementById('register-btn')?.addEventListener('click', async () => {
    const name     = document.getElementById('reg-name').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl    = document.getElementById('register-error');
    hideError(errEl);

    if (!name || !email || !password) { showError(errEl, 'All fields are required.'); return; }
    if (password.length < 6) { showError(errEl, 'Password must be at least 6 characters.'); return; }

    const btn = document.getElementById('register-btn');
    btn.textContent = 'Creating account…';
    btn.disabled = true;

    const { error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: name } },
    });

    if (error) {
      showError(errEl, error.message);
      btn.textContent = 'Create Account';
      btn.disabled = false;
      return;
    }

    // Auto sign-in (works when email confirmation is disabled in Supabase)
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (!signInErr) {
      window.location.href = 'dashboard.html';
    } else {
      showError(errEl, 'Account created! Please check your email to confirm, then sign in.');
      btn.textContent = 'Create Account';
      btn.disabled = false;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (!document.getElementById('register-form').classList.contains('hidden')) {
      document.getElementById('register-btn')?.click();
    } else {
      document.getElementById('login-btn')?.click();
    }
  });
}

// ── Page: Dashboard ───────────────────────────────────────────────────────

async function initDashboard() {
  const session = await requireAuth();
  if (!session) return;

  wireSignOut();
  await setNavUser(session);

  // Tool cards
  const grid = document.getElementById('tools-grid');
  if (grid) {
    grid.innerHTML = TOOLS.map(t => `
      <div class="tool-card" style="border-top-color:${t.color}">
        <div class="tool-card-icon" style="background:${t.color}18;color:${t.color}">${t.abbr}</div>
        <h3 class="tool-card-name">${t.name}</h3>
        <p class="tool-card-desc">${t.desc}</p>
        <a href="${t.url}" class="tool-card-btn" style="background:${t.color}">Open Tool →</a>
      </div>`).join('');
  }

  // Recent calcs
  const container = document.getElementById('recent-calcs');
  const { data: calcs } = await sb
    .from('calculations')
    .select('id, app, type, created_at, inputs, result, user_id, patients(patient_id, first_name, last_name)')
    .order('created_at', { ascending: false })
    .limit(15);

  if (!calcs?.length) {
    container.innerHTML = '<div class="empty-state">No calculations yet. Open a tool to get started.</div>';
    return;
  }

  const userIds = [...new Set(calcs.map(c => c.user_id))];
  const { data: profiles } = await sb.from('profiles').select('id, full_name').in('id', userIds);
  const pm = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));

  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Patient</th><th>Tool</th><th>Summary</th><th>By</th><th>When</th></tr></thead>
      <tbody>
        ${calcs.map(c => `
          <tr class="clickable-row" onclick="${c.patients ? `window.location.href='patient.html?id=${c.patients.patient_id}'` : ''}">
            <td>${c.patients
              ? `<a class="patient-link" href="patient.html?id=${c.patients.patient_id}">${c.patients.patient_id} · ${escHtml(c.patients.last_name)}, ${escHtml(c.patients.first_name)}</a>`
              : '<span class="text-muted">—</span>'}</td>
            <td><span class="app-tag app-${c.app}">${appTagLabel(c.app)}</span></td>
            <td class="calc-summary">${escHtml(summarizeCalc(c))}</td>
            <td>${escHtml(pm[c.user_id] || 'Unknown')}</td>
            <td style="white-space:nowrap;color:var(--text-muted);font-size:0.78rem">${timeAgo(c.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Page: Patients ────────────────────────────────────────────────────────

async function initPatientsPage() {
  const session = await requireAuth();
  if (!session) return;

  wireSignOut();
  await setNavUser(session);
  await loadPatients('');

  let timer;
  document.getElementById('patient-search')?.addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => loadPatients(e.target.value.trim()), 300);
  });

  document.getElementById('new-patient-btn')?.addEventListener('click', () =>
    showPatientModal(null, async () => loadPatients(document.getElementById('patient-search')?.value.trim() || ''))
  );
}

async function loadPatients(query) {
  const container = document.getElementById('patients-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-state">Loading…</div>';

  let q = sb.from('patients')
    .select('id, patient_id, first_name, last_name, date_of_birth, gender, weight_kg, scr_mg_dl')
    .order('id', { ascending: false })
    .limit(150);

  if (query) {
    if (/^pt-/i.test(query)) {
      q = q.ilike('patient_id', `${query}%`);
    } else {
      q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%`);
    }
  }

  const { data: patients, error } = await q;

  if (error) {
    container.innerHTML = `<div class="error-state">Error: ${escHtml(error.message)}</div>`;
    return;
  }
  if (!patients?.length) {
    container.innerHTML = '<div class="empty-state">No patients found.</div>';
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>ID</th><th>Name</th><th>DOB</th><th>Gender</th><th>Weight</th><th>SCr</th></tr></thead>
      <tbody>
        ${patients.map(p => `
          <tr class="clickable-row" onclick="window.location.href='patient.html?id=${p.patient_id}'">
            <td><span class="patient-id-tag">${p.patient_id}</span></td>
            <td><strong>${escHtml(p.last_name)}, ${escHtml(p.first_name)}</strong></td>
            <td>${formatDate(p.date_of_birth)}</td>
            <td>${p.gender || '—'}</td>
            <td>${p.weight_kg != null ? p.weight_kg + ' kg' : '—'}</td>
            <td>${p.scr_mg_dl != null ? p.scr_mg_dl + ' mg/dL' : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Page: Patient ─────────────────────────────────────────────────────────

async function initPatientPage() {
  const session = await requireAuth();
  if (!session) return;

  wireSignOut();
  await setNavUser(session);

  const ptId = new URLSearchParams(window.location.search).get('id');
  if (!ptId) { window.location.href = 'patients.html'; return; }

  const { data: patient, error } = await sb.from('patients').select('*').eq('patient_id', ptId).single();
  if (error || !patient) { window.location.href = 'patients.html'; return; }

  renderPatientCard(patient);
  await loadPatientCalcs(patient.id);

  document.getElementById('edit-patient-btn')?.addEventListener('click', () =>
    showPatientModal(patient, async () => {
      const { data: updated } = await sb.from('patients').select('*').eq('patient_id', ptId).single();
      if (updated) renderPatientCard(updated);
    })
  );
}

function renderPatientCard(p) {
  const age = p.date_of_birth
    ? Math.floor((Date.now() - new Date(p.date_of_birth + 'T00:00:00').getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  const bmi = (p.weight_kg && p.height_cm)
    ? (p.weight_kg / Math.pow(p.height_cm / 100, 2)).toFixed(1)
    : null;

  document.title = `${p.first_name} ${p.last_name} — RxTools`;

  const el = document.getElementById('patient-card');
  if (!el) return;
  el.innerHTML = `
    <div class="patient-demographics">
      <div class="patient-id-large">${p.patient_id}</div>
      <div class="patient-name">${escHtml(p.first_name)} ${escHtml(p.last_name)}</div>
      <div class="demo-grid">
        ${p.date_of_birth ? `<div class="demo-item"><span class="demo-label">DOB</span><span class="demo-value">${formatDate(p.date_of_birth)}</span></div>` : ''}
        ${age !== null ? `<div class="demo-item"><span class="demo-label">Age</span><span class="demo-value">${age} yr</span></div>` : ''}
        ${p.gender ? `<div class="demo-item"><span class="demo-label">Gender</span><span class="demo-value">${escHtml(p.gender)}</span></div>` : ''}
        ${p.weight_kg != null ? `<div class="demo-item"><span class="demo-label">Weight</span><span class="demo-value">${p.weight_kg} kg</span></div>` : ''}
        ${p.height_cm != null ? `<div class="demo-item"><span class="demo-label">Height</span><span class="demo-value">${p.height_cm} cm</span></div>` : ''}
        ${bmi ? `<div class="demo-item"><span class="demo-label">BMI</span><span class="demo-value">${bmi} kg/m²</span></div>` : ''}
        ${p.scr_mg_dl != null ? `<div class="demo-item"><span class="demo-label">SCr</span><span class="demo-value">${p.scr_mg_dl} mg/dL</span></div>` : ''}
        ${p.crcl_ml_min != null ? `<div class="demo-item"><span class="demo-label">CrCl</span><span class="demo-value">${p.crcl_ml_min} mL/min</span></div>` : ''}
        ${p.allergies ? `<div class="demo-item demo-wide"><span class="demo-label">Allergies</span><span class="demo-value allergy">${escHtml(p.allergies)}</span></div>` : ''}
        ${p.mrn ? `<div class="demo-item"><span class="demo-label">MRN</span><span class="demo-value">${escHtml(p.mrn)}</span></div>` : ''}
        ${p.notes ? `<div class="demo-item demo-wide"><span class="demo-label">Notes</span><span class="demo-value">${escHtml(p.notes)}</span></div>` : ''}
      </div>
    </div>`;
}

async function loadPatientCalcs(patientDbId) {
  const container = document.getElementById('patient-calcs');
  if (!container) return;

  const { data: calcs } = await sb
    .from('calculations')
    .select('id, app, type, inputs, result, created_at, user_id')
    .eq('patient_id', patientDbId)
    .order('created_at', { ascending: false });

  if (!calcs?.length) {
    container.innerHTML = '<div class="empty-state">No calculations recorded for this patient yet.</div>';
    return;
  }

  const userIds = [...new Set(calcs.map(c => c.user_id))];
  const { data: profiles } = await sb.from('profiles').select('id, full_name').in('id', userIds);
  const pm = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));

  container.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date / Time</th><th>Tool</th><th>Type</th><th>Summary</th><th>By</th></tr></thead>
      <tbody>
        ${calcs.map(c => `
          <tr>
            <td style="white-space:nowrap;font-size:0.78rem">${formatDateTime(c.created_at)}</td>
            <td><span class="app-tag app-${c.app}">${appTagLabel(c.app)}</span></td>
            <td style="font-size:0.8rem;color:var(--text-secondary)">${escHtml(c.type||'—')}</td>
            <td class="calc-summary">${escHtml(summarizeCalc(c))}</td>
            <td style="font-size:0.8rem">${escHtml(pm[c.user_id]||'Unknown')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Router ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page;
  if (page === 'login')     initLoginPage();
  if (page === 'dashboard') initDashboard();
  if (page === 'patients')  initPatientsPage();
  if (page === 'patient')   initPatientPage();
});
