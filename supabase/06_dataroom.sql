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
