-- =====================================================================
-- ZRC · CAPA 3 — MEMORIA
-- Esquema para Supabase / PostgreSQL 15+.
--
-- Estructura unicamente: no contiene ningun dato de expediente.
-- Los datos se cargan aparte y no viven en este repositorio.
--
-- Orden de aplicacion:
--   01_schema.sql   (este fichero)
--   02_modelos.sql  (modelo de scoring: dimensiones, pesos, bandas)
--   03_seed.sql     (expedientes reales — NO versionar en repo publico)
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- =====================================================================
-- 1 · IDENTIDAD Y PERMISOS
--
-- El reparto ver / editar vive aqui y en ningun otro sitio. Cambiar a
-- alguien de lector a editor es un UPDATE de una fila: no hay que tocar
-- codigo, ni redesplegar, ni repartir claves nuevas.
-- =====================================================================

create table if not exists app_members (
  user_id   uuid primary key references auth.users on delete cascade,
  nombre    text,
  rol       text not null default 'reader'
            check (rol in ('reader','writer','admin')),
  creado_en timestamptz not null default now()
);

comment on table app_members is
  'Quien puede entrar y con que nivel. reader = solo lectura; '
  'writer = puede puntuar y editar; admin = ademas gestiona miembros.';

-- SECURITY DEFINER a proposito: estas funciones leen app_members saltandose
-- RLS. Sin eso, una politica sobre app_members que consulte app_members
-- entra en recursion infinita y Postgres aborta la consulta.
create or replace function app_rol() returns text
  language sql stable security definer set search_path = public as $$
  select rol from app_members where user_id = auth.uid()
$$;

create or replace function app_es_miembro() returns boolean
  language sql stable as $$ select app_rol() is not null $$;

create or replace function app_puede_escribir() returns boolean
  language sql stable as $$ select app_rol() in ('writer','admin') $$;

create or replace function app_es_admin() returns boolean
  language sql stable as $$ select app_rol() = 'admin' $$;

alter table app_members enable row level security;

create policy m_sel on app_members for select
  using (user_id = auth.uid() or app_es_admin());
create policy m_ins on app_members for insert with check (app_es_admin());
create policy m_upd on app_members for update using (app_es_admin());
create policy m_del on app_members for delete using (app_es_admin());

-- =====================================================================
-- 2 · ENTIDADES
-- =====================================================================

create table if not exists companies (
  id        uuid primary key default gen_random_uuid(),
  nombre    text not null,
  cif       text,
  pais      text,
  notas     text,
  creado_en timestamptz not null default now()
);

create table if not exists contacts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid references companies on delete set null,
  nombre     text not null,
  cargo      text,
  email      text,
  telefono   text,
  -- Refleja D2 (acceso al decisor): de que tipo es la via, no como de buena es.
  via        text check (via in ('directa','calida','indirecta','fria')),
  es_decisor boolean not null default false,
  notas      text
);

-- Expedientes. El patron de codigo lo fija el manual (§12.3):
--   ZRC-[TIPO]-[ANIO]-[GEO]-[NN]
-- Se admite NULL porque un expediente puede entrar antes de codificarse,
-- pero sin codigo no deberia registrarse como vivo.
create table if not exists opportunities (
  id         uuid primary key default gen_random_uuid(),
  codigo     text unique
             check (codigo is null or codigo ~ '^ZRC-[A-Z]{2,4}-[0-9]{4}-[A-Z]{2,4}-[0-9]{2}$'),
  nombre     text not null,
  plaza      text,
  vertical   text not null,
  geo        text not null,
  company_id uuid references companies on delete set null,
  estado     text not null default 'originacion'
             check (estado in ('originacion','cualificacion','mandato','cerrado','archivado')),
  creado_en  timestamptz not null default now(),
  creado_por uuid references auth.users
);

-- Avisos de ambito y gobernanza (§3.2, §5.5, §12.3, §13.4).
-- 'stop' = verificar antes de consumir tiempo analitico; 'warn' = atencion.
create table if not exists scope_flags (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities on delete cascade,
  nivel          text not null check (nivel in ('stop','warn')),
  texto          text not null,
  referencia     text,
  resuelto_en    timestamptz,
  resuelto_por   uuid references auth.users
);

create table if not exists mandates (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities on delete set null,
  company_id     uuid references companies on delete set null,
  tipo           text,
  estado         text not null default 'vivo'
                 check (estado in ('vivo','pausado','cerrado')),
  firmado_en     date,
  vence_en       date,
  exclusivo      boolean not null default false,
  retainer_eur   numeric(14,2),
  exito_pct      numeric(5,2),
  notas          text
);

create table if not exists theses (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  vertical   text,
  cuerpo     text,
  vigente    boolean not null default true,
  creado_en  timestamptz not null default now(),
  creado_por uuid references auth.users
);

create table if not exists decisions (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid references opportunities on delete cascade,
  tipo           text not null check (tipo in ('go','no-go','excepcion','aplazada')),
  motivo         text not null,
  decidido_en    timestamptz not null default now(),
  decidido_por   uuid references auth.users
);

-- =====================================================================
-- 3 · MODELO DE SCORING — VERSIONADO
--
-- El corpus arrastra DOS modelos incompatibles que usan los mismos
-- nombres D1..D8 con significados y pesos distintos (manual ZOS frente a
-- DEALSCORE). Una puntuacion guardada bajo uno y leida bajo el otro da
-- una banda equivocada sin ningun error visible.
--
-- Por eso el modelo NO esta implicito: cada puntuacion apunta al modelo
-- con el que se hizo, y los pesos y bandas son datos, no constantes en
-- el codigo. Mientras convivan los dos, cada cifra sigue siendo legible.
-- =====================================================================

create table if not exists scoring_models (
  id          text primary key,          -- p.ej. 'dealscore-v1'
  familia     text not null,             -- 'DEALSCORE' | 'ZOS'
  version     text not null,
  descripcion text,
  activo      boolean not null default false,
  unique (familia, version)
);

create table if not exists scoring_dimensions (
  model_id  text not null references scoring_models on delete cascade,
  codigo    text not null,               -- 'D1'..'D8'
  nombre    text not null,
  peso      numeric(5,2) not null check (peso > 0),
  -- Metadato de PRESENTACION. La rubrica ya esta escrita en la direccion
  -- correcta (10 siempre es mejor), asi que el calculo NO invierte nada.
  -- Invertir aqui contaria dos veces la inversion.
  invertida boolean not null default false,
  orden     int not null,
  primary key (model_id, codigo)
);

create table if not exists scoring_bands (
  model_id text not null references scoring_models on delete cascade,
  clave    text not null,                -- 'P1'..'P4', 'DESCARTE'
  etiqueta text not null,
  minimo   numeric(5,2) not null,
  accion   text,
  primary key (model_id, clave)
);

-- Un acto de puntuacion: quien, cuando, con que modelo.
-- Se conservan las sucesivas; la vista toma la ultima por modelo.
create table if not exists scores (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities on delete cascade,
  model_id       text not null references scoring_models,
  autor          uuid references auth.users,
  creado_en      timestamptz not null default now(),
  notas          text
);

create table if not exists score_values (
  score_id uuid not null references scores on delete cascade,
  codigo   text not null,
  valor    int  not null check (valor between 0 and 10),
  primary key (score_id, codigo)
);

-- =====================================================================
-- 4 · DESENLACES
--
-- Sin esto no hay tasa base, y sin tasa base el DEALSCORE es una opinion
-- ordenada. Registrar tambien lo que salio mal y lo descartado: un
-- backtest hecho solo con exitos es sesgo de supervivencia.
-- =====================================================================

create table if not exists outcomes (
  opportunity_id uuid primary key references opportunities on delete cascade,
  resultado      text not null
                 check (resultado in ('cerrado','abortado','perdido','descartado')),
  fecha          date not null,
  honorarios_eur numeric(14,2),
  motivo         text,
  registrado_por uuid references auth.users
);

-- =====================================================================
-- 5 · RLS
--
-- Toda tabla con RLS activo y politicas explicitas. Leer exige ser
-- miembro; escribir exige writer o admin. La interfaz puede ocultar
-- controles, pero quien dice que no es esta capa.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'companies','contacts','opportunities','scope_flags','mandates',
    'theses','decisions','scoring_models','scoring_dimensions',
    'scoring_bands','scores','score_values','outcomes'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select using (app_es_miembro())',
      t||'_sel', t);
    execute format(
      'create policy %I on %I for insert with check (app_puede_escribir())',
      t||'_ins', t);
    execute format(
      'create policy %I on %I for update using (app_puede_escribir()) with check (app_puede_escribir())',
      t||'_upd', t);
    execute format(
      'create policy %I on %I for delete using (app_puede_escribir())',
      t||'_del', t);
  end loop;
end $$;

-- =====================================================================
-- 6 · VISTAS
--
-- security_invoker: la vista se evalua con los permisos de quien
-- consulta, no del propietario. Sin esto una vista filtra por encima de
-- RLS y cualquier miembro veria todo lo que ve el dueno del objeto.
-- =====================================================================

create or replace view v_opportunity_scores
  with (security_invoker = true) as
with ultima as (
  select distinct on (s.opportunity_id, s.model_id)
         s.id as score_id, s.opportunity_id, s.model_id, s.autor, s.creado_en
    from scores s
   order by s.opportunity_id, s.model_id, s.creado_en desc
),
calc as (
  select u.opportunity_id, u.model_id, u.score_id, u.autor, u.creado_en,
         round(sum(sv.valor * sd.peso) / 10.0, 1) as dealscore,
         count(*)                                 as dims_puntuadas,
         (select count(*) from scoring_dimensions d where d.model_id = u.model_id)
                                                  as dims_modelo
    from ultima u
    join score_values sv       on sv.score_id = u.score_id
    join scoring_dimensions sd on sd.model_id = u.model_id and sd.codigo = sv.codigo
   group by u.opportunity_id, u.model_id, u.score_id, u.autor, u.creado_en
)
select o.id as opportunity_id, o.codigo, o.nombre, o.plaza, o.vertical,
       o.geo, o.estado,
       c.model_id, c.score_id, c.autor, c.creado_en,
       -- Solo se considera puntuado si estan las ocho dimensiones: un
       -- parcial da una cifra mas baja que parece una valoracion real.
       case when c.dims_puntuadas = c.dims_modelo then c.dealscore end as dealscore,
       coalesce(c.dims_puntuadas, 0) as dims_puntuadas,
       c.dims_modelo,
       b.clave    as banda,
       b.etiqueta as banda_etiqueta,
       b.accion   as banda_accion
  from opportunities o
  left join calc c on c.opportunity_id = o.id
  left join lateral (
    select sb.clave, sb.etiqueta, sb.accion
      from scoring_bands sb
     where sb.model_id = c.model_id
       and c.dims_puntuadas = c.dims_modelo
       and c.dealscore >= sb.minimo
     order by sb.minimo desc
     limit 1
  ) b on true;

create or replace view v_mandatos_vivos
  with (security_invoker = true) as
select m.*, o.codigo as expediente_codigo, o.nombre as expediente,
       co.nombre as compania
  from mandates m
  left join opportunities o on o.id = m.opportunity_id
  left join companies co    on co.id = m.company_id
 where m.estado = 'vivo';

-- Lo que exige accion antes de seguir analizando.
create or replace view v_pendientes
  with (security_invoker = true) as
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo,
       f.texto as detalle, 1 as prioridad
  from opportunities o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null
union all
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin codigo de expediente: bloquea el registro formal (§12.3)', 2
  from opportunities o
 where o.codigo is null
union all
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuacion completa contra las rubricas ancladas', 3
  from opportunities o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null;

-- =====================================================================
-- 7 · INDICES
-- =====================================================================
create index if not exists ix_scores_opp    on scores (opportunity_id, model_id, creado_en desc);
create index if not exists ix_flags_opp     on scope_flags (opportunity_id) where resuelto_en is null;
create index if not exists ix_opp_vertical  on opportunities (vertical);
create index if not exists ix_mandates_est  on mandates (estado);
