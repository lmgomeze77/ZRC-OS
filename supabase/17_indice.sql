-- =====================================================================
-- ZRC · CAPA 3 — REACTIVAR EL INDICE DE RIESGO
--
-- El indice lleva parado desde el 08/09. No se paro por falta de tiempo:
-- se paro porque era un numero suelto. (fecha, valor, estado) y nada
-- mas. Tres consecuencias, y las tres hay que arreglarlas o volvera a
-- pararse:
--
-- 1. NO SE PODIA REPRODUCIR. Nadie puede decir por que el dia 8 marcaba
--    72. Un numero que no se puede defender se deja de publicar.
-- 2. NO SE PODIA RELLENAR A MEDIAS. O tenias el numero entero o no
--    tenias nada. El dia que solo barres cuatro mesas, no hay que meter.
-- 3. NO COSTABA NADA NO ACTUALIZARLO. No alimentaba ninguna decision.
--
-- Lo que hace este fichero: el indice pasa a DERIVARSE de las lecturas
-- por mesa. Asi se explica ("subio 6 porque financiacion paso de 40 a
-- 70"), un dia parcial es un dia valido, y el estado deja de teclearse:
-- sale de la cobertura.
--
-- LO QUE NO HACE, A PROPOSITO: rellenar el hueco de 32 dias. Esos dias
-- no se leyeron. Interpolarlos fabricaria un mes de lecturas que nadie
-- tomo, que es justo lo que 'reconstruido' hacia y por lo que la serie
-- no se puede usar para nada serio. El hueco se queda, y se ve.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1 · LAS MESAS, COMO DATO ────────────────────────────────────────
-- Las mesas son filas, no una lista en el codigo: cambiar el barrido no
-- puede exigir un despliegue.
create table if not exists risk_mesas (
  clave    text primary key,
  nombre   text not null,
  orden    int  not null default 99,
  peso     numeric(4,3) not null default 1 check (peso > 0),
  activa   boolean not null default true,
  descripcion text
);

comment on table risk_mesas is
  'Las mesas del barrido de ZRC Morning Intelligence. peso relativo; '
  'activa = entra en el indice de hoy. Desactivar una mesa NO reescribe '
  'el pasado: las lecturas ya tomadas siguen contando en sus dias.';

-- ── 2 · UNA LECTURA POR MESA Y DIA ──────────────────────────────────
create table if not exists risk_lecturas (
  fecha       date not null,
  mesa        text not null references risk_mesas on delete restrict,
  valor       int  not null check (valor between 0 and 100),
  -- Sin fundamento no es una lectura, es una corazonada con dos cifras.
  -- No se obliga por constraint para no bloquear el barrido rapido, pero
  -- la vista cuenta cuantas van sin el, y eso si se mira.
  fundamento  text,
  anotado_por uuid references auth.users,
  anotado_en  timestamptz not null default now(),
  primary key (fecha, mesa)
);

comment on column risk_lecturas.valor is
  'De 0 a 100, donde MAS ES MAS RIESGO. Misma direccion que el indice '
  'que ya estaba publicado, para que la serie siga siendo comparable.';

create index if not exists risk_lecturas_fecha_idx on risk_lecturas (fecha desc);

-- ── 3 · EL INDICE, DERIVADO ─────────────────────────────────────────
-- Media ponderada de las mesas leidas ese dia, normalizada sobre el peso
-- que si se leyo. Asi un dia con 5 de 9 mesas da un numero, y la
-- cobertura dice cuanto fiarse de el.
create or replace view v_risk_dia
  with (security_invoker = true) as
with pesos as (select coalesce(sum(peso), 0) as total from risk_mesas where activa)
select l.fecha,
       round(sum(l.valor * m.peso) / sum(m.peso))::int as valor,
       round(100.0 * sum(m.peso) / nullif((select total from pesos), 0))::int as cobertura,
       count(*)::int                                   as mesas_leidas,
       count(*) filter (where l.fundamento is null)::int as sin_fundamento,
       -- El estado deja de teclearse. Cobertura completa es una lectura
       -- publicada; parcial es degradada; y 'reconstruido' desaparece,
       -- porque aqui no se interpola nada.
       case when sum(m.peso) >= (select total from pesos) then 'publicado'
            else 'degradado' end                       as estado
  from risk_lecturas l
  join risk_mesas m on m.clave = l.mesa
 group by l.fecha;

-- ── 4 · LA SERIE COMPLETA, SIN REESCRIBIR EL PASADO ─────────────────
-- Los 21 dias que ya estaban publicados vinieron de otro sitio y NO se
-- pueden descomponer en mesas. Meterlos a la fuerza como lecturas de una
-- mesa inventada seria falsificarlos. Se quedan donde estan, marcados
-- como historico, y la serie une las dos procedencias.
create or replace view v_risk_serie
  with (security_invoker = true) as
select fecha, valor, estado, 'historico'::text as origen,
       null::int as cobertura, null::int as mesas_leidas
  from risk_index
 where fecha not in (select fecha from v_risk_dia)
union all
select fecha, valor, estado, 'mesas', cobertura, mesas_leidas
  from v_risk_dia
 order by fecha;

comment on view v_risk_serie is
  'origen = historico son los dias cargados antes de que el indice se '
  'descompusiera en mesas: no se pueden explicar, solo consultar. Si un '
  'dia tiene lecturas por mesa, esas mandan sobre el valor historico.';

-- ── 5 · EL ESTADO DE HOY, Y SI ESTA CADUCADO ────────────────────────
create or replace view v_risk_estado
  with (security_invoker = true) as
with ult as (select * from v_risk_serie order by fecha desc limit 1),
     ant as (select valor from v_risk_serie order by fecha desc offset 1 limit 1)
select u.fecha, u.valor, u.estado, u.origen, u.cobertura,
       u.valor - (select valor from ant)              as delta,
       (current_date - u.fecha)                       as dias_sin_actualizar,
       (select count(*) from v_risk_serie)::int       as dias_serie,
       -- Tres dias es el limite: un indice de riesgo de hace una semana
       -- no describe el riesgo de hoy, describe el de hace una semana.
       (current_date - u.fecha) > 3                   as caducado
  from ult u;

-- ── 6 · QUE CUESTE ALGO NO ACTUALIZARLO ─────────────────────────────
-- Esta es la parte que de verdad lo reactiva. Lo demas es fontaneria: si
-- el indice caducado no aparece como trabajo pendiente, se volvera a
-- quedar parado en cuanto haya una semana ocupada.
create or replace view v_pendientes_firma
  with (security_invoker = true) as
select 'indice_caducado'::text as motivo,
       'Indice de riesgo sin actualizar desde ' || to_char(e.fecha, 'DD/MM')
         || ' (' || e.dias_sin_actualizar || ' dias). El barrido de mesas esta parado.' as detalle,
       1 as prioridad,
       e.fecha + 1 as vence_en
  from v_risk_estado e
 where e.caducado
union all
select 'mesas_sin_fundamento',
       d.sin_fundamento || ' lecturas de ' || to_char(d.fecha, 'DD/MM')
         || ' sin fundamento anotado: no son lecturas, son cifras sueltas.',
       4, null::date
  from v_risk_dia d
 where d.sin_fundamento > 0
   and d.fecha >= current_date - 7;

comment on view v_pendientes_firma is
  'Pendientes que no cuelgan de ningun expediente, sino de la firma. '
  'v_pendientes sigue siendo la cola por expediente; esta es la otra.';

-- ── 7 · RLS ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['risk_mesas','risk_lecturas'] loop
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
grant select on risk_mesas, risk_lecturas to authenticated;
grant insert, update, delete on risk_mesas, risk_lecturas to authenticated;
grant select on v_risk_dia, v_risk_serie, v_risk_estado, v_pendientes_firma to authenticated;

-- ── 8 · LAS NUEVE MESAS ─────────────────────────────────────────────
-- ATENCION: ESTO ES UNA PROPUESTA, NO VUESTRO BARRIDO.
--
-- El manual habla de "9 mesas" pero no las nombra en lo que tengo, asi
-- que estas nueve son una construccion mia a partir de lo que mueve el
-- riesgo de una operacion en Espana. Cambiadlas: son filas.
--
--   update risk_mesas set nombre = 'El nombre real' where clave = 'M1';
--   update risk_mesas set activa = false where clave = 'M9';
--
-- Los pesos son todos 1 a proposito. Ponderar sin saber que mesa anticipa
-- mejor seria inventar precision, y es el error que la calibracion de la
-- Capa 4 ya esta intentando no cometer.
insert into risk_mesas (clave, nombre, orden, peso, descripcion) values
  ('M1','Macro y tipos',            1, 1, 'Tipos, inflacion y coste de la deuda. Mueve todos los multiplos a la vez.'),
  ('M2','Financiacion bancaria',    2, 1, 'Apetito del banco para operaciones medianas. Sin deuda, se cae el comprador apalancado.'),
  ('M3','Mercado de capitales',     3, 1, 'Salidas, colocaciones y apetito del inversor institucional por Espana.'),
  ('M4','Regulatorio y fiscal',     4, 1, 'Cambios que mueven sectores enteros: vivienda, energia, suelo turistico.'),
  ('M5','Inmobiliario',             5, 1, 'Precio, absorcion y liquidez del ladrillo, por ser la mitad del pipeline.'),
  ('M6','Agroalimentario',          6, 1, 'Campana, agua y precios. La otra mitad del pipeline.'),
  ('M7','Politico e institucional', 7, 1, 'Estabilidad, calendario electoral, seguridad juridica.'),
  ('M8','Divisa y exterior',        8, 1, 'Lo que afecta al comprador extranjero, que es quien paga la prima.'),
  ('M9','Contraparte y crediticio', 9, 1, 'Morosidad, concursos y solvencia del tejido mediano.')
on conflict (clave) do nothing;   -- do nothing, no update: si ya los habeis
                                  -- renombrado, esto no os lo pisa.

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'mesas activas' as concepto, (select count(*)::text from risk_mesas where activa) as valor
union all select 'lecturas por mesa cargadas', (select count(*)::text from risk_lecturas)
union all select 'dias de serie (historico + mesas)', (select count(*)::text from v_risk_serie)
union all select 'ultimo dia con lectura', (select coalesce(to_char(fecha,'YYYY-MM-DD'),'ninguno') from v_risk_estado)
union all select 'dias sin actualizar', (select coalesce(dias_sin_actualizar::text,'-') from v_risk_estado)
union all select 'el indice esta caducado', (select case when caducado then 'SI' else 'no' end from v_risk_estado)
union all select 'pendientes de firma abiertos', (select count(*)::text from v_pendientes_firma);
