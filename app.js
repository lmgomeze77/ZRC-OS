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
  docs: [], econ: [], strat: [], outreach: [], mand: [],
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
  const [scores, flags, pend, dims, bands, docs, econ, strat, outreach, mand] = await Promise.all([
    sb.from('v_opportunity_scores').select('*'),
    sb.from('scope_flags').select('*').is('resuelto_en', null),
    sb.from('v_pendientes').select('*'),
    sb.from('scoring_dimensions').select('*').eq('model_id', MODEL_ID).order('orden'),
    sb.from('scoring_bands').select('*').eq('model_id', MODEL_ID).order('minimo', { ascending: false }),
    sb.from('documents').select('*').order('orden'),
    sb.from('v_economics').select('*'),
    sb.from('strategy').select('*'),
    // PostgREST resuelve el inversor por la clave foranea: una consulta, no dos.
    sb.from('investor_outreach').select('*, investors(nombre,tipo,geo,ticket_min_eur,ticket_max_eur)'),
    sb.from('mandates').select('*')
  ]);
  for (const r of [scores, flags, pend, dims, bands, docs, econ, strat, outreach, mand]) if (r.error) throw r.error;
  state.rows  = scores.data ?? [];
  state.flags = flags.data ?? [];
  state.pend  = pend.data ?? [];
  state.dims  = dims.data ?? [];
  state.bands = bands.data ?? [];
  state.docs = docs.data ?? [];
  state.econ = econ.data ?? [];
  state.strat = strat.data ?? [];
  state.outreach = outreach.data ?? [];
  state.mand = mand.data ?? [];
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

function renderAll() { renderStats(); renderQueue(); renderFilters(); renderPipe(); renderDetail(); renderDataroom(); }

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
    renderAll();
  } catch (err) {
    banner('<b>ERROR AL CARGAR</b><br>' + esc(String(err.message)));
  }
}

boot();
