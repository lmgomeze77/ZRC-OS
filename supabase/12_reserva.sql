-- =====================================================================
-- ZRC · CAPA 3 — EXPEDIENTES RESERVADOS
--
-- Un expediente puede marcarse reservado: entonces solo lo ven los
-- administradores y quien tenga permiso explicito. Por defecto NO lo esta,
-- de modo que nada cambia para lo ya cargado.
--
-- Dos ejes separados, que no se multiplican entre si:
--   el permiso por expediente decide SI lo ves
--   el rol (reader / writer / admin) decide QUE puedes hacer con el
--
-- Aplicar despues de 01_schema.sql, 06_dataroom.sql y 08_storage.sql.
-- =====================================================================

alter table opportunities add column if not exists reservado boolean not null default false;

comment on column opportunities.reservado is
  'true = solo visible para administradores y para quien tenga fila en '
  'opportunity_access. Por defecto false: visible para cualquier miembro.';

create table if not exists opportunity_access (
  opportunity_id uuid not null references opportunities on delete cascade,
  user_id        uuid not null references auth.users on delete cascade,
  concedido_en   timestamptz not null default now(),
  concedido_por  uuid references auth.users,
  nota           text,
  primary key (opportunity_id, user_id)
);

-- ---------------------------------------------------------------------
-- SECURITY DEFINER a proposito: la funcion consulta opportunities y
-- opportunity_access saltandose RLS. Si no lo hiciera, la politica de
-- opportunities se aplicaria dentro de la propia funcion que esa politica
-- usa, y Postgres entraria en recursion.
-- ---------------------------------------------------------------------
create or replace function app_ve_expediente(p_opp uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select case
    when not app_es_miembro() then false
    when app_es_admin()       then true
    else coalesce(
      (select not o.reservado from opportunities o where o.id = p_opp),
      false)
      or exists (select 1 from opportunity_access a
                  where a.opportunity_id = p_opp and a.user_id = auth.uid())
  end
$$;

alter table opportunity_access enable row level security;
drop policy if exists oa_sel on opportunity_access;
drop policy if exists oa_ins on opportunity_access;
drop policy if exists oa_upd on opportunity_access;
drop policy if exists oa_del on opportunity_access;
-- Conceder y revocar acceso es potestad del administrador. Cada cual ve
-- los permisos que le afectan.
create policy oa_sel on opportunity_access for select
  using (user_id = auth.uid() or app_es_admin());
create policy oa_ins on opportunity_access for insert with check (app_es_admin());
create policy oa_upd on opportunity_access for update using (app_es_admin());
create policy oa_del on opportunity_access for delete using (app_es_admin());

-- ---------------------------------------------------------------------
-- EL EXPEDIENTE
-- ---------------------------------------------------------------------
drop policy if exists opportunities_sel on opportunities;
create policy opportunities_sel on opportunities for select
  using (app_ve_expediente(id));

-- Marcar o desmarcar como reservado es decision del administrador; el
-- resto de la ficha la edita cualquier writer que vea el expediente.
drop policy if exists opportunities_upd on opportunities;
create policy opportunities_upd on opportunities for update
  using (app_puede_escribir() and app_ve_expediente(id))
  with check (app_puede_escribir() and app_ve_expediente(id));

-- ---------------------------------------------------------------------
-- HERENCIA — la parte que se hace mal casi siempre.
--
-- No basta con ocultar la fila del expediente. Si sus documentos siguen
-- listandose, el nombre del fichero ya delata la operacion. Cada tabla
-- hija filtra por el expediente al que pertenece.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['scope_flags','scores','documents','economics',
                           'strategy','investor_outreach','outcomes',
                           'mandates','decisions'] loop
    execute format('drop policy if exists %I on %I', t||'_sel', t);
    execute format('drop policy if exists %I on %I', t||'_ins', t);
    execute format('drop policy if exists %I on %I', t||'_upd', t);
    execute format('drop policy if exists %I on %I', t||'_del', t);
    execute format(
      'create policy %I on %I for select using (app_ve_expediente(opportunity_id))', t||'_sel', t);
    execute format(
      'create policy %I on %I for insert with check (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_ins', t);
    execute format(
      'create policy %I on %I for update using (app_puede_escribir() and app_ve_expediente(opportunity_id)) with check (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_upd', t);
    execute format(
      'create policy %I on %I for delete using (app_puede_escribir() and app_ve_expediente(opportunity_id))', t||'_del', t);
  end loop;
end $$;

-- score_values no lleva opportunity_id: cuelga de scores.
drop policy if exists score_values_sel on score_values;
drop policy if exists score_values_ins on score_values;
drop policy if exists score_values_upd on score_values;
drop policy if exists score_values_del on score_values;
create policy score_values_sel on score_values for select
  using (exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_ins on score_values for insert
  with check (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_upd on score_values for update
  using (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));
create policy score_values_del on score_values for delete
  using (app_puede_escribir() and exists (select 1 from scores s
                  where s.id = score_id and app_ve_expediente(s.opportunity_id)));

-- ---------------------------------------------------------------------
-- LOS FICHEROS
--
-- Se guardan bajo <opportunity_id>/..., asi que la primera carpeta de la
-- ruta dice a que expediente pertenecen. Una ruta que no siga el convenio
-- no la ve nadie salvo un administrador: preferimos ocultar de mas.
-- ---------------------------------------------------------------------
create or replace function app_ve_ruta(p_name text)
  returns boolean language sql stable as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f-]{36}$'
      then app_ve_expediente(((storage.foldername(p_name))[1])::uuid)
    else app_es_admin()
  end
$$;

drop policy if exists exp_leer   on storage.objects;
drop policy if exists exp_subir  on storage.objects;
drop policy if exists exp_editar on storage.objects;
drop policy if exists exp_borrar on storage.objects;

create policy exp_leer on storage.objects for select
  using (bucket_id = 'expedientes' and app_ve_ruta(name));
create policy exp_subir on storage.objects for insert
  with check (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));
create policy exp_editar on storage.objects for update
  using (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name))
  with check (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));
create policy exp_borrar on storage.objects for delete
  using (bucket_id = 'expedientes' and app_puede_escribir() and app_ve_ruta(name));
