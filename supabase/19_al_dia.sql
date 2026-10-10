-- =====================================================================
-- ZRC · PONER LA BASE AL DIA
--
-- Una sola pegada con lo que el diagnostico dijo que falta:
--   15_plazos.sql      -- sin el, la bandeja Hoy no tiene nada que ensenar
--   16_actividad.sql   -- reaplicar: migra la clave foranea a set null,
--                         sin lo cual borrar un expediente falla
--   18_sectorial.sql   -- sectores, rubricas ancladas y cruce con pipeline
--
-- Idempotente: si algo ya esta, no se duplica. Al final sale el
-- diagnostico, asi que el resultado se ve sin ejecutar nada mas.
--
-- Es el mismo SQL de esos ficheros sin los comentarios largos, que
-- siguen en el repositorio.
-- =====================================================================


-- ═══ PLAZOS · que el reloj sea un dato ═══

alter table scoring_bands add column if not exists plazo_horas int;

update scoring_bands set plazo_horas = 48  where clave = 'P1' and plazo_horas is null;
update scoring_bands set plazo_horas = 168 where clave = 'P2' and plazo_horas is null;  -- 7 dias

comment on column scoring_bands.plazo_horas is
  'Horas desde la puntuacion para la accion por defecto de la banda. '
  'Null = sin reloj (watchlist, archivo, descarte).';

alter table checklist_items add column if not exists vence_en date;

comment on column checklist_items.vence_en is
  'Para cuando se espera este punto. Null = sin fecha comprometida.';

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
       'Sin codigo de expediente con el patron ZRC-[TIPO]-[ANIO]-[GEO]-[NN] (§12.3)', 4,
       null::date
  from vivos o
 where o.codigo is null

union all
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuacion completa contra las rubricas ancladas', 5,
       null::date
  from vivos o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null

union all
select o.id, o.codigo, o.nombre, 'checklist_vencido',
       c.area || ' · ' || c.descripcion, 2, c.vence_en
  from vivos o
  join checklist_items c on c.opportunity_id = o.id
 where c.vence_en is not null
   and c.vence_en < current_date
   and c.estado <> 'validado';


-- ═══ ACTIVIDAD · quien cambio que y cuando ═══

create table if not exists activity (
  id             bigserial primary key,
  ocurrido_en    timestamptz not null default now(),
  actor          uuid references auth.users,
  tabla          text not null,
  operacion      text not null check (operacion in ('alta','cambio','baja')),
  opportunity_id uuid references opportunities on delete set null,
  fila_id        text,
  etiqueta       text,      -- como se llama la fila tocada, en palabras
  campos         text[]     -- que columnas cambiaron (solo en 'cambio')
);

comment on table activity is
  'Registro de escrituras. Lo escriben disparadores, nunca la aplicacion. '
  'Solo de agregar: no hay politica de update ni de delete.';

do $$
declare v_nombre text;
begin
  select tc.constraint_name into v_nombre
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
   where tc.table_name = 'activity' and tc.constraint_type = 'FOREIGN KEY'
     and tc.constraint_name like '%opportunity_id%'
     and rc.delete_rule <> 'SET NULL';
  if v_nombre is not null then
    execute format('alter table activity drop constraint %I', v_nombre);
    execute 'alter table activity add constraint activity_opportunity_id_fkey
             foreign key (opportunity_id) references opportunities on delete set null';
    raise notice 'activity.opportunity_id corregido a on delete set null';
  end if;
end $$;

create index if not exists activity_opp_idx  on activity (opportunity_id, ocurrido_en desc);
create index if not exists activity_tiempo_idx on activity (ocurrido_en desc);

create or replace function app_registra_actividad()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fila   jsonb;
  v_vieja  jsonb;
  v_opp    uuid;
  v_op     text;
  v_campos text[];
  v_etq    text;
  c_ruido  text[] := array['actualizado_en','creado_en','id'];
begin
  if    tg_op = 'INSERT' then v_op := 'alta';   v_fila := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_op := 'cambio'; v_fila := to_jsonb(new); v_vieja := to_jsonb(old);
  else                        v_op := 'baja';   v_fila := to_jsonb(old);
  end if;

  if tg_table_name = 'opportunities' then
    v_opp := (v_fila ->> 'id')::uuid;
  else
    v_opp := (v_fila ->> 'opportunity_id')::uuid;
  end if;

  if tg_op = 'DELETE' and v_opp is not null
     and not exists (select 1 from opportunities where id = v_opp) then
    v_opp := null;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}')
      into v_campos
      from jsonb_object_keys(v_fila) k
     where v_fila -> k is distinct from v_vieja -> k
       and not (k = any (c_ruido));
    if v_campos = '{}' then return null; end if;
  end if;

  v_etq := coalesce(
    v_fila ->> 'titulo',   v_fila ->> 'nombre',  v_fila ->> 'descripcion',
    v_fila ->> 'resultado', v_fila ->> 'tipo',   v_fila ->> 'texto',
    v_fila ->> 'area',     v_fila ->> 'model_id');
  if length(v_etq) > 120 then v_etq := left(v_etq, 117) || '...'; end if;

  insert into activity (actor, tabla, operacion, opportunity_id, fila_id, etiqueta, campos)
  values (auth.uid(), tg_table_name, v_op, v_opp,
          coalesce(v_fila ->> 'id', v_fila ->> 'opportunity_id'), v_etq, v_campos);

  return null;  -- after trigger: el valor de retorno no se usa
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'opportunities','scores','documents','checklist_items','decisions',
    'outcomes','economics','strategy','investors','scope_flags',
    'mandates','opportunity_access'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', 'act_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on %I
           for each row execute function app_registra_actividad()',
        'act_' || t, t);
    end if;
  end loop;
end $$;

alter table activity enable row level security;

drop policy if exists act_sel on activity;
create policy act_sel on activity for select
  using (
    case when opportunity_id is null then app_es_miembro()
         else app_ve_expediente(opportunity_id) end
  );

grant select on activity to authenticated;

create or replace view v_actividad
  with (security_invoker = true) as
select a.id, a.ocurrido_en, a.tabla, a.operacion, a.opportunity_id,
       a.fila_id, a.etiqueta, a.campos,
       coalesce(m.nombre, 'sistema') as quien,
       o.nombre as expediente, o.codigo
  from activity a
  left join app_members  m on m.user_id = a.actor
  left join opportunities o on o.id = a.opportunity_id
 order by a.ocurrido_en desc;

grant select on v_actividad to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on activity from anon';
    execute 'revoke all on v_actividad from anon';
  end if;
end $$;

comment on view v_actividad is
  'Actividad legible. quien = "sistema" cuando la escritura no vino de '
  'una sesion de usuario (carga por SQL Editor, por ejemplo), que es la '
  'verdad y no un hueco.';


-- ═══ SECTORIAL · atractivo inversor por sector ═══

create table if not exists sectors (
  clave       text primary key,
  nombre      text not null,
  descripcion text,
  orden       int not null default 99,
  activo      boolean not null default true
);

alter table opportunities add column if not exists sector text references sectors;

comment on column opportunities.sector is
  'Sector del negocio. Null = se deduce de la vertical via sector_map, '
  'que acierta en la mayoria pero no donde la vertical dice el tipo de '
  'mandato en vez del sector. Ponerlo a mano siempre manda.';

create table if not exists sector_map (
  vertical text primary key,
  sector   text not null references sectors on delete cascade
);

comment on table sector_map is
  'Valor por defecto, no verdad: solo se aplica a los expedientes sin '
  'sector propio.';

create table if not exists sector_dimensions (
  clave       text primary key,
  nombre      text not null,
  peso        numeric(4,3) not null check (peso > 0),
  orden       int not null default 99,
  descripcion text
);

create table if not exists sector_rubrics (
  dimension text not null references sector_dimensions on delete cascade,
  tramo     int  not null check (tramo between 0 and 4),
  texto     text not null,
  primary key (dimension, tramo)
);

create table if not exists sector_readings (
  sector     text not null references sectors on delete cascade,
  fecha      date not null,
  dimension  text not null references sector_dimensions on delete cascade,
  tramo      int  not null check (tramo between 0 and 4),
  fundamento text,
  autor      uuid references auth.users,
  anotado_en timestamptz not null default now(),
  primary key (sector, fecha, dimension)
);

comment on column sector_readings.tramo is
  'De 0 a 4, el tramo de la rubrica. Se elige tramo leyendo el ancla, no '
  'se teclea una nota: es lo que separa esto de una opinion con cifras.';

create index if not exists sector_readings_idx on sector_readings (sector, fecha desc);

drop view if exists v_sector_pipeline;   -- depende de esta
drop view if exists v_sector_score;
create view v_sector_score
  with (security_invoker = true) as
with pesos as (select coalesce(sum(peso), 0) as total from sector_dimensions),
ultima as (select sector, max(fecha) as fecha from sector_readings group by sector)
select s.clave, s.nombre, s.orden, u.fecha,
       round(100.0 * sum(r.tramo / 4.0 * d.peso) / sum(d.peso))::int as score,
       round(100.0 * sum(d.peso) / nullif((select total from pesos), 0))::int as cobertura,
       count(*)::int                                     as dimensiones_leidas,
       count(*) filter (where r.fundamento is null)::int as sin_fundamento,
       (current_date - u.fecha)                          as antiguedad_dias,
       (current_date - u.fecha) > 90                     as caducado
  from sectors s
  join ultima u          on u.sector = s.clave
  join sector_readings r on r.sector = s.clave and r.fecha = u.fecha
  join sector_dimensions d on d.clave = r.dimension
 where s.activo
 group by s.clave, s.nombre, s.orden, u.fecha;

drop view if exists v_sector_pipeline;
create view v_sector_pipeline
  with (security_invoker = true) as
with clasificados as (
  select o.id, o.nombre, o.vertical,
         coalesce(o.sector, m.sector, '(sin clasificar)') as sector,
         case when o.sector is not null then 'explicito'
              when m.sector is not null then 'por vertical'
              else 'sin clasificar' end                   as origen
    from opportunities o
    left join sector_map m on m.vertical = o.vertical
   where o.estado not in ('archivado','cerrado')
     and not exists (select 1 from outcomes x where x.opportunity_id = o.id)
),
conteo as (
  select c.sector,
         count(*)::int as expedientes,
         count(*) filter (where v.banda in ('P1','P2'))::int as en_banda_alta,
         count(*) filter (where v.dealscore is null)::int    as sin_puntuar,
         count(*) filter (where c.origen = 'por vertical')::int as por_defecto,
         round(avg(v.dealscore)::numeric, 1)                 as dealscore_medio
    from clasificados c
    left join v_opportunity_scores v on v.opportunity_id = c.id
   group by c.sector
)
select coalesce(s.clave, c.sector)      as sector,
       coalesce(s.nombre, 'Sin clasificar') as nombre,
       coalesce(s.orden, 999)           as orden,
       sc.score, sc.cobertura, sc.fecha as leido_en, sc.caducado,
       coalesce(c.expedientes, 0)       as expedientes,
       coalesce(c.en_banda_alta, 0)     as en_banda_alta,
       coalesce(c.sin_puntuar, 0)       as sin_puntuar,
       coalesce(c.por_defecto, 0)       as por_defecto,
       c.dealscore_medio
  from sectors s
  full outer join conteo c on c.sector = s.clave
  left join v_sector_score sc on sc.clave = s.clave
 where s.activo is not false
 order by sc.score desc nulls last, coalesce(c.expedientes, 0) desc;

comment on view v_sector_pipeline is
  'Atractivo del sector frente a lo que la firma tiene ahi. Un sector '
  'con score alto y cero expedientes es originacion sin hacer; uno con '
  'score bajo y seis expedientes es concentracion que hay que justificar.';

do $$
declare t text;
begin
  foreach t in array array['sectors','sector_map','sector_dimensions',
                           'sector_rubrics','sector_readings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t||'_sel', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format('create policy %I on %I for select using (app_es_miembro())', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (app_puede_escribir())', t||'_ins', t);
    execute format('create policy %I on %I for update using (app_puede_escribir()) with check (app_puede_escribir())', t||'_upd', t);
    execute format('create policy %I on %I for delete using (app_puede_escribir())', t||'_del', t);
  end loop;
end $$;

grant select on sectors, sector_map, sector_dimensions, sector_rubrics, sector_readings to authenticated;
grant insert, update, delete on sectors, sector_map, sector_dimensions, sector_rubrics, sector_readings to authenticated;
grant select on v_sector_score, v_sector_pipeline to authenticated;

insert into sectors (clave, nombre, orden, descripcion) values
  ('INM-RES','Inmobiliario residencial y mixto', 1,'Edificios en renta o para reposicionar en plaza urbana.'),
  ('INM-HTL','Inmobiliario hotelero',            2,'Activo hotelero en explotacion o para reconversion.'),
  ('SUELO',  'Suelo y promocion',                3,'Suelo finalista, turistico o rustico con recorrido urbanistico.'),
  ('AGRO',   'Agroalimentario',                  4,'Explotacion, transformacion y agroindustria.'),
  ('IND',    'Industrial y servicios B2B',       5,'Taller, construccion, distribucion y servicios a empresa.'),
  ('TECH',   'Tecnologia y venture',             6,'Fundraising de compania temprana o en crecimiento.'),
  ('REEST',  'Situaciones especiales',           7,'Reestructuracion, capital de urgencia y preconcursal.')
on conflict (clave) do update set nombre = excluded.nombre, orden = excluded.orden;

insert into sector_map (vertical, sector) values
  ('Inmobiliario',                'INM-RES'),
  ('Inmobiliario / M&A',          'INM-RES'),
  ('Inmobiliario hotelero',       'INM-HTL'),
  ('Inmobiliario rustico',        'SUELO'),
  ('Inmobiliario rústico',        'SUELO'),
  ('Suelo',                       'SUELO'),
  ('Suelo turistico',             'SUELO'),
  ('Suelo turístico',             'SUELO'),
  ('Agro',                        'AGRO'),
  ('Agro-infraestructura',        'AGRO'),
  ('Fundraising startup',         'TECH'),
  ('Reestructuracion + capital',  'REEST'),
  ('Reestructuración + capital',  'REEST')
on conflict (vertical) do update set sector = excluded.sector;

insert into sector_dimensions (clave, nombre, peso, orden, descripcion) values
  ('S1','Profundidad de compradores',   0.20, 1,'Cuantos compradores activos y de cuantos tipos. Decide si hay proceso o conversacion unica.'),
  ('S2','Capital dirigido al sector',   0.15, 2,'Dinero levantado con mandato explicito para este sector en Espana.'),
  ('S3','Multiplos y su tendencia',     0.15, 3,'Nivel y direccion. Barato y expandiendo bate a caro y comprimiendo.'),
  ('S4','Consolidacion en marcha',      0.15, 4,'Si hay buy-and-build activo, hay comprador recurrente y conocido.'),
  ('S5','Fragmentacion del vendedor',   0.15, 5,'Es lo que produce objetos originables del tamano de ZRC.'),
  ('S6','Viento regulatorio y fiscal',  0.10, 6,'En Espana mueve sectores enteros: vivienda, energia, suelo turistico.'),
  ('S7','Financiacion disponible',      0.10, 7,'Sin deuda para el sector, se cae el comprador apalancado.')
on conflict (clave) do update
  set nombre = excluded.nombre, peso = excluded.peso,
      orden = excluded.orden, descripcion = excluded.descripcion;

insert into sector_rubrics (dimension, tramo, texto) values
  ('S1',0,'No se identifica ningún comprador activo en los últimos 12 meses'),
  ('S1',1,'Uno o dos compradores, del mismo tipo y conocidos de siempre'),
  ('S1',2,'Varios compradores pero de un solo perfil: o industrial, o financiero'),
  ('S1',3,'Industriales y financieros compitiendo; al menos cinco nombres plausibles'),
  ('S1',4,'Universo amplio y mixto, con entrada reciente de comprador extranjero'),
  ('S2',0,'Ningún vehículo con mandato para este sector en España'),
  ('S2',1,'Capital generalista que lo mira de pasada, sin tesis propia'),
  ('S2',2,'Dos o tres vehículos con asignación al sector, sin urgencia por desplegar'),
  ('S2',3,'Fondos con tesis declarada y periodo de inversión en marcha'),
  ('S2',4,'Capital levantado específicamente para esto y con presión de calendario'),
  ('S3',0,'Múltiplos en compresión severa y sin suelo visible'),
  ('S3',1,'Comprimiendo, con diferencial amplio entre lo que pide el vendedor y lo que paga el comprador'),
  ('S3',2,'Estables, en la media histórica del sector'),
  ('S3',3,'Estables en la parte alta, con transacciones recientes que lo acreditan'),
  ('S3',4,'En expansión, con comparables públicos del último año que lo confirman'),
  ('S4',0,'Sin consolidación: cada operación es un caso aislado'),
  ('S4',1,'Algún movimiento suelto, sin plataforma que repita'),
  ('S4',2,'Una plataforma comprando, con ritmo irregular'),
  ('S4',3,'Dos o más plataformas activas comprando con regularidad'),
  ('S4',4,'Carrera de consolidación abierta: varias plataformas compitiendo por el mismo activo'),
  ('S5',0,'Sector ya concentrado: quedan pocos independientes y son muy grandes'),
  ('S5',1,'Concentrado, con independientes por debajo del umbral de ZRC'),
  ('S5',2,'Mezcla de grandes grupos e independientes de tamaño irregular'),
  ('S5',3,'Fragmentado, con muchos independientes en el rango de 5 a 30 M EUR'),
  ('S5',4,'Muy fragmentado y de propiedad familiar, con relevo generacional pendiente'),
  ('S6',0,'Cambio regulatorio adverso ya aprobado y en vigor'),
  ('S6',1,'Anteproyecto adverso en tramitación, con texto conocido'),
  ('S6',2,'Marco estable, sin cambios anunciados'),
  ('S6',3,'Marco estable y con incentivo fiscal o de ayudas vigente'),
  ('S6',4,'Cambio favorable recién aprobado que abre operaciones que antes no existían'),
  ('S7',0,'La banca no financia el sector; solo comprador con caja'),
  ('S7',1,'Financiación disponible solo para el comprador con historial en el sector'),
  ('S7',2,'Financiación normal, en condiciones de mercado'),
  ('S7',3,'Apetito claro: varios bancos compiten por financiar operaciones medianas'),
  ('S7',4,'Banca y deuda alternativa compitiendo, con apalancamiento por encima de la media')
on conflict (dimension, tramo) do update set texto = excluded.texto;

update opportunities set sector = 'AGRO' where sector is null and nombre ilike 'BLASCO FRUIT%';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'MAIDEN%';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'MAAR %';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'Sushi Bar Tottori%';


-- ═══ COMPROBACION ═══

with obj(fichero, que) as (values
  ('06_dataroom.sql','documents'), ('06_dataroom.sql','economics'),
  ('09_doctrina.sql','scoring_rubrics'), ('09_doctrina.sql','risk_index'),
  ('11_cola.sql','v_pendientes'), ('12_reserva.sql','opportunity_access'),
  ('13_checklist.sql','checklist_items'),
  ('16_actividad.sql','activity'), ('16_actividad.sql','v_actividad'),
  ('17_indice.sql','risk_mesas'), ('17_indice.sql','risk_lecturas'),
  ('17_indice.sql','v_risk_serie'), ('17_indice.sql','v_risk_estado'),
  ('17_indice.sql','v_pendientes_firma'),
  ('18_sectorial.sql','sectors'), ('18_sectorial.sql','sector_dimensions'),
  ('18_sectorial.sql','sector_readings'),
  ('18_sectorial.sql','v_sector_score'), ('18_sectorial.sql','v_sector_pipeline')
),
col(fichero, que, tabla, columna) as (values
  ('14_checklist_documento.sql','checklist_items.document_id','checklist_items','document_id'),
  ('15_plazos.sql','checklist_items.vence_en','checklist_items','vence_en'),
  ('15_plazos.sql','scoring_bands.plazo_horas','scoring_bands','plazo_horas'),
  ('15_plazos.sql','v_pendientes.vence_en','v_pendientes','vence_en'),
  ('18_sectorial.sql','opportunities.sector','opportunities','sector')
),
filas as (
  select case when to_regclass('public.'||o.que) is null then '1 · FALTA'
              when not has_table_privilege('authenticated','public.'||o.que,'SELECT')
                   then '2 · SIN PERMISO'
              else '9 · ok' end as veredicto,
         o.fichero, o.que
    from obj o
  union all
  select case when not exists (select 1 from information_schema.columns c
                 where c.table_name = col.tabla and c.column_name = col.columna)
              then '1 · FALTA' else '9 · ok' end,
         col.fichero, col.que
    from col
  union all
  select coalesce((select case when rc.delete_rule = 'SET NULL' then '9 · ok'
                    else '1 · VERSION VIEJA (' || rc.delete_rule || ')' end
            from information_schema.table_constraints tc
            join information_schema.referential_constraints rc
              on rc.constraint_name = tc.constraint_name
           where tc.table_name='activity' and tc.constraint_type='FOREIGN KEY'
             and tc.constraint_name like '%opportunity_id%' limit 1), '1 · FALTA'),
         '16_actividad.sql', 'activity: borrado sin cascada'
  union all
  select '0 · DATO', 'pipeline', 'expedientes vivos: ' ||
         (select count(*) from opportunities where estado not in ('archivado','cerrado'))
  union all
  select '0 · DATO', f, etiqueta || ': ' ||
         coalesce((xpath('/row/c/text()',
            query_to_xml('select count(*) as c from ' || quote_ident(t), false, true, '')
          ))[1]::text, '0')
    from (values ('16_actividad.sql','activity','movimientos registrados'),
                 ('17_indice.sql','risk_lecturas','lecturas del indice'),
                 ('18_sectorial.sql','v_sector_score','sectores con lectura')
         ) as v(f, t, etiqueta)
   where to_regclass('public.' || t) is not null
)
select veredicto, fichero, que from filas order by veredicto, fichero, que;
