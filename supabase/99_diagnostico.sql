-- =====================================================================
-- ZRC · QUE HAY APLICADO DE VERDAD
--
-- No cambia nada. Dice, modulo por modulo, si sus objetos existen, si
-- 'authenticated' puede leerlos (que es con quien entra el navegador) y
-- cuantas filas tienen. Ejecutar en el SQL Editor de Supabase.
-- =====================================================================
with objetos(modulo, fichero, obj, tipo) as (values
  ('Esquema base',   '01_schema.sql',    'opportunities',      'tabla'),
  ('Esquema base',   '01_schema.sql',    'v_opportunity_scores','vista'),
  ('Data room',      '06_dataroom.sql',  'documents',          'tabla'),
  ('Data room',      '06_dataroom.sql',  'economics',          'tabla'),
  ('Doctrina',       '09_doctrina.sql',  'scoring_rubrics',    'tabla'),
  ('Doctrina',       '09_doctrina.sql',  'risk_index',         'tabla'),
  ('Cola',           '11_cola.sql',      'v_pendientes',       'vista'),
  ('Reserva',        '12_reserva.sql',   'opportunity_access', 'tabla'),
  ('Checklist',      '13_checklist.sql', 'checklist_items',    'tabla'),
  ('Actividad',      '16_actividad.sql', 'activity',           'tabla'),
  ('Actividad',      '16_actividad.sql', 'v_actividad',        'vista'),
  ('Indice',         '17_indice.sql',    'risk_mesas',         'tabla'),
  ('Indice',         '17_indice.sql',    'risk_lecturas',      'tabla'),
  ('Indice',         '17_indice.sql',    'v_risk_serie',       'vista'),
  ('Indice',         '17_indice.sql',    'v_risk_estado',      'vista'),
  ('Indice',         '17_indice.sql',    'v_pendientes_firma', 'vista'),
  ('Sectorial',      '18_sectorial.sql', 'sectors',            'tabla'),
  ('Sectorial',      '18_sectorial.sql', 'sector_dimensions',  'tabla'),
  ('Sectorial',      '18_sectorial.sql', 'sector_readings',    'tabla'),
  ('Sectorial',      '18_sectorial.sql', 'v_sector_score',     'vista'),
  ('Sectorial',      '18_sectorial.sql', 'v_sector_pipeline',  'vista')
)
select o.modulo, o.fichero, o.obj, o.tipo,
       case when to_regclass('public.' || o.obj) is null
            then 'NO EXISTE -- falta aplicar el fichero'
            when not has_table_privilege('authenticated', 'public.' || o.obj, 'SELECT')
            then 'EXISTE PERO authenticated NO PUEDE LEERLO'
            else 'ok' end as veredicto
  from objetos o
 order by o.fichero, o.obj;

-- Columnas que anadieron ficheros posteriores sobre tablas que ya existian.
select 'checklist_items.document_id' as columna, '14_checklist_documento.sql' as fichero,
       case when exists (select 1 from information_schema.columns
         where table_name='checklist_items' and column_name='document_id')
       then 'ok' else 'FALTA' end as veredicto
union all
select 'checklist_items.vence_en', '15_plazos.sql',
       case when exists (select 1 from information_schema.columns
         where table_name='checklist_items' and column_name='vence_en')
       then 'ok' else 'FALTA' end
union all
select 'scoring_bands.plazo_horas', '15_plazos.sql',
       case when exists (select 1 from information_schema.columns
         where table_name='scoring_bands' and column_name='plazo_horas')
       then 'ok' else 'FALTA' end
union all
select 'v_pendientes.vence_en', '15_plazos.sql',
       case when exists (select 1 from information_schema.columns
         where table_name='v_pendientes' and column_name='vence_en')
       then 'ok' else 'FALTA: la bandeja Hoy no tendra nada que ensenar' end
union all
select 'opportunities.sector', '18_sectorial.sql',
       case when exists (select 1 from information_schema.columns
         where table_name='opportunities' and column_name='sector')
       then 'ok' else 'FALTA' end
union all
select 'activity.opportunity_id = SET NULL', '16_actividad.sql (reaplicar)',
       coalesce((select case when rc.delete_rule = 'SET NULL' then 'ok'
                   else 'ES ' || rc.delete_rule || ' -- borrar un expediente fallara' end
         from information_schema.table_constraints tc
         join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
        where tc.table_name = 'activity' and tc.constraint_type = 'FOREIGN KEY'
          and tc.constraint_name like '%opportunity_id%' limit 1),
        'no se puede comprobar: activity no existe');

-- Y si todo existe, cuanta vida tiene cada cosa.
select 'expedientes vivos' as concepto, count(*)::text as valor from opportunities
  where estado not in ('archivado','cerrado')
union all select 'movimientos en Actividad',
  coalesce((select count(*)::text from activity), 'tabla ausente')
union all select 'mesas del barrido',
  coalesce((select count(*)::text from risk_mesas where activa), 'tabla ausente')
union all select 'lecturas del indice',
  coalesce((select count(*)::text from risk_lecturas), 'tabla ausente')
union all select 'sectores con lectura',
  coalesce((select count(*)::text from v_sector_score), 'vista ausente')
union all select 'expedientes sin sector',
  coalesce((select count(*)::text from opportunities where sector is null), 'columna ausente');
