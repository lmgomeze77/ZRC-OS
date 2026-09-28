-- =====================================================================
-- ZRC · CAPA 3 — TODO EL ESQUEMA POSTERIOR AL BASE, EN UN SOLO FICHERO
--
-- Pegar entero en el SQL Editor de Supabase y ejecutar una vez.
-- Requiere tener ya aplicado 01_schema.sql.
--
-- Reune, en este orden:
--   06_dataroom   documentos, economics, estrategia, inversores
--   08_storage    cubo privado de ficheros
--   09_doctrina   rubricas, puertas GO/NO-GO, indice de riesgo
--   11_cola       cola de decision con la regla de banda
--   12_reserva    expedientes reservados y permiso por persona
--   13_checklist  checklist de preparacion para due diligence
--
-- Solo estructura: ningun dato de expediente. Idempotente — se puede
-- ejecutar mas de una vez sin romper nada.
-- =====================================================================


-- ═══════════════════════════════════════════════════════════════════
-- 06_dataroom.sql
-- ═══════════════════════════════════════════════════════════════════

-- =====================================================================
-- ZRC · CAPA 3 — DATA ROOM POR EXPEDIENTE
--
-- Cada expediente abre su propio data room privado: documentacion,
-- mandato, economics, estrategia y potenciales inversores.
--
-- Estructura unicamente. Aplicar despues de 01_schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- DOCUMENTACION
-- ---------------------------------------------------------------------
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities on delete cascade,
  categoria      text not null check (categoria in
                   ('registral','catastral','tecnico','licencias','legal',
                    'fiscal','comunidad','comercial','financiero','otros')),
  titulo         text not null,
  descripcion    text,
  url            text,
  -- Un documento puede estar previsto y todavia no compilado. Se registra
  -- igual: un hueco declarado es informacion; un hueco invisible, no.
  estado         text not null default 'disponible'
                 check (estado in ('disponible','pendiente','solicitado')),
  orden          int not null default 99,
  anadido_en     timestamptz not null default now(),
  anadido_por    uuid references auth.users
);

-- ---------------------------------------------------------------------
-- ECONOMICS
-- ---------------------------------------------------------------------
create table if not exists economics (
  opportunity_id      uuid primary key references opportunities on delete cascade,
  ev_min_eur          numeric(14,2),
  ev_max_eur          numeric(14,2),
  precio_objetivo_eur numeric(14,2),
  -- Regla de proceso de la firma: el precio no se divulga hasta la fase
  -- de cualificacion del inversor / EOI. La vista lo oculta mientras sea
  -- false, para que no dependa de que alguien se acuerde.
  precio_publicado    boolean not null default false,
  retainer_eur        numeric(14,2),
  exito_pct           numeric(5,2),
  exito_min_eur       numeric(14,2),
  exclusividad        boolean,
  duracion_meses      int,
  notas               text,
  actualizado_en      timestamptz not null default now(),
  constraint ev_coherente check (ev_min_eur is null or ev_max_eur is null
                                 or ev_min_eur <= ev_max_eur)
);

-- ---------------------------------------------------------------------
-- ESTRATEGIA
-- ---------------------------------------------------------------------
create table if not exists strategy (
  opportunity_id  uuid primary key references opportunities on delete cascade,
  angulo          text,   -- por que ZRC y no otro: la respuesta de una frase
  comprador_tipo  text,   -- a quien va dirigido
  proceso         text,   -- como se conduce
  riesgos         text,
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- INVERSORES
--
-- Maestro aparte de `companies`: una compania del pipeline es el activo o
-- su propietario; un inversor es la contraparte compradora. Mezclarlos
-- obliga a distinguirlos con banderas en cada consulta.
-- ---------------------------------------------------------------------
create table if not exists investors (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique,
  tipo           text check (tipo in ('family office','fondo','industrial',
                                      'patrimonialista','promotor','institucional','otro')),
  geo            text,
  tesis          text,
  ticket_min_eur numeric(14,2),
  ticket_max_eur numeric(14,2),
  contacto       text,
  notas          text,
  creado_en      timestamptz not null default now()
);

-- Un inversor aparece en varios expedientes con estados distintos: el
-- estado vive en la relacion, no en el inversor.
create table if not exists investor_outreach (
  opportunity_id  uuid not null references opportunities on delete cascade,
  investor_id     uuid not null references investors on delete cascade,
  estado          text not null default 'identificado'
                  check (estado in ('identificado','contactado','nda',
                                    'en_revision','interesado','oferta','descartado')),
  prioridad       int,
  ultimo_contacto date,
  notas           text,
  actualizado_en  timestamptz not null default now(),
  primary key (opportunity_id, investor_id)
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['documents','economics','strategy','investors','investor_outreach'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (app_es_miembro())', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (app_puede_escribir())', t||'_ins', t);
    execute format('create policy %I on %I for update using (app_puede_escribir()) with check (app_puede_escribir())', t||'_upd', t);
    execute format('create policy %I on %I for delete using (app_puede_escribir())', t||'_del', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- VISTAS
-- ---------------------------------------------------------------------

-- Economics con la regla de divulgacion aplicada: mientras
-- precio_publicado sea false, el precio no sale de la base.
create or replace view v_economics
  with (security_invoker = true) as
select e.opportunity_id,
       e.ev_min_eur, e.ev_max_eur,
       case when e.precio_publicado then e.precio_objetivo_eur end as precio_objetivo_eur,
       e.precio_publicado,
       e.retainer_eur, e.exito_pct, e.exito_min_eur,
       e.exclusividad, e.duracion_meses, e.notas, e.actualizado_en
  from economics e;

-- Estado del data room de cada expediente, de un vistazo.
create or replace view v_dataroom
  with (security_invoker = true) as
select o.id as opportunity_id, o.codigo, o.nombre,
       (select count(*) from documents d
         where d.opportunity_id = o.id and d.estado = 'disponible')      as docs_disponibles,
       (select count(*) from documents d
         where d.opportunity_id = o.id and d.estado <> 'disponible')     as docs_pendientes,
       exists (select 1 from economics e where e.opportunity_id = o.id)  as tiene_economics,
       exists (select 1 from strategy s where s.opportunity_id = o.id)   as tiene_estrategia,
       exists (select 1 from mandates m
                where m.opportunity_id = o.id and m.estado = 'vivo')     as mandato_vivo,
       (select count(*) from investor_outreach io
         where io.opportunity_id = o.id)                                 as inversores,
       (select count(*) from investor_outreach io
         where io.opportunity_id = o.id and io.estado <> 'identificado')  as inversores_contactados
  from opportunities o;

create index if not exists ix_docs_opp      on documents (opportunity_id, categoria, orden);
create index if not exists ix_outreach_opp  on investor_outreach (opportunity_id, estado);


-- ═══════════════════════════════════════════════════════════════════
-- 08_storage.sql
-- ═══════════════════════════════════════════════════════════════════

-- =====================================================================
-- ZRC · CAPA 3 — ALMACENAMIENTO DE DOCUMENTOS
--
-- Los ficheros pasan a vivir en un cubo privado del propio proyecto, con
-- el acceso decidido por la MISMA tabla app_members que gobierna el resto.
-- Una sola fuente de verdad en vez de dos.
--
-- Aplicar despues de 06_dataroom.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- El cubo. public = false: no hay URL publica. Los ficheros solo se
-- sirven mediante enlaces firmados de vida corta que emite la aplicacion.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('expedientes', 'expedientes', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- Politicas del cubo, sobre storage.objects.
--
-- Mismo reparto que en todo lo demas: cualquier miembro lee, solo writer
-- o admin sube y borra. Un no miembro no ve ni un fichero, igual que no
-- ve una fila.
-- ---------------------------------------------------------------------
drop policy if exists exp_leer   on storage.objects;
drop policy if exists exp_subir  on storage.objects;
drop policy if exists exp_editar on storage.objects;
drop policy if exists exp_borrar on storage.objects;

create policy exp_leer on storage.objects for select
  using (bucket_id = 'expedientes' and app_es_miembro());

create policy exp_subir on storage.objects for insert
  with check (bucket_id = 'expedientes' and app_puede_escribir());

create policy exp_editar on storage.objects for update
  using (bucket_id = 'expedientes' and app_puede_escribir())
  with check (bucket_id = 'expedientes' and app_puede_escribir());

create policy exp_borrar on storage.objects for delete
  using (bucket_id = 'expedientes' and app_puede_escribir());

-- ---------------------------------------------------------------------
-- Un documento apunta a un fichero del cubo (storage_path) o a un enlace
-- externo (url). Las dos formas conviven: lo que ya estaba en Drive sigue
-- funcionando, y lo nuevo entra por el cubo.
-- ---------------------------------------------------------------------
alter table documents add column if not exists storage_path text;
alter table documents add column if not exists nombre_fichero text;
alter table documents add column if not exists bytes bigint;

-- Un documento no puede ser las dos cosas a la vez: si lo fuera, no
-- habria forma de saber cual de los dos es el bueno.
alter table documents drop constraint if exists doc_una_sola_fuente;
alter table documents add constraint doc_una_sola_fuente
  check (url is null or storage_path is null);

-- Un documento 'disponible' tiene que ser abrible por algun lado.
alter table documents drop constraint if exists doc_disponible_abrible;
alter table documents add constraint doc_disponible_abrible
  check (estado <> 'disponible' or url is not null or storage_path is not null);


-- ═══════════════════════════════════════════════════════════════════
-- 09_doctrina.sql
-- ═══════════════════════════════════════════════════════════════════

-- =====================================================================
-- ZRC · CAPA 3 — DOCTRINA Y SEÑAL
--
-- Trae a la base tres piezas que el prototipo llevaba incrustadas en el
-- codigo: las rubricas ancladas, las puertas GO/NO-GO y la serie del
-- indice de riesgo.
--
-- Motivo: las tres cambian por decision del CIO o por publicacion diaria,
-- no por despliegue. Incrustadas obligan a tocar codigo para corregir una
-- rubrica, y congelan el indice en la fecha en que se escribio.
--
-- Aplicar despues de 01_schema.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- RUBRICAS ANCLADAS
--
-- Cuelgan del modelo, igual que los pesos: una rubrica solo significa
-- algo junto a la dimension y la version con la que se escribio.
-- tramo 0..4 -> 0-2, 3-4, 5-6, 7-8, 9-10
-- ---------------------------------------------------------------------
create table if not exists scoring_rubrics (
  model_id text not null,
  codigo   text not null,
  tramo    int  not null check (tramo between 0 and 4),
  texto    text not null,
  primary key (model_id, codigo, tramo),
  foreign key (model_id, codigo) references scoring_dimensions (model_id, codigo) on delete cascade
);

-- ---------------------------------------------------------------------
-- PUERTAS GO / NO-GO (Anexo B)
--
-- Las cuatro primeras son eliminatorias: un fallo descarta con
-- independencia de la puntuacion. Se guardan como datos para que
-- cambiar un umbral sea una decision registrada y no un commit.
-- ---------------------------------------------------------------------
create table if not exists scoring_gates (
  model_id    text not null references scoring_models on delete cascade,
  orden       int  not null,
  pregunta    text not null,
  -- Que se evalua: una dimension con umbral, el propio DEALSCORE,
  -- el ambito geografico o los knock-outs de ambito.
  tipo        text not null check (tipo in ('dimension','dealscore','ambito','knockout')),
  codigo      text,              -- dimension, cuando tipo = 'dimension'
  umbral      numeric(5,2),
  etiqueta    text not null,     -- lo que se muestra: 'D2 >= 3'
  eliminatoria boolean not null default false,
  primary key (model_id, orden)
);

-- ---------------------------------------------------------------------
-- INDICE DE RIESGO (Capa 2 · ZRC Morning Intelligence)
--
-- estado distingue una lectura publicada de una degradada o reconstruida
-- por interpolacion. Un valor reconstruido NO es una lectura, y el cuadro
-- de mando lo dibuja hueco para que no se lea como si lo fuera.
-- ---------------------------------------------------------------------
create table if not exists risk_index (
  fecha   date primary key,
  valor   int not null check (valor between 0 and 100),
  estado  text not null default 'publicado'
          check (estado in ('publicado','degradado','reconstruido'))
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['scoring_rubrics','scoring_gates','risk_index'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (app_es_miembro())', t||'_sel', t);
    execute format('create policy %I on %I for insert with check (app_puede_escribir())', t||'_ins', t);
    execute format('create policy %I on %I for update using (app_puede_escribir()) with check (app_puede_escribir())', t||'_upd', t);
    execute format('create policy %I on %I for delete using (app_puede_escribir())', t||'_del', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- VISTA · lectura actual del indice con su variacion
-- ---------------------------------------------------------------------
create or replace view v_risk_actual
  with (security_invoker = true) as
select r.fecha, r.valor, r.estado,
       r.valor - lag(r.valor) over (order by r.fecha) as delta,
       count(*) over ()                               as dias_serie
  from risk_index r
 order by r.fecha desc
 limit 1;


-- ═══════════════════════════════════════════════════════════════════
-- 11_cola.sql
-- ═══════════════════════════════════════════════════════════════════

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
-- Aplicar despues de 01_schema.sql.
-- =====================================================================

create or replace view v_pendientes
  with (security_invoker = true) as
-- 1 · Knock-outs y ambito: preceden a cualquier puntuacion (§5.5)
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo,
       f.texto                as detalle,
       1                      as prioridad
  from opportunities o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null

union all
-- 2 y 3 · La banda fija la accion por defecto y su plazo
select o.id, o.codigo, o.nombre,
       'banda_alta',
       'DEALSCORE ' || to_char(v.dealscore, 'FM999.0') || ' · ' || coalesce(v.banda_accion, ''),
       case when v.banda = 'P1' then 2 else 3 end
  from opportunities o
  join v_opportunity_scores v on v.opportunity_id = o.id
 where v.banda in ('P1','P2')

union all
-- 4 · Higiene de memoria: bloquea el registro formal, no el analisis
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin codigo de expediente con el patron ZRC-[TIPO]-[ANIO]-[GEO]-[NN] (§12.3)', 4
  from opportunities o
 where o.codigo is null

union all
-- 5 · Sin puntuar contra las rubricas ancladas
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuacion completa contra las rubricas ancladas', 5
  from opportunities o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null;


-- ═══════════════════════════════════════════════════════════════════
-- 12_reserva.sql
-- ═══════════════════════════════════════════════════════════════════

-- =====================================================================
-- ZRC · CAPA 3 — EXPEDIENTES RESERVADOS
--
-- Un expediente puede marcarse reservado: entonces solo lo ven los
-- administradores y quien tenga permiso explicito. Por defecto NO lo esta,
-- de modo que nada cambia para lo ya cargado.
--
-- Dos ejes separados, que no se multiplican entre si:
--   el permiso por expediente decide SI lo ves
--   el rol (reader / writer / admin) decide QUE puedes hacer con el
--
-- Aplicar despues de 01_schema.sql, 06_dataroom.sql y 08_storage.sql.
-- =====================================================================

alter table opportunities add column if not exists reservado boolean not null default false;

comment on column opportunities.reservado is
  'true = solo visible para administradores y para quien tenga fila en '
  'opportunity_access. Por defecto false: visible para cualquier miembro.';

create table if not exists opportunity_access (
  opportunity_id uuid not null references opportunities on delete cascade,
  user_id        uuid not null references auth.users on delete cascade,
  concedido_en   timestamptz not null default now(),
  concedido_por  uuid references auth.users,
  nota           text,
  primary key (opportunity_id, user_id)
);

-- ---------------------------------------------------------------------
-- SECURITY DEFINER a proposito: la funcion consulta opportunities y
-- opportunity_access saltandose RLS. Si no lo hiciera, la politica de
-- opportunities se aplicaria dentro de la propia funcion que esa politica
-- usa, y Postgres entraria en recursion.
-- ---------------------------------------------------------------------
create or replace function app_ve_expediente(p_opp uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not app_es_miembro() then false
    when app_es_admin()       then true
    else coalesce(
      (select not o.reservado from opportunities o where o.id = p_opp),
      false)
      or exists (select 1 from opportunity_access a
                  where a.opportunity_id = p_opp and a.user_id = auth.uid())
  end
$$;

alter table opportunity_access enable row level security;
drop policy if exists oa_sel on opportunity_access;
drop policy if exists oa_ins on opportunity_access;
drop policy if exists oa_upd on opportunity_access;
drop policy if exists oa_del on opportunity_access;
-- Conceder y revocar acceso es potestad del administrador. Cada cual ve
-- los permisos que le afectan.
create policy oa_sel on opportunity_access for select
  using (user_id = auth.uid() or app_es_admin());
create policy oa_ins on opportunity_access for insert with check (app_es_admin());
create policy oa_upd on opportunity_access for update using (app_es_admin());
create policy oa_del on opportunity_access for delete using (app_es_admin());

-- ---------------------------------------------------------------------
-- EL EXPEDIENTE
-- ---------------------------------------------------------------------
drop policy if exists opportunities_sel on opportunities;
create policy opportunities_sel on opportunities for select
  using (app_ve_expediente(id));

-- Marcar o desmarcar como reservado es decision del administrador; el
-- resto de la ficha la edita cualquier writer que vea el expediente.
drop policy if exists opportunities_upd on opportunities;
create policy opportunities_upd on opportunities for update
  using (app_puede_escribir() and app_ve_expediente(id))
  with check (app_puede_escribir() and app_ve_expediente(id));

-- ---------------------------------------------------------------------
-- HERENCIA — la parte que se hace mal casi siempre.
--
-- No basta con ocultar la fila del expediente. Si sus documentos siguen
-- listandose, el nombre del fichero ya delata la operacion. Cada tabla
-- hija filtra por el expediente al que pertenece.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['scope_flags','scores','documents','economics',
                           'strategy','investor_outreach','outcomes',
                           'mandates','decisions'] loop
    execute format('drop policy if exists %I on %I', t||'_sel', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format(
      'create policy %I on %I for select using (app_ve_expediente(opportunity_id))', t||'_sel', t);
    execute format(
      'create policy %I on %I for insert with check (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_ins', t);
    execute format(
      'create policy %I on %I for update using (app_puede_escribir() and app_ve_expediente(opportunity_id)) with check (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_upd', t);
    execute format(
      'create policy %I on %I for delete using (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_del', t);
  end loop;
end $$;

-- score_values no lleva opportunity_id: cuelga de scores.
drop policy if exists score_values_sel on score_values;
drop policy if exists score_values_ins on score_values;
drop policy if exists score_values_upd on score_values;
drop policy if exists score_values_del on score_values;
create policy score_values_sel on score_values for select
  using (exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_ins on score_values for insert
  with check (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_upd on score_values for update
  using (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_del on score_values for delete
  using (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));

-- ---------------------------------------------------------------------
-- LOS FICHEROS
--
-- Se guardan bajo <opportunity_id>/..., asi que la primera carpeta de la
-- ruta dice a que expediente pertenecen. Una ruta que no siga el convenio
-- no la ve nadie salvo un administrador: preferimos ocultar de mas.
-- ---------------------------------------------------------------------
create or replace function app_ve_ruta(p_name text)
  returns boolean language sql stable as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
      then app_ve_expediente(((storage.foldername(p_name))[1])::uuid)
    else app_es_admin()
  end
$$;

drop policy if exists exp_leer   on storage.objects;
drop policy if exists exp_subir  on storage.objects;
drop policy if exists exp_editar on storage.objects;
drop policy if exists exp_borrar on storage.objects;

create policy exp_leer on storage.objects for select
  using (bucket_id = 'expedientes' and app_ve_ruta(name));
create policy exp_subir on storage.objects for insert
  with check (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));
create policy exp_editar on storage.objects for update
  using (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name))
  with check (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));
create policy exp_borrar on storage.objects for delete
  using (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));


-- ═══════════════════════════════════════════════════════════════════
-- 13_checklist.sql
-- ═══════════════════════════════════════════════════════════════════

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
