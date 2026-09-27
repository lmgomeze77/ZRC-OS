-- =====================================================================
-- ZRC · CAPA 3 — CHECKLIST DE PREPARACION PARA DUE DILIGENCE
--
-- Cada expediente lleva su propia lista de informacion a recabar antes de
-- abrir la sala de datos. Sustituye al localStorage: el estado de un punto
-- es trabajo compartido del equipo, no una nota del navegador de quien lo
-- miro por ultima vez.
--
-- Aplicar despues de 01_schema.sql y 12_reserva.sql.
-- =====================================================================

create table if not exists checklist_items (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities on delete cascade,
  orden          int  not null,
  area           text not null,
  descripcion    text not null,
  prioridad      text not null default 'media'
                 check (prioridad in ('critica','alta','media')),
  -- De donde sale la exigencia: un hueco senalado por el propio analisis
  -- pesa distinto que un documento de paquete estandar.
  origen         text not null default 'dd_recomendada'
                 check (origen in ('informe_valoracion','cuaderno','valoracion','dd_recomendada')),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente','solicitado','recibido','validado')),
  responsable    text,
  nota           text,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references auth.users,
  unique (opportunity_id, orden)
);

alter table checklist_items enable row level security;
-- Hereda la reserva del expediente, como el resto de tablas hijas.
drop policy if exists checklist_items_sel on checklist_items;
drop policy if exists checklist_items_ins on checklist_items;
drop policy if exists checklist_items_upd on checklist_items;
drop policy if exists checklist_items_del on checklist_items;
create policy checklist_items_sel on checklist_items for select
  using (app_ve_expediente(opportunity_id));
create policy checklist_items_ins on checklist_items for insert
  with check (app_puede_escribir() and app_ve_expediente(opportunity_id));
create policy checklist_items_upd on checklist_items for update
  using (app_puede_escribir() and app_ve_expediente(opportunity_id))
  with check (app_puede_escribir() and app_ve_expediente(opportunity_id));
create policy checklist_items_del on checklist_items for delete
  using (app_puede_escribir() and app_ve_expediente(opportunity_id));

create index if not exists ix_check_opp on checklist_items (opportunity_id, orden);

-- Avance por expediente, para el cuadro de mando.
create or replace view v_checklist_avance
  with (security_invoker = true) as
select opportunity_id,
       count(*)                                          as total,
       count(*) filter (where estado = 'validado')        as validados,
       count(*) filter (where estado = 'pendiente')       as pendientes,
       count(*) filter (where prioridad = 'critica'
                          and estado <> 'validado')       as criticos_abiertos,
       round(100.0 * count(*) filter (where estado = 'validado') / nullif(count(*),0), 0) as pct
  from checklist_items
 group by opportunity_id;

-- El checklist es una carencia de expediente como cualquier otra: si tiene
-- puntos criticos sin validar, la sala de datos no deberia abrirse.
create or replace view v_pendientes
  with (security_invoker = true) as
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo, f.texto as detalle, 1 as prioridad
  from opportunities o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null
union all
select o.id, o.codigo, o.nombre, 'banda_alta',
       'DEALSCORE ' || to_char(v.dealscore, 'FM999.0') || ' · ' || coalesce(v.banda_accion, ''),
       case when v.banda = 'P1' then 2 else 3 end
  from opportunities o
  join v_opportunity_scores v on v.opportunity_id = o.id
 where v.banda in ('P1','P2')
union all
select o.id, o.codigo, o.nombre, 'checklist_critico',
       c.criticos_abiertos || ' puntos criticos sin validar antes de abrir la sala de datos', 3
  from opportunities o
  join v_checklist_avance c on c.opportunity_id = o.id
 where c.criticos_abiertos > 0
union all
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin codigo de expediente con el patron ZRC-[TIPO]-[ANIO]-[GEO]-[NN] (§12.3)', 4
  from opportunities o
 where o.codigo is null
union all
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuacion completa contra las rubricas ancladas', 5
  from opportunities o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null;
