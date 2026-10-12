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

// Ficheros del data room. El cubo es privado: no hay URL permanente, se
// pide una firmada y con caducidad en el momento de abrir.
const CUBO        = 'expedientes';
const MAX_BYTES   = 25 * 1024 * 1024;
const FIRMA_SEGS  = 60;
// Lista blanca. Un data room recibe documentos, no ejecutables ni
// archivos comprimidos cuyo contenido nadie ha mirado.
const EXT_OK = ['pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf',
                'png','jpg','jpeg','webp','heic'];

// VERSION. La portada va con Cache-Control: no-store, asi que el ?v= del
// <script> lo pone siempre el despliegue vivo. Si el fichero que acaba
// ejecutandose no lleva esa misma version, el navegador ha servido una
// copia vieja de su cache: eso, y no un despliegue parado, es lo que hace
// que una actualizacion publicada no se vea. Hay que subir las dos a la
// vez: esta constante y el ?v= de index.html.
const VERSION = '2026-10-12a';
const VERSION_PEDIDA = new URL(import.meta.url).searchParams.get('v');

function sellaVersion() {
  const el = $('sello');
  if (!el) return;
  if (VERSION_PEDIDA && VERSION_PEDIDA !== VERSION) {
    el.className = 'sello-viejo';
    el.innerHTML = `TU NAVEGADOR EJECUTA LA VERSI&Oacute;N ${esc(VERSION)} ·
      EL SERVIDOR SIRVE LA ${esc(VERSION_PEDIDA)} · RECARGA FORZADA`;
  } else {
    el.className = 'sello';
    el.textContent = 'VERSIÓN ' + VERSION;
  }
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const state = {
  rol: null, email: null,
  rows: [], flags: [], pend: [], dims: [], bands: [],
  docs: [], econ: [], strat: [], outreach: [], mand: [], check: [], drError: null,
  ckPrio: '', ckEst: '',
  codAbierto: null, codProp: null, obsGraf: null,
  rubrics: [], gates: [], risk: [], doctError: null,
  outcomes: [], decisions: [], outError: null,
  miembros: [], accesos: [],
  actividad: [], actError: null,
  serie: [], lecturasPub: [], riesgo: null, mesas: [], lecturas: [], pendFirma: [], mercError: null,
  secScore: [], secPipe: [], secDims: [], secRub: [], secSel: '', secError: null,
  altaAbierta: false, altaDup: null, altaCreado: null,
  ingesta: null, ingestaHecha: false,
  drTab: 'documentos', pane: 'detail', docQ: '', docCat: '', ckPlazo: '', hoyTab: '', nombre: null,
  selected: null, fVert: '', fBand: '', fSinCod: false, sortKey: 'score', sortDir: -1,
  draft: null
};
const canWrite = () => state.rol === 'writer' || state.rol === 'admin';

function banner(html) { $('banner').innerHTML = html ? `<div class="banner">${html}</div>` : ''; }

// Un tramo de SQL sin aplicar NO es un error, y pintarlo en rojo decia
// que algo se habia roto cuando lo que pasa es que falta un paso de
// instalacion. Rojo se queda para lo que de verdad ha fallado; esto es
// un recado, y lo parece.
//
// Recibe el error tal cual y decide: si Postgres dice que la relacion no
// existe, es que falta el fichero; cualquier otra cosa si es un fallo.
function avisoModulo(err, titulo, fichero, explica) {
  const falta = /schema cache|does not exist|relation/i.test(err);
  if (!falta) return `<div class="banner"><b>${esc(titulo)}</b><br>${esc(err)}</div>`;
  return `<div class="pendiente">
    <b>PENDIENTE DE APLICAR</b>
    <p>${explica} Aplica <code>supabase/${esc(fichero)}</code> en el SQL Editor de Supabase y recarga.</p>
    <p class="pendiente-pie">El resto del cuadro de mando funciona sin esto.</p>
  </div>`;
}

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

  // DESENLACES: opcional y aparte. Alimenta la calibracion; sin ellos las
  // tarjetas de backtest no tienen nada que decir, y deben decir eso —
  // no dar por hecho que estan vacios, que es lo que hacian antes.
  try {
    const [out, dec] = await Promise.all([
      sb.from('outcomes').select('*'),
      sb.from('decisions').select('*').order('decidido_en', { ascending: false })
    ]);
    const fallo = [out, dec].find(r => r.error);
    if (fallo) throw fallo.error;
    state.outcomes = out.data ?? [];
    state.decisions = dec.data ?? [];
    state.outError = null;
  } catch (err) {
    state.outcomes = []; state.decisions = [];
    state.outError = String(err?.message ?? err);
  }

  // MERCADO · INDICE: opcional, como todo lo que vino despues del
  // esquema base. Las lecturas se piden solo de los ultimos 30 dias: el
  // formulario de barrido solo necesita el dia de hoy, y arrastrar la
  // serie entera de lecturas por mesa no la mira nadie.
  try {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const [ser, est, mes, lec, pf] = await Promise.all([
      sb.from('v_risk_serie').select('*').order('fecha'),
      sb.from('v_risk_estado').select('*').maybeSingle(),
      sb.from('risk_mesas').select('*').order('orden'),
      sb.from('risk_lecturas').select('*').gte('fecha', desde),
      sb.from('v_pendientes_firma').select('*')
    ]);
    const fallo = [ser, est, mes, lec, pf].find(r => r.error);
    if (fallo) throw fallo.error;
    const todo = ser.data ?? [];
    state.serie = todo.filter(r => r.metodo !== 'lectura');
    state.lecturasPub = todo.filter(r => r.metodo === 'lectura');
    state.riesgo = est.data ?? null;
    state.mesas = mes.data ?? [];
    state.lecturas = lec.data ?? [];
    state.pendFirma = pf.data ?? [];
    state.mercError = null;
  } catch (err) {
    state.serie = []; state.lecturasPub = []; state.riesgo = null;
    state.mesas = []; state.lecturas = [];
    state.pendFirma = [];
    state.mercError = String(err?.message ?? err);
  }

  // MERCADO · SECTORIAL: opcional y aparte del indice, para que falte
  // uno sin arrastrar al otro.
  try {
    const [sc, pi, di, ru] = await Promise.all([
      sb.from('v_sector_score').select('*'),
      sb.from('v_sector_pipeline').select('*'),
      sb.from('sector_dimensions').select('*').order('orden'),
      sb.from('sector_rubrics').select('*')
    ]);
    const fallo = [sc, pi, di, ru].find(r => r.error);
    if (fallo) throw fallo.error;
    state.secScore = sc.data ?? [];
    state.secPipe = pi.data ?? [];
    state.secDims = di.data ?? [];
    state.secRub = ru.data ?? [];
    state.secError = null;
  } catch (err) {
    state.secScore = []; state.secPipe = []; state.secDims = []; state.secRub = [];
    state.secError = String(err?.message ?? err);
  }

  // ACTIVIDAD: opcional. Los ultimos 200 movimientos de toda la firma; el
  // panel de cada expediente filtra de ahi. Doscientos porque es un
  // registro para mirar que paso ayer, no un archivo historico: eso vive
  // en la tabla y se consulta desde el SQL Editor.
  try {
    const { data, error } = await sb.from('v_actividad')
      .select('*').order('ocurrido_en', { ascending: false }).limit(200);
    if (error) throw error;
    state.actividad = data ?? [];
    state.actError = null;
  } catch (err) {
    state.actividad = [];
    state.actError = String(err?.message ?? err);
  }

  // DATA ROOM: opcional. Si 06_dataroom.sql no se ha aplicado todavia, sus
  // tablas no existen — y eso no puede dejar en blanco el cuadro de mando
  // entero. Se degrada a una seccion que explica que falta.
  try {
    const [docs, econ, strat, outreach, mand, chk] = await Promise.all([
      sb.from('documents').select('*').order('orden'),
      sb.from('v_economics').select('*'),
      sb.from('strategy').select('*'),
      // PostgREST resuelve el inversor por la clave foranea: una consulta, no dos.
      sb.from('investor_outreach').select('*, investors(nombre,tipo,geo,ticket_min_eur,ticket_max_eur)'),
      sb.from('mandates').select('*'),
      sb.from('checklist_items').select('*').order('orden')
    ]);
    const fallo = [docs, econ, strat, outreach, mand, chk].find(r => r.error);
    if (fallo) throw fallo.error;
    state.docs = docs.data ?? [];
    state.econ = econ.data ?? [];
    state.strat = strat.data ?? [];
    state.outreach = outreach.data ?? [];
    state.mand = mand.data ?? [];
    state.check = chk.data ?? [];
    state.drError = null;
  } catch (err) {
    state.docs = []; state.econ = []; state.strat = []; state.outreach = []; state.mand = []; state.check = [];
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
// `cotejo` es una segunda serie dibujada en fino y a trazos: no es la
// misma medida, asi que no comparte trazo ni puntos, solo los ejes. Es
// lo que deja ver cuanto se separa la lectura de la IA de la formula.
function sparkline(serie, cotejo) {
  const W = 200, H = 42, PT = 6, PB = 6, PL = 2, PR = 6;
  if (serie.length < 2) return '';
  const vals = serie.map(r => r.valor);
  const porFecha = new Map(serie.map((r, i) => [r.fecha, i]));
  const cot = (cotejo ?? []).filter(r => porFecha.has(r.fecha));
  const todos = vals.concat(cot.map(r => r.valor));
  const lo = Math.min(...todos) - 3, hi = Math.max(...todos) + 3;
  const x = i => PL + i * (W - PL - PR) / (serie.length - 1);
  const y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
  const d = serie.map((r, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(r.valor).toFixed(1)).join(' ');
  const area = d + ` L${x(serie.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const dots = serie.map((r, i) => {
    const last = i === serie.length - 1;
    if (r.estado === 'publicado' && !last) return '';
    const cx = x(i).toFixed(1), cy = y(r.valor).toFixed(1);
    if (last) return `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--acento)" stroke="var(--panel)" stroke-width="1.5"></circle>`;
    return `<circle cx="${cx}" cy="${cy}" r="2.4" fill="var(--panel)" stroke="${
      r.estado === 'reconstruido' ? 'var(--faint)' : 'var(--amber)'}" stroke-width="1.2"></circle>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
    aria-label="Índice de mesas, ${serie.length} días, de ${vals[0]} a ${vals[vals.length-1]}"
    preserveAspectRatio="none" style="display:block;max-width:100%">
    <defs><linearGradient id="sparkG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--acento)" stop-opacity=".22"></stop>
      <stop offset="100%" stop-color="var(--acento)" stop-opacity="0"></stop>
    </linearGradient></defs>
    <path d="${area}" fill="url(#sparkG)"></path>
    ${cot.length > 1 ? `<path d="${cot.map((r, i) => (i ? 'L' : 'M')
        + x(porFecha.get(r.fecha)).toFixed(1) + ' ' + y(r.valor).toFixed(1)).join(' ')}"
      fill="none" stroke="var(--faint)" stroke-width="1.1" stroke-dasharray="3 2.5"
      stroke-linejoin="round" opacity=".85"></path>` : ''}
    <path d="${d}" fill="none" stroke="var(--acento)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>
    ${dots}</svg>`;
}

function tarjetaRiesgo() {
  // Prefiere la serie compuesta (historico + mesas) si 17_indice.sql ya
  // esta aplicado; si no, cae a la tabla antigua y sigue funcionando.
  const serie = state.serie.length ? state.serie : state.risk;
  if (!serie.length) return '';
  const ult = serie[serie.length - 1];
  const prev = serie[serie.length - 2];
  const delta = prev ? ult.valor - prev.valor : 0;
  const flecha = delta === 0 ? '→' : (delta > 0 ? '▲' : '▼');
  const dias = Math.round((Date.now() - new Date(ult.fecha).getTime()) / 86400000);
  // El mismo nombre que la tarjeta grande: las dos pintan la serie de
  // MESAS, y llamarla aqui «de riesgo» la confundia con la lectura del
  // briefing, que es el otro numero y no es este.
  return `<div class="stat"><div class="stat-label">Índice de mesas · ZRC</div>
    <div class="stat-value">${ult.valor}<small>${flecha} ${Math.abs(delta)}</small></div>
    <div class="spark-wrap">${sparkline(tramoContinuo(serie).tramo)}</div>
    <div class="spark-legend">
      <span><i style="background:var(--acento)"></i>Publicado</span>
      <span><i style="border:1.2px solid var(--amber)"></i>Degradado</span>
      <span><i style="border:1.2px solid var(--faint)"></i>Reconstruido</span>
    </div>
    <div class="stat-sub">${esc(ult.fecha)}${dias > 2 ? ` · <b style="color:var(--amber)">${dias} días sin actualizar</b>` : ''}</div></div>`;
}

// ── ALTA DE EXPEDIENTE ──────────────────────────────────────────────
// Hasta ahora los 21 expedientes habian entrado por SQL: originar algo
// un lunes exigia abrir el SQL Editor. Para una plataforma de trabajo
// cuyo primer proposito es la originacion, ese era el hueco gordo.

const ESTADOS = {
  originacion: 'Originación', cualificacion: 'Cualificación', mandato: 'Mandato'
};
// §12.3. Se valida aqui ADEMAS de en la base: la restriccion de Postgres
// rechaza con un mensaje de constraint que no le dice nada a nadie.
//
// EL TIPO ADMITE '&'. El mandato de venta real de la firma es
// ZRC-M&A-2026-BF-01, que no valida contra [A-Z]. Este patron tiene que
// ser EL MISMO que el check de opportunities (24_codigo.sql): si el
// navegador es mas estricto que la base, rechaza codigos que la firma
// usa de verdad, y eso es exactamente lo que hacia.
const PATRON_CODIGO = /^ZRC-[A-Z&]{2,4}-[0-9]{4}-[A-Z]{2,4}-[0-9]{2}$/;

// ── ASIGNAR CODIGO A UN EXPEDIENTE QUE NO LO TIENE ──────────────────
// La cola lleva 17 expedientes con el aviso «asignar codigo con el
// patron del manual» y no habia ningun sitio donde asignarlo. Un aviso
// sin control al lado es un reproche.
//
// Se pide por segmentos y no como texto libre: asi el patron no se
// puede incumplir, y no hay que explicarlo.

const SINTILDE = (x) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
// Un filtro por segmento. El '&' solo vale en el tipo; el GEO es una
// plaza o un pais y no lleva ninguno.
const LIMPIA = {
  cTipo: (x) => SINTILDE(x).toUpperCase().replace(/[^A-Z&]/g, ''),
  cGeo:  (x) => SINTILDE(x).toUpperCase().replace(/[^A-Z]/g, ''),
  cAnio: (x) => x.replace(/[^0-9]/g, ''),
  cNN:   (x) => x.replace(/[^0-9]/g, '')
};

// EL TIPO NO SE DEDUCE, Y NO SE INVENTA. 'HTL' no esta en la cadena
// «Inmobiliario hotelero» y 'M&A' no esta en ninguna vertical: los fija
// el manual. Lo unico honrado es copiarlo de otro expediente de la
// misma vertical que ya lo tenga, y si no hay ninguno, dejarlo en
// blanco y decir por que.
function tipoPorPrecedente(vertical) {
  const cuenta = new Map();
  for (const r of state.rows) {
    if (!r.codigo || r.vertical !== vertical) continue;
    const t = r.codigo.split('-')[1];
    if (t) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
}

// MAD, MIA y JRZ: los tres codigos de plaza que ya existen salen de las
// tres primeras letras de la plaza. Sin plaza, el pais ya es un
// segmento valido de dos letras.
const geoPorPlaza = (r) => LIMPIA.cGeo(r.plaza).slice(0, 3) || LIMPIA.cGeo(r.geo).slice(0, 4);

// El primer secuencial libre de ese prefijo, no el siguiente al total:
// con huecos, contar daria uno ya usado.
function siguienteNN(tipo, anio, geo) {
  const pre = `ZRC-${tipo}-${anio}-${geo}-`;
  const usados = new Set(state.rows.map(r => r.codigo)
    .filter(c => c && c.startsWith(pre))
    .map(c => Number(c.slice(pre.length)))
    .filter(x => Number.isInteger(x)));
  let i = 1; while (usados.has(i) && i < 99) i++;
  return String(i).padStart(2, '0');
}

function proponeCodigo(r) {
  const tipo = tipoPorPrecedente(r.vertical);
  const anio = String(new Date().getFullYear());
  const geo  = geoPorPlaza(r);
  return { tipo, anio, geo, nn: tipo && geo ? siguienteNN(tipo, anio, geo) : '01' };
}

function panelCodigo(r) {
  if (r.codigo || !canWrite()) return '';
  if (state.codAbierto !== r.opportunity_id)
    return `<div class="cod-llamada">
      <span>Este expediente no tiene código, así que no puede registrarse formalmente (§12.3).</span>
      <button type="button" class="tbtn-alta" id="codAbrir">ASIGNAR CÓDIGO</button></div>`;

  const p = state.codProp ?? proponeCodigo(r);
  const seg = (id, v, n, ph, lbl) => `<input class="cod-in" id="${id}" value="${esc(v)}"
    maxlength="${n}" style="width:${n + 1.5}ch" placeholder="${ph}" aria-label="${lbl}"
    autocomplete="off" spellcheck="false" />`;
  return `<div class="cod-frm" id="codFrm">
    <div class="cod-seg">
      <span class="cod-fijo">ZRC</span><span class="cod-sep">-</span>
      ${seg('cTipo', p.tipo, 4, 'TIPO', 'Tipo de operación')}<span class="cod-sep">-</span>
      ${seg('cAnio', p.anio, 4, 'AÑO',  'Año')}<span class="cod-sep">-</span>
      ${seg('cGeo',  p.geo,  4, 'GEO',  'Plaza o país')}<span class="cod-sep">-</span>
      ${seg('cNN',   p.nn,   2, 'NN',   'Secuencial')}
    </div>
    <div class="cod-prev" id="codPrev" aria-live="polite"></div>
    <div class="cod-nota">${p.tipo
      ? `El tipo <b>${esc(p.tipo)}</b> está copiado de otro expediente de la misma vertical.`
      : `<b>El tipo no se deduce de la vertical</b> y no lo voy a inventar: no hay ningún
         expediente de esta vertical con código del que copiarlo. Lo fija el manual (§12.3).`}
      El GEO sale de la plaza y el secuencial es el primero libre. Cámbialos si no cuadran.</div>
    <div class="cod-btns">
      <button class="btn-oro" id="codGuardar">ASIGNAR</button>
      ${siguienteSinCodigo(r) ? `<button class="tbtn" id="codSeguir">ASIGNAR Y SEGUIR →</button>` : ''}
      <button type="button" class="linkbtn" id="codCerrar">cancelar</button>
    </div>
    <div class="frm-msg" id="codMsg"></div>
  </div>`;
}

function cablearCodigo(r) {
  $('codAbrir')?.addEventListener('click', () => {
    state.codAbierto = r.opportunity_id;
    state.codProp = proponeCodigo(r);
    renderDetail();
  });
  if (!$('codFrm')) return;

  $('codCerrar')?.addEventListener('click', () => {
    state.codAbierto = null; state.codProp = null; renderDetail();
  });

  const ids = ['cTipo', 'cAnio', 'cGeo', 'cNN'];
  const arma = () => 'ZRC-' + ids.map(i => $(i).value.trim()).join('-');
  const pinta = () => {
    const c = arma();
    const ok  = PATRON_CODIGO.test(c);
    const dup = state.rows.some(x => x.codigo === c);
    const pv = $('codPrev');
    pv.textContent = c;
    pv.className = 'cod-prev' + (ok && !dup ? ' es-ok' : ' es-mal');
    $('codGuardar').disabled = !ok || dup;
    const m = $('codMsg');
    m.className = 'frm-msg' + (dup ? ' err' : '');
    m.textContent = dup ? 'ESE CÓDIGO YA ESTÁ EN USO POR OTRO EXPEDIENTE.' : '';
  };
  for (const i of ids) {
    const el = $(i);
    el.addEventListener('input', () => {
      const pos = el.selectionStart;
      el.value = LIMPIA[i](el.value);
      try { el.setSelectionRange(pos, pos); } catch { /* el campo ya no esta */ }
      pinta();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('codGuardar').disabled) { e.preventDefault(); $('codGuardar').click(); }
    });
  }
  pinta();
  // El foco va donde hay que escribir: al tipo si no se pudo proponer,
  // y al secuencial si todo lo demas ya viene puesto.
  $(state.codProp?.tipo ? 'cNN' : 'cTipo')?.focus();
  $(state.codProp?.tipo ? 'cNN' : 'cTipo')?.select();

  // Asignar los 17 que faltan es una tanda, no un tramite suelto: el
  // boton de seguir encadena con el siguiente sin codigo y deja el
  // formulario abierto, asi que cada uno son dos pulsaciones.
  const asigna = async (ev, seguir) => {
    const codigo = arma();
    if (!PATRON_CODIGO.test(codigo)) return;
    const sig = seguir ? siguienteSinCodigo(r) : null;
    await guardar($('codMsg'), ev.target, () =>
      sb.from('opportunities').update({ codigo }).eq('id', r.opportunity_id),
      'CÓDIGO ASIGNADO.');
    if (!state.rows.find(x => x.opportunity_id === r.opportunity_id)?.codigo) return;
    state.codAbierto = null; state.codProp = null;
    // El siguiente se vuelve a buscar sobre los datos recargados: el que
    // se habia apuntado puede haberlo codificado otro entretanto.
    const vivo = sig && state.rows.find(x => x.opportunity_id === sig && !x.codigo);
    if (vivo) { state.codAbierto = vivo.opportunity_id; state.codProp = proponeCodigo(vivo); select(vivo.opportunity_id); }
    else renderDetail();
  };
  $('codGuardar')?.addEventListener('click', (ev) => asigna(ev, false));
  $('codSeguir')?.addEventListener('click', (ev) => asigna(ev, true));
}

// El siguiente sin codigo en el orden que se esta viendo, dando la
// vuelta. Devuelve null si este es el unico que queda.
function siguienteSinCodigo(r) {
  const vis = visibleRows();
  const i = vis.findIndex(x => x.opportunity_id === r.opportunity_id);
  const orden = i < 0 ? vis : [...vis.slice(i + 1), ...vis.slice(0, i)];
  return orden.find(x => !x.codigo)?.opportunity_id ?? null;
}

function formAlta() {
  if (!state.altaAbierta || !canWrite()) return '';
  // Sugerencias de lo que ya existe, en vez de un campo libre a secas:
  // es lo que evita la quinta grafia de "Inmobiliario".
  const verts = [...new Set(state.rows.map(r => r.vertical).filter(Boolean))].sort();
  const geos  = [...new Set(state.rows.map(r => r.geo).filter(Boolean))].sort();
  const secs  = state.secPipe.filter(x => x.sector !== '(sin clasificar)');
  return `<div class="frm" id="altaFrm">
    <h4>Nuevo expediente</h4>
    <div class="frm-grid">
      ${campo('oNom','Nombre','text','maxlength="200" placeholder="Como se le llama dentro de la firma"')}
      ${campo('oPlaza','Plaza','text','maxlength="120" placeholder="Madrid, Segorbe…"')}
      <div class="fld"><label for="oVert">Vertical</label>
        <input id="oVert" type="text" list="oVerts" maxlength="120" placeholder="Inmobiliario, Agro…" />
        <datalist id="oVerts">${verts.map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist></div>
      <div class="fld"><label for="oGeo">Geografía</label>
        <input id="oGeo" type="text" list="oGeos" maxlength="8" placeholder="ES" />
        <datalist id="oGeos">${geos.map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist></div>
      ${secs.length ? `<div class="fld"><label for="oSec">Sector</label>
        <select id="oSec"><option value="">— deducir de la vertical —</option>${secs.map(x =>
          `<option value="${esc(x.sector)}">${esc(x.nombre)}</option>`).join('')}</select></div>` : ''}
      <div class="fld"><label for="oEst">Estado</label>
        <select id="oEst">${opciones(ESTADOS, 'originacion')}</select></div>
      ${campo('oCod','Código (opcional)','text','maxlength="40" placeholder="ZRC-AGR-2026-ES-01" style="text-transform:uppercase"')}
      <div class="fld ancho alta-aviso"><div class="pista">
        El código sigue el patrón <code>ZRC-[TIPO]-[AÑO]-[GEO]-[NN]</code> del §12.3.
        Déjalo vacío si todavía no toca: el expediente entra igual y aparece en Pendientes
        hasta que lo tenga. Inventarlo para quitarse el aviso es peor que no tenerlo.</div></div>
    </div>
    <button class="btn-oro" id="oGuardar">DAR DE ALTA</button>
    <div class="frm-msg" id="oMsg"></div>
  </div>`;
}

function renderAlta() {
  const b = $('oNuevo');
  if (b) {
    b.hidden = !canWrite();
    b.setAttribute('aria-expanded', String(!!state.altaAbierta));
    b.textContent = state.altaAbierta ? '× CANCELAR' : '+ NUEVO EXPEDIENTE';
  }
  const c = $('frmAlta');
  if (!c) return;
  c.innerHTML = formAlta();
  if (!state.altaAbierta) return;
  $('oNom')?.focus();

  $('oGuardar')?.addEventListener('click', async (ev) => {
    const m = $('oMsg');
    const falla = (t) => { m.className = 'frm-msg err'; m.textContent = t; };
    const nombre = val('oNom'), vertical = val('oVert'), geo = val('oGeo').toUpperCase();
    const codigo = val('oCod').toUpperCase().trim();

    // Las tres validaciones que la base tambien hace, pero diciendolo en
    // castellano antes de gastar una ida y vuelta.
    if (!nombre)   return falla('EL NOMBRE ES OBLIGATORIO.');
    if (!vertical) return falla('LA VERTICAL ES OBLIGATORIA: DETERMINA EL PLAYBOOK.');
    if (!geo)      return falla('LA GEOGRAFÍA ES OBLIGATORIA.');
    if (codigo && !PATRON_CODIGO.test(codigo))
      return falla('EL CÓDIGO NO SIGUE EL PATRÓN ZRC-[TIPO]-[AÑO]-[GEO]-[NN]. DÉJALO VACÍO SI NO LO TIENES.');

    // Con 21 expedientes es facil volver a dar de alta uno que ya esta.
    // Se avisa en vez de crear el duplicado, y confirmando se crea.
    const igual = state.rows.find(r =>
      String(r.nombre).trim().toLowerCase() === nombre.toLowerCase());
    if (igual && state.altaDup !== nombre.toLowerCase()) {
      state.altaDup = nombre.toLowerCase();
      return falla('YA EXISTE UN EXPEDIENTE CON ESE NOMBRE. PULSA OTRA VEZ SI AUN ASÍ QUIERES CREARLO.');
    }
    if (codigo && state.rows.some(r => r.codigo === codigo))
      return falla('ESE CÓDIGO YA ESTÁ EN USO POR OTRO EXPEDIENTE.');

    const uid = (await sb.auth.getUser()).data.user?.id ?? null;
    const fila = {
      nombre, vertical, geo, codigo: codigo || null,
      plaza: val('oPlaza') || null, estado: val('oEst') || 'originacion',
      creado_por: uid
    };
    // sector solo si 18_sectorial.sql esta aplicado y se ha elegido uno.
    const sec = $('oSec')?.value;
    if (sec) fila.sector = sec;

    await guardar(m, ev.target, async () => {
      const { data, error } = await sb.from('opportunities').insert(fila).select('id').single();
      if (!error) state.altaCreado = data?.id ?? null;
      return { error };
    }, 'EXPEDIENTE DADO DE ALTA.');

    // Si salio bien, se cierra el formulario y se abre lo recien creado:
    // dar de alta y ponerse a trabajar son el mismo gesto.
    if (state.altaCreado) {
      const id = state.altaCreado;
      state.altaCreado = null; state.altaAbierta = false; state.altaDup = null;
      renderAlta();
      if (state.rows.some(r => r.opportunity_id === id)) select(id);
    }
  });
}

// ── INGESTA DEL BRIEFING ────────────────────────────────────────────
// El indice no se paro por desidia: ZRC OS copiaba a mano de un fichero
// que dejo de actualizarse, mientras el valor vivo cambiaba cada manana
// a dos metros. Mientras haya que teclearlo, se volvera a parar.
//
// Se lee del repositorio publico del Morning Intelligence. No hace
// falta clave: data.json es publico y lo unico que se trae es lo que
// ya se publica.
const BRIEFING = { duenio: 'lmgomeze77', repo: 'zrc-intelligence', fichero: 'data.json' };
const CRUDO = (ref) => `https://raw.githubusercontent.com/${BRIEFING.duenio}/${BRIEFING.repo}/${ref}/${BRIEFING.fichero}`;
// Como mucho dos semanas hacia atras. Si falta mas, es que el briefing
// estuvo parado y eso no lo arregla una importacion.
const DIAS_ATRAS_MAX = 14;

// El peso de cada senal, tal cual esta en generate-briefing.js
// (SIGNAL_RISK_WEIGHT). Una bajista suma mas riesgo del que resta una
// alcista: es asimetrico a proposito, y copiarlo mal cambiaria la serie.
const PESO_SENAL = { bullish: -1, bearish: 1.2, watch: 0.6, neutral: 0 };

// La formula del briefing aplicada a UNA mesa. Sin su suavizacion de
// +-12 puntos: eso es continuidad de la serie publicada, no lectura de
// una mesa.
function valorDeMesa(items) {
  let num = 0, masa = 0;
  for (const it of items ?? []) {
    const imp = Number(it?.impact) || 0;
    num += (PESO_SENAL[String(it?.signal ?? 'neutral').toLowerCase()] ?? 0) * imp;
    masa += imp;
  }
  if (masa <= 0) return null;
  return { valor: Math.max(5, Math.min(95, Math.round(50 + 35 * (num / masa)))), masa };
}

function leeBriefing(d, conocidas) {
  const fecha = String(d?.generated ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const filas = [], desconocidas = [];
  for (const [clave, cat] of Object.entries(d?.categories ?? {})) {
    const v = valorDeMesa(cat?.items);
    if (!v) continue;
    // Una mesa que el briefing tiene y la base no, NO se inventa: la
    // clave foranea la rechazaria y, sobre todo, habria que decidir si
    // entra en el indice. Se nombra y se deja fuera.
    if (!conocidas.has(clave)) { desconocidas.push(clave); continue; }
    filas.push({ fecha, mesa: clave, valor: v.valor,
      fundamento: `Importado del briefing del ${fecha.slice(8)}/${fecha.slice(5,7)} · masa de impacto ${v.masa}.` });
  }
  const lectura = Number(d?.riskIndex);
  return { fecha, filas, desconocidas,
           lectura: Number.isFinite(lectura) ? Math.round(lectura) : null };
}

// Los dias que faltan, no solo el de hoy: si nadie abrio el cuadro de
// mando en el puente, se recuperan los del puente. Se piden por el
// historial de commits, que es donde vive cada dia pasado.
async function diasPendientes(desde) {
  const url = `https://api.github.com/repos/${BRIEFING.duenio}/${BRIEFING.repo}/commits`
    + `?path=${BRIEFING.fichero}&per_page=40`
    + (desde ? `&since=${encodeURIComponent(desde + 'T00:00:00Z')}` : '');
  const r = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error('GitHub respondió ' + r.status);
  const porDia = new Map();
  for (const c of await r.json()) {
    const f = String(c?.commit?.committer?.date ?? '').slice(0, 10);
    if (f && !porDia.has(f)) porDia.set(f, c.sha);   // el ultimo del dia manda
  }
  return [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-DIAS_ATRAS_MAX);
}

async function importarBriefing() {
  const conocidas = new Set(state.mesas.filter(m => m.activa).map(m => m.clave));
  if (!conocidas.size) throw new Error('No hay mesas activas contra las que importar.');
  const ultimo = state.serie.length ? state.serie[state.serie.length - 1].fecha : null;
  const dias = await diasPendientes(ultimo);
  const yaEstan = new Set(state.serie.map(r => r.fecha));

  const lecturas = [], indices = [];
  const desconocidas = new Set();
  let traidos = 0;
  for (const [fecha, sha] of dias) {
    if (yaEstan.has(fecha)) continue;
    const r = await fetch(CRUDO(sha));
    if (!r.ok) continue;
    const b = leeBriefing(await r.json(), conocidas);
    if (!b || !b.filas.length) continue;
    traidos++;
    lecturas.push(...b.filas);
    b.desconocidas.forEach(k => desconocidas.add(k));
    if (b.lectura != null) indices.push({ fecha: b.fecha, valor: b.lectura, estado: 'publicado' });
  }
  if (!lecturas.length) return { traidos: 0, desconocidas: [...desconocidas] };

  const e1 = (await sb.from('risk_lecturas').upsert(lecturas, { onConflict: 'fecha,mesa' })).error;
  if (e1) throw e1;
  // ignoreDuplicates: un dia ya clasificado a mano como degradado o
  // reconstruido no se pisa con un 'publicado' generico.
  const e2 = (await sb.from('risk_index')
    .upsert(indices, { onConflict: 'fecha', ignoreDuplicates: true })).error;
  if (e2) throw e2;
  return { traidos, dias: lecturas.length, desconocidas: [...desconocidas] };
}

// ── MERCADO ─────────────────────────────────────────────────────────

// El tramo final de la serie SIN cortes. Unir con una recta un hueco de
// 32 dias dibujaria una tendencia que nadie midio, y una grafica que
// miente es peor que no tener grafica.
function tramoContinuo(serie, maxHueco = 3) {
  if (serie.length < 2) return { tramo: serie, corte: null };
  for (let i = serie.length - 1; i > 0; i--) {
    const d = (new Date(serie[i].fecha) - new Date(serie[i - 1].fecha)) / 86400000;
    if (d > maxHueco) {
      return { tramo: serie.slice(i), corte: { dias: Math.round(d), desde: serie[i - 1].fecha } };
    }
  }
  return { tramo: serie, corte: null };
}

const fechaCorta = (f) => { const d = new Date(f + 'T00:00:00');
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'); };

// La ultima lectura de una mesa ANTERIOR a hoy. Es el contexto que
// convierte el barrido en "¿ha cambiado algo?" en vez de "rellena nueve
// cifras desde cero", que es por lo que se dejo de hacer.
function anteriorDe(clave, hoy) {
  return state.lecturas
    .filter(l => l.mesa === clave && l.fecha < hoy)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))[0] ?? null;
}

// ── LA GRAFICA DEL INDICE ───────────────────────────────────────────
// Las bandas son las del propio briefing, tal cual estan escritas en su
// generate-briefing.js: «0-30 benign · 31-50 normal · 51-70 elevated ·
// 71-100 stressed». Sin ellas un 59 es un numero suelto y nadie sabe si
// es mucho; con ellas se lee de un vistazo que estamos en elevado y a
// cuanto queda del siguiente escalon.
const BANDAS = [
  { hi:  30, nombre: 'Benigno',    tinte: 'var(--green)' },
  { hi:  50, nombre: 'Normal',     tinte: 'var(--cyan)'  },
  { hi:  70, nombre: 'Elevado',    tinte: 'var(--amber)' },
  { hi: 100, nombre: 'Tensionado', tinte: 'var(--red)'   }
];
const bandaDe = (v) => BANDAS.find(b => v <= b.hi) ?? BANDAS[BANDAS.length - 1];

const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const dia = (f) => new Date(f + 'T00:00:00');
const etiquetaDia = (f) => { const d = dia(f); return d.getDate() + ' ' + MESES[d.getMonth()]; };

// La escala NO es 0..100: con la serie entre 36 y 78, pintar los cien
// puntos la deja plana y no se ve evolucion ninguna. Se cine a los datos
// con tres puntos de aire; redondear ademas los BORDES a decenas
// regalaba hasta nueve puntos de alto para nada. Las decenas se quedan
// donde importan, que es en las marcas.
function escalaY(vals) {
  const lo = Math.max(0,   Math.min(...vals) - 3);
  const hi = Math.min(100, Math.max(...vals) + 3);
  return hi - lo < 20 ? { lo: Math.max(0, Math.min(lo, hi - 20)), hi: Math.min(100, lo + 20) } : { lo, hi };
}

// Los tramos sin hueco. Antes la serie se RECORTABA por el ultimo hueco
// y se perdian las semanas anteriores; ahora se dibujan todas y el hueco
// se ve como lo que es: un trozo sin linea.
function tramos(serie) {
  const out = []; let act = [];
  for (const r of serie) {
    if (act.length && (dia(r.fecha) - dia(act[act.length - 1].fecha)) / 86400000 > 1) {
      out.push(act); act = [];
    }
    act.push(r);
  }
  if (act.length) out.push(act);
  return out;
}

function dibujaGrafica(cont) {
  const serie = state.serie, cotejo = state.lecturasPub ?? [];
  if (!cont || serie.length < 2) return;
  const W = Math.max(260, Math.round(cont.clientWidth || 600));
  const corto = W < 372;
  const PL = 32, PR = corto ? 12 : 76, PT = 12, PB = 24;
  const H = corto ? 148 : 204;
  const pw = W - PL - PR, ph = H - PT - PB;

  const t0 = dia(serie[0].fecha).getTime();
  const t1 = dia(serie[serie.length - 1].fecha).getTime();
  const cot = cotejo.filter(r => dia(r.fecha).getTime() >= t0 && dia(r.fecha).getTime() <= t1);
  const { lo, hi } = escalaY(serie.map(r => r.valor).concat(cot.map(r => r.valor)));
  const x = (f) => PL + (t1 === t0 ? pw / 2 : (dia(f).getTime() - t0) / (t1 - t0) * pw);
  const y = (v) => PT + (hi - Math.min(hi, Math.max(lo, v))) / (hi - lo) * ph;
  const r1 = (n) => Math.round(n * 10) / 10;
  const linea = (rs) => rs.map((r, i) => (i ? 'L' : 'M') + r1(x(r.fecha)) + ' ' + r1(y(r.valor))).join(' ');

  // ── fondo: una banda por tramo de riesgo que asome en la escala ──
  let fondo = '', cortes = '', nombres = '';
  let desde = lo;
  for (const b of BANDAS) {
    const a = Math.max(lo, desde), z = Math.min(hi, b.hi);
    if (z > a) {
      fondo += `<rect x="${PL}" y="${r1(y(z))}" width="${r1(pw)}" height="${r1(y(a) - y(z))}"
        fill="${b.tinte}" opacity=".055"></rect>`;
      if (!corto) nombres += `<text x="${W - PR + 9}" y="${r1((y(z) + y(a)) / 2)}" class="g-banda"
        dominant-baseline="middle">${b.nombre.toUpperCase()}</text>`;
    }
    if (b.hi > lo && b.hi < hi) cortes += `<line x1="${PL}" x2="${r1(W - PR)}"
      y1="${r1(y(b.hi))}" y2="${r1(y(b.hi))}" class="g-corte"></line>`;
    desde = b.hi;
  }

  // ── rejilla y marcas: decenas, y meses en el eje de tiempo ──
  let rejilla = '', marcasY = '';
  for (let v = Math.ceil(lo / 10) * 10; v <= hi; v += 10) {
    rejilla += `<line x1="${PL}" x2="${r1(W - PR)}"
      y1="${r1(y(v))}" y2="${r1(y(v))}" class="g-rejilla"></line>`;
    marcasY += `<text x="${PL - 7}" y="${r1(y(v))}" class="g-marca" text-anchor="end"
      dominant-baseline="middle">${v}</text>`;
  }
  const hitos = [];
  for (let i = 1; i < serie.length; i++) {
    const d = dia(serie[i].fecha);
    if (d.getMonth() !== dia(serie[i - 1].fecha).getMonth()) hitos.push(serie[i].fecha);
  }
  // Primera, ultima, y los cambios de mes que QUEPAN. En 320 px «1 OCT»
  // y «10 OCT» se montaban una encima de otra; se descarta la de en
  // medio antes que dejar dos rotulos solapados.
  const SEP = 52;
  const primera = serie[0].fecha, ultima = serie[serie.length - 1].fecha;
  const puestas = [primera];
  for (const f of hitos) {
    if (f === primera || f === ultima) continue;
    if (x(f) - x(puestas[puestas.length - 1]) >= SEP && x(ultima) - x(f) >= SEP) puestas.push(f);
  }
  if (ultima !== primera) puestas.push(ultima);
  const marcasX = puestas.map((f, i, a) => {
    const anchor = i === 0 ? 'start' : (i === a.length - 1 ? 'end' : 'middle');
    return `<text x="${r1(x(f))}" y="${H - 7}" class="g-marca" text-anchor="${anchor}">${etiquetaDia(f)}</text>`;
  }).join('');

  const ult = serie[serie.length - 1];
  const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" class="g-svg"
    role="img" tabindex="0" aria-label="Índice de mesas y lectura del briefing, de ${
      etiquetaDia(serie[0].fecha)} a ${etiquetaDia(ult.fecha)}, de ${lo} a ${hi}">
    ${fondo}${rejilla}${cortes}${nombres}${marcasY}${marcasX}
    <line x1="${PL}" x2="${PL}" y1="${PT}" y2="${PT + ph}" class="g-eje"></line>
    <line x1="${PL}" x2="${r1(W - PR)}" y1="${PT + ph}" y2="${PT + ph}" class="g-eje"></line>
    ${tramos(cot).filter(t => t.length > 1).map(t =>
      `<path d="${linea(t)}" class="g-cotejo"></path>`).join('')}
    ${tramos(serie).map(t => t.length > 1
      ? `<path d="${linea(t)}" class="g-mesas"></path>`
      : `<circle cx="${r1(x(t[0].fecha))}" cy="${r1(y(t[0].valor))}" r="2.2" fill="var(--acento)"></circle>`).join('')}
    <circle cx="${r1(x(ult.fecha))}" cy="${r1(y(ult.valor))}" r="4.5" class="g-fin"></circle>
    <g class="g-cruz">
      <line y1="${PT}" y2="${PT + ph}" class="g-cruz-l"></line>
      <circle r="4.5" class="g-cruz-a"></circle><circle r="4" class="g-cruz-b"></circle>
    </g>
    <rect x="${PL}" y="${PT}" width="${r1(pw)}" height="${r1(ph)}" fill="transparent" class="g-caza"></rect>
  </svg>`;
  cont.innerHTML = svg + '<div class="g-lee"></div>';
  cablearCruz(cont, { serie, cot, x, y, PL, pw, W, PR });
}

// El cruce sigue al dedo y se engancha al dia mas cercano: se apunta a
// una fecha, no a una linea de dos pixeles.
//
// Lo que se lee NO va en un globo flotante. El globo tapaba un tercio de
// la grafica justo donde estabas mirando, y en un iPad lo tapa ademas el
// propio dedo. Va en una linea fija debajo, que nace con el ultimo dia
// puesto antes de que nadie toque nada. Y nada de esto es la unica via:
// la tabla de abajo lo tiene todo sin pasar el dedo por encima.
function cablearCruz(cont, g) {
  const svg = cont.querySelector('.g-svg'), lee = cont.querySelector('.g-lee');
  const cruz = cont.querySelector('.g-cruz');
  const porFecha = new Map(g.cot.map(r => [r.fecha, r.valor]));
  let i = g.serie.length - 1;

  const pinta = (idx, conCruz = true) => {
    i = Math.max(0, Math.min(g.serie.length - 1, idx));
    const r = g.serie[i], lec = porFecha.get(r.fecha) ?? null;
    const px = g.x(r.fecha);
    // Por clase y no por .hidden: en SVG esa propiedad no existe, asi
    // que la cruz se quedaba invisible mientras el texto si cambiaba.
    cruz.classList.toggle('es-on', conCruz);
    cruz.querySelector('.g-cruz-l').setAttribute('x1', px);
    cruz.querySelector('.g-cruz-l').setAttribute('x2', px);
    const a = cruz.querySelector('.g-cruz-a');
    a.setAttribute('cx', px); a.setAttribute('cy', g.y(r.valor));
    const b = cruz.querySelector('.g-cruz-b');
    b.setAttribute('cx', px); b.setAttribute('cy', lec == null ? -99 : g.y(lec));
    b.classList.toggle('es-off', lec == null);

    const brecha = lec == null ? null : r.valor - lec;
    lee.innerHTML = `<span class="g-lee-f">${esc(etiquetaDia(r.fecha))}</span>
      <span class="g-lee-r"><i class="k-mesas"></i><b>${r.valor}</b> mesas${
        r.cobertura != null && r.cobertura < 100 ? ` <span>${r.cobertura}%</span>` : ''}</span>
      ${lec == null ? '<span class="g-lee-r g-lee-no">sin lectura del briefing</span>'
        : `<span class="g-lee-r"><i class="k-cotejo"></i><b>${lec}</b> briefing</span>
           <span class="g-lee-b">${brecha > 0 ? '+' : ''}${brecha} de brecha</span>`}
      <span class="g-lee-banda" style="--chip:${bandaDe(r.valor).tinte}">${
        esc(bandaDe(r.valor).nombre.toUpperCase())}</span>`;
  };
  const cerrar = () => pinta(g.serie.length - 1, false);
  const porPunto = (ev) => {
    const caja = svg.getBoundingClientRect();
    const px = (ev.clientX - caja.left) / caja.width * g.W;
    let mejor = 0, dist = Infinity;
    g.serie.forEach((r, k) => { const d = Math.abs(g.x(r.fecha) - px); if (d < dist) { dist = d; mejor = k; } });
    pinta(mejor);
  };
  svg.addEventListener('pointermove', porPunto);
  svg.addEventListener('pointerdown', porPunto);
  svg.addEventListener('pointerleave', cerrar);
  svg.addEventListener('blur', cerrar);
  svg.addEventListener('focus', () => pinta(i));
  pinta(g.serie.length - 1, false);   // la linea nace con el ultimo dia puesto
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft')  { ev.preventDefault(); pinta(i - 1); }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); pinta(i + 1); }
    if (ev.key === 'Escape') { cerrar(); svg.blur(); }
  });
}

// La tabla es el gemelo accesible de la grafica: todo lo que ensena el
// globo esta aqui sin pasar el dedo por encima, y se puede copiar.
function tablaSerie() {
  const cot = new Map((state.lecturasPub ?? []).map(r => [r.fecha, r.valor]));
  const filas = [...state.serie].reverse().map(r => {
    const l = cot.get(r.fecha);
    return `<tr><td>${esc(r.fecha)}</td><td class="num">${r.valor}</td>
      <td class="num">${l ?? '—'}</td>
      <td class="num">${l == null ? '—' : (r.valor - l > 0 ? '+' : '') + (r.valor - l)}</td>
      <td>${esc(bandaDe(r.valor).nombre)}</td>
      <td class="num">${r.cobertura == null ? '—' : r.cobertura + '%'}</td></tr>`;
  }).join('');
  return `<details class="g-tabla"><summary>ver la serie en tabla · ${state.serie.length} días</summary>
    <div class="g-tabla-caja"><table>
      <thead><tr><th>Fecha</th><th class="num">Mesas</th><th class="num">Briefing</th>
        <th class="num">Brecha</th><th>Banda</th><th class="num">Cobertura</th></tr></thead>
      <tbody>${filas}</tbody></table></div></details>`;
}

function bloqueIndice() {
  if (state.mercError) {
    return `<div class="card"><div class="merc-tit">Índice de mesas · ZRC</div>
      ${avisoModulo(state.mercError, 'ÍNDICE DE MESAS NO DISPONIBLE', '17_indice.sql',
        'Hasta que se aplique, el índice sigue siendo un número suelto que nadie puede reproducir ni rellenar a medias.')}</div>`;
  }
  const e = state.riesgo;
  const { corte } = tramoContinuo(state.serie);
  const hoy = new Date().toISOString().slice(0, 10);
  const leidoHoy = new Map(state.lecturas.filter(l => l.fecha === hoy).map(l => [l.mesa, l]));

  const cabecera = !e ? '<div class="vacio">Sin ninguna lectura todavía.</div>' : `
    <div class="merc-num">
      <span class="merc-val">${e.valor}</span>
      <span class="g-chip" data-banda="${esc(bandaDe(e.valor).nombre)}"
        style="--chip:${bandaDe(e.valor).tinte}">${esc(bandaDe(e.valor).nombre.toUpperCase())}</span>
      <span class="merc-delta">${e.delta == null ? '' :
        (e.delta === 0 ? '→ 0' : (e.delta > 0 ? '▲ ' : '▼ ') + Math.abs(e.delta))}
        · ${esc(e.estado)}${e.cobertura != null ? ` · ${e.cobertura}% de cobertura` : ''}</span>
    </div>
    <div class="stat-sub">${esc(e.fecha)} · ${e.dias_serie} días de serie</div>
    ${e.lectura != null ? `<div class="merc-cotejo">
      El briefing publicó <b>${e.lectura}</b> ese día${e.brecha != null
        ? ` · <span class="merc-brecha">${e.brecha > 0 ? '+' : ''}${e.brecha}</span> de brecha` : ''}.
      Lo propone la IA leyendo los titulares, así que no se reproduce desde las mesas.</div>` : ''}
    ${state.serie.length > 1 ? `<div class="g-caja" id="grafIndice"></div>
      <div class="spark-legend">
        <span><i class="i-solido"></i>Índice de mesas</span>
        <span><i class="i-trazo"></i>Lectura del briefing</span>
        <span class="g-leyenda-nota">la escala son las bandas del briefing</span>
      </div>
      ${tablaSerie()}` : ''}
    ${corte ? `<div class="merc-corte">SERIE CORTADA · ${corte.dias} días sin lectura tras el ${esc(corte.desde)}.
       El hueco se ve en la gráfica porque no se midió: la línea no lo cruza.</div>` : ''}
    ${e.caducado ? `<p class="merc-caduco"><b>El índice de mesas está caducado.</b>
       Lleva ${e.dias_sin_actualizar} días sin actualizar, así que describe el riesgo de entonces,
       no el de hoy. El barrido de mesas es lo que lo reactiva.</p>` : ''}`;

  const activas = state.mesas.filter(m => m.activa);
  const ing = state.ingesta;
  const bloqueIngesta = !canWrite() ? '' : `
    <div class="ingesta">
      <div class="ingesta-txt">${
        ing?.estado === 'trayendo' ? 'Trayendo el briefing…'
        : ing?.estado === 'error' ? `<b class="ing-err">No se pudo importar:</b> ${esc(ing.detalle)}`
        : ing?.estado === 'ok' && ing.traidos ? `<b class="ing-ok">Importados ${ing.traidos} día${ing.traidos === 1 ? '' : 's'}</b> del briefing.`
        : ing?.estado === 'ok' ? 'Al día con el briefing.'
        : 'Las mesas se traen del ZRC Morning Intelligence y se recalculan aquí.'}${
        ing?.desconocidas?.length ? ` <span class="ing-aviso">El briefing trae ${
          ing.desconocidas.length} mesa${ing.desconocidas.length === 1 ? '' : 's'} que no está${
          ing.desconocidas.length === 1 ? '' : 'n'} dada${ing.desconocidas.length === 1 ? '' : 's'} de alta (${
          esc(ing.desconocidas.join(', '))}): queda fuera del índice hasta que alguien decida si entra.</span>` : ''}</div>
      <button class="btn-mini" id="ingBtn"${ing?.estado === 'trayendo' ? ' disabled' : ''}>IMPORTAR AHORA</button>
    </div>`;

  const form = !canWrite() || !activas.length ? '' : `
    <div class="frm" id="frmMesas">
      <div class="merc-tit" style="margin-bottom:10px">Barrido de hoy · ${esc(hoy)}</div>
      <p class="pista" style="font-size:11.5px;color:var(--muted);line-height:1.5;margin-bottom:12px">
        No hace falta completar las nueve: con las que leas sale número, marcado como parcial.
        Mirar una mesa y ver que no se ha movido <b>sí es una lectura</b> — para eso está
        «sin cambio». Lo que no vale es no mirarla.</p>
      ${activas.map(m => {
        const l = leidoHoy.get(m.clave);
        const ant = anteriorDe(m.clave, hoy);
        // El deslizador arranca en la ultima lectura si la hay: casi
        // ninguna mesa cambia de un dia para otro, y partir de 50 obliga
        // a reconstruir a mano lo que ya se sabia. Que arranque ahi no
        // la da por leida -- eso sigue exigiendo tocarla.
        const v = l ? l.valor : (ant ? ant.valor : 50);
        return `<div class="mesa-fila" data-mesa="${esc(m.clave)}"${l ? ' data-leida="1"' : ''}>
          <div class="mesa-nom">${esc(m.nombre)}<small>${esc(m.descripcion ?? '')}</small></div>
          <div class="mesa-val${l ? '' : ' sin-leer'}" id="mv-${esc(m.clave)}">${l ? v : '—'}</div>
          <input type="range" min="0" max="100" step="1" value="${v}"
                 aria-label="${esc(m.nombre)}, 0 a 100, más es más riesgo" />
          ${ant ? `<div class="mesa-ant">
            <span class="mesa-ant-txt" title="${esc(ant.fundamento ?? 'sin fundamento anotado')}">
              Última: <b>${ant.valor}</b> el ${esc(fechaCorta(ant.fecha))}${
                ant.fundamento ? ' · ' + esc(ant.fundamento.slice(0, 64)) + (ant.fundamento.length > 64 ? '…' : '') : ''}</span>
            <button type="button" class="btn-mini mesa-igual" data-igual="${esc(m.clave)}"
                    data-valor="${ant.valor}" data-desde="${esc(fechaCorta(ant.fecha))}">SIN CAMBIO</button>
          </div>` : ''}
          <input type="text" placeholder="Fundamento: qué has leído y dónde"
                 value="${esc(l?.fundamento ?? '')}" maxlength="400" />
        </div>`; }).join('')}
      <button class="btn-oro" id="mesasSave">GUARDAR BARRIDO</button>
      <div class="frm-msg" id="mesasMsg"></div>
    </div>`;

  return `<div class="card">
    <div class="merc-tit">Índice de mesas · ZRC</div>
    <div class="merc-dir">0 a 100 · más es MÁS riesgo · derivado de las nueve mesas</div>
    ${cabecera}${bloqueIngesta}${form}${panelMesas()}</div>`;
}

// Le dije al usuario "las mesas son filas, cambialas" -- y solo se
// podian cambiar por SQL. El mismo callejon sin salida que tenia el
// formulario de economics. Aqui se ven y, si puedes escribir, se
// editan.
function panelMesas() {
  if (!state.mesas.length) return '';
  const editable = canWrite();
  const act = state.mesas.filter(m => m.activa).length;
  const fila = (m) => editable ? `
    <tr data-mesaid="${esc(m.clave)}">
      <td class="mesa-clave">${esc(m.clave)}</td>
      <td><input type="text" class="mc-nom" value="${esc(m.nombre)}" maxlength="80" /></td>
      <td><input type="text" class="mc-desc" value="${esc(m.descripcion ?? '')}" maxlength="200"
                 placeholder="Qué mira esta mesa" /></td>
      <td class="num"><input type="number" class="mc-peso" value="${m.peso}" step="0.1" min="0.1" max="9" /></td>
      <td class="num"><input type="checkbox" class="mc-act" ${m.activa ? 'checked' : ''}
            aria-label="${esc(m.nombre)} activa" /></td>
    </tr>` : `
    <tr><td class="mesa-clave">${esc(m.clave)}</td><td>${esc(m.nombre)}</td>
      <td class="mesa-desc">${esc(m.descripcion ?? '')}</td>
      <td class="num">${m.peso}</td><td class="num">${m.activa ? 'sí' : 'no'}</td></tr>`;

  // La clave siguiente, para dar de alta sin pensarla. No se reutiliza
  // ninguna retirada: una clave vieja arrastraria sus lecturas.
  const nums = state.mesas.map(m => parseInt(String(m.clave).replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n));
  const sig = 'M' + ((nums.length ? Math.max(...nums) : 0) + 1);

  return `<details class="mesas-cfg">
    <summary>Las mesas del barrido · ${act} activa${act === 1 ? '' : 's'} de ${state.mesas.length}</summary>
    <p class="pista" style="font-size:11.5px;color:var(--muted);line-height:1.55;margin:10px 0 12px">
      Son datos, no código: cambiar el barrido no exige desplegar nada. El <b>peso</b> es relativo
      — todas a 1 significa que ninguna manda sobre otra, que es lo honesto mientras no se sepa
      cuál anticipa mejor. Desactivar una mesa la saca del índice de hoy pero
      <b>no reescribe el pasado</b>: sus lecturas siguen contando en sus días.
    </p>
    <div class="table-scroll"><table class="sec-tabla mesas-tabla">
      <colgroup><col class="c-clave" /><col /><col /><col class="c-peso" /><col class="c-act" /></colgroup>
      <thead><tr><th>Clave</th><th>Nombre</th><th>Qué mira</th>
        <th class="num">Peso</th><th class="num">Activa</th></tr></thead>
      <tbody>${state.mesas.map(fila).join('')}</tbody>
    </table></div>
    ${editable ? `
      <div class="mesas-alta">
        <input type="text" id="mcNueva" maxlength="80" placeholder="Añadir una mesa: cómo se llama" />
        <button class="btn-mini" id="mcAdd">+ AÑADIR ${esc(sig)}</button>
      </div>
      <button class="btn-oro" id="mcSave">GUARDAR LAS MESAS</button>
      <div class="frm-msg" id="mcMsg"></div>` : ''}
  </details>`;
}

function bloqueSectorial() {
  if (state.secError) {
    return `<div class="card"><div class="merc-tit">Atractivo inversor por sector</div>
      ${avisoModulo(state.secError, 'SECTORIAL NO DISPONIBLE', '18_sectorial.sql',
        'Trae los siete sectores, sus rúbricas ancladas y el cruce con el pipeline.')}</div>`;
  }
  const filas = state.secPipe.map(r => {
    const parcial = r.cobertura != null && r.cobertura < 100;
    return `<tr>
      <td><span class="sec-nom">${esc(r.nombre)}</span>
        ${r.score != null ? `<span class="sec-barra"><i style="width:${r.score}%"></i></span>` : ''}</td>
      <td class="num">${r.score == null
        ? '<span class="sec-sin">SIN LEER</span>'
        : `<span class="sec-score${parcial ? ' es-parcial' : ''}">${r.score}</span>
           <div class="sec-cob${parcial ? ' es-parcial' : ''}">${r.cobertura}%${
             r.caducado ? ' · CADUCADO' : ''}</div>`}</td>
      <td class="num"><span class="sec-exp">${r.expedientes}</span>${
        r.por_defecto > 0 ? `<br><small class="sec-cob">${r.por_defecto} POR VERTICAL</small>` : ''}</td>
    </tr>`; }).join('');

  // Lo que de verdad se viene a mirar aqui: donde hay atractivo sin
  // expedientes, y donde hay expedientes sin lectura.
  const sinLeer = state.secPipe.filter(r => r.score == null && r.expedientes > 0);
  const desatendido = state.secPipe
    .filter(r => r.score != null && r.score >= 70 && r.expedientes === 0);

  return `<div class="card">
    <div class="merc-tit">Atractivo inversor por sector · España</div>
    <div class="merc-dir">0 a 100 · más es MÁS atractivo — al revés que el índice</div>
    <table class="sec-tabla">
      <thead><tr><th>Sector</th><th class="num">Atractivo</th><th class="num">Expedientes</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="3"><span class="sec-sin">SIN SECTORES</span></td></tr>'}</tbody>
    </table>
    ${desatendido.length ? `<p class="merc-caduco" style="border-color:rgba(4,120,87,.3);background:rgba(4,120,87,.05);border-left-color:var(--green)">
      <b>Originación sin hacer.</b> ${esc(desatendido.map(r => r.nombre).join(', '))}
      ${desatendido.length === 1 ? 'puntúa' : 'puntúan'} alto y no ${desatendido.length === 1 ? 'tiene' : 'tienen'}
      ningún expediente.</p>` : ''}
    ${sinLeer.length ? `<p class="act-pie"><b>${sinLeer.reduce((a, r) => a + r.expedientes, 0)} expedientes</b>
      están en sectores sin lectura (${esc(sinLeer.map(r => r.nombre).join(', '))}): de esos no se sabe
      si hay comprador.</p>` : ''}
    ${formSector()}</div>`;
}

function formSector() {
  if (!canWrite() || !state.secDims.length) return '';
  const sectores = state.secPipe.filter(r => r.sector !== '(sin clasificar)');
  const sel = state.secSel || sectores[0]?.sector || '';
  const hoy = new Date().toISOString().slice(0, 10);
  return `<div class="frm" id="frmSector">
    <div class="merc-tit" style="margin-bottom:10px">Puntuar un sector · ${esc(hoy)}</div>
    <div class="fld" style="margin-bottom:14px">
      <label for="secSel">SECTOR</label>
      <select id="secSel">${sectores.map(r =>
        `<option value="${esc(r.sector)}"${r.sector === sel ? ' selected' : ''}>${esc(r.nombre)}</option>`).join('')}</select>
    </div>
    <div class="pista" style="margin-bottom:16px">
      La lectura es de un dia: el score toma solo las dimensiones de la fecha mas
      reciente. Si puntuas cuatro hoy y tres manana, manana el sector se queda con
      la cobertura de esas tres. <b>Haz las siete de una vez.</b>
    </div>
    ${state.secDims.map(d => {
      const anclas = state.secRub.filter(r => r.dimension === d.clave).sort((a, b) => a.tramo - b.tramo);
      // Las cinco anclas A LA VISTA, y se elige pulsando la que describe
      // lo que hay. Antes era un deslizador que ensenaba un ancla cada
      // vez: para comparar las cinco habia que barrerlas de memoria, que
      // es justo lo que una rubrica anclada viene a evitar. Y el
      // deslizador arrancaba en el 2, asi que un sector que de verdad
      // era un 2 no se podia guardar sin moverlo y devolverlo.
      return `<div class="dim-row" data-sdim="${esc(d.clave)}">
        <div class="dim-top">
          <span class="dim-code">${esc(d.clave)}</span>
          <span class="dim-name">${esc(d.nombre)}</span>
          <span class="dim-w">${Math.round(d.peso * 100)}%</span>
          <span class="dim-val es-sin" id="sv-${esc(d.clave)}">SIN LEER</span></div>
        ${d.descripcion ? `<div class="dim-desc">${esc(d.descripcion)}</div>` : ''}
        <div class="anclas" aria-label="${esc(d.clave + ' ' + d.nombre)}, tramo 0 a 4">
          ${anclas.map(a => `<button type="button" class="ancla" aria-pressed="false"
             data-tramo="${a.tramo}"><span class="ancla-n">${a.tramo}</span>
             <span class="ancla-t">${esc(a.texto)}</span></button>`).join('')}
        </div>
        <input type="text" class="s-fund" placeholder="Fundamento: de dónde sale ese tramo"
               maxlength="400" style="width:100%;margin-top:8px;background:var(--panel-2);
               border:1px solid var(--line);border-radius:2px;color:var(--text);
               font-family:var(--body);font-size:12px;padding:7px 9px" />
      </div>`; }).join('')}
    <button class="btn-oro" id="secSave">GUARDAR LECTURA DEL SECTOR</button>
    <div class="frm-msg" id="secMsg"></div>
  </div>`;
}

function renderMercado() {
  const e = state.riesgo;
  $('mercRef').textContent = e
    ? (e.caducado ? `ÍNDICE DE MESAS CADUCADO · ${e.dias_sin_actualizar} DÍAS` : `MESAS AL ${e.fecha}`)
    : 'SIN LECTURAS';
  $('mercIndice').innerHTML = bloqueIndice();
  $('mercSector').innerHTML = bloqueSectorial();
  cablearMercado();
  // La grafica se dibuja DESPUES de pintar, porque necesita saber el
  // ancho real: con un viewBox fijo estirado al contenedor los trazos
  // salen deformados y las marcas, de tamanos distintos segun la
  // pantalla. Un solo observador, que se reengancha en cada pintada.
  const caja = $('grafIndice');
  if (caja) {
    dibujaGrafica(caja);
    state.obsGraf?.disconnect();
    let ancho = caja.clientWidth;
    state.obsGraf = new ResizeObserver(() => {
      if (Math.abs(caja.clientWidth - ancho) < 8) return;
      ancho = caja.clientWidth; dibujaGrafica(caja);
    });
    state.obsGraf.observe(caja);
  }
}

async function lanzarIngesta(manual) {
  state.ingesta = { estado: 'trayendo' };
  renderMercado();
  try {
    const r = await importarBriefing();
    state.ingesta = { estado: 'ok', traidos: r.traidos, desconocidas: r.desconocidas };
    if (r.traidos) { await loadAll(); renderAll(); return; }
  } catch (err) {
    state.ingesta = { estado: 'error', detalle: String(err?.message ?? err) };
  }
  renderMercado();
}

function cablearMercado() {
  $('ingBtn')?.addEventListener('click', () => lanzarIngesta(true));
  // Automatica, una vez por carga, y solo si falta el dia de hoy. Es lo
  // unico que hace que el indice no dependa de que alguien se acuerde.
  // No atribuye nada a nadie: las filas van sin autor y su fundamento
  // dice que vienen del briefing.
  if (canWrite() && !state.ingestaHecha && !state.mercError && state.mesas.some(m => m.activa)) {
    const hoy = new Date().toISOString().slice(0, 10);
    if (!state.serie.some(r => r.fecha === hoy)) {
      state.ingestaHecha = true;
      lanzarIngesta(false);
    }
  }

  // Las mesas: el numero sigue al deslizador en vivo, porque sin eso no
  // se sabe que se esta poniendo.
  for (const f of document.querySelectorAll('.mesa-fila')) {
    const r = f.querySelector('input[type=range]');
    const v = $('mv-' + f.dataset.mesa);
    // Mover el deslizador es lo que convierte la mesa en leida.
    r?.addEventListener('input', () => {
      f.dataset.leida = '1';
      if (v) { v.textContent = r.value; v.classList.remove('sin-leer'); }
    });
    // Confirmar que no se ha movido es una lectura con todas las letras,
    // y deja dicho en el fundamento que se reviso y desde cuando. A
    // proposito NO hay un boton de "todas sin cambio": eso convertiria
    // el barrido en un clic y volveria a llenar la serie de dias que
    // nadie miro, que es de lo que venimos.
    f.querySelector('.mesa-igual')?.addEventListener('click', function () {
      const txt = f.querySelector('input[type=text]');
      r.value = this.dataset.valor;
      if (!txt.value.trim()) txt.value = 'Sin cambio desde el ' + this.dataset.desde + '.';
      f.dataset.leida = '1';
      if (v) { v.textContent = r.value; v.classList.remove('sin-leer'); }
      f.classList.add('es-igual');
    });
    // Escribir el fundamento tambien cuenta: si alguien justifica un 50,
    // ese 50 si es una lectura.
    f.querySelector('input[type=text]')?.addEventListener('input', function () {
      if (this.value.trim()) {
        f.dataset.leida = '1';
        if (v && v.textContent === '—') { v.textContent = r.value; v.classList.remove('sin-leer'); }
      }
    });
  }
  $('mesasSave')?.addEventListener('click', (ev) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const filas = [...document.querySelectorAll('.mesa-fila[data-leida="1"]')].map(f => ({
      fecha: hoy, mesa: f.dataset.mesa,
      valor: Number(f.querySelector('input[type=range]').value),
      fundamento: f.querySelector('input[type=text]').value.trim() || null
    }));
    const m = $('mesasMsg');
    if (!filas.length) {
      m.className = 'frm-msg err';
      m.textContent = 'NO HAS LEÍDO NINGUNA MESA. MUEVE AL MENOS UNA: GUARDAR NUEVE CINCUENTAS SERÍA INVENTAR EL BARRIDO.';
      return;
    }
    guardar(m, ev.target,
      () => sb.from('risk_lecturas').upsert(filas, { onConflict: 'fecha,mesa' }),
      `BARRIDO GUARDADO · ${filas.length} DE ${state.mesas.filter(m => m.activa).length} MESAS.`);
  });

  // Las mesas: se envia solo lo que haya cambiado de verdad, comparando
  // contra lo cargado. Guardar nueve filas iguales cada vez seria
  // ruido, y ademas pisaria un cambio que otro hubiera hecho entretanto.
  $('mcSave')?.addEventListener('click', (ev) => {
    const m = $('mcMsg');
    const filas = [];
    for (const tr of document.querySelectorAll('[data-mesaid]')) {
      const o = state.mesas.find(x => x.clave === tr.dataset.mesaid);
      const n = {
        clave: tr.dataset.mesaid,
        nombre: tr.querySelector('.mc-nom').value.trim(),
        descripcion: tr.querySelector('.mc-desc').value.trim() || null,
        peso: Number(tr.querySelector('.mc-peso').value),
        activa: tr.querySelector('.mc-act').checked,
        orden: o?.orden ?? 99
      };
      if (!n.nombre) { m.className = 'frm-msg err';
        m.textContent = 'UNA MESA SIN NOMBRE NO SE PUEDE BARRER: ' + n.clave; return; }
      if (!(n.peso > 0)) { m.className = 'frm-msg err';
        m.textContent = 'EL PESO TIENE QUE SER MAYOR QUE CERO: ' + n.clave; return; }
      if (!o || o.nombre !== n.nombre || (o.descripcion ?? null) !== n.descripcion
          || Number(o.peso) !== n.peso || o.activa !== n.activa) filas.push(n);
    }
    if (!filas.length) { m.className = 'frm-msg'; m.textContent = 'NADA QUE GUARDAR: NO HAS CAMBIADO NINGUNA.'; return; }
    if (!filas.some(f => f.activa) && !state.mesas.some(x => x.activa && !filas.find(f => f.clave === x.clave))) {
      m.className = 'frm-msg err';
      m.textContent = 'NO PUEDES DEJAR CERO MESAS ACTIVAS: EL ÍNDICE SE QUEDARÍA SIN DE QUÉ SALIR.'; return;
    }
    guardar(m, ev.target, () => sb.from('risk_mesas').upsert(filas, { onConflict: 'clave' }),
      `GUARDADAS · ${filas.length} MESA${filas.length === 1 ? '' : 'S'} CAMBIADA${filas.length === 1 ? '' : 'S'}.`);
  });
  $('mcAdd')?.addEventListener('click', (ev) => {
    const m = $('mcMsg');
    const nombre = $('mcNueva')?.value.trim();
    if (!nombre) { m.className = 'frm-msg err'; m.textContent = 'PONLE NOMBRE A LA MESA NUEVA.'; return; }
    const nums = state.mesas.map(x => parseInt(String(x.clave).replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    const clave = 'M' + ((nums.length ? Math.max(...nums) : 0) + 1);
    const orden = Math.max(0, ...state.mesas.map(x => x.orden ?? 0)) + 1;
    guardar(m, ev.target,
      () => sb.from('risk_mesas').insert({ clave, nombre, orden, peso: 1, activa: true }),
      `MESA ${clave} AÑADIDA.`);
  });

  // El sector: se elige PULSANDO el ancla que describe lo que hay. Nada
  // viene preseleccionado, asi que lo que no se lee no se guarda, y eso
  // se ve: la dimension pone SIN LEER hasta que se toca.
  $('secSel')?.addEventListener('change', (e) => { state.secSel = e.target.value; });
  for (const f of document.querySelectorAll('[data-sdim]')) {
    const cl = f.dataset.sdim;
    for (const b of f.querySelectorAll('.ancla')) {
      b.addEventListener('click', () => {
        f.dataset.leida = '1';
        f.dataset.tramo = b.dataset.tramo;
        for (const o of f.querySelectorAll('.ancla')) {
          const sel = o === b;
          o.classList.toggle('es-sel', sel);
          o.setAttribute('aria-pressed', String(sel));
        }
        const ev = $('sv-' + cl);
        if (ev) { ev.textContent = b.dataset.tramo; ev.classList.remove('es-sin'); }
      });
    }
  }
  $('secSave')?.addEventListener('click', (ev) => {
    const sector = $('secSel')?.value;
    if (!sector) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const filas = [...document.querySelectorAll('[data-sdim][data-leida="1"]')].map(f => ({
      sector, fecha: hoy, dimension: f.dataset.sdim,
      tramo: Number(f.dataset.tramo),
      fundamento: f.querySelector('.s-fund').value.trim() || null
    }));
    const m = $('secMsg');
    if (!filas.length) {
      m.className = 'frm-msg err';
      m.textContent = 'NO HAS PUNTUADO NINGUNA DIMENSIÓN. PULSA EL ANCLA QUE DESCRIBE LO QUE HAY.';
      return;
    }
    guardar(m, ev.target,
      () => sb.from('sector_readings').upsert(filas, { onConflict: 'sector,fecha,dimension' }),
      `SECTOR PUNTUADO · ${filas.length} DE ${state.secDims.length} DIMENSIONES.`);
  });
}

// ── 2 · PENDIENTES ──────────────────────────────────────────────────
const MOTIVO = {
  verificacion_previa: ['Verificación previa', 'Resolver el flag antes de consumir tiempo analítico.'],
  // La banda fija la accion por si sola: no hace falta ningun aviso ni
  // ninguna carencia para que un P1 exija trabajo hoy.
  banda_alta:          ['Banda alta', 'La acción y el plazo los fija la banda.'],
  checklist_critico:   ['Checklist crítico', 'Validar antes de abrir la sala de datos.'],
  sin_codigo:          ['Sin código de expediente', 'Asignar código con el patrón del manual (§12.3).'],
  sin_puntuar:         ['Sin puntuar', 'Puntuar contra las rúbricas ancladas.'],
  checklist_vencido:   ['Checklist vencido', 'Pasó la fecha comprometida y el punto sigue abierto.'],
  // Los dos que no cuelgan de ningun expediente, sino de la firma.
  indice_caducado:     ['Índice de riesgo parado', 'Barrer las mesas. Sin eso el índice describe otro mes.'],
  mesas_sin_fundamento:['Lecturas sin fundamento', 'Anotar de dónde sale cada cifra, o no es una lectura.']
};

// El reloj, en una sola pieza: lo usan la cola y el checklist y tienen
// que decir lo mismo. Devuelve null cuando no hay fecha, porque no
// tenerla no es estar a tiempo.
function reloj(fecha) {
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const d = new Date(fecha + 'T00:00:00');
  const dias = Math.round((d - hoy) / 86400000);
  if (dias < 0)  return { clase:'vencido', texto:`VENCIDO · ${-dias} d`, dias };
  if (dias === 0) return { clase:'hoy',     texto:'VENCE HOY', dias };
  if (dias <= 7)  return { clase:'pronto',  texto:`${dias} d`, dias };
  return { clase:'holgado', texto:`${dias} d`, dias };
}
const pastillaReloj = (f) => {
  const r = reloj(f);
  return r ? `<span class="reloj r-${r.clase}">${esc(r.texto)}</span>` : '';
};

// ── HOY ─────────────────────────────────────────────────────────────
// La cola de Pendientes responde "que es lo siguiente para la firma",
// por la jerarquia del SOP-08. Esto responde otra pregunta distinta:
// "que me toca a mi, hoy". Mismos datos, otra lente. No duplica la
// fuente: los puntos de checklist salen de state.check y de la cola
// solo lo que no es checklist, para que nada aparezca dos veces.
function trabajoDeHoy() {
  const nombreDe = (oid) => state.rows.find(r => r.opportunity_id === oid)?.nombre ?? '—';
  const yo = (state.nombre ?? '').trim().toLowerCase();

  const deLaCola = state.pend
    .filter(it => it.motivo !== 'checklist_vencido' && it.vence_en)
    .map(it => ({ oid: it.opportunity_id, expediente: it.nombre,
                  que: it.detalle ?? (MOTIVO[it.motivo]?.[0] ?? it.motivo),
                  etiqueta: MOTIVO[it.motivo]?.[0] ?? it.motivo,
                  vence: it.vence_en, mio: false }));

  const delChecklist = state.check
    .filter(c => c.estado !== 'validado')
    .map(c => ({ oid: c.opportunity_id, expediente: nombreDe(c.opportunity_id),
                 que: `${c.area} · ${c.descripcion}`, etiqueta: 'Checklist',
                 vence: c.vence_en,
                 mio: !!(yo && (c.responsable ?? '').trim().toLowerCase() === yo) }))
    .filter(c => c.vence || c.mio);

  return [...deLaCola, ...delChecklist];
}

function renderHoy() {
  const caja = $('hoy'); if (!caja) return;
  const todo = trabajoDeHoy();
  const esVencido = (t) => (reloj(t.vence)?.dias ?? 9e3) < 0;
  const esSemana  = (t) => { const d = reloj(t.vence)?.dias; return d != null && d >= 0 && d <= 7; };

  const grupos = {
    vencido: todo.filter(esVencido),
    semana:  todo.filter(esSemana),
    mio:     todo.filter(t => t.mio)
  };
  // Se abre por lo que arde: si no hay vencido, por lo de esta semana.
  if (!state.hoyTab) state.hoyTab = grupos.vencido.length ? 'vencido'
    : grupos.semana.length ? 'semana' : 'mio';

  const chip = (k, t) => `<button type="button" class="tbtn" data-hoy="${k}"
    aria-pressed="${state.hoyTab === k}">${t} · ${grupos[k].length}</button>`;

  const lista = [...grupos[state.hoyTab]]
    .sort((a,b) => (reloj(a.vence)?.dias ?? 9e3) - (reloj(b.vence)?.dias ?? 9e3));

  $('hoyRef').textContent = grupos.vencido.length
    ? `${grupos.vencido.length} VENCIDO${grupos.vencido.length === 1 ? '' : 'S'}`
    : 'AL DÍA';
  $('hoyRef').className = 'sec-ref' + (grupos.vencido.length ? ' es-vencido' : '');

  caja.innerHTML = `<div class="hoy-tabs">
      ${chip('vencido','Vencido')}${chip('semana','Esta semana')}${chip('mio','A mi nombre')}
    </div>` + (lista.length
    ? `<div class="hoy-lista">${lista.map(t => `
        <div class="hoy-fila" data-goto="${esc(t.oid)}" role="button" tabindex="0">
          <span class="hoy-exp">${esc(t.expediente)}</span>
          <span class="hoy-que">${esc(t.que)}</span>
          <span class="hoy-eti">${esc(t.etiqueta)}</span>
          ${t.mio ? '<span class="hoy-mio">MÍO</span>' : ''}
          ${pastillaReloj(t.vence) || '<span class="td-code">sin fecha</span>'}
        </div>`).join('')}</div>`
    : `<div class="empty-state">${
        state.hoyTab === 'mio'
          ? (state.nombre
             ? `Nada a nombre de <b style="color:var(--text)">${esc(state.nombre)}</b>. El responsable se pone en la respuesta de cada punto del checklist.`
             : 'Tu cuenta no tiene nombre en app_members, así que no se puede saber qué es tuyo.')
          : 'Nada en este tramo.'}</div>`);

  for (const b of caja.querySelectorAll('[data-hoy]'))
    b.addEventListener('click', () => { state.hoyTab = b.dataset.hoy; renderHoy(); });
  for (const f of caja.querySelectorAll('[data-goto]')) {
    const ir = () => select(f.dataset.goto);
    f.addEventListener('click', ir);
    f.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } });
  }
}

function renderQueue() {
  // Dentro de la misma prioridad manda el reloj: lo vencido primero, y
  // lo que no tiene fecha al final de su grupo.
  // Lo de la firma entra en la misma cola que lo de los expedientes. Un
  // indice parado un mes no es menos trabajo por no colgar de ningun
  // expediente: en una cola aparte no lo miraria nadie.
  const items = [...state.pend, ...state.pendFirma].sort((a, b) =>
    a.prioridad - b.prioridad ||
    ((reloj(a.vence_en)?.dias ?? 9e3) - (reloj(b.vence_en)?.dias ?? 9e3))).slice(0, 8);
  if (!items.length) { $('queue').innerHTML = '<div class="q-item"><div class="q-rank">—</div><div><div class="q-why">Nada pendiente.</div></div></div>'; return; }
  $('queue').innerHTML = items.map((it, i) => {
    const [titulo, accion] = MOTIVO[it.motivo] ?? [it.motivo, ''];
    const stop = it.motivo === 'verificacion_previa';
    const banda = it.motivo === 'banda_alta'
      ? (state.rows.find(r => r.opportunity_id === it.opportunity_id)?.banda ?? null) : null;
    const lado = banda
      ? `<span class="pill pill-${esc(banda)}">${esc(banda)}</span>`
      : `<span class="flag ${stop ? 'flag-stop' : 'flag-warn'}">${stop ? '⛔' : '▲'} ${esc(titulo)}</span>`;
    // Lo de la firma no tiene expediente: en vez de un salto a ninguna
    // parte, lleva al bloque de Mercado, que es donde se arregla.
    const deFirma = !it.opportunity_id;
    return `<div class="q-item"${deFirma ? ' data-ira="mercado"' : ` data-goto="${esc(it.opportunity_id)}"`}
      role="button" tabindex="0" style="cursor:pointer">
      <div class="q-rank">${String(i+1).padStart(2,'0')}</div>
      <div><div class="q-title">${esc(it.nombre ?? 'La firma')}</div>
      <div class="q-why">${esc(it.detalle ?? titulo)}</div>
      <div class="q-act"><b>ACCIÓN</b> · ${esc(accion)}</div></div>
      <div class="q-side">${lado}${pastillaReloj(it.vence_en)}</div>
    </div>`;
  }).join('');
}

// ── 3 · PIPELINE ────────────────────────────────────────────────────
function visibleRows() {
  return state.rows.filter(r => {
    if (state.fVert && r.vertical !== state.fVert) return false;
    if (state.fSinCod && r.codigo) return false;
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
      <div class="td-code">${r.codigo ? esc(r.codigo)
        : (canWrite()
           ? `<button type="button" class="td-cod-btn" data-cod="${esc(r.opportunity_id)}">+ asignar código</button>`
           : '— sin código —')}${r.plaza ? ' · ' + esc(r.plaza) : ''}</div></td>
      <td><span class="td-vert">${esc(r.vertical)}</span></td>
      <td><div class="score-cell">${score}</div></td>
      <td><span class="pill pill-${esc(r.banda ?? 'NONE')}">${esc(r.banda ?? 'NONE')}</span>
        ${r.reservado ? '<span class="pill pill-RESERVADO" style="margin-left:6px">⛔ RESERVADO</span>' : ''}</td>
      <td>${scope}</td></tr>`;
  }).join('');
  // Asignar los 17 que faltan entrando y saliendo de la ficha son 34
  // navegaciones. Desde la tabla es un clic y dos pulsaciones.
  for (const b of $('pipeBody').querySelectorAll('[data-cod]'))
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      state.codAbierto = b.dataset.cod;
      state.codProp = proponeCodigo(state.rows.find(r => r.opportunity_id === b.dataset.cod));
      select(b.dataset.cod);
    });
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

// ── DECISION Y DESENLACE ────────────────────────────────────────────
// Las dos entidades de memoria del manual (Parte 12.2) que hasta ahora
// solo se podian escribir abriendo el SQL Editor. El §12.3 pide registrar
// los descartes con su motivo: si eso exige salir de la aplicacion, no se
// hace. Por eso 'motivo' es obligatorio aqui, igual que en el esquema.
const DEC_TIPO  = { 'go':'GO', 'no-go':'NO-GO', 'excepcion':'EXCEPCIÓN', 'aplazada':'APLAZADA' };
const DEC_CLASE = { 'go':'go', 'no-go':'nogo', 'excepcion':'excepcion', 'aplazada':'aplazada' };
const RESULTADO = { 'cerrado':'CERRADO', 'abortado':'ABORTADO',
                    'perdido':'PERDIDO', 'descartado':'DESCARTADO' };
const soloFecha = (t) => t ? String(t).slice(0, 10) : '';
const opts = (mapa, sel) => Object.entries(mapa)
  .map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

function panelDecision(r) {
  const id = r.opportunity_id;
  if (state.outError) {
    return `<div class="decision"><h4>⚖ Decisión y desenlace</h4>
      <div class="pista">No se han podido leer las decisiones ni los desenlaces:
      <code>${esc(state.outError)}</code></div></div>`;
  }

  const decs = state.decisions.filter(d => d.opportunity_id === id);
  const out  = state.outcomes.find(o => o.opportunity_id === id);
  const quien = (uid) => state.miembros.find(m => m.user_id === uid)?.nombre ?? null;

  const historial = decs.length
    ? `<div class="dec-lista">${decs.map(d => `
        <div class="dec-fila">
          <div class="dec-top">
            <span class="dec-tipo ${esc(DEC_CLASE[d.tipo] ?? '')}">${esc(DEC_TIPO[d.tipo] ?? d.tipo)}</span>
            <span class="dec-cuando">${esc(soloFecha(d.decidido_en))}</span></div>
          <div>${esc(d.motivo)}</div>
          ${quien(d.decidido_por) ? `<div class="dec-quien">${esc(quien(d.decidido_por))}</div>` : ''}
        </div>`).join('')}</div>`
    : '<div class="pista">Ninguna decisión registrada todavía.</div>';

  const desenlace = out
    ? `<div class="dec-lista"><div class="dec-fila">
         <div class="dec-top">
           <span class="dec-tipo ${out.resultado === 'cerrado' ? 'go' : 'nogo'}">${esc(RESULTADO[out.resultado] ?? out.resultado)}</span>
           <span class="dec-cuando">${esc(soloFecha(out.fecha))}</span></div>
         ${out.honorarios_eur != null ? `<div>Honorarios: <b>${esc(eur(out.honorarios_eur))}</b></div>` : ''}
         ${out.motivo ? `<div>${esc(out.motivo)}</div>` : ''}
         ${quien(out.registrado_por) ? `<div class="dec-quien">${esc(quien(out.registrado_por))}</div>` : ''}
       </div></div>`
    : `<div class="pista">Sin desenlace. Mientras no lo tenga, este expediente no cuenta
       para la calibración: sin tasa base, el DEALSCORE es una opinión ordenada.</div>`;

  const hoy = new Date().toISOString().slice(0, 10);

  if (!canWrite()) {
    return `<div class="decision"><h4>⚖ Decisiones</h4>${historial}</div>
      <div class="decision"><h4>◈ Desenlace</h4>${desenlace}</div>`;
  }

  return `<div class="decision">
    <h4>⚖ Decisiones</h4>${historial}
    <div class="frm-grid" style="margin-top:12px">
      <div class="fld ancho"><label for="decTipo">Nueva decisión</label>
        <select id="decTipo">${opts(DEC_TIPO)}</select></div>
      <div class="fld ancho"><label for="decMotivo">Motivo · obligatorio</label>
        <textarea id="decMotivo" placeholder="Por qué se decide esto, con la información que hay hoy."></textarea></div>
      <div class="fld ancho"><button class="btn-oro" id="decGuardar">REGISTRAR DECISIÓN</button></div>
    </div>
    <div class="pista">Las decisiones no se sobrescriben: se acumulan. Saber por qué se dijo
      que no vale tanto como saber por qué se dijo que sí (§12.3).</div>
    <div class="frm-msg" id="decMsg"></div>
  </div>

  <div class="decision">
    <h4>◈ Desenlace</h4>${desenlace}
    <div class="frm-grid" style="margin-top:12px">
      <div class="fld ancho"><label for="outRes">Resultado</label>
        <select id="outRes">${opts(RESULTADO, out?.resultado)}</select></div>
      <div class="fld"><label for="outFecha">Fecha</label>
        <input id="outFecha" type="date" value="${esc(soloFecha(out?.fecha) || hoy)}" /></div>
      <div class="fld"><label for="outHon">Honorarios (€)</label>
        <input id="outHon" type="number" step="1000" value="${out?.honorarios_eur ?? ''}" /></div>
      <div class="fld ancho"><label for="outMotivo">Motivo</label>
        <textarea id="outMotivo" placeholder="Qué ocurrió realmente.">${esc(out?.motivo ?? '')}</textarea></div>
      <div class="fld ancho"><button class="btn-oro" id="outGuardar">${out ? 'ACTUALIZAR DESENLACE' : 'REGISTRAR DESENLACE'}</button></div>
    </div>
    <div class="pista">Registrar el desenlace cierra el expediente: pasa a
      <b>cerrado</b> o <b>archivado</b> segun el resultado, y sale de la cola de pendientes.
      Su banda sigue diciendo lo que dice la puntuación; el desenlace dice lo que pasó.</div>
    <div class="frm-msg" id="outMsg"></div>
  </div>`;
}

function cablearDecision(r) {
  const id = r.opportunity_id;

  $('decGuardar')?.addEventListener('click', async (ev) => {
    const motivo = val('decMotivo');
    if (!motivo) {
      const m = $('decMsg');
      m.className = 'frm-msg err';
      m.textContent = 'EL MOTIVO ES OBLIGATORIO: UNA DECISIÓN SIN MOTIVO NO ES MEMORIA.';
      return;
    }
    const uid = (await sb.auth.getUser()).data.user?.id ?? null;
    guardar($('decMsg'), ev.target, () => sb.from('decisions').insert({
      opportunity_id: id, tipo: val('decTipo'), motivo, decidido_por: uid
    }), 'DECISIÓN REGISTRADA.');
  });

  $('outGuardar')?.addEventListener('click', async (ev) => {
    const resultado = val('outRes');
    const uid = (await sb.auth.getUser()).data.user?.id ?? null;
    // El estado del expediente es consecuencia del desenlace, no un campo
    // aparte que haya que acordarse de tocar. Si se escribiera solo desde
    // aqui, un desenlace metido por SQL dejaria el estado sin actualizar.
    guardar($('outMsg'), ev.target, async () => {
      const { error } = await sb.from('outcomes').upsert({
        opportunity_id: id, resultado, fecha: val('outFecha'),
        honorarios_eur: num('outHon'), motivo: val('outMotivo') || null,
        registrado_por: uid
      }, { onConflict: 'opportunity_id' });
      if (error) return { error };
      return sb.from('opportunities')
        .update({ estado: resultado === 'cerrado' ? 'cerrado' : 'archivado' })
        .eq('id', id);
    }, 'DESENLACE REGISTRADO.');
  });
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
    ? `<button id="saveScore" class="btn-oro" style="margin-top:16px;width:100%"
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
    ${panelCodigo(r)}
    <div class="detail-cols">
      <div>${dimHtml}</div>
      <div>${goNoGo(r, vals, sc)}${scopeHtml}${action}</div>
    </div>
    <div class="detail-gov">${panelReserva(r)}${panelDecision(r)}</div>`;

  cablearCodigo(r);
  if (!canWrite()) { cablearReserva(r); cablearDecision(r); }
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
  cablearDecision(r);
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

// El nombre viaja a una ruta de almacenamiento: fuera acentos, espacios y
// cualquier cosa que no sea segura en una URL.
const nombreSeguro = (n) => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'fichero';
const extDe = (n) => (n.split('.').pop() ?? '').toLowerCase();
const pesa = (b) => b == null ? '' : b < 1024 * 1024
  ? `${Math.max(1, Math.round(b / 1024))} kB`
  : `${(b / 1024 / 1024).toFixed(1)} MB`;

// Compartido por el formulario de alta y por el boton de adjuntar: las
// dos comprobaciones van ANTES de tocar la red, para no subir 26 MB y
// rechazarlos despues.
function pegaAlFichero(f) {
  if (f.size > MAX_BYTES) return `EL FICHERO PESA ${pesa(f.size).toUpperCase()}. EL TOPE SON 25 MB.`;
  if (!EXT_OK.includes(extDe(f.name)))
    return `TIPO NO ADMITIDO (.${extDe(f.name).toUpperCase()}). SE ADMITEN: ${EXT_OK.join(', ').toUpperCase()}.`;
  return null;
}

// La ruta empieza por el id del expediente: es lo que miran las politicas
// del cubo para heredar la reserva (app_ve_ruta).
async function subirAlCubo(opportunityId, fichero) {
  const ruta = `${opportunityId}/${Date.now()}-${nombreSeguro(fichero.name)}`;
  const { error } = await sb.storage.from(CUBO)
    .upload(ruta, fichero, { contentType: fichero.type || undefined, upsert: false });
  return { ruta, error };
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

// Las fichas gastaban una pantalla entera en tres documentos, cada una
// con un boton de oro a todo lo ancho: el acento de la firma puesto a
// decir "abrir". Un data room se consulta, no se hojea, asi que va en
// tabla densa, con buscador y el abrir como enlace discreto.
const DOC_EST = { disponible:'Disponible', pendiente:'Pendiente', solicitado:'Solicitado' };

function fuenteDe(d) {
  if (d.storage_path) return { clase: 'fichero', texto: 'FICHERO',
    detalle: `${d.nombre_fichero ?? ''}${d.bytes ? ' · ' + pesa(d.bytes) : ''}` };
  if (d.url) return { clase: 'enlace', texto: 'ENLACE', detalle: 'externo' };
  return { clase: 'hueco', texto: 'SIN FUENTE', detalle: 'hueco declarado' };
}

function drDocumentos(id) {
  const ds = state.docs.filter(d => d.opportunity_id === id);
  if (!ds.length && !canWrite()) return vacio('Sin documentación cargada para este expediente.');

  const q = (state.docQ ?? '').toLowerCase();
  const vis = ds.filter(d =>
    (!state.docCat || d.categoria === state.docCat) &&
    (!q || `${d.titulo} ${d.descripcion ?? ''} ${d.nombre_fichero ?? ''}`.toLowerCase().includes(q)));

  const cats = [...new Set(ds.map(d => d.categoria))].sort();
  const conFuente = ds.filter(d => d.storage_path || d.url).length;

  const cab = `<div class="ck-cab">
    <input id="docQ" type="search" placeholder="Buscar documento…" value="${esc(state.docQ ?? '')}" />
    <select id="docCat"><option value="">TODAS LAS CATEGORÍAS</option>${
      cats.map(c => `<option value="${esc(c)}"${c === state.docCat ? ' selected' : ''}>${
        esc((CATS[c] ?? c).toUpperCase())}</option>`).join('')}</select>
    <span class="toolbar-count">${vis.length} DE ${ds.length} · ${conFuente} CON FUENTE</span>
  </div>`;

  const filas = vis.map(d => {
    const f = fuenteDe(d);
    const abrir = d.storage_path
      ? `<button class="doc-abrir" data-abrir="${esc(d.storage_path)}">ABRIR</button>`
      : d.url ? `<a class="doc-abrir" href="${esc(d.url)}" target="_blank" rel="noopener">ABRIR</a>`
      : canWrite() ? `<label class="doc-adj">
          <input type="file" data-adj="${esc(d.id)}" accept=".${EXT_OK.join(',.')}" />ADJUNTAR</label>` : '';
    return `<tr>
      <td><div class="td-name">${esc(d.titulo)}</div>
        ${d.descripcion ? `<div class="td-code">${esc(d.descripcion)}</div>` : ''}
        <div class="frm-msg" id="adj-${esc(d.id)}"></div></td>
      <td><span class="td-code">${esc(CATS[d.categoria] ?? d.categoria)}</span></td>
      <td><span class="doc-fuente f-${f.clase}">${f.texto}</span>
        <div class="doc-meta">${esc(f.detalle)}</div></td>
      <td><span class="td-code e-${esc(d.estado)}">${esc(DOC_EST[d.estado] ?? d.estado)}</span></td>
      <td class="doc-acc">${abrir}${canWrite()
        ? `<button class="btn-mini" data-del-doc="${esc(d.id)}"${
            d.storage_path ? ` data-ruta="${esc(d.storage_path)}"` : ''}>ELIMINAR</button>` : ''}</td>
    </tr>`;
  }).join('');

  const tabla = vis.length
    ? `<div class="table-scroll"><table class="pipe"><thead><tr>
        <th>Documento</th><th>Categoría</th><th>Fuente</th><th>Estado</th><th></th>
      </tr></thead><tbody>${filas}</tbody></table></div>`
    : vacio(ds.length ? 'Ningún documento coincide con el filtro.'
                      : 'Sin documentación cargada para este expediente.');

  return cab + tabla + formDocumento();
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
      <div class="fld ancho"><label for="dFile">Fichero</label>
        <input id="dFile" type="file" accept=".${EXT_OK.join(',.')}" />
        <span class="pista">Sube el documento al cubo privado del expediente. Máximo 25 MB.
          Admitidos: ${EXT_OK.join(', ').toUpperCase()}.</span></div>
      <div class="fld ancho"><label for="dUrl">…o enlace externo</label><input id="dUrl" type="text"
        placeholder="https://drive.google.com/…" />
        <span class="pista">Un documento es fichero <b>o</b> enlace, nunca las dos cosas: si lo fuera,
          no habría forma de saber cuál es el bueno. Deja los dos vacíos si el documento aún no
          existe y quieres registrarlo como hueco declarado.</span></div>
      <div class="fld ancho"><label for="dDes">Descripción</label><textarea id="dDes"></textarea></div>
    </div>
    <button class="btn-oro" id="dAdd">AÑADIR DOCUMENTO</button>
    <div class="frm-msg" id="dMsg"></div>
  </div>`;
}

function drEconomics(id) {
  const e = state.econ.find(x => x.opportunity_id === id);
  const m = state.mand.filter(x => x.opportunity_id === id && x.estado === 'vivo')[0];
  if (!e && !m) return vacio('Sin economics ni mandato registrados todavía.')
                      + formEconomics(id, null);
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
    <h4>${e ? 'Editar' : 'Registrar'} economics</h4>
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
  if (!os.length) return vacio('Sin inversores potenciales asociados todavía.')
                       + formInversor();
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

const CK_EST = { pendiente:'Pendiente', solicitado:'Solicitado', recibido:'Recibido', validado:'Validado' };
const CK_PRIO = { critica:'Crítica', alta:'Alta', media:'Media' };
const CK_ORIG = { informe_valoracion:'Informe valoración', cuaderno:'Cuaderno',
                  valoracion:'Valoración', dd_recomendada:'DD recomendada' };

// El documento que cierra el punto, abrible desde aqui. Si la columna
// todavia no existe en la base, c.document_id llega undefined y esto no
// pinta nada: la pantalla no se cae por una migracion sin aplicar.
function docDelPunto(c) {
  if (!c.document_id) return '';
  const d = state.docs.find(x => x.id === c.document_id);
  if (!d) return '';
  const abrir = d.storage_path
    ? `<button class="doc-abrir" data-abrir="${esc(d.storage_path)}">ABRIR</button>`
    : d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">ABRIR</a>`
    : `<span class="td-code">${esc(String(d.estado).toUpperCase())}</span>`;
  return `<div class="ck-doc">◆ ${esc(d.titulo)} ${abrir}</div>`;
}

function drChecklist(id) {
  const todos = state.check.filter(c => c.opportunity_id === id);
  if (!todos.length) return vacio('Sin checklist de preparación para este expediente.')
                          + formChecklist([]);

  const val = todos.filter(c => c.estado === 'validado').length;
  const crit = todos.filter(c => c.prioridad === 'critica' && c.estado !== 'validado').length;
  const pct = Math.round(100 * val / todos.length);

  const vis = todos.filter(c =>
    (!state.ckPrio || c.prioridad === state.ckPrio) &&
    (!state.ckEst  || c.estado === state.ckEst) &&
    (!state.ckPlazo || (() => {
      if (c.estado === 'validado') return false;
      const r = reloj(c.vence_en);
      if (state.ckPlazo === 'sinfecha') return !r;
      if (!r) return false;
      return state.ckPlazo === 'vencido' ? r.dias < 0 : r.dias >= 0 && r.dias <= 7;
    })()));
  const vencidos = todos.filter(c => c.estado !== 'validado' && (reloj(c.vence_en)?.dias ?? 9e3) < 0).length;

  const opc = (m, sel) => Object.entries(m)
    .map(([k,t]) => `<option value="${esc(k)}"${k===sel?' selected':''}>${esc(t)}</option>`).join('');

  const cab = `<div class="ck-cab">
    <select id="ckPrio"><option value="">TODAS LAS PRIORIDADES</option>${opc(CK_PRIO, state.ckPrio)}</select>
    <select id="ckEst"><option value="">TODOS LOS ESTADOS</option>${opc(CK_EST, state.ckEst)}</select>
    <select id="ckPlazo"><option value="">CUALQUIER PLAZO</option>${
      opc({ vencido:'Vencidos', semana:'Vencen en 7 días', sinfecha:'Sin fecha' }, state.ckPlazo)}</select>
    <span class="toolbar-count">${vis.length} DE ${todos.length}${
      crit ? ` · <b style="color:var(--red)">${crit} CRÍTICOS ABIERTOS</b>` : ''}${
      vencidos ? ` · <b style="color:var(--red)">${vencidos} VENCIDOS</b>` : ''}</span>
    <div class="ck-prog"><b>${val} / ${todos.length} validados</b>
      <div class="ck-bar"><i style="width:${pct}%"></i></div></div>
  </div>`;

  // La respuesta se enseña SIEMPRE, tambien a los lectores: un punto
  // validado sin lo que se encontro no es memoria, es una casilla.
  const filas = vis.map(c => `<tr>
    <td><span class="ck-num">${String(c.orden).padStart(2,'0')}</span></td>
    <td><div class="ck-area">${esc(c.area)}${
          c.responsable ? ` · <span class="ck-resp">${esc(c.responsable)}</span>` : ''}</div>
        <div style="font-size:13px;color:var(--text);margin-top:3px">${esc(c.descripcion)}</div>
        ${c.nota ? `<div class="ck-nota">${esc(c.nota)}</div>` : ''}
        ${docDelPunto(c)}
        ${canWrite() ? `<button class="ck-edit" data-ck-edit="${esc(c.id)}">${
          c.nota ? 'EDITAR RESPUESTA' : '+ RESPUESTA'}</button>` : ''}</td>
    <td><span class="pill p-${esc(c.prioridad)}">${esc(CK_PRIO[c.prioridad] ?? c.prioridad)}</span></td>
    <td><span class="td-code">${esc(CK_ORIG[c.origen] ?? c.origen)}</span></td>
    <td>${c.estado === 'validado' ? '<span class="td-code">—</span>'
         : (pastillaReloj(c.vence_en) || '<span class="td-code">sin fecha</span>')}</td>
    <td>${canWrite()
      ? `<select class="ck-est e-${esc(c.estado)}" data-ck="${esc(c.id)}">${opc(CK_EST, c.estado)}</select>`
      : `<span class="td-code e-${esc(c.estado)}">${esc(CK_EST[c.estado] ?? c.estado)}</span>`}</td>
  </tr>
  ${canWrite() ? `<tr class="ck-fila-edit" id="cke-${esc(c.id)}" hidden><td colspan="6">
    <div class="frm-grid">
      <div class="fld ancho"><label for="ckn-${esc(c.id)}">Respuesta · qué se ha encontrado</label>
        <textarea id="ckn-${esc(c.id)}" placeholder="La cifra, el hallazgo o el documento que responde a este punto.">${esc(c.nota ?? '')}</textarea></div>
      <div class="fld"><label for="ckr-${esc(c.id)}">Responsable</label>
        <input id="ckr-${esc(c.id)}" type="text" value="${esc(c.responsable ?? '')}" placeholder="Quién lo persigue" /></div>
      <div class="fld"><label for="ckv-${esc(c.id)}">Vence el</label>
        <input id="ckv-${esc(c.id)}" type="date" value="${esc(c.vence_en ?? '')}" /></div>
      <div class="fld"><label for="ckd-${esc(c.id)}">Documento que lo resuelve</label>
        <select id="ckd-${esc(c.id)}">
          <option value="">— ninguno —</option>
          ${state.docs.filter(d => d.opportunity_id === c.opportunity_id).map(d =>
            `<option value="${esc(d.id)}"${d.id === c.document_id ? ' selected' : ''}>${esc(d.titulo)}</option>`).join('')}
        </select></div>
      <div class="fld"><label>&nbsp;</label>
        <button class="btn-oro" style="margin-top:0" data-ck-save="${esc(c.id)}">GUARDAR</button></div>
    </div>
    <div class="frm-msg" id="ckm-${esc(c.id)}"></div></td></tr>` : ''}`).join('');

  return cab + `<div class="table-scroll"><table class="pipe"><thead><tr>
    <th>#</th><th>Área · documento o información</th><th>Prioridad</th><th>Origen</th>
    <th>Vence</th><th>Estado</th>
  </tr></thead><tbody>${filas}</tbody></table></div>` + formChecklist(todos);
}

// Dar de alta un punto. El checklist que trae el expediente es el de la
// due diligence estandar; lo que aparece durante el proceso -- una pregunta
// del comprador, un hallazgo -- tambien es exigencia y tiene que caber.
function formChecklist(todos) {
  if (!canWrite()) return '';
  const siguiente = todos.reduce((m, c) => Math.max(m, c.orden), 0) + 1;
  const areas = [...new Set(todos.map(c => c.area))].sort();
  return `<div class="frm">
    <h4>Añadir punto al checklist</h4>
    <div class="frm-grid">
      <div class="fld"><label for="ckNArea">Área</label>
        <input id="ckNArea" type="text" list="ckAreas" placeholder="Financiero, Legal…" />
        <datalist id="ckAreas">${areas.map(a => `<option value="${esc(a)}"></option>`).join('')}</datalist></div>
      <div class="fld"><label for="ckNPrio">Prioridad</label>
        <select id="ckNPrio">${Object.entries(CK_PRIO).map(([k,t]) =>
          `<option value="${esc(k)}"${k==='alta'?' selected':''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="fld"><label for="ckNOrig">Origen</label>
        <select id="ckNOrig">${Object.entries(CK_ORIG).map(([k,t]) =>
          `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select></div>
      <div class="fld"><label for="ckNOrd">Nº</label>
        <input id="ckNOrd" type="number" value="${siguiente}" /></div>
      <div class="fld ancho"><label for="ckNDes">Documento o información que se exige</label>
        <textarea id="ckNDes" placeholder="Qué hay que pedir, con el detalle suficiente para que no haya que preguntarlo dos veces."></textarea></div>
    </div>
    <button class="btn-oro" id="ckNAdd">AÑADIR PUNTO</button>
    <div class="frm-msg" id="ckNMsg"></div>
  </div>`;
}

// Los nombres de tabla y de columna son de la base, no de nadie que vaya
// a leerlos. Lo que no este aqui sale tal cual: preferible un tecnicismo
// visible a un hueco, porque el hueco no se arregla nunca.
const ACT_TABLA = {
  opportunities: 'el expediente', scores: 'una puntuación', documents: 'un documento',
  checklist_items: 'un punto del checklist', decisions: 'una decisión',
  outcomes: 'el desenlace', economics: 'los economics', strategy: 'la estrategia',
  investors: 'un inversor', scope_flags: 'un aviso de ámbito', mandates: 'el mandato',
  opportunity_access: 'un permiso de acceso'
};
const ACT_CAMPO = {
  estado: 'estado', codigo: 'código', nombre: 'nombre', plaza: 'plaza', geo: 'geografía',
  vertical: 'vertical', reservado: 'reserva', nota: 'nota', responsable: 'responsable',
  document_id: 'documento enlazado', vence_en: 'fecha límite', prioridad: 'prioridad',
  descripcion: 'descripción', titulo: 'título', url: 'enlace', categoria: 'categoría',
  orden: 'orden', resultado: 'resultado', honorarios_eur: 'honorarios', motivo: 'motivo',
  fecha: 'fecha', area: 'área', tipo: 'tipo', notas: 'notas'
};
const ACT_VERBO = { alta: 'añadió', cambio: 'cambió', baja: 'eliminó' };

// «hace 20 min» se lee de un vistazo; una marca de tiempo completa hay que
// restarla mentalmente. La fecha exacta va en el title, para quien la
// necesite.
function haceCuanto(iso) {
  const seg = Math.round((Date.now() - new Date(iso)) / 1000);
  if (seg < 60)      return 'ahora mismo';
  if (seg < 3600)    return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400)   return `hace ${Math.round(seg / 3600)} h`;
  const d = Math.round(seg / 86400);
  if (d < 30)        return `hace ${d} d`;
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function drActividad(id) {
  if (state.actError) {
    return avisoModulo(state.actError, 'ACTIVIDAD NO DISPONIBLE', '16_actividad.sql',
      'Registra solo lo que pase <b>a partir de entonces</b>: lo anterior no se puede reconstruir, porque la base no lo guardaba.');
  }
  const filas = state.actividad.filter(a => a.opportunity_id === id);
  if (!filas.length) return `<div class="vacio">Sin movimientos registrados en este expediente.
    El registro empieza cuando se aplica <code>16_actividad.sql</code>: lo que se hizo antes no queda,
    porque reconstruirlo seria inventarselo.</div>`;

  return `<div class="act-lista">${filas.map(a => {
    const campos = (a.campos ?? []).map(c => ACT_CAMPO[c] ?? c);
    const que = ACT_TABLA[a.tabla] ?? a.tabla;
    return `<div class="act-fila">
      <div class="act-cuando" title="${esc(new Date(a.ocurrido_en).toLocaleString('es-ES'))}">${
        esc(haceCuanto(a.ocurrido_en))}</div>
      <div class="act-quien">${esc(a.quien)}</div>
      <div class="act-que"><b>${ACT_VERBO[a.operacion]}</b> ${esc(que)}${
        a.etiqueta ? ` · <span class="act-etq">${esc(a.etiqueta)}</span>` : ''}${
        campos.length ? `<div class="act-campos">${campos.map(c =>
          `<span class="act-campo">${esc(c)}</span>`).join('')}</div>` : ''}</div>
      <div class="act-op act-${a.operacion}">${a.operacion}</div>
    </div>`;
  }).join('')}</div>
  <p class="act-pie">Lo escriben disparadores de la base, no esta pantalla: queda registrada toda
  escritura, venga del navegador o del SQL Editor. El registro es solo de agregar — nadie, ni un
  administrador, puede reescribirlo.</p>`;
}

const DR_TABS = [
  ['documentos', 'DOCUMENTACIÓN', drDocumentos],
  ['economics',  'ECONOMICS · MANDATO', drEconomics],
  ['estrategia', 'ESTRATEGIA', drEstrategia],
  ['inversores', 'INVERSORES', drInversores],
  ['checklist',  'CHECKLIST', drChecklist],
  ['actividad',  'ACTIVIDAD', drActividad]
];

function renderDataroom() {
  const r = state.rows.find(x => x.opportunity_id === state.selected);
  if (!r) { $('drBody').innerHTML = ''; $('drTabs').innerHTML = ''; return; }
  $('drRef').textContent = String(r.nombre).toUpperCase();

  if (state.drError) {
    $('drTabs').innerHTML = '';
    $('drBody').innerHTML = avisoModulo(state.drError, 'DATA ROOM NO DISPONIBLE', '06_dataroom.sql',
      'Trae documentos, economics, estrategia, inversores y mandatos.');
    return;
  }

  const n = {
    documentos: state.docs.filter(d => d.opportunity_id === r.opportunity_id).length,
    economics:  state.econ.some(e => e.opportunity_id === r.opportunity_id) ? 1 : 0,
    estrategia: state.strat.some(e => e.opportunity_id === r.opportunity_id) ? 1 : 0,
    inversores: state.outreach.filter(o => o.opportunity_id === r.opportunity_id).length,
    checklist:  state.check.filter(c => c.opportunity_id === r.opportunity_id).length,
    actividad:  state.actividad.filter(a => a.opportunity_id === r.opportunity_id).length
  };

  $('drTabs').innerHTML = DR_TABS.map(([k, label]) =>
    `<button class="tbtn" data-tab="${k}" aria-pressed="${state.drTab === k}">
       ${label}${n[k] ? ` · ${n[k]}` : ''}</button>`).join('');
  for (const b of $('drTabs').querySelectorAll('button')) {
    b.addEventListener('click', () => { state.drTab = b.dataset.tab; renderDataroom(); });
  }

  const fn = (DR_TABS.find(([k]) => k === state.drTab) ?? DR_TABS[0])[2];
  $('drBody').innerHTML = fn(r.opportunity_id);
  cablearChecklist(r.opportunity_id);
  cablearAperturas();
  if (canWrite()) cablearFormularios(r.opportunity_id);
}

function cablearChecklist(id) {
  // El buscador no repinta en cada tecla: perderia el foco. Repinta al
  // soltar la tecla y devuelve el cursor donde estaba.
  const q = $('docQ');
  if (q) q.addEventListener('input', function () {
    const pos = this.selectionStart;
    state.docQ = this.value;
    renderDataroom();
    const otra = $('docQ');
    if (otra) { otra.focus(); otra.setSelectionRange(pos, pos); }
  });
  $('docCat')?.addEventListener('change', function () { state.docCat = this.value; renderDataroom(); });

  $('ckPrio')?.addEventListener('change', function () { state.ckPrio = this.value; renderDataroom(); });
  $('ckEst') ?.addEventListener('change', function () { state.ckEst  = this.value; renderDataroom(); });
  $('ckPlazo')?.addEventListener('change', function () { state.ckPlazo = this.value; renderDataroom(); });
  for (const sel of document.querySelectorAll('.ck-est')) {
    sel.addEventListener('change', () => guardar(null, null,
      () => sb.from('checklist_items').update({
        estado: sel.value, actualizado_en: new Date().toISOString()
      }).eq('id', sel.dataset.ck)));
  }

  // La fila de respuesta se despliega bajo su punto. No es un dialogo
  // aparte: lo que se escribe pertenece a ese punto y se lee con el.
  for (const b of document.querySelectorAll('[data-ck-edit]')) {
    b.addEventListener('click', () => {
      const fila = $('cke-' + b.dataset.ckEdit);
      fila.hidden = !fila.hidden;
      if (!fila.hidden) $('ckn-' + b.dataset.ckEdit)?.focus();
    });
  }

  for (const b of document.querySelectorAll('[data-ck-save]')) {
    b.addEventListener('click', (ev) => {
      const k = b.dataset.ckSave;
      guardar($('ckm-' + k), ev.target, () => sb.from('checklist_items').update({
        nota: val('ckn-' + k) || null,
        responsable: val('ckr-' + k) || null,
        document_id: val('ckd-' + k) || null,
        vence_en: val('ckv-' + k) || null,
        actualizado_en: new Date().toISOString()
      }).eq('id', k), 'RESPUESTA GUARDADA.');
    });
  }

  $('ckNAdd')?.addEventListener('click', (ev) => {
    const m = $('ckNMsg');
    if (!val('ckNDes')) {
      m.className = 'frm-msg err';
      m.textContent = 'DI QUÉ SE EXIGE: UN PUNTO SIN DESCRIPCIÓN NO SE PUEDE PEDIR.';
      return;
    }
    if (!val('ckNArea')) {
      m.className = 'frm-msg err';
      m.textContent = 'EL ÁREA ES OBLIGATORIA: ES LO QUE AGRUPA EL CHECKLIST.';
      return;
    }
    guardar(m, ev.target, () => sb.from('checklist_items').insert({
      opportunity_id: id, orden: num('ckNOrd'), area: val('ckNArea'),
      descripcion: val('ckNDes'), prioridad: val('ckNPrio'), origen: val('ckNOrig')
    }), 'PUNTO AÑADIDO.');
  });
}

function cablearFormularios(id) {
  const uid = () => sb.auth.getUser().then(r => r.data.user.id);

  const noVale = (texto) => {
    const m = $('dMsg'); m.className = 'frm-msg err'; m.textContent = texto;
  };

  $('dAdd')?.addEventListener('click', async (ev) => {
    if (!val('dTit')) return noVale('EL TÍTULO ES OBLIGATORIO.');
    const fichero = $('dFile')?.files?.[0] ?? null;
    const enlace  = val('dUrl') || null;

    // Lo impone tambien la base (doc_una_sola_fuente), pero decirlo aqui
    // evita un rechazo del driver con un mensaje ilegible.
    if (fichero && enlace) return noVale('UN DOCUMENTO ES FICHERO O ENLACE, NO LAS DOS COSAS.');
    if (fichero) { const pega = pegaAlFichero(fichero); if (pega) return noVale(pega); }

    const autor = await uid();
    const base = {
      opportunity_id: id, titulo: val('dTit'), categoria: val('dCat'),
      orden: num('dOrd') ?? 99, descripcion: val('dDes') || null, anadido_por: autor
    };

    if (!fichero) {
      return guardar($('dMsg'), ev.target, () => sb.from('documents').insert({
        ...base, estado: val('dEst'), url: enlace, storage_path: null
      }), 'DOCUMENTO AÑADIDO.');
    }

    const m = $('dMsg'); m.className = 'frm-msg'; m.textContent = 'SUBIENDO…';
    guardar($('dMsg'), ev.target, async () => {
      const { ruta, error } = await subirAlCubo(id, fichero);
      if (error) return { error };
      const fila = await sb.from('documents').insert({
        ...base, estado: 'disponible', url: null, storage_path: ruta,
        nombre_fichero: fichero.name, bytes: fichero.size
      });
      // Si la fila no entra, el fichero se queda huerfano en el cubo:
      // ocupa, no lo ve nadie y nadie sabe de quien era. Se retira.
      if (fila.error) { await sb.storage.from(CUBO).remove([ruta]); return { error: fila.error }; }
      return { error: null };
    }, 'DOCUMENTO SUBIDO.');
  });

  for (const b of document.querySelectorAll('[data-del-doc]')) {
    b.addEventListener('click', (ev) => {
      const ruta = b.dataset.ruta || null;
      if (ruta && !confirm('Esto borra también el fichero del cubo. Es irreversible.\n\n¿Seguir?')) return;
      guardar(null, ev.target, async () => {
        // Primero la fila. Al reves, un fallo dejaria un documento visible
        // apuntando a un fichero que ya no existe, que es peor que un
        // huerfano invisible.
        const fila = await sb.from('documents').delete().eq('id', b.dataset.delDoc);
        if (fila.error) return { error: fila.error };
        if (ruta) return sb.storage.from(CUBO).remove([ruta]);
        return { error: null };
      });
    });
  }

  // Adjuntar a un documento YA registrado. Es un UPDATE, no un insert: las
  // filas 'pendiente' son huecos declarados con su titulo, su categoria y
  // su descripcion ya escritos. Dar de alta otra fila con el mismo titulo
  // dejaria el data room con duplicados, que es justo lo que no se le
  // ensena a un comprador.
  for (const inp of document.querySelectorAll('[data-adj]')) {
    inp.addEventListener('change', async () => {
      const fichero = inp.files?.[0]; if (!fichero) return;
      const msg = $('adj-' + inp.dataset.adj);
      const pega = pegaAlFichero(fichero);
      if (pega) { msg.className = 'frm-msg err'; msg.textContent = pega; inp.value = ''; return; }
      msg.className = 'frm-msg'; msg.textContent = 'SUBIENDO…';
      guardar(msg, null, async () => {
        const { ruta, error } = await subirAlCubo(id, fichero);
        if (error) return { error };
        const fila = await sb.from('documents').update({
          storage_path: ruta, nombre_fichero: fichero.name, bytes: fichero.size,
          url: null, estado: 'disponible'
        }).eq('id', inp.dataset.adj);
        if (fila.error) { await sb.storage.from(CUBO).remove([ruta]); return { error: fila.error }; }
        return { error: null };
      }, 'FICHERO ADJUNTADO.');
    });
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

// Abrir ficheros NO es una accion de escritura. Vivia dentro de
// cablearFormularios(), que solo corre para quien puede editar, asi que
// un lector veia el boton y no hacia nada -- cuando las politicas del
// cubo si le dejan leer. Se cablea para todos.
function cablearAperturas() {
  const noVale = (texto) => {
    const m = $('dMsg'); if (!m) return alert(texto);
    m.className = 'frm-msg err'; m.textContent = texto;
  };
  // El cubo es privado: no hay enlace permanente. Se pide uno firmado y
  // con caducidad justo al pulsar. La ventana se abre ANTES de esperar,
  // porque abrirla despues la bloquea el navegador.
  for (const b of document.querySelectorAll('[data-abrir]')) {
    b.addEventListener('click', async () => {
      // Sin el tercer argumento a proposito: con 'noopener' window.open
      // devuelve null y el respaldo se llevaba por delante la pestaña
      // actual, sacando al usuario del cuadro de mando. Se corta el
      // vinculo despues, que consigue lo mismo sin perder el manejador.
      const w = window.open('', '_blank');
      const { data, error } = await sb.storage.from(CUBO)
        .createSignedUrl(b.dataset.abrir, FIRMA_SEGS);
      if (error || !data?.signedUrl) {
        if (w) w.close();
        return noVale('NO SE PUDO ABRIR: ' + String(error?.message ?? 'sin url').toUpperCase());
      }
      if (w) { w.opener = null; w.location = data.signedUrl; }
      else noVale('EL NAVEGADOR HA BLOQUEADO LA VENTANA. PERMITE LAS EMERGENTES Y REINTENTA.');
    });
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

  // El filtro lleva la cuenta encima: un boton que dice «sin codigo» sin
  // decir cuantos obliga a pulsarlo para saber si hace falta.
  const b = $('fSinCod');
  if (b) {
    const n = state.rows.filter(r => !r.codigo).length;
    b.textContent = `SIN CÓDIGO · ${n}`;
    b.setAttribute('aria-pressed', String(state.fSinCod));
    b.disabled = !n && !state.fSinCod;
  }
}

function renderCalibracion() {
  const cuenta = { P1:0, P2:0, P3:0, P4:0, DESCARTE:0, NONE:0 };
  for (const r of state.rows) cuenta[r.banda ?? 'NONE']++;
  const orden = [['P1','var(--b1)'],['P2','var(--b2)'],['P3','var(--b3)'],
                 ['P4','var(--b4)'],['DESCARTE','var(--b5)'],['NONE','rgba(52,65,86,.8)']];
  const max = Math.max(...orden.map(([k]) => cuenta[k])) || 1;

  // Se cuenta contra la tabla. Escribirlo a mano hacia que la tarjeta
  // afirmase un hecho sobre los datos sin haberlos leido.
  const conDesenlace = state.outcomes.length;
  const cerrados = state.outcomes.filter(o => o.resultado === 'cerrado').length;
  const dist = orden.map(([k, c]) =>
    `<div class="bandrow"><span class="bl" style="color:${c}">${k === 'NONE' ? 'SIN PUNT.' : k}</span>
     <span class="bt"><span class="bf" style="width:${cuenta[k] / max * 100}%;background:${c}"></span></span>
     <span class="bn">${cuenta[k]} exp.</span></div>`).join('');

  // Conversion y discriminante: se describe lo que HAY, no lo que se
  // supone que hay. Si la tabla no se puede leer, se dice; no se pinta
  // un cero que parece un hecho.
  const RES = { cerrado:['cerrado','cerrados'], abortado:['abortado','abortados'],
                perdido:['perdido','perdidos'], descartado:['descartado','descartados'] };
  let convHtml, discTxt;
  if (state.outError) {
    convHtml = `<div class="empty-state">No se ha podido leer la tabla de desenlaces:
      <code>${esc(state.outError)}</code></div>`;
    discTxt = 'No se ha podido leer la tabla de desenlaces, así que no se puede contrastar nada.';
  } else if (!conDesenlace) {
    convHtml = `<div class="empty-state">Sin datos. Ningún expediente tiene desenlace registrado
      (<span class="num">0</span> de <span class="num">${state.rows.length}</span>).<br />
      <b style="color:var(--text);font-style:normal">Esta tarjeta no puede rellenarse desde el análisis:
      exige el desenlace real de operaciones cerradas y abortadas.</b></div>`;
    discTxt = `Sin datos. Se calcula como la diferencia entre la media de la dimensión en cerrados y
      en no cerrados; una dimensión con discriminación cercana a cero no aporta información, por
      mucho peso que se le haya dado.`;
  } else {
    const banda = new Map(state.rows.map(r => [r.opportunity_id, r.banda]));
    const porBanda = {};
    for (const o of state.outcomes) {
      const b = banda.get(o.opportunity_id) ?? 'NONE';
      (porBanda[b] ??= {})[o.resultado] = ((porBanda[b] ?? {})[o.resultado] ?? 0) + 1;
    }
    const filas = orden.map(([k]) => {
      const d = porBanda[k]; if (!d) return '';
      const det = Object.entries(d)
        .map(([r, n]) => `${n} ${(RES[r] ?? [r, r])[n === 1 ? 0 : 1]}`).join(', ');
      return `<div class="bandrow"><span class="bl">${k === 'NONE' ? 'SIN PUNT.' : k}</span>
        <span class="bn" style="text-align:left;flex:1">${esc(det)}</span></div>`;
    }).join('');
    convHtml = `${filas}<p class="empty-state" style="padding-bottom:0">
      <span class="num">${conDesenlace}</span> desenlace${conDesenlace === 1 ? '' : 's'} registrado${conDesenlace === 1 ? '' : 's'}
      de <span class="num">${state.rows.length}</span> expedientes, de los cuales
      <span class="num">${cerrados}</span> ${cerrados === 1 ? 'es un cierre' : 'son cierres'}. Por debajo de 10 no hay tasa de conversión
      que leer: esto es el recuento, no un resultado.</p>`;
    discTxt = cerrados
      ? `Hay ${cerrados} cierre${cerrados === 1 ? '' : 's'} registrado${cerrados === 1 ? '' : 's'}. El contraste por dimensión
         necesita las puntuaciones de cada expediente cerrado frente a los no cerrados; todavía no
         se calcula en esta superficie.`
      : `Sin contraste posible. Hay ${conDesenlace} desenlace${conDesenlace === 1 ? '' : 's'} registrado${conDesenlace === 1 ? '' : 's'} y
         ninguno es un cierre, así que no existe el grupo «cerrados» contra el que comparar.`;
  }

  $('calGrid').innerHTML = `
    <div class="card"><h3>Distribución por banda</h3>
      <p class="card-note">Reparto del pipeline actual. Una distribución plana indica rúbricas mal
      ancladas, no un pipeline bueno.</p>${dist}</div>

    <div class="card"><h3>Conversión por banda</h3>
      <p class="card-note">Si P1+P2 no convierten claramente por encima de P3+P4, el score no separa.</p>
      ${convHtml}</div>

    <div class="card"><h3>Muestra para recalibrar</h3>
      <p class="card-note">Expedientes con desenlace conocido frente al mínimo accionable.</p>
      <div class="gauge-track"><span class="gauge-fill" style="width:${Math.min(100, conDesenlace / 20 * 100)}%"></span></div>
      <div class="gauge-ticks"><span>${conDesenlace} ACTUAL</span><span>10 ORIENTATIVO</span><span>20 ACCIONABLE</span></div>
      <p class="empty-state" style="padding-bottom:0">Por debajo de 10, los resultados son orientativos.
        Incluye siempre los que salieron mal y los que descartaste: un backtest hecho solo con éxitos
        es sesgo de supervivencia.</p></div>

    <div class="card"><h3>Poder discriminante</h3>
      <p class="card-note">Cuánto separa cada dimensión los expedientes que cerraron de los que no.</p>
      <div class="empty-state">${discTxt}<br /><br />
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
      (() => {
        const n = (state.serie.length ? state.serie : state.risk).length;
        if (!n) return ['warn', '▲ SIN CARGAR'];
        if (state.riesgo?.caducado) return ['warn', `▲ PARADO ${state.riesgo.dias_sin_actualizar} DÍAS`];
        return ['ok', `✓ ${n} DÍAS DE SERIE`];
      })()],
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

// Pestanas del expediente. La ficha y el data room son el mismo objeto:
// se alternan en el mismo sitio en vez de vivir en secciones distintas.
// Hay dos mandos para lo mismo -- el del expediente y el de la barra fija --
// asi que el estado vive aqui y los dos se repintan desde el.
function abrirPanel(pane, mover = false) {
  state.pane = pane;
  for (const grupo of ['dealTabs', 'dbSeg']) {
    const g = $(grupo); if (!g) continue;
    for (const b of g.querySelectorAll('[data-pane]')) {
      const activo = b.dataset.pane === pane;
      b.setAttribute('aria-selected', String(activo));
      b.setAttribute('aria-pressed', String(activo));
    }
  }
  for (const id of ['detail', 'drPane']) {
    const el = $(id); if (el) el.hidden = (id !== pane);
  }
  // Se lleva a la vista el EXPEDIENTE, no la seccion. #pipeline empieza por
  // su titulo, la barra de filtros y la lista: saltar ahi dejaba el panel
  // recien abierto entre 500 y 700 px por debajo de lo que se esta mirando,
  // y habia que ir a buscarlo. Se mueve siempre que lo pida una persona --
  // cambiar de panel sin mover deja la vista en un punto que ya no
  // significa nada -- y nunca en el arranque.
  if (mover) $('dealTabs')?.closest('.work-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cablearPestanasExpediente() {
  for (const grupo of ['dealTabs', 'dbSeg']) {
    const g = $(grupo); if (!g) continue;
    for (const b of g.querySelectorAll('[data-pane]')) {
      b.addEventListener('click', () => abrirPanel(b.dataset.pane, true));
    }
  }
  // Desde el indice se entra directo al data room del expediente abierto.
  $('navDr')?.addEventListener('click', (ev) => { ev.preventDefault(); abrirPanel('drPane', true); });
  abrirPanel(state.pane);
}

// La barra solo tiene sentido con un expediente abierto.
function renderDealBar() {
  const bar = $('dealBar'); if (!bar) return;
  const r = state.rows.find(x => x.opportunity_id === state.selected);
  bar.hidden = !r;
  if (!r) return;
  $('dbName').textContent = r.nombre;
  $('dbScore').textContent = r.dealscore == null
    ? 'SIN PUNTUAR'
    : `${Number(r.dealscore).toFixed(1)} · ${r.banda ?? ''}`.trim();
}

function renderAll() { renderStats(); renderHoy(); renderQueue(); renderFilters(); renderPipe(); renderDetail(); renderDataroom(); renderAlta(); renderMercado(); renderCalibracion(); renderArquitectura(); renderDealBar(); }

function select(id) { state.selected = id; state.draft = null; renderPipe(); renderDetail(); renderDataroom(); renderDealBar(); $('detail')?.closest('.work-main')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

function wire() {
  $('pipeBody').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id); });
  $('pipeBody').addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); select(tr.dataset.id); }
  });
  $('queue').addEventListener('click', e => {
    const ir = e.target.closest('[data-ira]');
    if (ir) { document.getElementById(ir.dataset.ira)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const el = e.target.closest('[data-goto]'); if (el) select(el.dataset.goto);
  });
  $('oNuevo')?.addEventListener('click', () => {
    state.altaAbierta = !state.altaAbierta; state.altaDup = null; renderAlta();
  });
  $('fVert').addEventListener('change', function () { state.fVert = this.value; renderPipe(); });
  $('fBand').addEventListener('change', function () { state.fBand = this.value; renderPipe(); });
  $('fSinCod')?.addEventListener('click', () => {
    state.fSinCod = !state.fSinCod; renderFilters(); renderPipe();
  });
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
  sellaVersion();
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
  cablearPestanasExpediente();
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
