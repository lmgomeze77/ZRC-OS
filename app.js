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
  docs: [], econ: [], strat: [], outreach: [], mand: [], drError: null,
  rubrics: [], gates: [], risk: [], doctError: null,
  miembros: [], accesos: [],
  drTab: 'documentos',
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
  // NUCLEO: sin esto no hay cuadro de mando. Un fallo aqui si es fatal.
  const [scores, flags, pend, dims, bands] = await Promise.all([
    sb.from('v_opportunity_scores').select('*'),
    sb.from('scope_flags').select('*').is('resuelto_en', null),
    sb.from('v_pendientes').select('*'),
    sb.from('scoring_dimensions').select('*').eq('model_id', MODEL_ID).order('orden'),
    sb.from('scoring_bands').select('*').eq('model_id', MODEL_ID).order('minimo', { ascending: false })
  ]);
  for (const r of [scores, flags, pend, dims, bands]) if (r.error) throw r.error;

  // Reserva por expediente: opcional, como los demas tramos. Las politicas
  // devuelven poco a quien no es admin, y eso es correcto, no un error.
  try {
    const [mem, acc] = await Promise.all([
      sb.from('app_members').select('user_id,nombre,rol'),
      sb.from('opportunity_access').select('*')
    ]);
    const fallo = [mem, acc].find(r => r.error);
    if (fallo) throw fallo.error;
    state.miembros = mem.data ?? [];
    state.accesos = acc.data ?? [];
  } catch { state.miembros = []; state.accesos = []; }
  state.rows  = scores.data ?? [];
  state.flags = flags.data ?? [];
  state.pend  = pend.data ?? [];
  state.dims  = dims.data ?? [];
  state.bands = bands.data ?? [];
  // DOCTRINA: opcional, igual que el data room. Si 09_doctrina.sql no se
  // ha aplicado, el cuadro de mando sigue funcionando sin rubricas, sin
  // matriz GO/NO-GO y sin indice de riesgo.
  try {
    const [rub, gat, rsk] = await Promise.all([
      sb.from('scoring_rubrics').select('*').eq('model_id', MODEL_ID),
      sb.from('scoring_gates').select('*').eq('model_id', MODEL_ID).order('orden'),
      sb.from('risk_index').select('*').order('fecha')
    ]);
    const fallo = [rub, gat, rsk].find(r => r.error);
    if (fallo) throw fallo.error;
    state.rubrics = rub.data ?? [];
    state.gates = gat.data ?? [];
    state.risk = rsk.data ?? [];
    state.doctError = null;
  } catch (err) {
    state.rubrics = []; state.gates = []; state.risk = [];
    state.doctError = String(err?.message ?? err);
  }

  // DATA ROOM: opcional. Si 06_dataroom.sql no se ha aplicado todavia, sus
  // tablas no existen — y eso no puede dejar en blanco el cuadro de mando
  // entero. Se degrada a una seccion que explica que falta.
  try {
    const [docs, econ, strat, outreach, mand] = await Promise.all([
      sb.from('documents').select('*').order('orden'),
      sb.from('v_economics').select('*'),
      sb.from('strategy').select('*'),
      // PostgREST resuelve el inversor por la clave foranea: una consulta, no dos.
      sb.from('investor_outreach').select('*, investors(nombre,tipo,geo,ticket_min_eur,ticket_max_eur)'),
      sb.from('mandates').select('*')
    ]);
    const fallo = [docs, econ, strat, outreach, mand].find(r => r.error);
    if (fallo) throw fallo.error;
    state.docs = docs.data ?? [];
    state.econ = econ.data ?? [];
    state.strat = strat.data ?? [];
    state.outreach = outreach.data ?? [];
    state.mand = mand.data ?? [];
    state.drError = null;
  } catch (err) {
    state.docs = []; state.econ = []; state.strat = []; state.outreach = []; state.mand = [];
    state.drError = String(err?.message ?? err);
  }
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
  const vivos = state.mand.filter(m => m.estado === 'vivo').length;

  const tile = (label, value, sub, alert) =>
    `<div class="stat${alert ? ' is-alert' : ''}"><div class="stat-label">${label}</div>
     <div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;

  $('statGrid').innerHTML =
    tile('Expedientes en pipeline', n, `<b>${puntuados}</b> puntuados · <b>${n - puntuados}</b> sin puntuar`) +
    tile('En banda P1–P2', `${p12}<small>/ ${n}</small>`, 'Acción en 48 h y 7 días') +
    tile('Mandatos vivos', vivos || '—',
         vivos ? 'Con plazo y economics registrados' : 'Ningún mandato vivo en Capa 3', !vivos) +
    tile('Verificación previa', previa, 'Ámbito o sanciones antes de analizar', previa > 0) +
    tile('Sin código de expediente', `${sinCodigo}<small>/ ${n}</small>`, 'Bloquea el registro formal (§12.3)', sinCodigo > 0) +
    tarjetaRiesgo();
}

// El punto hueco marca un valor reconstruido por interpolacion: no es una
// lectura, y dibujarlo igual que una lectura seria afirmar algo que no consta.
function sparkline(serie) {
  const W = 200, H = 42, PT = 6, PB = 6, PL = 2, PR = 6;
  if (serie.length < 2) return '';
  const vals = serie.map(r => r.valor);
  const lo = Math.min(...vals) - 3, hi = Math.max(...vals) + 3;
  const x = i => PL + i * (W - PL - PR) / (serie.length - 1);
  const y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
  const d = serie.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.valor).toFixed(1)).join(' ');
  const area = d + ` L${x(serie.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const dots = serie.map((r, i) => {
    const last = i === serie.length - 1;
    if (r.estado === 'publicado' && !last) return '';
    const cx = x(i).toFixed(1), cy = y(r.valor).toFixed(1);
    if (last) return `<circle cx="${cx}" cy="${cy}" r="3" fill="#C9A84C" stroke="#0B1526" stroke-width="1.5"></circle>`;
    return `<circle cx="${cx}" cy="${cy}" r="2.4" fill="#0B1526" stroke="${
      r.estado === 'reconstruido' ? '#5A6A80' : '#FBBF24'}" stroke-width="1.2"></circle>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
    aria-label="Índice de riesgo ZRC, ${serie.length} días, de ${vals[0]} a ${vals[vals.length-1]}"
    preserveAspectRatio="none" style="display:block;max-width:100%">
    <defs><linearGradient id="sparkG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#C9A84C" stop-opacity=".22"></stop>
      <stop offset="100%" stop-color="#C9A84C" stop-opacity="0"></stop>
    </linearGradient></defs>
    <path d="${area}" fill="url(#sparkG)"></path>
    <path d="${d}" fill="none" stroke="#C9A84C" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
    ${dots}</svg>`;
}

function tarjetaRiesgo() {
  if (!state.risk.length) return '';
  const ult = state.risk[state.risk.length - 1];
  const prev = state.risk[state.risk.length - 2];
  const delta = prev ? ult.valor - prev.valor : 0;
  const flecha = delta === 0 ? '→' : (delta > 0 ? '▲' : '▼');
  const dias = Math.round((Date.now() - new Date(ult.fecha).getTime()) / 86400000);
  return `<div class="stat"><div class="stat-label">Índice de riesgo ZRC</div>
    <div class="stat-value">${ult.valor}<small>${flecha} ${Math.abs(delta)}</small></div>
    <div class="spark-wrap">${sparkline(state.risk)}</div>
    <div class="spark-legend">
      <span><i style="background:#C9A84C"></i>Publicado</span>
      <span><i style="border:1.2px solid #FBBF24"></i>Degradado</span>
      <span><i style="border:1.2px solid #5A6A80"></i>Reconstruido</span>
    </div>
    <div class="stat-sub">${esc(ult.fecha)}${dias > 2 ? ` · <b style="color:var(--amber)">${dias} días sin actualizar</b>` : ''}</div></div>`;
}

// ── 2 · PENDIENTES ──────────────────────────────────────────────────
const MOTIVO = {
  verificacion_previa: ['Verificación previa', 'Resolver el flag antes de consumir tiempo analítico.'],
  // La banda fija la accion por si sola: no hace falta ningun aviso ni
  // ninguna carencia para que un P1 exija trabajo hoy.
  banda_alta:          ['Banda alta', 'La acción y el plazo los fija la banda.'],
  sin_codigo:          ['Sin código de expediente', 'Asignar código con el patrón del manual (§12.3).'],
  sin_puntuar:         ['Sin puntuar', 'Puntuar contra las rúbricas ancladas.']
};

function renderQueue() {
  const items = [...state.pend].sort((a,b) => a.prioridad - b.prioridad).slice(0, 8);
  if (!items.length) { $('queue').innerHTML = '<div class="q-item"><div class="q-rank">—</div><div><div class="q-why">Nada pendiente.</div></div></div>'; return; }
  $('queue').innerHTML = items.map((it, i) => {
    const [titulo, accion] = MOTIVO[it.motivo] ?? [it.motivo, ''];
    const stop = it.motivo === 'verificacion_previa';
    const banda = it.motivo === 'banda_alta'
      ? (state.rows.find(r => r.opportunity_id === it.opportunity_id)?.banda ?? null) : null;
    const lado = banda
      ? `<span class="pill pill-${esc(banda)}">${esc(banda)}</span>`
      : `<span class="flag ${stop ? 'flag-stop' : 'flag-warn'}">${stop ? '⛔' : '▲'} ${esc(titulo)}</span>`;
    return `<div class="q-item" data-goto="${esc(it.opportunity_id)}" role="button" tabindex="0" style="cursor:pointer">
      <div class="q-rank">${String(i+1).padStart(2,'0')}</div>
      <div><div class="q-title">${esc(it.nombre)}</div>
      <div class="q-why">${esc(it.detalle ?? titulo)}</div>
      <div class="q-act"><b>ACCIÓN</b> · ${esc(accion)}</div></div>
      <div class="q-side">${lado}</div>
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
      <td><span class="pill pill-${esc(r.banda ?? 'NONE')}">${esc(r.banda ?? 'NONE')}</span>
        ${r.reservado ? '<span class="pill pill-RESERVADO" style="margin-left:6px">⛔ RESERVADO</span>' : ''}</td>
      <td>${scope}</td></tr>`;
  }).join('');
  $('pipeCount').textContent = `${rs.length} DE ${state.rows.length} EXPEDIENTES`;
  $('pipeRef').textContent = `${state.rows.length} EXPEDIENTES · ${MODEL_ID.toUpperCase()}`;
}

// Las palancas no son las dimensiones con peor nota, sino aquellas donde
// queda mas recorrido ponderado: (10 - valor) x peso. Es la diferencia
// entre «esto esta flojo» y «aqui es donde hay puntos que ganar».
function levers(vals, n) {
  if (!vals) return [];
  return vals.map((x, i) => ({ i, gana: (10 - x) * Number(state.dims[i]?.peso ?? 0) }))
    .sort((a, b) => b.gana - a.gana).slice(0, n).map(o => o.i);
}

// Matriz GO / NO-GO (Anexo B). Las puertas vienen de la base: cambiar un
// umbral es una decision registrada, no un despliegue.
function goNoGo(r, vals, sc) {
  if (!state.gates.length) return '';
  const fs = flagsOf(r.opportunity_id);
  const hayStop = fs.some(f => f.nivel === 'stop');
  const idx = (cod) => state.dims.findIndex(d => d.codigo === cod);

  const checks = state.gates.map(g => {
    let ok = null;
    if (g.tipo === 'knockout') ok = !hayStop;
    else if (g.tipo === 'ambito') ok = (r.geo === 'ES' || r.geo === 'PT') ? true : (r.geo === 'MENA' ? null : false);
    else if (g.tipo === 'dealscore') ok = sc == null ? null : sc >= Number(g.umbral);
    else if (g.tipo === 'dimension') {
      const i = idx(g.codigo);
      ok = (vals && i >= 0) ? vals[i] >= Number(g.umbral) : null;
    }
    return { ...g, ok };
  });

  const fallaElim = checks.some(c => c.eliminatoria && c.ok === false);
  const pendiente = checks.some(c => c.ok === null);
  const fallaBlanda = checks.some(c => !c.eliminatoria && c.ok === false);

  let veredicto, vcls;
  if (fallaElim)        { veredicto = 'NO-GO AUTOMÁTICO'; vcls = 'no'; }
  else if (pendiente)   { veredicto = 'INFORMACIÓN INSUFICIENTE'; vcls = 'cio'; }
  else if (fallaBlanda) { veredicto = 'DECISIÓN DEL CIO · EXCEPCIÓN DOCUMENTADA'; vcls = 'cio'; }
  else                  { veredicto = 'GO'; vcls = 'go'; }

  const filas = checks.map(c => {
    const cls = c.ok === true ? 'gg-pass' : (c.ok === false ? 'gg-fail' : 'gg-warn');
    const mk  = c.ok === true ? '✓' : (c.ok === false ? '✕' : '?');
    return `<div class="gg-item ${cls}"><span class="gg-mark">${mk}</span>
      <span class="gg-q">${esc(c.pregunta)}</span><span class="gg-t">${esc(c.etiqueta)}</span></div>`;
  }).join('');

  const pal = levers(vals, 2);
  const palHtml = (vals && pal.length === 2)
    ? `<div class="lever"><h4>◆ LECTURA OPERATIVA</h4><p>La puntuación no dice qué hacer; dice dónde
       está el problema. Las dos palancas de este expediente son
       <b style="color:var(--cream)">${esc(state.dims[pal[0]].codigo)} · ${esc(state.dims[pal[0]].nombre)}</b> y
       <b style="color:var(--cream)">${esc(state.dims[pal[1]].codigo)} · ${esc(state.dims[pal[1]].nombre)}</b>.
       Mover cualquiera de las dos cambia la banda más que cualquier trabajo adicional sobre las seis restantes.</p></div>`
    : '';

  return `<div class="gonogo"><h4>Matriz GO / NO-GO · Anexo B</h4>${filas}
    <div class="gg-verdict ${vcls}">${veredicto}</div></div>${palHtml}`;
}

// Reservar un expediente y repartir quien lo ve es potestad del admin: la
// base lo aplica en opportunity_access, esto solo es el mando.
function panelReserva(r) {
  if (state.rol !== 'admin') return '';
  const conAcceso = state.accesos.filter(a => a.opportunity_id === r.opportunity_id);
  const otros = state.miembros.filter(m => m.rol !== 'admin');
  const yaTiene = new Set(conAcceso.map(a => a.user_id));
  const libres = otros.filter(m => !yaTiene.has(m.user_id));

  const lista = r.reservado
    ? (conAcceso.length
        ? `<div class="acc-lista">${conAcceso.map(a => {
            const m = state.miembros.find(x => x.user_id === a.user_id);
            return `<div class="acc-fila"><b>${esc(m?.nombre ?? a.user_id)}</b>
              <span class="rolepill ${esc(m?.rol ?? '')}">${esc(String(m?.rol ?? '').toUpperCase())}</span>
              <button class="btn-mini" data-revocar="${esc(a.user_id)}">REVOCAR</button></div>`;
          }).join('')}</div>`
        : '<div class="pista" style="margin-top:10px">Nadie más que los administradores puede verlo.</div>')
    : '';

  const conceder = (r.reservado && libres.length)
    ? `<div class="frm-grid" style="margin-top:12px">
         <div class="fld"><label for="accQuien">Conceder acceso a</label>
           <select id="accQuien">${libres.map(m =>
             `<option value="${esc(m.user_id)}">${esc(m.nombre ?? m.user_id)} · ${esc(m.rol)}</option>`).join('')}</select></div>
         <div class="fld"><label>&nbsp;</label>
           <button class="btn-oro" style="margin-top:0" id="accDar">CONCEDER</button></div>
       </div>` : '';

  return `<div class="reserva">
    <h4>⛔ Reserva del expediente</h4>
    <div class="fld check"><input id="resv" type="checkbox" ${r.reservado ? 'checked' : ''} />
      <label for="resv">Expediente reservado</label></div>
    <div class="pista">Reservado, solo lo ven los administradores y quien tenga permiso aquí abajo.
      La reserva alcanza también a sus documentos, economics, estrategia, inversores, puntuaciones
      y ficheros: lo aplica la base, no esta pantalla.</div>
    ${lista}${conceder}
    <div class="frm-msg" id="resvMsg"></div>
  </div>`;
}

// ── DETALLE ─────────────────────────────────────────────────────────
function renderDetail() {
  const r = state.rows.find(x => x.opportunity_id === state.selected);
  if (!r) { $('detail').innerHTML = ''; return; }
  const vals = state.draft && state.draft.id === r.opportunity_id ? state.draft.v : null;

  const palancas = levers(vals, 2);
  const dimHtml = state.dims.map((d, i) => {
    const v = vals ? vals[i] : null;
    // tramo 0..4 -> 0-2, 3-4, 5-6, 7-8, 9-10
    const tramo = v == null ? null : Math.min(4, Math.floor(v / 2.0001));
    const rub = tramo == null ? null
      : state.rubrics.find(r => r.codigo === d.codigo && r.tramo === tramo);
    const esPalanca = palancas.includes(i) && vals;
    const control = canWrite()
      ? `<input class="dim-slider" type="range" min="0" max="10" step="1"
           value="${v ?? 5}" data-dim="${i}" aria-label="${esc(d.codigo + ' ' + d.nombre)}" />`
      : '';
    return `<div class="dim-row${esPalanca ? ' is-lever' : ''}"><div class="dim-top">
        <span class="dim-code">${esc(d.codigo)}</span>
        <span class="dim-name">${esc(d.nombre)}${d.invertida ? ' <span class="dim-w">(invertida)</span>' : ''}</span>
        ${esPalanca ? '<span class="lever-tag">PALANCA</span>' : ''}
        <span class="dim-w">${d.peso}%</span>
        <span class="dim-val">${v ?? '—'}</span></div>
        <div class="dim-bar-row"><span class="dim-track"><span class="dim-fill" style="width:${(v ?? 0) * 10}%"></span></span></div>
        ${control}
        ${rub ? `<div class="dim-anchor">${esc(rub.texto)}</div>` : ''}</div>`;
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
      <div>${goNoGo(r, vals, sc)}${scopeHtml}${panelReserva(r)}${action}</div>
    </div>`;

  if (!canWrite()) cablearReserva(r);
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
  cablearReserva(r);
}

function cablearReserva(r) {
  const id = r.opportunity_id;
  $('resv')?.addEventListener('change', (ev) => guardar($('resvMsg'), null,
    () => sb.from('opportunities').update({ reservado: ev.target.checked }).eq('id', id),
    ev.target.checked ? 'EXPEDIENTE RESERVADO.' : 'EXPEDIENTE ABIERTO A TODOS LOS MIEMBROS.'));

  $('accDar')?.addEventListener('click', (ev) => guardar($('resvMsg'), ev.target,
    () => sb.from('opportunity_access').insert({
      opportunity_id: id, user_id: val('accQuien')
    }), 'ACCESO CONCEDIDO.'));

  for (const b of document.querySelectorAll('[data-revocar]')) {
    b.addEventListener('click', (ev) => guardar($('resvMsg'), ev.target,
      () => sb.from('opportunity_access').delete()
        .eq('opportunity_id', id).eq('user_id', b.dataset.revocar), 'ACCESO REVOCADO.'));
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



// ── ESCRITURA ───────────────────────────────────────────────────────
// Envoltorio unico para todo lo que escribe: mensaje legible, recarga y
// repintado. El 42501 de Postgres es el rechazo de una politica RLS; sin
// traducirlo, el usuario solo veria una cadena cruda del driver.
async function guardar(msgEl, btnEl, fn, textoOk = 'GUARDADO.') {
  if (btnEl) btnEl.disabled = true;
  if (msgEl) { msgEl.className = 'frm-msg'; msgEl.textContent = 'GUARDANDO…'; }
  try {
    const { error } = await fn();
    if (error) throw error;
    await loadAll();
    renderAll();
    const m = $(msgEl?.id); if (m) { m.className = 'frm-msg ok'; m.textContent = textoOk; }
  } catch (err) {
    if (btnEl) btnEl.disabled = false;
    if (msgEl) {
      msgEl.className = 'frm-msg err';
      msgEl.textContent = err?.code === '42501'
        ? 'LA BASE HA RECHAZADO LA ESCRITURA: TU ROL NO PUEDE EDITAR.'
        : 'NO SE PUDO GUARDAR: ' + String(err?.message ?? err).toUpperCase();
    }
  }
}

const val = (id) => { const e = $(id); return e ? e.value.trim() : ''; };
const num = (id) => { const v = val(id); return v === '' ? null : Number(v); };
const chk = (id) => { const e = $(id); return e ? e.checked : false; };

const campo = (id, etiqueta, tipo = 'text', extra = '') =>
  `<div class="fld"><label for="${id}">${etiqueta}</label>
   <input id="${id}" type="${tipo}" ${extra} /></div>`;
const area = (id, etiqueta, v = '') =>
  `<div class="fld ancho"><label for="${id}">${etiqueta}</label>
   <textarea id="${id}">${esc(v ?? '')}</textarea></div>`;
const opciones = (mapa, sel) => Object.entries(mapa)
  .map(([k, t]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(t)}</option>`).join('');

// ── 4 · DATA ROOM ───────────────────────────────────────────────────
const CATS = {
  registral:'Registral', catastral:'Catastral', tecnico:'Técnico',
  licencias:'Licencias', legal:'Legal', fiscal:'Fiscal',
  comunidad:'Comunidad', comercial:'Comercial', financiero:'Financiero', otros:'Otros'
};
const EST_INV = {
  identificado:'Identificado', contactado:'Contactado', nda:'NDA firmado',
  en_revision:'En revisión', interesado:'Interesado', oferta:'Oferta', descartado:'Descartado'
};
const eur = (n) => n == null ? null
  : new Intl.NumberFormat('es-ES', { style:'currency', currency:'EUR', maximumFractionDigits:0 }).format(n);

const vacio = (txt) => `<div class="empty-state">${esc(txt)}</div>`;

function drDocumentos(id) {
  const ds = state.docs.filter(d => d.opportunity_id === id);
  if (!ds.length) return vacio('Sin documentación cargada para este expediente.');
  const cats = [...new Set(ds.map(d => d.categoria))];
  return cats.map(c => {
    const items = ds.filter(d => d.categoria === c);
    return `<div class="dr-cat">${esc(CATS[c] ?? c)} · ${items.length}</div>
      <div class="dr-grid">${items.map(d => `
        <article class="doc">
          <div><h4>${esc(d.titulo)}</h4>${d.descripcion ? `<p>${esc(d.descripcion)}</p>` : ''}</div>
          <div>
            ${d.url
              ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">ABRIR DOCUMENTO</a>`
              : `<div class="pend">▲ ${esc(String(d.estado).toUpperCase())}</div>`}
            ${canWrite() ? `<div class="fila-acc" style="margin-top:9px">
              <button class="btn-mini" data-del-doc="${esc(d.id)}">ELIMINAR</button></div>` : ''}
          </div>
        </article>`).join('')}</div>`;
  }).join('') + formDocumento();
}

function formDocumento() {
  if (!canWrite()) return '';
  return `<div class="frm">
    <h4>Añadir documento</h4>
    <div class="frm-grid">
      <div class="fld"><label for="dTit">Título</label><input id="dTit" type="text" /></div>
      <div class="fld"><label for="dCat">Categoría</label>
        <select id="dCat">${opciones(CATS, 'otros')}</select></div>
      <div class="fld"><label for="dEst">Estado</label>
        <select id="dEst">${opciones({disponible:'Disponible',pendiente:'Pendiente',solicitado:'Solicitado'},'disponible')}</select></div>
      <div class="fld"><label for="dOrd">Orden</label><input id="dOrd" type="number" value="99" /></div>
      <div class="fld ancho"><label for="dUrl">Enlace</label><input id="dUrl" type="text"
        placeholder="https://drive.google.com/…" />
        <span class="pista">Déjalo vacío si el documento aún no existe: se registra como hueco declarado.</span></div>
      <div class="fld ancho"><label for="dDes">Descripción</label><textarea id="dDes"></textarea></div>
    </div>
    <button class="btn-oro" id="dAdd">AÑADIR DOCUMENTO</button>
    <div class="frm-msg" id="dMsg"></div>
  </div>`;
}

function drEconomics(id) {
  const e = state.econ.find(x => x.opportunity_id === id);
  const m = state.mand.filter(x => x.opportunity_id === id && x.estado === 'vivo')[0];
  if (!e && !m) return vacio('Sin economics ni mandato registrados todavía.');
  const fila = (k, v) => `<dt>${k}</dt><dd${v == null ? ' class="vacio"' : ''}>${v ?? 'sin registrar'}</dd>`;
  const rango = e && (e.ev_min_eur != null || e.ev_max_eur != null)
    ? `${eur(e.ev_min_eur) ?? '—'} – ${eur(e.ev_max_eur) ?? '—'}` : null;
  // El precio ya viene oculto de la vista si no esta autorizada su difusion.
  const precio = !e ? null
    : (e.precio_objetivo_eur != null ? eur(e.precio_objetivo_eur)
      : '<span class="oculto">⛔ NO DIVULGADO EN ESTA FASE</span>');
  return `<dl class="kv">
    ${fila('Rango de EV', rango)}
    ${fila('Precio objetivo', precio)}
    ${fila('Retainer', e ? eur(e.retainer_eur) : null)}
    ${fila('Éxito', e && e.exito_pct != null ? e.exito_pct + ' %' : null)}
    ${fila('Éxito mínimo', e ? eur(e.exito_min_eur) : null)}
    ${fila('Exclusividad', e && e.exclusividad != null ? (e.exclusividad ? 'Sí' : 'No') : null)}
    ${fila('Duración', e && e.duracion_meses != null ? e.duracion_meses + ' meses' : null)}
    ${fila('Mandato', m ? `${esc(m.tipo ?? 'vivo')}${m.vence_en ? ' · vence ' + esc(m.vence_en) : ''}` : null)}
  </dl>${e && e.notas ? `<div class="prosa" style="margin-top:14px"><h4>Notas</h4><p>${esc(e.notas)}</p></div>` : ''}
  ${formEconomics(id, e)}`;
}

function formEconomics(id, e) {
  if (!canWrite()) return '';
  const v = (x) => x == null ? '' : x;
  return `<div class="frm">
    <h4>Editar economics</h4>
    <div class="frm-grid">
      ${campo('eMin','EV mínimo (€)','number',`value="${v(e?.ev_min_eur)}"`)}
      ${campo('eMax','EV máximo (€)','number',`value="${v(e?.ev_max_eur)}"`)}
      ${campo('ePre','Precio objetivo (€)','number',`value="${v(e?.precio_objetivo_eur)}"`)}
      ${campo('eRet','Retainer (€)','number',`value="${v(e?.retainer_eur)}"`)}
      ${campo('eExP','Éxito (%)','number',`step="0.01" value="${v(e?.exito_pct)}"`)}
      ${campo('eExM','Éxito mínimo (€)','number',`value="${v(e?.exito_min_eur)}"`)}
      ${campo('eDur','Duración (meses)','number',`value="${v(e?.duracion_meses)}"`)}
      <div class="fld check"><input id="eExc" type="checkbox" ${e?.exclusividad ? 'checked' : ''} />
        <label for="eExc">Mandato en exclusiva</label></div>
      <div class="fld ancho check"><input id="ePub" type="checkbox" ${e?.precio_publicado ? 'checked' : ''} />
        <label for="ePub">Autorizar la divulgación del precio</label></div>
      <div class="fld ancho"><div class="aviso-precio">Mientras esta casilla esté desmarcada, el precio
        <b>no sale de la base de datos</b>: la vista lo oculta. Márcala sólo al pasar a
        cualificación de inversor o EOI.</div></div>
      ${area('eNot','Notas', e?.notas)}
    </div>
    <button class="btn-oro" id="eSave">GUARDAR ECONOMICS</button>
    <div class="frm-msg" id="eMsg"></div>
  </div>`;
}

function drEstrategia(id) {
  const s = state.strat.find(x => x.opportunity_id === id);
  if (!s) return vacio('Sin estrategia registrada para este expediente.') + formEstrategia(id, null);
  const bloque = (t, v) => v ? `<div class="prosa"><h4>${t}</h4><p>${esc(v)}</p></div>` : '';
  const html = bloque('Ángulo · por qué ZRC', s.angulo) + bloque('Comprador objetivo', s.comprador_tipo)
             + bloque('Proceso', s.proceso) + bloque('Riesgos', s.riesgos);
  return (html || vacio('La estrategia existe pero está vacía.')) + formEstrategia(id, s);
}

function formEstrategia(id, s) {
  if (!canWrite()) return '';
  return `<div class="frm">
    <h4>${s ? 'Editar' : 'Registrar'} estrategia</h4>
    <div class="frm-grid">
      ${area('sAng','Ángulo · la respuesta de una frase a «por qué ZRC»', s?.angulo)}
      ${area('sCom','Comprador objetivo', s?.comprador_tipo)}
      ${area('sPro','Proceso', s?.proceso)}
      ${area('sRie','Riesgos', s?.riesgos)}
    </div>
    <button class="btn-oro" id="sSave">GUARDAR ESTRATEGIA</button>
    <div class="frm-msg" id="sMsg"></div>
  </div>`;
}

function drInversores(id) {
  const os = state.outreach.filter(x => x.opportunity_id === id)
    .sort((a, b) => (a.prioridad ?? 99) - (b.prioridad ?? 99));
  if (!os.length) return vacio('Sin inversores potenciales asociados todavía.');
  return `<div class="table-scroll"><table class="pipe"><thead><tr>
      <th>Inversor</th><th>Tipo</th><th>Ticket</th><th>Estado</th><th>Último contacto</th>
    </tr></thead><tbody>${os.map(o => {
      const i = o.investors ?? {};
      const tk = (i.ticket_min_eur != null || i.ticket_max_eur != null)
        ? `${eur(i.ticket_min_eur) ?? '—'} – ${eur(i.ticket_max_eur) ?? '—'}` : '—';
      return `<tr><td><div class="td-name">${esc(i.nombre ?? '—')}</div>
        ${i.geo ? `<div class="td-code">${esc(i.geo)}</div>` : ''}</td>
        <td><span class="td-vert">${esc(i.tipo ?? '—')}</span></td>
        <td><span class="td-code">${tk}</span></td>
        <td>${canWrite()
          ? `<select class="io-est" data-inv="${esc(o.investor_id)}">${opciones(EST_INV, o.estado)}</select>`
          : `<span class="pill ${o.estado === 'descartado' ? 'pill-DESCARTE' : 'pill-P2'}">${esc(EST_INV[o.estado] ?? o.estado)}</span>`}</td>
        <td><span class="td-code">${esc(o.ultimo_contacto ?? '—')}</span>
          ${canWrite() ? `<button class="btn-mini" style="margin-left:8px" data-del-inv="${esc(o.investor_id)}">QUITAR</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>` + formInversor();
}

function formInversor() {
  if (!canWrite()) return '';
  return `<div class="frm">
    <h4>Añadir inversor potencial</h4>
    <div class="frm-grid">
      ${campo('iNom','Nombre')}
      <div class="fld"><label for="iTip">Tipo</label><select id="iTip">${opciones({
        'family office':'Family office', fondo:'Fondo', industrial:'Industrial',
        patrimonialista:'Patrimonialista', promotor:'Promotor',
        institucional:'Institucional', otro:'Otro' }, 'family office')}</select></div>
      ${campo('iGeo','Geografía','text','placeholder="ES"')}
      ${campo('iMin','Ticket mínimo (€)','number')}
      ${campo('iMax','Ticket máximo (€)','number')}
      <div class="fld"><label for="iEst">Estado</label><select id="iEst">${opciones(EST_INV,'identificado')}</select></div>
      ${campo('iPri','Prioridad','number','value="5"')}
      <div class="fld ancho"><span class="pista">Si el inversor ya existe en el maestro, se reutiliza
        su ficha y sólo se añade el vínculo con este expediente.</span></div>
    </div>
    <button class="btn-oro" id="iAdd">AÑADIR INVERSOR</button>
    <div class="frm-msg" id="iMsg"></div>
  </div>`;
}

const DR_TABS = [
  ['documentos', 'DOCUMENTACIÓN', drDocumentos],
  ['economics',  'ECONOMICS · MANDATO', drEconomics],
  ['estrategia', 'ESTRATEGIA', drEstrategia],
  ['inversores', 'INVERSORES', drInversores]
];

function renderDataroom() {
  const r = state.rows.find(x => x.opportunity_id === state.selected);
  if (!r) { $('drBody').innerHTML = ''; $('drTabs').innerHTML = ''; return; }
  $('drRef').textContent = String(r.nombre).toUpperCase();

  if (state.drError) {
    $('drTabs').innerHTML = '';
    const falta = /schema cache|does not exist|relation/i.test(state.drError);
    $('drBody').innerHTML = `<div class="banner"><b>DATA ROOM NO DISPONIBLE</b><br>${
      falta
        ? 'Sus tablas todavía no existen en la base. Aplica <code>supabase/06_dataroom.sql</code> en el SQL Editor de Supabase y recarga.'
        : esc(state.drError)
    }</div>`;
    return;
  }

  const n = {
    documentos: state.docs.filter(d => d.opportunity_id === r.opportunity_id).length,
    economics:  state.econ.some(e => e.opportunity_id === r.opportunity_id) ? 1 : 0,
    estrategia: state.strat.some(e => e.opportunity_id === r.opportunity_id) ? 1 : 0,
    inversores: state.outreach.filter(o => o.opportunity_id === r.opportunity_id).length
  };

  $('drTabs').innerHTML = DR_TABS.map(([k, label]) =>
    `<button class="tbtn" data-tab="${k}" aria-pressed="${state.drTab === k}">
       ${label}${n[k] ? ` · ${n[k]}` : ''}</button>`).join('');
  for (const b of $('drTabs').querySelectorAll('button')) {
    b.addEventListener('click', () => { state.drTab = b.dataset.tab; renderDataroom(); });
  }

  const fn = (DR_TABS.find(([k]) => k === state.drTab) ?? DR_TABS[0])[2];
  $('drBody').innerHTML = fn(r.opportunity_id);
  if (canWrite()) cablearFormularios(r.opportunity_id);
}

function cablearFormularios(id) {
  const uid = () => sb.auth.getUser().then(r => r.data.user.id);

  $('dAdd')?.addEventListener('click', async (ev) => {
    if (!val('dTit')) { const m = $('dMsg'); m.className = 'frm-msg err'; m.textContent = 'EL TÍTULO ES OBLIGATORIO.'; return; }
    const autor = await uid();
    guardar($('dMsg'), ev.target, () => sb.from('documents').insert({
      opportunity_id: id, titulo: val('dTit'), categoria: val('dCat'),
      estado: val('dEst'), orden: num('dOrd') ?? 99,
      url: val('dUrl') || null, descripcion: val('dDes') || null, anadido_por: autor
    }), 'DOCUMENTO AÑADIDO.');
  });

  for (const b of document.querySelectorAll('[data-del-doc]')) {
    b.addEventListener('click', (ev) => guardar(null, ev.target,
      () => sb.from('documents').delete().eq('id', b.dataset.delDoc)));
  }

  $('eSave')?.addEventListener('click', (ev) => guardar($('eMsg'), ev.target,
    () => sb.from('economics').upsert({
      opportunity_id: id, ev_min_eur: num('eMin'), ev_max_eur: num('eMax'),
      precio_objetivo_eur: num('ePre'), precio_publicado: chk('ePub'),
      retainer_eur: num('eRet'), exito_pct: num('eExP'), exito_min_eur: num('eExM'),
      exclusividad: chk('eExc'), duracion_meses: num('eDur'),
      notas: val('eNot') || null, actualizado_en: new Date().toISOString()
    }), 'ECONOMICS GUARDADO.'));

  $('sSave')?.addEventListener('click', (ev) => guardar($('sMsg'), ev.target,
    () => sb.from('strategy').upsert({
      opportunity_id: id, angulo: val('sAng') || null, comprador_tipo: val('sCom') || null,
      proceso: val('sPro') || null, riesgos: val('sRie') || null,
      actualizado_en: new Date().toISOString()
    }), 'ESTRATEGIA GUARDADA.'));

  $('iAdd')?.addEventListener('click', async (ev) => {
    const msg = $('iMsg');
    if (!val('iNom')) { msg.className = 'frm-msg err'; msg.textContent = 'EL NOMBRE ES OBLIGATORIO.'; return; }
    ev.target.disabled = true; msg.className = 'frm-msg'; msg.textContent = 'GUARDANDO…';
    try {
      // El maestro tiene nombre unico: un inversor ya conocido se reutiliza
      // en vez de duplicarse, y el vinculo con el expediente es lo que se crea.
      const { data: inv, error: e1 } = await sb.from('investors').upsert({
        nombre: val('iNom'), tipo: val('iTip'), geo: val('iGeo') || null,
        ticket_min_eur: num('iMin'), ticket_max_eur: num('iMax')
      }, { onConflict: 'nombre' }).select('id').single();
      if (e1) throw e1;
      const { error: e2 } = await sb.from('investor_outreach').upsert({
        opportunity_id: id, investor_id: inv.id, estado: val('iEst'),
        prioridad: num('iPri'), actualizado_en: new Date().toISOString()
      });
      if (e2) throw e2;
      await loadAll(); renderAll();
      const m = $('iMsg'); if (m) { m.className = 'frm-msg ok'; m.textContent = 'INVERSOR AÑADIDO.'; }
    } catch (err) {
      ev.target.disabled = false;
      msg.className = 'frm-msg err';
      msg.textContent = err?.code === '42501'
        ? 'LA BASE HA RECHAZADO LA ESCRITURA: TU ROL NO PUEDE EDITAR.'
        : 'NO SE PUDO GUARDAR: ' + String(err?.message ?? err).toUpperCase();
    }
  });

  for (const sel of document.querySelectorAll('.io-est')) {
    sel.addEventListener('change', () => guardar(null, null,
      () => sb.from('investor_outreach').update({
        estado: sel.value, actualizado_en: new Date().toISOString()
      }).eq('opportunity_id', id).eq('investor_id', sel.dataset.inv)));
  }
  for (const b of document.querySelectorAll('[data-del-inv]')) {
    b.addEventListener('click', (ev) => guardar(null, ev.target,
      () => sb.from('investor_outreach').delete()
        .eq('opportunity_id', id).eq('investor_id', b.dataset.delInv)));
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

function renderCalibracion() {
  const cuenta = { P1:0, P2:0, P3:0, P4:0, DESCARTE:0, NONE:0 };
  for (const r of state.rows) cuenta[r.banda ?? 'NONE']++;
  const orden = [['P1','var(--b1)'],['P2','var(--b2)'],['P3','var(--b3)'],
                 ['P4','var(--b4)'],['DESCARTE','var(--b5)'],['NONE','rgba(52,65,86,.8)']];
  const max = Math.max(...orden.map(([k]) => cuenta[k])) || 1;

  const conDesenlace = 0;  // outcomes aun vacia
  const dist = orden.map(([k, c]) =>
    `<div class="bandrow"><span class="bl" style="color:${c}">${k === 'NONE' ? 'SIN PUNT.' : k}</span>
     <span class="bt"><span class="bf" style="width:${cuenta[k] / max * 100}%;background:${c}"></span></span>
     <span class="bn">${cuenta[k]} exp.</span></div>`).join('');

  $('calGrid').innerHTML = `
    <div class="card"><h3>Distribución por banda</h3>
      <p class="card-note">Reparto del pipeline actual. Una distribución plana indica rúbricas mal
      ancladas, no un pipeline bueno.</p>${dist}</div>

    <div class="card"><h3>Conversión por banda</h3>
      <p class="card-note">Si P1+P2 no convierten claramente por encima de P3+P4, el score no separa.</p>
      <div class="empty-state">Sin datos. Ningún expediente tiene desenlace registrado
        (<span class="num">${conDesenlace}</span> de <span class="num">${state.rows.length}</span>).<br />
        <b style="color:var(--text);font-style:normal">Esta tarjeta no puede rellenarse desde el análisis:
        exige el desenlace real de operaciones cerradas y abortadas.</b></div></div>

    <div class="card"><h3>Muestra para recalibrar</h3>
      <p class="card-note">Expedientes con desenlace conocido frente al mínimo accionable.</p>
      <div class="gauge-track"><span class="gauge-fill" style="width:${Math.min(100, conDesenlace / 20 * 100)}%"></span></div>
      <div class="gauge-ticks"><span>0 ACTUAL</span><span>10 ORIENTATIVO</span><span>20 ACCIONABLE</span></div>
      <p class="empty-state" style="padding-bottom:0">Por debajo de 10, los resultados son orientativos.
        Incluye siempre los que salieron mal y los que descartaste: un backtest hecho solo con éxitos
        es sesgo de supervivencia.</p></div>

    <div class="card"><h3>Poder discriminante</h3>
      <p class="card-note">Cuánto separa cada dimensión los expedientes que cerraron de los que no.</p>
      <div class="empty-state">Sin datos. Se calcula como la diferencia entre la media de la dimensión
        en cerrados y en no cerrados; una dimensión con discriminación cercana a cero no aporta
        información, por mucho peso que se le haya dado.<br /><br />
        <b style="color:var(--text);font-style:normal">Primer contraste esperado:</b> el manual asigna a
        <i>Acceso al decisor</i> el mayor peso por su correlación empírica con el cierre. Es la primera
        hipótesis que el backtest debe confirmar o refutar.</div></div>`;
}

function renderArquitectura() {
  const puntuados = state.rows.filter(r => r.dealscore != null).length;
  const capas = [
    ['CAPA 1','Doctrina','Manual del Intelligence Officer: epistemología, rúbricas, playbooks, gobernanza. No es código; es lo que el código tiene que respetar.',
      state.rubrics.length ? ['ok', `✓ ${state.rubrics.length} RÚBRICAS EN BASE`] : ['warn','▲ SIN CARGAR']],
    ['CAPA 2','Señal','ZRC Morning Intelligence: barrido de fuentes, 9 mesas, índice de riesgo.',
      state.risk.length ? ['ok', `✓ ${state.risk.length} DÍAS DE SERIE`] : ['warn','▲ SIN CARGAR']],
    ['CAPA 3','Memoria','Postgres/Supabase: expedientes, mandatos, puntuaciones, data room y desenlaces, con RLS.',
      state.rows.length ? ['ok', `✓ ${state.rows.length} EXPEDIENTES`] : ['warn','▲ VACÍA']],
    ['CAPA 4','Mando','Esta superficie. Ya no lee de un fichero estático: consulta v_opportunity_scores, v_pendientes y v_dataroom en vivo.',
      puntuados ? ['ok', `✓ ${puntuados} PUNTUADOS`] : ['warn','▲ NADA PUNTUADO']]
  ];
  $('layers').innerHTML = capas.map(([n, nom, desc, [cls, txt]]) =>
    `<div class="layer"><span class="layer-n">${n}</span><span class="layer-name">${nom}</span>
     <span class="layer-desc">${esc(desc)}</span>
     <span class="flag flag-${cls}">${esc(txt)}</span></div>`).join('');
}

function renderAll() { renderStats(); renderQueue(); renderFilters(); renderPipe(); renderDetail(); renderDataroom(); renderCalibracion(); renderArquitectura(); }

function select(id) { state.selected = id; state.draft = null; renderPipe(); renderDetail(); renderDataroom(); $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

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
    else if (state.drError) banner('<b>DATA ROOM NO DISPONIBLE</b><br>El resto del cuadro de mando funciona. Para activarlo, aplica <code>supabase/06_dataroom.sql</code> en el SQL Editor y recarga.');
    renderAll();
  } catch (err) {
    banner('<b>ERROR AL CARGAR</b><br>' + esc(String(err.message)));
  }
}

boot();
