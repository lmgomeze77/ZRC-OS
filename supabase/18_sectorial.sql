-- =====================================================================
-- ZRC · CAPA 3 — ATRACTIVO INVERSOR POR SECTOR (ESPANA)
--
-- Responde una pregunta que el DEALSCORE no responde: no "que hago con
-- este expediente que ya tengo", sino "donde conviene cazar". Son dos
-- preguntas distintas y por eso son dos numeros distintos.
--
-- TRES DECISIONES QUE SON EL FICHERO:
--
-- 1. NO ALIMENTA AL DEALSCORE, Y NO DEBE. D1 ya pregunta por el encaje
--    estrategico y D8 por la competencia. Meter el atractivo del sector
--    dentro del score del expediente contaria lo mismo dos veces y
--    ensuciaria una calibracion que todavia no tiene ni una sola tasa
--    base. Van al lado, no dentro.
--
-- 2. RUBRICAS ANCLADAS, COMO EL DEALSCORE. Un sector puntuado sin anclas
--    delante es una opinion con decimales. Mismo metodo que ya usais:
--    cinco tramos escritos por dimension, y se elige tramo, no cifra.
--
-- 3. CADA LECTURA LLEVA SU FUNDAMENTO Y SU FECHA. Un atractivo sectorial
--    de hace seis meses no es un atractivo sectorial: es historia. La
--    vista dice la antiguedad de cada sector, y la cara.
--
-- OJO A LA DIRECCION: aqui MAS ES MEJOR (100 = sector muy atractivo).
-- En el indice de riesgo MAS ES PEOR. Son dos escalas opuestas a
-- proposito -- cada una apunta en la direccion que se lee natural -- y
-- por eso el cuadro de mando las etiqueta siempre.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1 · LOS SECTORES ────────────────────────────────────────────────
create table if not exists sectors (
  clave       text primary key,
  nombre      text not null,
  descripcion text,
  orden       int not null default 99,
  activo      boolean not null default true
);

-- ── 2 · EL PUENTE CON EL PIPELINE ───────────────────────────────────
-- Aqui hay dos problemas distintos con opportunities.vertical, y hacen
-- falta dos soluciones.
--
-- PROBLEMA A: la misma cosa escrita de cuatro maneras. En los 21
-- expedientes hay "Inmobiliario", "Inmobiliario hotelero",
-- "Inmobiliario rustico" e "Inmobiliario / M&A". Cruzar el score contra
-- esa columna lo partiria en cuatro sectores falsos. Lo resuelve una
-- tabla de equivalencias.
--
-- PROBLEMA B, mas serio: vertical mezcla TIPO DE MANDATO con SECTOR.
-- "M&A sell-side" no es un sector, es como se vende. Lo llevan tres
-- expedientes que no tienen nada que ver entre si: un taller de
-- Mercedes, una constructora y BLASCO FRUIT. Si el sector se dedujera
-- solo de la vertical, el unico mandato vivo de la firma -- y la tesis
-- agro entera -- quedaria clasificado como industrial.
--
-- Por eso el sector es una columna propia del expediente, y la tabla de
-- equivalencias es solo el valor POR DEFECTO para quien no la tenga
-- puesta. El sector es del negocio que se vende, no de como se vende.
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

-- ── 3 · LAS DIMENSIONES ─────────────────────────────────────────────
create table if not exists sector_dimensions (
  clave       text primary key,
  nombre      text not null,
  peso        numeric(4,3) not null check (peso > 0),
  orden       int not null default 99,
  descripcion text
);

-- ── 4 · LAS RUBRICAS ANCLADAS ───────────────────────────────────────
create table if not exists sector_rubrics (
  dimension text not null references sector_dimensions on delete cascade,
  tramo     int  not null check (tramo between 0 and 4),
  texto     text not null,
  primary key (dimension, tramo)
);

-- ── 5 · LAS LECTURAS ────────────────────────────────────────────────
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

-- ── 6 · EL SCORE, DERIVADO ──────────────────────────────────────────
-- Media ponderada sobre el peso que SI se leyo, igual que el indice: un
-- sector con 5 de 7 dimensiones da numero, y la cobertura dice cuanto
-- fiarse. La fecha de corte es la ultima en la que se toco ese sector.
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
       -- Noventa dias: un trimestre. Mas alla de eso el numero describe
       -- un mercado que ya no es el que hay delante.
       (current_date - u.fecha) > 90                     as caducado
  from sectors s
  join ultima u          on u.sector = s.clave
  join sector_readings r on r.sector = s.clave and r.fecha = u.fecha
  join sector_dimensions d on d.clave = r.dimension
 where s.activo
 group by s.clave, s.nombre, s.orden, u.fecha;

-- ── 7 · EL CRUCE QUE DA EL VALOR ────────────────────────────────────
-- El score solo es util contra el pipeline: dice si estas cazando donde
-- hay caza. Incluye los sectores SIN lectura y los expedientes SIN
-- sector, porque los dos huecos son informacion.
-- Se retira antes de crearla: `create or replace` no sabe anadir una
-- columna en medio, y esta vista ha cambiado de forma al aparecer
-- por_defecto. Reaplicar el fichero tiene que funcionar siempre.
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
         -- Cuantos estan ahi solo porque lo dijo la vertical. Es el
         -- numero que avisa de que el reparto puede estar mal.
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

-- ── 8 · RLS ─────────────────────────────────────────────────────────
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


-- Permisos explicitos. Supabase concede select a authenticated por
-- privilegios por defecto sobre lo que se crea en public, asi que esto
-- normalmente no hace falta -- pero cuando esos privilegios no estan
-- como se espera, el sintoma es que la pagina dice "pendiente de
-- aplicar" sobre algo que SI esta aplicado. Costaba una linea evitarlo.
grant select on sectors, sector_map, sector_dimensions, sector_rubrics, sector_readings to authenticated;
grant insert, update, delete on sectors, sector_map, sector_dimensions, sector_rubrics, sector_readings to authenticated;
grant select on v_sector_score, v_sector_pipeline to authenticated;

-- ── 9 · LOS SECTORES, SACADOS DE VUESTRO PIPELINE ───────────────────
-- Siete, no una taxonomia de consultora: cubren los 21 expedientes que
-- ya hay y nada mas.
insert into sectors (clave, nombre, orden, descripcion) values
  ('INM-RES','Inmobiliario residencial y mixto', 1,'Edificios en renta o para reposicionar en plaza urbana.'),
  ('INM-HTL','Inmobiliario hotelero',            2,'Activo hotelero en explotacion o para reconversion.'),
  ('SUELO',  'Suelo y promocion',                3,'Suelo finalista, turistico o rustico con recorrido urbanistico.'),
  ('AGRO',   'Agroalimentario',                  4,'Explotacion, transformacion y agroindustria.'),
  ('IND',    'Industrial y servicios B2B',       5,'Taller, construccion, distribucion y servicios a empresa.'),
  ('TECH',   'Tecnologia y venture',             6,'Fundraising de compania temprana o en crecimiento.'),
  ('REEST',  'Situaciones especiales',           7,'Reestructuracion, capital de urgencia y preconcursal.')
on conflict (clave) do update set nombre = excluded.nombre, orden = excluded.orden;

-- Las equivalencias con lo que hay escrito hoy en opportunities.vertical.
--
-- Faltan "M&A sell-side" y "M&A minoritaria" A PROPOSITO. Dicen COMO se
-- vende, no QUE se vende: las llevan un taller de Mercedes, una
-- constructora y BLASCO FRUIT. Mapearlas a industrial acertaria en dos
-- de tres y fallaria en el unico mandato vivo de la firma. Un acierto de
-- dos tercios en silencio es peor que un hueco que se ve: esos
-- expedientes salen SIN CLASIFICAR hasta que alguien diga de que son.
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

-- ── 10 · LAS DIMENSIONES Y SUS PESOS ────────────────────────────────
-- Los pesos NO salen de evidencia: no hay. Salen de que ZRC es una casa
-- de asesoramiento de tamano medio, no un fondo. Para vosotros lo que
-- manda es si hay comprador y si hay objeto de vuestro tamano; de ahi
-- que S1 y S5 pesen mas que la divisa. Es una hipotesis estructural, y
-- se revisa igual que las rubricas: cuando haya desenlaces, mirando que
-- dimension anticipo los sectores donde de verdad cerrasteis.
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

-- ── 11 · LAS ANCLAS ─────────────────────────────────────────────────
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

-- ── 12 · LOS QUE HAY QUE DECIR A MANO ───────────────────────────────
-- Los tres que la vertical no puede clasificar. Se hace por nombre y
-- solo si existen, asi que este fichero se puede aplicar antes o despues
-- de cargar los expedientes; si se aplica antes, basta con volver a
-- pasarlo despues.
update opportunities set sector = 'AGRO' where sector is null and nombre ilike 'BLASCO FRUIT%';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'MAIDEN%';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'MAAR %';
update opportunities set sector = 'IND'  where sector is null and nombre ilike 'Sushi Bar Tottori%';

-- Lo que quede sin clasificar sale asi, y se arregla igual:
--
--   select nombre, vertical from opportunities where sector is null;
--   update opportunities set sector = 'IND' where nombre = '...';

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'sectores activos' as concepto, (select count(*)::text from sectors where activo) as valor,
       case when (select count(*) from sectors where activo) = 7 then 'ok' else 'REVISAR' end as veredicto
union all
select 'dimensiones', (select count(*)::text from sector_dimensions),
       case when (select count(*) from sector_dimensions) = 7 then 'ok' else 'REVISAR' end
union all
select 'los pesos suman 1', (select round(sum(peso),3)::text from sector_dimensions),
       case when (select sum(peso) from sector_dimensions) = 1 then 'ok' else 'REVISAR' end
union all
select 'anclas escritas', (select count(*)::text from sector_rubrics),
       case when (select count(*) from sector_rubrics) = 35 then 'ok' else 'REVISAR: deberian ser 35' end
union all
select 'dimensiones con los 5 tramos',
       (select count(*)::text from (select dimension from sector_rubrics group by dimension having count(*) = 5) t),
       case when (select count(*) from (select dimension from sector_rubrics group by dimension having count(*) = 5) t) = 7
            then 'ok' else 'REVISAR' end
union all
select 'expedientes vivos sin sector asignado',
       (select coalesce(sum(expedientes)::text,'0') from v_sector_pipeline where sector = '(sin clasificar)'),
       'si no es 0: select nombre, vertical from opportunities where sector is null'
union all
select 'expedientes clasificados por su vertical',
       (select coalesce(sum(por_defecto)::text,'0') from v_sector_pipeline),
       'repasalos: la vertical acierta el sector, pero no siempre'
union all
select 'sectores con lectura', (select count(*)::text from v_sector_score), 'empieza en 0';
