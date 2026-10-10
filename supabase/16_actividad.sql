-- =====================================================================
-- ZRC · CAPA 3 — ACTIVIDAD: QUIEN CAMBIO QUE Y CUANDO
--
-- Hasta ahora el sistema guardaba el ESTADO pero no el CAMBIO. Se veia
-- que un expediente esta puntuado, no quien lo puntuo ni cuando ni que
-- habia antes. Con dos personas dentro eso deja de ser un detalle: es
-- la diferencia entre una base de datos y un registro.
--
-- Dos decisiones que importan:
--
-- 1. LO ESCRIBE UN DISPARADOR, NO LA APLICACION. Una llamada desde el
--    navegador se puede olvidar, y una escritura hecha desde el SQL
--    Editor no pasaria por ella. El disparador vive en la base, asi que
--    registra TODA escritura, venga de donde venga -- incluidas las
--    mias.
--
-- 2. ES SOLO DE AGREGAR. No hay politica de update ni de delete sobre
--    activity, ni para el administrador. Un registro que se puede
--    reescribir no sirve para lo que sirve un registro.
--
-- Lo que NO registra: score_values. Una puntuacion son ocho filas, y
-- registrar las ocho ahoga el resto. El evento es la puntuacion, que si
-- queda (tabla scores).
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1 · LA TABLA ────────────────────────────────────────────────────
create table if not exists activity (
  id             bigserial primary key,
  ocurrido_en    timestamptz not null default now(),
  actor          uuid references auth.users,
  tabla          text not null,
  operacion      text not null check (operacion in ('alta','cambio','baja')),
  -- on delete SET NULL, no cascade. Con cascade, borrar un expediente se
  -- llevaba por delante su historial, y eso daba una forma en un paso de
  -- hacer desaparecer el registro de lo que uno habia hecho: justo lo que
  -- esta tabla existe para impedir. Al quedarse sin expediente la fila
  -- pasa a ambito de firma, que es lo que es -- ya no hay reserva que
  -- aplicar, porque ya no hay expediente.
  opportunity_id uuid references opportunities on delete set null,
  fila_id        text,
  etiqueta       text,      -- como se llama la fila tocada, en palabras
  campos         text[]     -- que columnas cambiaron (solo en 'cambio')
);

comment on table activity is
  'Registro de escrituras. Lo escriben disparadores, nunca la aplicacion. '
  'Solo de agregar: no hay politica de update ni de delete.';

-- Si la tabla ya existia con cascade, se corrige aqui. create table if
-- not exists no habria tocado la restriccion.
do $$
declare v_nombre text;
begin
  select tc.constraint_name into v_nombre
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
   where tc.table_name = 'activity' and tc.constraint_type = 'FOREIGN KEY'
     and tc.constraint_name like '%opportunity_id%'
     and rc.delete_rule <> 'SET NULL';
  if v_nombre is not null then
    execute format('alter table activity drop constraint %I', v_nombre);
    execute 'alter table activity add constraint activity_opportunity_id_fkey
             foreign key (opportunity_id) references opportunities on delete set null';
    raise notice 'activity.opportunity_id corregido a on delete set null';
  end if;
end $$;

create index if not exists activity_opp_idx  on activity (opportunity_id, ocurrido_en desc);
create index if not exists activity_tiempo_idx on activity (ocurrido_en desc);

-- ── 2 · EL DISPARADOR ───────────────────────────────────────────────
-- security definer para que pueda escribir en activity aunque quien
-- dispara no tenga permiso de insert sobre ella (nadie lo tiene).
create or replace function app_registra_actividad()
  returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fila   jsonb;
  v_vieja  jsonb;
  v_opp    uuid;
  v_op     text;
  v_campos text[];
  v_etq    text;
  -- Ruido: cambian en cada escritura y no dicen nada de la intencion.
  c_ruido  text[] := array['actualizado_en','creado_en','id'];
begin
  if    tg_op = 'INSERT' then v_op := 'alta';   v_fila := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_op := 'cambio'; v_fila := to_jsonb(new); v_vieja := to_jsonb(old);
  else                        v_op := 'baja';   v_fila := to_jsonb(old);
  end if;

  -- De que expediente hablamos. opportunities se nombra a si misma;
  -- outcomes usa opportunity_id como clave primaria.
  if tg_table_name = 'opportunities' then
    v_opp := (v_fila ->> 'id')::uuid;
  else
    v_opp := (v_fila ->> 'opportunity_id')::uuid;
  end if;

  -- El caso que no es obvio: borrar un expediente. El disparador corre
  -- cuando la fila ya no esta, asi que apuntar a ella violaria la clave
  -- foranea y el borrado fallaria ENTERO -- no solo el registro. Y no
  -- pasa solo con opportunities: el borrado en cascada arrastra a
  -- documentos, checklist y demas, y esos disparadores corren tambien
  -- con el expediente ya desaparecido. Un guardia de existencia cubre
  -- los dos casos. El uuid y el nombre se conservan en fila_id y
  -- etiqueta, que es lo que hace falta para saber que se borro.
  if tg_op = 'DELETE' and v_opp is not null
     and not exists (select 1 from opportunities where id = v_opp) then
    v_opp := null;
  end if;

  -- Que columnas cambiaron. Comparar el jsonb entero es generico: no hay
  -- que mantener una lista por tabla que se quedaria desfasada.
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}')
      into v_campos
      from jsonb_object_keys(v_fila) k
     where v_fila -> k is distinct from v_vieja -> k
       and not (k = any (c_ruido));
    -- Un update que no cambia nada visible no es un cambio.
    if v_campos = '{}' then return null; end if;
  end if;

  -- Como se llama la fila, para no tener que enseñar un uuid.
  v_etq := coalesce(
    v_fila ->> 'titulo',   v_fila ->> 'nombre',  v_fila ->> 'descripcion',
    v_fila ->> 'resultado', v_fila ->> 'tipo',   v_fila ->> 'texto',
    v_fila ->> 'area',     v_fila ->> 'model_id');
  if length(v_etq) > 120 then v_etq := left(v_etq, 117) || '...'; end if;

  insert into activity (actor, tabla, operacion, opportunity_id, fila_id, etiqueta, campos)
  values (auth.uid(), tg_table_name, v_op, v_opp,
          coalesce(v_fila ->> 'id', v_fila ->> 'opportunity_id'), v_etq, v_campos);

  return null;  -- after trigger: el valor de retorno no se usa
end $$;

-- ── 3 · ENGANCHARLO DONDE IMPORTA ───────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'opportunities','scores','documents','checklist_items','decisions',
    'outcomes','economics','strategy','investors','scope_flags',
    'mandates','opportunity_access'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on %I', 'act_' || t, t);
      execute format(
        'create trigger %I after insert or update or delete on %I
           for each row execute function app_registra_actividad()',
        'act_' || t, t);
    end if;
  end loop;
end $$;

-- ── 4 · QUIEN LO PUEDE LEER ─────────────────────────────────────────
alter table activity enable row level security;

drop policy if exists act_sel on activity;
-- Mismo alcance que el expediente: si la reserva te lo oculta, su
-- historial tambien. Las filas sin expediente son de ambito firma.
create policy act_sel on activity for select
  using (
    case when opportunity_id is null then app_es_miembro()
         else app_ve_expediente(opportunity_id) end
  );
-- A proposito: ninguna politica de insert, update ni delete. Solo el
-- disparador escribe aqui, y nadie reescribe.

-- Y los permisos de tabla dicen lo mismo, por si algun dia alguien
-- aflojase una politica: desde la API solo se puede leer. Supabase ya
-- concede select por privilegios por defecto; aqui se escribe explicito
-- porque en este fichero el reparto de permisos ES el contenido.
grant select on activity to authenticated;

-- ── 5 · LA VISTA, CON NOMBRES EN VEZ DE UUIDS ───────────────────────
create or replace view v_actividad
  with (security_invoker = true) as
select a.id, a.ocurrido_en, a.tabla, a.operacion, a.opportunity_id,
       a.fila_id, a.etiqueta, a.campos,
       coalesce(m.nombre, 'sistema') as quien,
       o.nombre as expediente, o.codigo
  from activity a
  left join app_members  m on m.user_id = a.actor
  left join opportunities o on o.id = a.opportunity_id
 order by a.ocurrido_en desc;

grant select on v_actividad to authenticated;

-- Supabase concede por privilegios por defecto a anon (el visitante sin
-- sesion) y a service_role sobre todo lo que se crea en public. A las
-- politicas les da igual -- app_es_miembro() ya dice que no --, pero un
-- registro de quien hace que no tiene por que estar al alcance de quien
-- no ha entrado. Se retira si el rol existe; en un Postgres pelado no
-- existe y esto no hace nada.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on activity from anon';
    execute 'revoke all on v_actividad from anon';
  end if;
end $$;

comment on view v_actividad is
  'Actividad legible. quien = "sistema" cuando la escritura no vino de '
  'una sesion de usuario (carga por SQL Editor, por ejemplo), que es la '
  'verdad y no un hueco.';

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'tabla activity' as concepto,
       case when to_regclass('public.activity') is not null then 'ok' else 'REVISAR' end as veredicto
union all
select 'disparadores enganchados',
       (select count(*)::text from pg_trigger
         where tgname like 'act\_%' and not tgisinternal)
union all
select 'politicas sobre activity (debe ser 1: solo select)',
       (select count(*)::text from pg_policies where tablename = 'activity')
union all
select 'vista v_actividad',
       case when to_regclass('public.v_actividad') is not null then 'ok' else 'REVISAR' end
union all
select 'movimientos registrados', (select count(*)::text from activity);
