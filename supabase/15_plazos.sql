-- =====================================================================
-- ZRC · CAPA 3 — PLAZOS: QUE EL RELOJ SEA UN DATO
--
-- La cola decia "escalar al CIO en 48 h" y "outreach con angulo en 7
-- dias" dentro del texto de la accion. Como frase no se puede filtrar,
-- no se puede ordenar y no se puede saber que esta vencido. El plazo
-- pasa a ser una columna, y la fecha limite se DERIVA de cuando se
-- puntuo: nadie tiene que teclearla.
--
-- Los puntos del checklist si llevan fecha propia, porque su plazo no
-- se deduce de nada: lo pone quien lo persigue.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1 · EL PLAZO DE CADA BANDA, COMO DATO ───────────────────────────
alter table scoring_bands add column if not exists plazo_horas int;

update scoring_bands set plazo_horas = 48  where clave = 'P1' and plazo_horas is null;
update scoring_bands set plazo_horas = 168 where clave = 'P2' and plazo_horas is null;  -- 7 dias
-- P3, P4 y DESCARTE sin plazo: no son trabajo con reloj.

comment on column scoring_bands.plazo_horas is
  'Horas desde la puntuacion para la accion por defecto de la banda. '
  'Null = sin reloj (watchlist, archivo, descarte).';

-- ── 2 · FECHA LIMITE EN EL CHECKLIST ────────────────────────────────
alter table checklist_items add column if not exists vence_en date;

comment on column checklist_items.vence_en is
  'Para cuando se espera este punto. Null = sin fecha comprometida.';

-- ── 3 · LA COLA PASA A LLEVAR LA FECHA LIMITE ───────────────────────
-- La de banda alta se deriva: fecha de la puntuacion + el plazo de su
-- banda. La del checklist es la que haya puesto una persona. Las demas
-- carencias no tienen reloj, y decir que vencen seria inventarselo.
create or replace view v_pendientes
  with (security_invoker = true) as
with vivos as (
  select o.* from opportunities o
   where o.estado not in ('archivado','cerrado')
     and not exists (select 1 from outcomes x where x.opportunity_id = o.id)
)
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo,
       f.texto                as detalle,
       1                      as prioridad,
       null::date             as vence_en
  from vivos o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null

union all
select o.id, o.codigo, o.nombre,
       'banda_alta',
       'DEALSCORE ' || to_char(v.dealscore, 'FM999.0') || ' · ' || coalesce(v.banda_accion, ''),
       case when v.banda = 'P1' then 2 else 3 end,
       (v.creado_en + make_interval(hours => b.plazo_horas))::date
  from vivos o
  join v_opportunity_scores v on v.opportunity_id = o.id
  left join scoring_bands b on b.model_id = v.model_id and b.clave = v.banda
 where v.banda in ('P1','P2')

union all
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin código de expediente con el patrón ZRC-[TIPO]-[AÑO]-[GEO]-[NN] (§12.3)', 4,
       null::date
  from vivos o
 where o.codigo is null

union all
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuación completa contra las rúbricas ancladas', 5,
       null::date
  from vivos o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null

union all
-- Un punto critico del checklist con fecha pasada es trabajo vencido, y
-- no estaba en la cola de ninguna manera.
select o.id, o.codigo, o.nombre, 'checklist_vencido',
       c.area || ' · ' || c.descripcion, 2, c.vence_en
  from vivos o
  join checklist_items c on c.opportunity_id = o.id
 where c.vence_en is not null
   and c.vence_en < current_date
   and c.estado <> 'validado';

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'plazo de P1' as concepto,
       coalesce((select plazo_horas::text from scoring_bands where clave='P1' limit 1),'-') as valor
union all select 'plazo de P2',
       coalesce((select plazo_horas::text from scoring_bands where clave='P2' limit 1),'-')
union all select 'columna vence_en en checklist',
       case when exists (select 1 from information_schema.columns
         where table_name='checklist_items' and column_name='vence_en') then 'ok' else 'REVISAR' end
union all select 'la cola devuelve fecha limite',
       case when exists (select 1 from information_schema.columns
         where table_name='v_pendientes' and column_name='vence_en') then 'ok' else 'REVISAR' end
union all select 'pendientes con reloj',
       (select count(*)::text from v_pendientes where vence_en is not null);
