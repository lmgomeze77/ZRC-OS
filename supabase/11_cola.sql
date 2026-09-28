-- =====================================================================
-- ZRC · CAPA 3 — COLA DE DECISION COMPLETA
--
-- Reemplaza v_pendientes para recuperar la regla que faltaba: la banda
-- alta fija por si sola una accion con plazo, sin que haga falta ningun
-- aviso ni ninguna carencia.
--
-- Jerarquia (SOP-08):
--   1  verificacion previa — ambito y sanciones, precede a todo
--   2  banda P1 — escalar al CIO, 48 h
--   3  banda P2 — outreach con angulo, 7 dias
--   4  sin codigo de expediente — bloquea el registro, no el analisis
--   5  sin puntuar
--
-- La cola solo contiene expedientes VIVOS. Uno archivado o con
-- desenlace registrado ya no es trabajo pendiente: su banda sigue
-- diciendo lo que el score dice, pero la firma ya ha resuelto. Sin
-- esta regla, un expediente descartado por ambito seguia reclamando
-- outreach a siete dias por el mero hecho de estar puntuado en P2.
--
-- Aplicar despues de 01_schema.sql.
-- =====================================================================

create or replace view v_pendientes
  with (security_invoker = true) as
with vivos as (
  select o.* from opportunities o
   where o.estado not in ('archivado','cerrado')
     and not exists (select 1 from outcomes x where x.opportunity_id = o.id)
)
-- 1 · Knock-outs y ambito: preceden a cualquier puntuacion (§5.5)
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo,
       f.texto                as detalle,
       1                      as prioridad
  from vivos o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null

union all
-- 2 y 3 · La banda fija la accion por defecto y su plazo
select o.id, o.codigo, o.nombre,
       'banda_alta',
       'DEALSCORE ' || to_char(v.dealscore, 'FM999.0') || ' · ' || coalesce(v.banda_accion, ''),
       case when v.banda = 'P1' then 2 else 3 end
  from vivos o
  join v_opportunity_scores v on v.opportunity_id = o.id
 where v.banda in ('P1','P2')

union all
-- 4 · Higiene de memoria: bloquea el registro formal, no el analisis
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin codigo de expediente con el patron ZRC-[TIPO]-[ANIO]-[GEO]-[NN] (§12.3)', 4
  from vivos o
 where o.codigo is null

union all
-- 5 · Sin puntuar contra las rubricas ancladas
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuacion completa contra las rubricas ancladas', 5
  from vivos o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null;
