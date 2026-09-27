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
