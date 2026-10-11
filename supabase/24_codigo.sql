-- =====================================================================
-- ZRC · CAPA 3 — EL PATRON DE CODIGO ADMITE EL '&'
--
-- El patron del manual (§12.3) es ZRC-[TIPO]-[ANIO]-[GEO]-[NN], y el
-- esquema lo escribio con [A-Z] en el tipo. Pero la firma usa un tipo
-- que lleva ampersand: el mandato de venta real es
--
--   ZRC-M&A-2026-BF-01
--
-- Ese codigo NO valida contra [A-Z]{2,4}. La base de produccion ya
-- aprendio esto al registrar el mandato, y lo ensancho alli mismo; el
-- esquema publico se quedo con la version estrecha, asi que un
-- despliegue nuevo desde este repositorio rechazaria los codigos de
-- M&A de la propia firma. Aqui se iguala.
--
-- El tipo es lo unico que se ensancha. El segmento de GEO sigue siendo
-- [A-Z]{2,4}: es una plaza o un pais (MAD, MIA, JRZ, ES), y no hay
-- ninguno con ampersand.
--
-- QUIEN MANDA ES ESTE CHECK. La pagina valida con el mismo patron antes
-- de enviar, y eso es cortesia: si los dos no dicen exactamente lo
-- mismo, el navegador acaba rechazando codigos que la base acepta, que
-- es justo lo que pasaba.
--
-- Idempotente.
-- =====================================================================

alter table opportunities drop constraint if exists opportunities_codigo_check;
alter table opportunities add  constraint opportunities_codigo_check
  check (codigo is null or codigo ~ '^ZRC-[A-Z&]{2,4}-[0-9]{4}-[A-Z]{2,4}-[0-9]{2}$');

-- ── COMPROBACION ────────────────────────────────────────────────────
-- Una sola consulta: el editor de Supabase solo ensena la ultima.
select 'el patron admite el &' as concepto,
       case when pg_get_constraintdef(oid) like '%[A-Z&]%' then 'si' else 'NO' end as valor
  from pg_constraint
 where conrelid = 'opportunities'::regclass and conname = 'opportunities_codigo_check'
union all select 'expedientes con codigo',
       (select count(*)::text from opportunities where codigo is not null)
union all select 'expedientes sin codigo',
       (select count(*)::text from opportunities where codigo is null)
union all select 'sin codigo y ya en mandato',
       (select count(*)::text from opportunities
         where codigo is null and estado in ('mandato','cerrado'))
union all select 'tipos en uso',
       (select coalesce(string_agg(distinct split_part(codigo,'-',2), ' · '
              order by split_part(codigo,'-',2)), 'ninguno')
          from opportunities where codigo is not null);
