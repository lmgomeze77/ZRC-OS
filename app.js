// ═════════════════════════════════════════════════════════════════════
// ZRC OS · Capa 4 sobre Capa 3
//
// La clave publishable va aqui a proposito: esta disenada para el
// navegador. Lo que protege los datos son las politicas RLS de Postgres.
// Esta interfaz oculta controles por cortesia; quien deniega es la base.
// ═════════════════════════════════════════════════════════════════════
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://jpecmcplicwhmtfnbpdi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_i4NLV2qeu-QbhdzqHR9moQ_NvQC5T1O';
const MODEL_ID     = 'dealscore-v1';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const state = {
  rol: null, email: null,
  rows: [], flags: [], pend: [], dims: [], bands: [],
  selected: null, fVert: '', fBand: '', sortKey: 'score', sortDir: -1,
  draft: null
};
const canWrite = () => state.rol === 'writer' || state.rol === 'admin';

function banner(html) { $('banner').innerHTML = html ? `<div class="banner">${html}</div>` : ''; }

// ── ACCESO ──────────────────────────────────────────────────────────
async function sendLink() {
  const email = $('email').value.trim();
  const msg = $('authMsg');
  if (!email) { msg.className = 'amsg err'; msg.textContent = 'INTRODUCE TU EMAIL.'; return; }
  $('send').disabled = true;
  msg.className = 'amsg'; msg.textContent = 'ENVIANDO…';
  const { error } = await sb.auth.signInWithOtp({
    email, options: { emailRedirectTo: window.location.href.split('#')[0] }
  });
  $('send').disabled = false;
  if (error) {
    msg.className = 'amsg err';
    msg.textContent = 'NO SE PUDO ENVIAR: ' + error.message.toUpperCase();
    return;
  }
  msg.className = 'amsg ok';
  msg.textContent = 'ENLACE ENVIADO. REVISA TU CORREO Y ABRELO EN ESTE MISMO NAVEGADOR.';
}

async function signOut() { await sb.auth.signOut(); location.reload(); }

// ── CARGA ───────────────────────────────────────────────────────────
async function loadRole() {
  // La politica deja leer la fila propia. Si no eres miembro, no hay fila:
  // no es un error, es RLS haciendo su trabajo.
  const { data, error } = await sb.from('app_members')
    .select('rol,nombre').eq('user_id', (await sb.auth.getUser()).data.user.id).maybeSingle();
  if (error) throw error;
  state.rol = data?.rol ?? null;
  state.nombre = data?.nombre ?? null;
}

async function loadAll() {
  const [scores, flags, pend, dims, bands] = await Promise.all([
    sb.from('v_opportunity_scores').select('*'),
    sb.from('scope_flags').select('*').is('resuelto_en', null),
    sb.from('v_pendientes').select('*'),
    sb.from('scoring_dimensions').select('*').eq('model_id', MODEL_ID).order('orden'),
    sb.from('scoring_bands').select('*').eq('model_id', MODEL_ID).order('minimo', { ascending: false })
  ]);
  for (const r of [scores, flags, pend, dims, bands]) if (r.error) throw r.error;
  state.rows  = scores.data ?? [];
  state.flags = flags.data ?? [];
  state.pend  = pend.data ?? [];
  state.dims  = dims.data ?? [];
  state.bands = bands.data ?? [];
  if (state.selected == null && state.rows.length) {
    const best = [...state.rows].sort((a,b) => (b.dealscore ?? -1) - (a.dealscore ?? -1))[0];
    state.selected = best.opportunity_id;
  }
}

const flagsOf = (id) => state.flags.filter(f => f.opportunity_id === id);
const bandColor = (k) => ({ P1:'var(--b1)',P2:'var(--b2)',P3:'var(--b3)',P4:'var(--b4)',DESCARTE:'var(--b5)' }[k] ?? 'var(--faint)');

// ── 1 · ESTADO ──────────────────────────────────────────────────────
function renderStats() {
  const n = state.rows.length;
  const puntuados = state.rows.filter(r => r.dealscore != null).length;
  const p12 = state.rows.filter(r => r.banda === 'P1' || r.banda === 'P2').length;
  const previa = new Set(state.pend.filter(p => p.motivo === 'verificacion_previa').map(p => p.opportunity_id)).size;
  const sinCodigo = state.pend.filter(p => p.motivo === 'sin_codigo').length;

  const tile = (label, value, sub, alert) =>
    `<div class="stat${alert ? ' is-alert' : ''}"><div class="stat-label">${label}</div>
     <div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;

  $('statGrid').innerHTML =
    tile('Expedientes en pipeline', n, `<b>${puntuados}</b> puntuados · <b>${n - puntuados}</b> sin puntuar`) +
    tile('En banda P1–P2', `${p12}<small>/ ${n}</small>`, 'Acción en 48 h y 7 días') +
    tile('Verificación previa', previa, 'Ámbito o sanciones antes de analizar', previa > 0) +
    tile('Sin código de expediente', `${sinCodigo}<small>/ ${n}</small>`, 'Bloquea el registro formal (§12.3)', sinCodigo > 0);
}

// ── 2 · PENDIENTES ──────────────────────────────────────────────────
const MOTIVO = {
  verificacion_previa: ['Verificación previa', 'Resolver el flag antes de consumir tiempo analítico.'],
  sin_codigo:          ['Sin código de expediente', 'Asignar código con el patrón del manual (§12.3).'],
  sin_puntuar:         ['Sin puntuar', 'Puntuar contra las rúbricas ancladas.']
};

function renderQueue() {
  const items = [...state.pend].sort((a,b) => a.prioridad - b.prioridad).slice(0, 8);
  if (!items.length) { $('queue').innerHTML = '<div class="q-item"><div class="q-rank">—</div><div><div class="q-why">Nada pendiente.</div></div></div>'; return; }
  $('queue').innerHTML = items.map((it, i) => {
    const [titulo, accion] = MOTIVO[it.motivo] ?? [it.motivo, ''];
    const stop = it.motivo === 'verificacion_previa';
    return `<div class="q-item" data-goto="${esc(it.opportunity_id)}" role="button" tabindex="0" style="cursor:pointer">
      <div class="q-rank">${String(i+1).padStart(2,'0')}</div>
      <div><div class="q-title">${esc(it.nombre)}</div>
      <div class="q-why">${esc(it.detalle ?? titulo)}</div>
      <div class="q-act"><b>ACCIÓN</b> · ${esc(accion)}</div></div>
      <div class="q-side"><span class="flag ${stop ? 'flag-stop' : 'flag-warn'}">${stop ? '⛔' : '▲'} ${esc(titulo)}</span></div>
    </div>`;
  }).join('');
}

// ── 3 · PIPELINE ────────────────────────────────────────────────────
function visibleRows() {
  return state.rows.filter(r => {
    if (state.fVert && r.vertical !== state.fVert) return false;
    if (state.fBand) {
      const b = r.banda ?? 'NONE';
      if (b !== state.fBand) return false;
    }
    return true;
  }).sort((a,b) => {
    const d = state.sortKey === 'vertical'
      ? String(a.vertical).localeCompare(String(b.vertical))
      : (a.dealscore ?? -1) - (b.dealscore ?? -1);
    return d * state.sortDir;
  });
}

function renderPipe() {
  const rs = visibleRows();
  $('pipeBody').innerHTML = rs.map(r => {
    const fs = flagsOf(r.opportunity_id);
    const stop = fs.some(f => f.nivel === 'stop');
    const scope = fs.length
      ? `<span class="flag ${stop ? 'flag-stop' : 'flag-warn'}">${stop ? '⛔' : '▲'} ${fs.length}</span>`
      : '<span class="flag flag-ok">✓ NÚCLEO</span>';
    const score = r.dealscore == null
      ? '<span class="score-num is-empty">SIN PUNTUAR</span>'
      : `<span class="score-num">${Number(r.dealscore).toFixed(1)}</span>
         <span class="score-bar"><span class="score-fill" style="width:${r.dealscore}%;background:${bandColor(r.banda)}"></span></span>`;
    return `<tr data-id="${esc(r.opportunity_id)}" tabindex="0" aria-selected="${r.opportunity_id === state.selected}">
      <td><div class="td-name">${esc(r.nombre)}</div>
      <div class="td-code">${esc(r.codigo ?? '— sin código —')}${r.plaza ? ' · ' + esc(r.plaza) : ''}</div></td>
      <td><span class="td-vert">${esc(r.vertical)}</span></td>
      <td><div class="score-cell">${score}</div></td>
      <td><span class="pill pill-${esc(r.banda ?? 'NONE')}">${esc(r.banda ?? 'NONE')}</span></td>
      <td>${scope}</td></tr>`;
  }).join('');
  $('pipeCount').textContent = `${rs.length} DE ${state.rows.length} EXPEDIENTES`;
  $('pipeRef').textContent = `${state.rows.length} EXPEDIENTES · ${MODEL_ID.toUpperCase()}`;
}

// ── DETALLE ─────────────────────────────────────────────────────────
function renderDetail() {
  const r = state.rows.find(x => x.opportunity_id === state.selected);
  if (!r) { $('detail').innerHTML = ''; return; }
  const vals = state.draft && state.draft.id === r.opportunity_id ? state.draft.v : null;

  const dimHtml = state.dims.map((d, i) => {
    const v = vals ? vals[i] : null;
    const control = canWrite()
      ? `<input class="dim-slider" type="range" min="0" max="10" step="1"
           value="${v ?? 5}" data-dim="${i}" aria-label="${esc(d.codigo + ' ' + d.nombre)}" />`
      : '';
    return `<div class="dim-row"><div class="dim-top">
        <span class="dim-code">${esc(d.codigo)}</span>
        <span class="dim-name">${esc(d.nombre)}${d.invertida ? ' <span class="dim-w">(invertida)</span>' : ''}</span>
        <span class="dim-w">${d.peso}%</span>
        <span class="dim-val">${v ?? '—'}</span></div>
        <div class="dim-bar-row"><span class="dim-track"><span class="dim-fill" style="width:${(v ?? 0) * 10}%"></span></span></div>
        ${control}</div>`;
  }).join('');

  const sc = vals ? Math.round(vals.reduce((t, x, i) => t + x * Number(state.dims[i].peso), 0)) / 10 : r.dealscore;
  const band = sc == null ? null : state.bands.find(b => sc >= Number(b.minimo));

  const fs = flagsOf(r.opportunity_id);
  const scopeHtml = fs.length ? `<div class="scope-notes">${fs.map(f =>
    `<div class="scope-note"><span class="flag ${f.nivel === 'stop' ? 'flag-stop' : 'flag-warn'}">${f.nivel === 'stop' ? '⛔' : '▲'}</span>
     <span>${esc(f.texto)}${f.referencia ? ` <span class="dim-w">${esc(f.referencia)}</span>` : ''}</span></div>`).join('')}</div>` : '';

  const action = canWrite()
    ? `<button id="saveScore" class="tbtn" style="margin-top:16px;width:100%;padding:12px"
         ${vals ? '' : 'disabled'}>GUARDAR PUNTUACIÓN</button>
       <div class="amsg" id="saveMsg"></div>`
    : `<div class="readonly-note">Tu acceso es de <b>solo lectura</b>. Puedes consultarlo todo,
       pero no puntuar. Quien lo impide es la base de datos, no esta pantalla.</div>`;

  $('detail').innerHTML = `
    <div class="detail-head">
      <div><div class="detail-title">${esc(r.nombre)}${r.plaza ? ` (${esc(r.plaza)})` : ''}</div>
      <div class="detail-meta">${esc(r.codigo ?? '— SIN CÓDIGO DE EXPEDIENTE —')} · ${esc(String(r.vertical).toUpperCase())} · ${esc(r.geo)}</div></div>
      <div class="detail-score">
        <div class="detail-score-n" style="color:${sc == null ? 'var(--faint)' : bandColor(band?.clave)}">${sc == null ? '—' : Number(sc).toFixed(1)}</div>
        <div class="detail-score-l">${esc(band?.etiqueta ?? 'SIN PUNTUAR')}</div>
      </div>
    </div>
    <div class="detail-cols">
      <div>${dimHtml}</div>
      <div>${scopeHtml}${action}</div>
    </div>`;

  if (canWrite()) {
    for (const el of $('detail').querySelectorAll('input[type=range]')) {
      el.addEventListener('input', () => {
        const base = (state.draft && state.draft.id === r.opportunity_id)
          ? [...state.draft.v] : new Array(state.dims.length).fill(5);
        base[Number(el.dataset.dim)] = Number(el.value);
        state.draft = { id: r.opportunity_id, v: base };
        renderDetail();
        const again = $('detail').querySelector(`input[data-dim="${el.dataset.dim}"]`);
        if (again) again.focus();
      });
    }
    $('saveScore')?.addEventListener('click', saveScore);
  }
}

async function saveScore() {
  const msg = $('saveMsg'), btn = $('saveScore');
  if (!state.draft) return;
  btn.disabled = true; msg.className = 'amsg'; msg.textContent = 'GUARDANDO…';
  try {
    const uid = (await sb.auth.getUser()).data.user.id;
    const { data: sc, error: e1 } = await sb.from('scores')
      .insert({ opportunity_id: state.draft.id, model_id: MODEL_ID, autor: uid })
      .select('id').single();
    if (e1) throw e1;
    const filas = state.dims.map((d, i) => ({ score_id: sc.id, codigo: d.codigo, valor: state.draft.v[i] }));
    const { error: e2 } = await sb.from('score_values').insert(filas);
    if (e2) throw e2;
    state.draft = null;
    await loadAll();
    renderAll();
    const m = $('saveMsg'); if (m) { m.className = 'amsg ok'; m.textContent = 'PUNTUACIÓN GUARDADA.'; }
  } catch (err) {
    btn.disabled = false;
    msg.className = 'amsg err';
    // 42501 es el codigo de Postgres para violacion de politica RLS
    msg.textContent = err?.code === '42501'
      ? 'LA BASE HA RECHAZADO LA ESCRITURA: TU ROL NO PUEDE PUNTUAR.'
      : 'NO SE PUDO GUARDAR: ' + String(err?.message ?? err).toUpperCase();
  }
}

// ── RENDER ──────────────────────────────────────────────────────────
function renderWhoami() {
  $('whoami').innerHTML =
    `<b>${esc(state.email)}</b><span class="rolepill ${esc(state.rol)}">${esc(String(state.rol).toUpperCase())}</span>
     <button class="linkbtn" id="out">salir</button>`;
  $('out').addEventListener('click', signOut);
}

function renderFilters() {
  const sel = $('fVert');
  const verts = [...new Set(state.rows.map(r => r.vertical))].sort();
  sel.innerHTML = '<option value="">TODAS LAS VERTICALES</option>' +
    verts.map(v => `<option value="${esc(v)}">${esc(String(v).toUpperCase())}</option>`).join('');
  sel.value = state.fVert;
}

function renderAll() { renderStats(); renderQueue(); renderFilters(); renderPipe(); renderDetail(); }

function select(id) { state.selected = id; state.draft = null; renderPipe(); renderDetail(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

function wire() {
  $('pipeBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id); });
  $('pipeBody').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); select(tr.dataset.id); }
  });
  $('queue').addEventListener('click', e => { const el = e.target.closest('[data-goto]'); if (el) select(el.dataset.goto); });
  $('fVert').addEventListener('change', function () { state.fVert = this.value; renderPipe(); });
  $('fBand').addEventListener('change', function () { state.fBand = this.value; renderPipe(); });
  for (const th of document.querySelectorAll('th.sortable')) {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = k === 'score' ? -1 : 1; }
      renderPipe();
    });
  }
}

// ── ARRANQUE ────────────────────────────────────────────────────────
async function boot() {
  $('send').addEventListener('click', sendLink);
  $('email').addEventListener('keydown', e => { if (e.key === 'Enter') sendLink(); });

  const { data: { session } } = await sb.auth.getSession();
  $('boot').hidden = true;

  if (!session) { $('auth').hidden = false; $('email').focus(); return; }
  state.email = session.user.email;

  try {
    await loadRole();
  } catch (err) {
    $('auth').hidden = false;
    $('authMsg').className = 'amsg err';
    $('authMsg').textContent = 'NO SE PUDO LEER TU PERFIL: ' + String(err.message).toUpperCase();
    return;
  }

  if (!state.rol) {
    // Autenticado pero sin fila en app_members: RLS no da error, da vacio.
    // Decirlo claramente en vez de pintar un cuadro de mando vacio.
    $('auth').hidden = false;
    $('authIntro').innerHTML =
      `Has entrado como <b style="color:var(--cream)">${esc(state.email)}</b>, pero tu cuenta
       todav&iacute;a no tiene acceso concedido al ZRC OS. P&iacute;deselo al administrador.`;
    $('email').hidden = true; $('send').hidden = true;
    $('authMsg').innerHTML = `<button class="linkbtn" id="out2">salir</button>`;
    $('out2').addEventListener('click', signOut);
    return;
  }

  $('app').hidden = false;
  renderWhoami();
  wire();
  try {
    await loadAll();
    if (!state.rows.length) banner('<b>SIN DATOS</b><br>La base responde pero no devuelve expedientes. Revisa que se haya aplicado la carga (05_seed.sql).');
    renderAll();
  } catch (err) {
    banner('<b>ERROR AL CARGAR</b><br>' + esc(String(err.message)));
  }
}

boot();
