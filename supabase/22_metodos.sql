-- =====================================================================
-- ZRC · CAPA 3 — DOS CONSTRUCCIONES, DOS SERIES
--
-- v_risk_serie mezclaba las dos: cogia la lectura historica para los
-- dias sin mesas y la de mesas para el resto, y devolvia una sola
-- linea. Eso es empalmar dos medidas distintas, que es exactamente lo
-- que no se hace con el GeoRisk y tampoco debe hacerse aqui.
--
-- Ahora cada dia puede tener las dos, cada una con su metodo, y quien
-- dibuje decide. La brecha entre ambas deja de ser un detalle oculto y
-- pasa a ser un dato: si la IA se separa sistematicamente de su propia
-- formula, eso hay que verlo.
--
-- Idempotente.
-- =====================================================================

drop view if exists v_pendientes_firma;
drop view if exists v_risk_estado;
drop view if exists v_risk_serie;

-- ── LA SERIE, CON LAS DOS CONSTRUCCIONES ────────────────────────────
create view v_risk_serie
  with (security_invoker = true) as
select fecha, valor, estado,
       'lectura'::text as metodo,
       null::int as cobertura, null::int as mesas_leidas
  from risk_index
union all
select fecha, valor, estado, 'mesas', cobertura, mesas_leidas
  from v_risk_dia
 order by fecha, metodo;

comment on view v_risk_serie is
  'metodo = lectura: el numero que publico el briefing ese dia, que lo '
  'propone la IA y no se puede reproducir desde las mesas. '
  'metodo = mesas: el indice derivado de las senales de cada mesa con '
  'la formula del propio briefing. No son el mismo numero y no van en '
  'la misma linea.';

-- ── EL ESTADO DE HOY ────────────────────────────────────────────────
-- Manda el indice de MESAS: es el que la firma puede defender. La
-- lectura del mismo dia va al lado, y la brecha entre las dos es la
-- medida de cuanto se separa la IA de su propia formula.
create view v_risk_estado
  with (security_invoker = true) as
with m as (select * from v_risk_dia order by fecha desc limit 1),
     ant as (select valor from v_risk_dia order by fecha desc offset 1 limit 1)
select m.fecha, m.valor, m.estado, 'mesas'::text as metodo, m.cobertura,
       m.valor - (select valor from ant)                  as delta,
       (select r.valor from risk_index r where r.fecha = m.fecha) as lectura,
       m.valor - (select r.valor from risk_index r where r.fecha = m.fecha) as brecha,
       (current_date - m.fecha)                           as dias_sin_actualizar,
       (select count(*) from v_risk_dia)::int             as dias_serie,
       (current_date - m.fecha) > 3                       as caducado
  from m;

-- ── LA COLA DE FIRMA, IGUAL QUE ESTABA ──────────────────────────────
create view v_pendientes_firma
  with (security_invoker = true) as
select 'indice_caducado'::text as motivo,
       'Índice de mesas sin actualizar desde ' || to_char(e.fecha, 'DD/MM')
         || ' (' || e.dias_sin_actualizar || ' días). El barrido está parado.' as detalle,
       1 as prioridad, e.fecha + 1 as vence_en
  from v_risk_estado e where e.caducado
union all
select 'mesas_sin_fundamento',
       d.sin_fundamento || ' lecturas de ' || to_char(d.fecha, 'DD/MM')
         || ' sin fundamento anotado: no son lecturas, son cifras sueltas.',
       4, null::date
  from v_risk_dia d
 where d.sin_fundamento > 0 and d.fecha >= current_date - 7;

grant select on v_risk_serie, v_risk_estado, v_pendientes_firma to authenticated;

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'mesas activas' as concepto, (select count(*)::text from risk_mesas where activa) as valor
union all select 'mesas retiradas', (select count(*)::text from risk_mesas where not activa)
union all select 'dias con indice de mesas', (select count(*)::text from v_risk_dia)
union all select 'dias con lectura publicada', (select count(*)::text from risk_index)
union all select 'lecturas por mesa cargadas', (select count(*)::text from risk_lecturas)
union all select 'ultimo dia de mesas', (select coalesce(max(fecha)::text,'ninguno') from v_risk_dia)
union all select 'indice de mesas hoy', (select coalesce(valor::text,'-') from v_risk_estado)
union all select 'lectura del mismo dia', (select coalesce(lectura::text,'-') from v_risk_estado)
union all select 'brecha (mesas - lectura)', (select coalesce(brecha::text,'-') from v_risk_estado)
union all select 'caducado', (select case when caducado then 'SI' else 'no' end from v_risk_estado);
