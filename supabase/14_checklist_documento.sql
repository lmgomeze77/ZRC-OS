-- =====================================================================
-- ZRC · CAPA 3 — UN PUNTO DEL CHECKLIST APUNTA AL DOCUMENTO QUE LO CIERRA
--
-- El punto 17 pide "Informe de auditoria 2025/26" y el documento con ese
-- informe vivia en otra tabla sin ninguna relacion: habia que acordarse
-- de ir al punto y marcarlo a mano. Con esto, adjuntar el fichero y
-- cerrar el punto son el mismo gesto, y desde el punto se abre el
-- documento.
--
-- on delete set null a proposito: si se borra el documento, la exigencia
-- NO desaparece -- vuelve a estar sin resolver, que es la verdad.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

alter table checklist_items
  add column if not exists document_id uuid references documents on delete set null;

comment on column checklist_items.document_id is
  'Documento del data room que responde a este punto. Null = sin resolver.';

-- Comprobacion
select 'columna document_id' as concepto,
       case when exists (
         select 1 from information_schema.columns
          where table_name = 'checklist_items' and column_name = 'document_id')
       then 'ok' else 'REVISAR' end as veredicto
union all
select 'puntos con documento',
       (select count(*)::text from checklist_items where document_id is not null);
