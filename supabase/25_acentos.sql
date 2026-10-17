-- =====================================================================
-- ZRC · CAPA 3 — LAS TILDES QUE FALTABAN
--
-- Escribo los comentarios del codigo sin tildes a proposito: estan en el
-- fuente y nadie los lee en pantalla. El fallo es que esa costumbre se
-- colo en los DATOS, que si se pintan. En la pagina salia «manana» por
-- «mañana», «Multiplos» por «Múltiplos», «Espana» por «España».
--
-- Lo encontre comparando la aplicacion consigo misma: si escribe «día»
-- en un sitio y «dia» en otro, la segunda esta mal. No hace falta
-- diccionario para eso.
--
-- Los ficheros de origen ya estan corregidos, pero estas filas YA ESTAN
-- en la base, asi que hay que pasarles esto por encima. Idempotente: las
-- que ya esten bien no se tocan.
--
-- Lo que NO se toca: `sector_map` lleva a proposito las dos grafias de
-- cada vertical («Suelo turistico» y «Suelo turístico») para que un
-- expediente escrito sin tilde siga encontrando su sector. Y los
-- `comment on` de la base, que lee un desarrollador y no un usuario.
-- =====================================================================

-- ── 1 · SECTORES ────────────────────────────────────────────────────
update sectors set nombre = 'Suelo y promoción'   where clave = 'SUELO';
update sectors set nombre = 'Tecnología y venture' where clave = 'TECH';
update sectors set descripcion = 'Activo hotelero en explotación o para reconversión.' where clave = 'INM-HTL';
update sectors set descripcion = 'Suelo finalista, turístico o rústico con recorrido urbanístico.' where clave = 'SUELO';
update sectors set descripcion = 'Explotación, transformación y agroindustria.' where clave = 'AGRO';
update sectors set descripcion = 'Taller, construcción, distribución y servicios a empresa.' where clave = 'IND';
update sectors set descripcion = 'Fundraising de compañía temprana o en crecimiento.' where clave = 'TECH';
update sectors set descripcion = 'Reestructuración, capital de urgencia y preconcursal.' where clave = 'REEST';

-- ── 2 · DIMENSIONES SECTORIALES ─────────────────────────────────────
update sector_dimensions set nombre = 'Consolidación en marcha'   where clave = 'S4';
update sector_dimensions set nombre = 'Financiación disponible'   where clave = 'S7';
update sector_dimensions set nombre = 'Fragmentación del vendedor' where clave = 'S5';
update sector_dimensions set nombre = 'Múltiplos y su tendencia'  where clave = 'S3';
update sector_dimensions set descripcion =
  'Cuántos compradores activos y de cuántos tipos. Decide si hay proceso o conversación única.' where clave = 'S1';
update sector_dimensions set descripcion =
  'Dinero levantado con mandato explícito para este sector en España.' where clave = 'S2';
update sector_dimensions set descripcion =
  'Nivel y dirección. Barato y expandiendo bate a caro y comprimiendo.' where clave = 'S3';
update sector_dimensions set descripcion =
  'Es lo que produce objetos originables del tamaño de ZRC.' where clave = 'S5';
update sector_dimensions set descripcion =
  'En España mueve sectores enteros: vivienda, energía, suelo turístico.' where clave = 'S6';

-- ── 3 · MESAS ───────────────────────────────────────────────────────
-- Las M1..M9 estan retiradas, pero siguen leyendose en la tabla del
-- barrido y conservan sus lecturas: tambien se escriben bien.
update risk_mesas set nombre = 'Financiación bancaria'   where clave = 'M2';
update risk_mesas set nombre = 'Político e institucional' where clave = 'M7';
update risk_mesas set descripcion =
  'Tipos, inflación y coste de la deuda. Mueve todos los múltiplos a la vez.' where clave = 'M1';
update risk_mesas set descripcion =
  'Salidas, colocaciones y apetito del inversor institucional por España.' where clave = 'M3';
update risk_mesas set descripcion =
  'Cambios que mueven sectores enteros: vivienda, energía, suelo turístico.' where clave = 'M4';
update risk_mesas set descripcion =
  'Precio, absorción y liquidez del ladrillo, por ser la mitad del pipeline.' where clave = 'M5';
update risk_mesas set descripcion =
  'Campaña, agua y precios. La otra mitad del pipeline.' where clave = 'M6';
update risk_mesas set descripcion =
  'Estabilidad, calendario electoral, seguridad jurídica.' where clave = 'M7';

-- ── 4 · LAS VISTAS DE LA COLA ───────────────────────────────────────
-- Sus textos van escritos DENTRO de la vista, asi que no basta con un
-- update: hay que volver a crearlas. Son las mismas de 15_plazos.sql y
-- 22_metodos.sql, ya corregidas.

create or replace view v_pendientes
  with (security_invoker = true) as
with vivos as (
  select o.* from opportunities o
   where o.estado not in ('archivado','cerrado')
     and not exists (select 1 from outcomes x where x.opportunity_id = o.id)
)
select o.id as opportunity_id, o.codigo, o.nombre,
       'verificacion_previa' as motivo,
       f.texto                as detalle,
       1                      as prioridad,
       null::date             as vence_en
  from vivos o
  join scope_flags f on f.opportunity_id = o.id
 where f.nivel = 'stop' and f.resuelto_en is null

union all
select o.id, o.codigo, o.nombre,
       'banda_alta',
       'DEALSCORE ' || to_char(v.dealscore, 'FM999.0') || ' · ' || coalesce(v.banda_accion, ''),
       case when v.banda = 'P1' then 2 else 3 end,
       (v.creado_en + make_interval(hours => b.plazo_horas))::date
  from vivos o
  join v_opportunity_scores v on v.opportunity_id = o.id
  left join scoring_bands b on b.model_id = v.model_id and b.clave = v.banda
 where v.banda in ('P1','P2')

union all
select o.id, o.codigo, o.nombre, 'sin_codigo',
       'Sin código de expediente con el patrón ZRC-[TIPO]-[AÑO]-[GEO]-[NN] (§12.3)', 4,
       null::date
  from vivos o
 where o.codigo is null

union all
select o.id, o.codigo, o.nombre, 'sin_puntuar',
       'Sin puntuación completa contra las rúbricas ancladas', 5,
       null::date
  from vivos o
  left join v_opportunity_scores v on v.opportunity_id = o.id
 where v.dealscore is null

union all
-- Un punto critico del checklist con fecha pasada es trabajo vencido, y
-- no estaba en la cola de ninguna manera.
select o.id, o.codigo, o.nombre, 'checklist_vencido',
       c.area || ' · ' || c.descripcion, 2, c.vence_en
  from vivos o
  join checklist_items c on c.opportunity_id = o.id
 where c.vence_en is not null
   and c.vence_en < current_date
   and c.estado <> 'validado';

create or replace view v_pendientes_firma
  with (security_invoker = true) as
select 'indice_caducado'::text as motivo,
       'Índice de mesas sin actualizar desde ' || to_char(e.fecha, 'DD/MM')
         || ' (' || e.dias_sin_actualizar || ' días). El barrido está parado.' as detalle,
       1 as prioridad, e.fecha + 1 as vence_en
  from v_risk_estado e where e.caducado
union all
select 'mesas_sin_fundamento',
       d.sin_fundamento || ' lecturas de ' || to_char(d.fecha, 'DD/MM')
         || ' sin fundamento anotado: no son lecturas, son cifras sueltas.',
       4, null::date
  from v_risk_dia d
 where d.sin_fundamento > 0 and d.fecha >= current_date - 7;

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'cadenas visibles sin tilde' as concepto,
       (select count(*)::text from (
          select nombre as t from sectors union all select descripcion from sectors
          union all select nombre from sector_dimensions
          union all select descripcion from sector_dimensions
          union all select nombre from risk_mesas
          union all select descripcion from risk_mesas
        ) x where t is not null
          and t !~ '[áéíóúñÁÉÍÓÚÑ]'
          and t ~* '(multiplos|financiacion|consolidacion|fragmentacion|espana|energia|turistico|tamano|explicito|compania|construccion|distribucion|explotacion|transformacion|reestructuracion|reconversion|rustico|urbanistico|promocion|tecnologia|inflacion|absorcion|juridica|politico|campana|cuantos|conversacion|unica|direccion)') as valor,
       'tiene que ser 0' as veredicto
union all
select 'la cola dice «puntuación» y «rúbricas»',
       case when exists (select 1 from v_pendientes
                          where detalle like '%puntuación completa contra las rúbricas%')
            then 'si' else 'no hay ninguno sin puntuar ahora mismo' end, ''
union all
select 'la cola de firma dice «Índice» y «días»',
       case when exists (select 1 from v_pendientes_firma where detalle like '%Índice%días%')
            then 'si' else 'el indice no esta caducado ahora mismo' end, '';
