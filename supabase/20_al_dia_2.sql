-- =====================================================================
-- ZRC · SEGUNDA PASADA
--
-- El diagnostico tras la primera dijo que quedaban dos cosas:
--   14_checklist_documento.sql -- un punto del checklist apunta al
--                                 documento que lo cierra
--   17_indice.sql              -- el indice de riesgo entero: no estaba
--                                 aplicado, al contrario de lo que yo
--                                 habia dado por hecho
--
-- Idempotente. Termina con el diagnostico.
-- =====================================================================


-- ═══ CHECKLIST → DOCUMENTO ═══

alter table checklist_items
  add column if not exists document_id uuid references documents on delete set null;

comment on column checklist_items.document_id is
  'Documento del data room que responde a este punto. Null = sin resolver.';


-- ═══ INDICE DE RIESGO ═══

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

create table if not exists risk_lecturas (
  fecha       date not null,
  mesa        text not null references risk_mesas on delete restrict,
  valor       int  not null check (valor between 0 and 100),
  fundamento  text,
  anotado_por uuid references auth.users,
  anotado_en  timestamptz not null default now(),
  primary key (fecha, mesa)
);

comment on column risk_lecturas.valor is
  'De 0 a 100, donde MAS ES MAS RIESGO. Misma direccion que el indice '
  'que ya estaba publicado, para que la serie siga siendo comparable.';

create index if not exists risk_lecturas_fecha_idx on risk_lecturas (fecha desc);

create or replace view v_risk_dia
  with (security_invoker = true) as
with pesos as (select coalesce(sum(peso), 0) as total from risk_mesas where activa)
select l.fecha,
       round(sum(l.valor * m.peso) / sum(m.peso))::int as valor,
       round(100.0 * sum(m.peso) / nullif((select total from pesos), 0))::int as cobertura,
       count(*)::int                                   as mesas_leidas,
       count(*) filter (where l.fundamento is null)::int as sin_fundamento,
       case when sum(m.peso) >= (select total from pesos) then 'publicado'
            else 'degradado' end                       as estado
  from risk_lecturas l
  join risk_mesas m on m.clave = l.mesa
 group by l.fecha;

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

create or replace view v_risk_estado
  with (security_invoker = true) as
with ult as (select * from v_risk_serie order by fecha desc limit 1),
     ant as (select valor from v_risk_serie order by fecha desc offset 1 limit 1)
select u.fecha, u.valor, u.estado, u.origen, u.cobertura,
       u.valor - (select valor from ant)              as delta,
       (current_date - u.fecha)                       as dias_sin_actualizar,
       (select count(*) from v_risk_serie)::int       as dias_serie,
       (current_date - u.fecha) > 3                   as caducado
  from ult u;

create or replace view v_pendientes_firma
  with (security_invoker = true) as
select 'indice_caducado'::text as motivo,
       'Índice de riesgo sin actualizar desde ' || to_char(e.fecha, 'DD/MM')
         || ' (' || e.dias_sin_actualizar || ' días). El barrido de mesas está parado.' as detalle,
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

grant select on risk_mesas, risk_lecturas to authenticated;
grant insert, update, delete on risk_mesas, risk_lecturas to authenticated;
grant select on v_risk_dia, v_risk_serie, v_risk_estado, v_pendientes_firma to authenticated;

insert into risk_mesas (clave, nombre, orden, peso, descripcion) values
  ('M1','Macro y tipos',            1, 1, 'Tipos, inflación y coste de la deuda. Mueve todos los múltiplos a la vez.'),
  ('M2','Financiación bancaria',    2, 1, 'Apetito del banco para operaciones medianas. Sin deuda, se cae el comprador apalancado.'),
  ('M3','Mercado de capitales',     3, 1, 'Salidas, colocaciones y apetito del inversor institucional por España.'),
  ('M4','Regulatorio y fiscal',     4, 1, 'Cambios que mueven sectores enteros: vivienda, energía, suelo turístico.'),
  ('M5','Inmobiliario',             5, 1, 'Precio, absorción y liquidez del ladrillo, por ser la mitad del pipeline.'),
  ('M6','Agroalimentario',          6, 1, 'Campaña, agua y precios. La otra mitad del pipeline.'),
  ('M7','Político e institucional', 7, 1, 'Estabilidad, calendario electoral, seguridad jurídica.'),
  ('M8','Divisa y exterior',        8, 1, 'Lo que afecta al comprador extranjero, que es quien paga la prima.'),
  ('M9','Contraparte y crediticio', 9, 1, 'Morosidad, concursos y solvencia del tejido mediano.')
on conflict (clave) do nothing;   -- do nothing, no update: si ya los habeis


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
