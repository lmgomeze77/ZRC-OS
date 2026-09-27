-- =====================================================================
-- ZRC · CAPA 3 — ALMACENAMIENTO DE DOCUMENTOS
--
-- Los ficheros pasan a vivir en un cubo privado del propio proyecto, con
-- el acceso decidido por la MISMA tabla app_members que gobierna el resto.
-- Una sola fuente de verdad en vez de dos.
--
-- Aplicar despues de 06_dataroom.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- El cubo. public = false: no hay URL publica. Los ficheros solo se
-- sirven mediante enlaces firmados de vida corta que emite la aplicacion.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('expedientes', 'expedientes', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- Politicas del cubo, sobre storage.objects.
--
-- Mismo reparto que en todo lo demas: cualquier miembro lee, solo writer
-- o admin sube y borra. Un no miembro no ve ni un fichero, igual que no
-- ve una fila.
-- ---------------------------------------------------------------------
drop policy if exists exp_leer   on storage.objects;
drop policy if exists exp_subir  on storage.objects;
drop policy if exists exp_editar on storage.objects;
drop policy if exists exp_borrar on storage.objects;

create policy exp_leer on storage.objects for select
  using (bucket_id = 'expedientes' and app_es_miembro());

create policy exp_subir on storage.objects for insert
  with check (bucket_id = 'expedientes' and app_puede_escribir());

create policy exp_editar on storage.objects for update
  using (bucket_id = 'expedientes' and app_puede_escribir())
  with check (bucket_id = 'expedientes' and app_puede_escribir());

create policy exp_borrar on storage.objects for delete
  using (bucket_id = 'expedientes' and app_puede_escribir());

-- ---------------------------------------------------------------------
-- Un documento apunta a un fichero del cubo (storage_path) o a un enlace
-- externo (url). Las dos formas conviven: lo que ya estaba en Drive sigue
-- funcionando, y lo nuevo entra por el cubo.
-- ---------------------------------------------------------------------
alter table documents add column if not exists storage_path text;
alter table documents add column if not exists nombre_fichero text;
alter table documents add column if not exists bytes bigint;

-- Un documento no puede ser las dos cosas a la vez: si lo fuera, no
-- habria forma de saber cual de los dos es el bueno.
alter table documents drop constraint if exists doc_una_sola_fuente;
alter table documents add constraint doc_una_sola_fuente
  check (url is null or storage_path is null);

-- Un documento 'disponible' tiene que ser abrible por algun lado.
alter table documents drop constraint if exists doc_disponible_abrible;
alter table documents add constraint doc_disponible_abrible
  check (estado <> 'disponible' or url is not null or storage_path is not null);
