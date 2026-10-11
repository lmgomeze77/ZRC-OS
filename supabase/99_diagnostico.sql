-- =====================================================================
-- ZRC · QUE HAY APLICADO. UNA SOLA CONSULTA.
--
-- Una sola a proposito: el SQL Editor de Supabase solo ensena el
-- resultado de la ULTIMA sentencia, asi que un diagnostico en tres
-- consultas ocultaba dos tercios de la respuesta.
--
-- El veredicto va primero para que se lea en una pantalla estrecha, y
-- lo que falta sale arriba. No cambia nada.
-- =====================================================================
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
  ('18_sectorial.sql','opportunities.sector','opportunities','sector'),
  ('22_metodos.sql','v_risk_serie.metodo','v_risk_serie','metodo'),
  ('22_metodos.sql','v_risk_estado.brecha','v_risk_estado','brecha')
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
  -- Las nueve mesas del briefing. No basta con que risk_mesas exista:
  -- si solo lleva las M1..M9 que invente yo, el indice no se puede
  -- reproducir desde el briefing y la ingesta diaria no casa.
  select case
           when to_regclass('public.risk_mesas') is null then '1 · FALTA'
           when coalesce((xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from risk_mesas'
                  ' where clave = ''macro'' and activa', false, true, '')
                ))[1]::text, '0') = '0' then '1 · FALTA'
           else '9 · ok' end,
         '21_mesas_reales.sql', 'las nueve mesas del briefing'
  union all
  -- El ultimo dia con indice de mesas. Es la respuesta directa a "el
  -- indice sigue parado en una fecha vieja": si aqui sale un dia de
  -- hace semanas, falta la serie, no el despliegue.
  select '0 · DATO', '21_mesas_reales.sql', 'ultimo dia con mesas: ' ||
         coalesce((xpath('/row/c/text()', query_to_xml(
            'select coalesce(max(fecha)::text, ''ninguno'') as c from v_risk_dia',
            false, true, '')))[1]::text, 'ninguno')
    where to_regclass('public.v_risk_dia') is not null
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
   -- Solo se cuenta lo que existe: referenciar una tabla ausente dentro
   -- de la consulta la tumbaria entera.
   where to_regclass('public.' || t) is not null
)
select veredicto, fichero, que from filas order by veredicto, fichero, que;
