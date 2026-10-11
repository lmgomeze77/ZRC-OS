-- =====================================================================
-- ZRC · CAPA 3 — AL DIA (3): LAS NUEVE MESAS Y LAS DOS CONSTRUCCIONES
--
-- POR QUE ESTE FICHERO. El indice que se ve en ZRC OS sigue parado en
-- el 08/09 porque la base todavia no tiene ni las nueve mesas reales ni
-- su serie reconstruida. La pagina ya esta desplegada con el nombre y la
-- grafica nuevos; lo que falta es el lado de la base.
--
-- Es la union, en orden, de:
--   21_mesas_reales.sql  — las nueve mesas del briefing, 435 lecturas
--                          por mesa y 49 dias reconstruidos desde el
--                          historico de git (19/08 a 10/10).
--   22_metodos.sql       — v_risk_serie devuelve las dos series con su
--                          metodo, y v_risk_estado informa la brecha.
--
-- Aplicar ESTE fichero solo, de una vez, en el SQL Editor de Supabase.
-- Es idempotente: si ya se paso el 21 por separado, volver a pasarlo es
-- lo correcto -- trae 16 filas que estaban desviadas un punto por una
-- diferencia de redondeo (JS redondea 54,5 a 55; Python, a 54).
--
-- La tabla de comprobacion sale al final, en una sola consulta, que es
-- lo unico que el editor de Supabase deja ver.
-- =====================================================================

-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  21_mesas_reales.sql                                            ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- =====================================================================
-- ZRC · CAPA 3 — LAS NUEVE MESAS DE VERDAD, Y SU SERIE RECONSTRUIDA
--
-- Las nueve mesas que yo habia sembrado eran una invencion mia. Las
-- reales son los nueve desks del ZRC Morning Intelligence, y estaban en
-- su codigo desde el principio (FEEDS en generate-briefing.js).
--
-- DOS CONSTRUCCIONES, DOS NOMBRES. El briefing publica cada manana un
-- riskIndex que PROPONE la IA leyendo los titulares; su formula es solo
-- el respaldo cuando la IA no responde. Ese numero no se puede
-- reproducir desde las mesas, asi que no es un indice: es una LECTURA.
-- Lo que si se reproduce es el calculo sobre las senales de cada mesa,
-- y eso es el INDICE DE MESAS.
--
-- No son el mismo numero y no van en la misma linea. Medido sobre los
-- 49 dias reconstruidos: la lectura va de media 5,6 puntos POR ENCIMA
-- de la formula del propio briefing, con 7,0 de diferencia absoluta
-- media y 11 dias por encima de 10 puntos de separacion.
--
-- LA SERIE SE RECONSTRUYE DESDE EL HISTORICO DE GIT. Cada commit de
-- data.json guarda los articulos de cada mesa con su senal y su
-- impacto. Son 49 dias, del 19/08 al 10/10 -- mas de los 21 que habia
-- cargados, asi que el hueco de 33 dias desaparece. Antes del 19/08 el
-- esquema no llevaba articulos por mesa y no hay nada que recalcular.
--
-- La formula por mesa es la del briefing, SIN su suavizacion de +-12
-- puntos: esa es una propiedad de la continuidad de la serie publicada,
-- no de la lectura de una mesa, y aplicarla por mesa le inventaria una
-- inercia que no tiene.
--
-- Idempotente. Aplicar en el SQL Editor de Supabase.
-- =====================================================================

-- ── 1 · LAS MESAS INVENTADAS SE RETIRAN, NO SE BORRAN ───────────────
-- Si alguien llego a barrerlas, sus lecturas son lecturas. Se
-- desactivan: salen del indice de hoy y conservan su pasado.
update risk_mesas set activa = false
 where clave in ('M1','M2','M3','M4','M5','M6','M7','M8','M9');

-- ── 2 · LAS NUEVE REALES ────────────────────────────────────────────
-- La clave es el id del desk en el briefing: asi la ingesta diaria
-- casa sin tabla de equivalencias.
insert into risk_mesas (clave, nombre, orden, peso, activa, descripcion) values
  ('macro', 'Macro y bancos centrales', 1, 1, true, 'Macro & Central Banks'),
  ('geopolitics', 'Geopolítica y seguridad', 2, 1, true, 'Geopolitics & Security'),
  ('fdi', 'Inversión extranjera y flujos de capital', 3, 1, true, 'FDI & Capital Flows'),
  ('critical-minerals', 'Materias primas y energía', 4, 1, true, 'Commodities & Energy'),
  ('real-estate', 'Inmobiliario e infraestructura', 5, 1, true, 'Real Estate & Infrastructure'),
  ('ma-growth', 'M&A y capital privado', 6, 1, true, 'M&A & Private Capital'),
  ('emerging-markets', 'Mercados emergentes', 7, 1, true, 'Emerging Markets'),
  ('trade-policy', 'Comercio y política industrial', 8, 1, true, 'Trade & Industrial Policy'),
  ('food-agriculture', 'Alimentación y agricultura', 9, 1, true, 'Food & Agriculture')
on conflict (clave) do update
  set nombre = excluded.nombre, orden = excluded.orden,
      activa = true, descripcion = excluded.descripcion;

-- ── 3 · LA SERIE DE MESAS, RECALCULADA DIA A DIA ────────────────────
-- Una fila por mesa y dia. El fundamento dice de donde sale y con
-- cuanta masa de impacto, que es lo que permite juzgar si la lectura de
-- ese dia pesa o es un dia flojo de noticias.
insert into risk_lecturas (fecha, mesa, valor, fundamento) values
  (date '2026-08-19', 'macro', 82, 'Recalculado del briefing del 19/08 · masa de impacto 6.'),
  (date '2026-08-19', 'geopolitics', 74, 'Recalculado del briefing del 19/08 · masa de impacto 14.'),
  (date '2026-08-19', 'fdi', 61, 'Recalculado del briefing del 19/08 · masa de impacto 5.'),
  (date '2026-08-19', 'critical-minerals', 69, 'Recalculado del briefing del 19/08 · masa de impacto 21.'),
  (date '2026-08-19', 'real-estate', 40, 'Recalculado del briefing del 19/08 · masa de impacto 6.'),
  (date '2026-08-19', 'ma-growth', 25, 'Recalculado del briefing del 19/08 · masa de impacto 7.'),
  (date '2026-08-19', 'emerging-markets', 82, 'Recalculado del briefing del 19/08 · masa de impacto 10.'),
  (date '2026-08-19', 'food-agriculture', 15, 'Recalculado del briefing del 19/08 · masa de impacto 3.'),
  (date '2026-08-20', 'macro', 82, 'Recalculado del briefing del 20/08 · masa de impacto 12.'),
  (date '2026-08-20', 'geopolitics', 75, 'Recalculado del briefing del 20/08 · masa de impacto 15.'),
  (date '2026-08-20', 'fdi', 38, 'Recalculado del briefing del 20/08 · masa de impacto 8.'),
  (date '2026-08-20', 'critical-minerals', 19, 'Recalculado del briefing del 20/08 · masa de impacto 20.'),
  (date '2026-08-20', 'real-estate', 38, 'Recalculado del briefing del 20/08 · masa de impacto 13.'),
  (date '2026-08-20', 'ma-growth', 36, 'Recalculado del briefing del 20/08 · masa de impacto 10.'),
  (date '2026-08-20', 'emerging-markets', 60, 'Recalculado del briefing del 20/08 · masa de impacto 13.'),
  (date '2026-08-20', 'trade-policy', 92, 'Recalculado del briefing del 20/08 · masa de impacto 4.'),
  (date '2026-08-20', 'food-agriculture', 49, 'Recalculado del briefing del 20/08 · masa de impacto 13.'),
  (date '2026-08-21', 'macro', 71, 'Recalculado del briefing del 21/08 · masa de impacto 11.'),
  (date '2026-08-21', 'geopolitics', 69, 'Recalculado del briefing del 21/08 · masa de impacto 15.'),
  (date '2026-08-21', 'fdi', 62, 'Recalculado del briefing del 21/08 · masa de impacto 13.'),
  (date '2026-08-21', 'critical-minerals', 28, 'Recalculado del briefing del 21/08 · masa de impacto 11.'),
  (date '2026-08-21', 'real-estate', 58, 'Recalculado del briefing del 21/08 · masa de impacto 8.'),
  (date '2026-08-21', 'ma-growth', 21, 'Recalculado del briefing del 21/08 · masa de impacto 6.'),
  (date '2026-08-21', 'emerging-markets', 62, 'Recalculado del briefing del 21/08 · masa de impacto 13.'),
  (date '2026-08-21', 'trade-policy', 77, 'Recalculado del briefing del 21/08 · masa de impacto 7.'),
  (date '2026-08-21', 'food-agriculture', 73, 'Recalculado del briefing del 21/08 · masa de impacto 12.'),
  (date '2026-08-22', 'macro', 57, 'Recalculado del briefing del 22/08 · masa de impacto 11.'),
  (date '2026-08-22', 'geopolitics', 77, 'Recalculado del briefing del 22/08 · masa de impacto 14.'),
  (date '2026-08-22', 'fdi', 80, 'Recalculado del briefing del 22/08 · masa de impacto 14.'),
  (date '2026-08-22', 'critical-minerals', 33, 'Recalculado del briefing del 22/08 · masa de impacto 21.'),
  (date '2026-08-22', 'real-estate', 45, 'Recalculado del briefing del 22/08 · masa de impacto 9.'),
  (date '2026-08-22', 'ma-growth', 40, 'Recalculado del briefing del 22/08 · masa de impacto 11.'),
  (date '2026-08-22', 'emerging-markets', 80, 'Recalculado del briefing del 22/08 · masa de impacto 12.'),
  (date '2026-08-22', 'trade-policy', 80, 'Recalculado del briefing del 22/08 · masa de impacto 7.'),
  (date '2026-08-22', 'food-agriculture', 25, 'Recalculado del briefing del 22/08 · masa de impacto 11.'),
  (date '2026-08-23', 'macro', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'geopolitics', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'fdi', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'critical-minerals', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'real-estate', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'ma-growth', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'emerging-markets', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-23', 'trade-policy', 50, 'Recalculado del briefing del 23/08 · masa de impacto 2.'),
  (date '2026-08-23', 'food-agriculture', 50, 'Recalculado del briefing del 23/08 · masa de impacto 6.'),
  (date '2026-08-24', 'macro', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'geopolitics', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'fdi', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'critical-minerals', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'real-estate', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'ma-growth', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'emerging-markets', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'trade-policy', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-24', 'food-agriculture', 50, 'Recalculado del briefing del 24/08 · masa de impacto 6.'),
  (date '2026-08-25', 'macro', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'geopolitics', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'fdi', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'critical-minerals', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'real-estate', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'ma-growth', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'emerging-markets', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'trade-policy', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-25', 'food-agriculture', 50, 'Recalculado del briefing del 25/08 · masa de impacto 6.'),
  (date '2026-08-26', 'macro', 43, 'Recalculado del briefing del 26/08 · masa de impacto 11.'),
  (date '2026-08-26', 'geopolitics', 15, 'Recalculado del briefing del 26/08 · masa de impacto 4.'),
  (date '2026-08-26', 'critical-minerals', 83, 'Recalculado del briefing del 26/08 · masa de impacto 7.'),
  (date '2026-08-26', 'emerging-markets', 29, 'Recalculado del briefing del 26/08 · masa de impacto 5.'),
  (date '2026-08-28', 'macro', 82, 'Recalculado del briefing del 28/08 · masa de impacto 8.'),
  (date '2026-08-28', 'geopolitics', 73, 'Recalculado del briefing del 28/08 · masa de impacto 9.'),
  (date '2026-08-28', 'fdi', 33, 'Recalculado del briefing del 28/08 · masa de impacto 15.'),
  (date '2026-08-28', 'critical-minerals', 85, 'Recalculado del briefing del 28/08 · masa de impacto 17.'),
  (date '2026-08-28', 'real-estate', 47, 'Recalculado del briefing del 28/08 · masa de impacto 9.'),
  (date '2026-08-28', 'ma-growth', 57, 'Recalculado del briefing del 28/08 · masa de impacto 10.'),
  (date '2026-08-28', 'emerging-markets', 40, 'Recalculado del briefing del 28/08 · masa de impacto 11.'),
  (date '2026-08-28', 'trade-policy', 64, 'Recalculado del briefing del 28/08 · masa de impacto 16.'),
  (date '2026-08-28', 'food-agriculture', 23, 'Recalculado del briefing del 28/08 · masa de impacto 13.'),
  (date '2026-08-29', 'macro', 40, 'Recalculado del briefing del 29/08 · masa de impacto 11.'),
  (date '2026-08-29', 'geopolitics', 71, 'Recalculado del briefing del 29/08 · masa de impacto 11.'),
  (date '2026-08-29', 'fdi', 25, 'Recalculado del briefing del 29/08 · masa de impacto 16.'),
  (date '2026-08-29', 'critical-minerals', 47, 'Recalculado del briefing del 29/08 · masa de impacto 13.'),
  (date '2026-08-29', 'real-estate', 40, 'Recalculado del briefing del 29/08 · masa de impacto 7.'),
  (date '2026-08-29', 'ma-growth', 49, 'Recalculado del briefing del 29/08 · masa de impacto 11.'),
  (date '2026-08-29', 'emerging-markets', 56, 'Recalculado del briefing del 29/08 · masa de impacto 11.'),
  (date '2026-08-29', 'trade-policy', 74, 'Recalculado del briefing del 29/08 · masa de impacto 13.'),
  (date '2026-08-29', 'food-agriculture', 38, 'Recalculado del briefing del 29/08 · masa de impacto 10.'),
  (date '2026-08-30', 'macro', 63, 'Recalculado del briefing del 30/08 · masa de impacto 10.'),
  (date '2026-08-30', 'geopolitics', 88, 'Recalculado del briefing del 30/08 · masa de impacto 10.'),
  (date '2026-08-30', 'fdi', 48, 'Recalculado del briefing del 30/08 · masa de impacto 12.'),
  (date '2026-08-30', 'critical-minerals', 27, 'Recalculado del briefing del 30/08 · masa de impacto 14.'),
  (date '2026-08-30', 'real-estate', 68, 'Recalculado del briefing del 30/08 · masa de impacto 7.'),
  (date '2026-08-30', 'ma-growth', 66, 'Recalculado del briefing del 30/08 · masa de impacto 9.'),
  (date '2026-08-30', 'emerging-markets', 32, 'Recalculado del briefing del 30/08 · masa de impacto 12.'),
  (date '2026-08-30', 'trade-policy', 67, 'Recalculado del briefing del 30/08 · masa de impacto 12.'),
  (date '2026-08-30', 'food-agriculture', 38, 'Recalculado del briefing del 30/08 · masa de impacto 10.'),
  (date '2026-08-31', 'macro', 65, 'Recalculado del briefing del 31/08 · masa de impacto 10.'),
  (date '2026-08-31', 'geopolitics', 75, 'Recalculado del briefing del 31/08 · masa de impacto 12.'),
  (date '2026-08-31', 'fdi', 25, 'Recalculado del briefing del 31/08 · masa de impacto 7.'),
  (date '2026-08-31', 'critical-minerals', 56, 'Recalculado del briefing del 31/08 · masa de impacto 11.'),
  (date '2026-08-31', 'real-estate', 46, 'Recalculado del briefing del 31/08 · masa de impacto 5.'),
  (date '2026-08-31', 'ma-growth', 47, 'Recalculado del briefing del 31/08 · masa de impacto 7.'),
  (date '2026-08-31', 'emerging-markets', 49, 'Recalculado del briefing del 31/08 · masa de impacto 9.'),
  (date '2026-08-31', 'trade-policy', 86, 'Recalculado del briefing del 31/08 · masa de impacto 7.'),
  (date '2026-08-31', 'food-agriculture', 86, 'Recalculado del briefing del 31/08 · masa de impacto 7.'),
  (date '2026-09-01', 'macro', 87, 'Recalculado del briefing del 01/09 · masa de impacto 16.'),
  (date '2026-09-01', 'geopolitics', 88, 'Recalculado del briefing del 01/09 · masa de impacto 15.'),
  (date '2026-09-01', 'fdi', 20, 'Recalculado del briefing del 01/09 · masa de impacto 13.'),
  (date '2026-09-01', 'critical-minerals', 65, 'Recalculado del briefing del 01/09 · masa de impacto 14.'),
  (date '2026-09-01', 'real-estate', 58, 'Recalculado del briefing del 01/09 · masa de impacto 8.'),
  (date '2026-09-01', 'ma-growth', 42, 'Recalculado del briefing del 01/09 · masa de impacto 9.'),
  (date '2026-09-01', 'emerging-markets', 48, 'Recalculado del briefing del 01/09 · masa de impacto 14.'),
  (date '2026-09-01', 'trade-policy', 79, 'Recalculado del briefing del 01/09 · masa de impacto 10.'),
  (date '2026-09-01', 'food-agriculture', 69, 'Recalculado del briefing del 01/09 · masa de impacto 8.'),
  (date '2026-09-02', 'macro', 88, 'Recalculado del briefing del 02/09 · masa de impacto 16.'),
  (date '2026-09-02', 'geopolitics', 80, 'Recalculado del briefing del 02/09 · masa de impacto 9.'),
  (date '2026-09-02', 'fdi', 64, 'Recalculado del briefing del 02/09 · masa de impacto 7.'),
  (date '2026-09-02', 'critical-minerals', 72, 'Recalculado del briefing del 02/09 · masa de impacto 13.'),
  (date '2026-09-02', 'real-estate', 54, 'Recalculado del briefing del 02/09 · masa de impacto 9.'),
  (date '2026-09-02', 'ma-growth', 49, 'Recalculado del briefing del 02/09 · masa de impacto 12.'),
  (date '2026-09-02', 'emerging-markets', 81, 'Recalculado del briefing del 02/09 · masa de impacto 13.'),
  (date '2026-09-02', 'trade-policy', 68, 'Recalculado del briefing del 02/09 · masa de impacto 13.'),
  (date '2026-09-02', 'food-agriculture', 57, 'Recalculado del briefing del 02/09 · masa de impacto 8.'),
  (date '2026-09-03', 'macro', 86, 'Recalculado del briefing del 03/09 · masa de impacto 7.'),
  (date '2026-09-03', 'geopolitics', 80, 'Recalculado del briefing del 03/09 · masa de impacto 7.'),
  (date '2026-09-03', 'fdi', 15, 'Recalculado del briefing del 03/09 · masa de impacto 8.'),
  (date '2026-09-03', 'critical-minerals', 79, 'Recalculado del briefing del 03/09 · masa de impacto 18.'),
  (date '2026-09-03', 'real-estate', 82, 'Recalculado del briefing del 03/09 · masa de impacto 8.'),
  (date '2026-09-03', 'ma-growth', 26, 'Recalculado del briefing del 03/09 · masa de impacto 10.'),
  (date '2026-09-03', 'emerging-markets', 78, 'Recalculado del briefing del 03/09 · masa de impacto 13.'),
  (date '2026-09-03', 'trade-policy', 57, 'Recalculado del briefing del 03/09 · masa de impacto 8.'),
  (date '2026-09-03', 'food-agriculture', 70, 'Recalculado del briefing del 03/09 · masa de impacto 7.'),
  (date '2026-09-07', 'macro', 56, 'Recalculado del briefing del 07/09 · masa de impacto 10.'),
  (date '2026-09-07', 'geopolitics', 85, 'Recalculado del briefing del 07/09 · masa de impacto 16.'),
  (date '2026-09-07', 'fdi', 48, 'Recalculado del briefing del 07/09 · masa de impacto 9.'),
  (date '2026-09-07', 'critical-minerals', 81, 'Recalculado del briefing del 07/09 · masa de impacto 15.'),
  (date '2026-09-07', 'real-estate', 53, 'Recalculado del briefing del 07/09 · masa de impacto 9.'),
  (date '2026-09-07', 'ma-growth', 58, 'Recalculado del briefing del 07/09 · masa de impacto 7.'),
  (date '2026-09-07', 'emerging-markets', 64, 'Recalculado del briefing del 07/09 · masa de impacto 10.'),
  (date '2026-09-07', 'trade-policy', 66, 'Recalculado del briefing del 07/09 · masa de impacto 9.'),
  (date '2026-09-07', 'food-agriculture', 79, 'Recalculado del briefing del 07/09 · masa de impacto 10.'),
  (date '2026-09-08', 'macro', 73, 'Recalculado del briefing del 08/09 · masa de impacto 10.'),
  (date '2026-09-08', 'geopolitics', 85, 'Recalculado del briefing del 08/09 · masa de impacto 9.'),
  (date '2026-09-08', 'fdi', 38, 'Recalculado del briefing del 08/09 · masa de impacto 6.'),
  (date '2026-09-08', 'critical-minerals', 86, 'Recalculado del briefing del 08/09 · masa de impacto 15.'),
  (date '2026-09-08', 'real-estate', 55, 'Recalculado del briefing del 08/09 · masa de impacto 9.'),
  (date '2026-09-08', 'ma-growth', 64, 'Recalculado del briefing del 08/09 · masa de impacto 7.'),
  (date '2026-09-08', 'emerging-markets', 45, 'Recalculado del briefing del 08/09 · masa de impacto 6.'),
  (date '2026-09-08', 'trade-policy', 70, 'Recalculado del briefing del 08/09 · masa de impacto 9.'),
  (date '2026-09-08', 'food-agriculture', 69, 'Recalculado del briefing del 08/09 · masa de impacto 7.'),
  (date '2026-09-09', 'macro', 82, 'Recalculado del briefing del 09/09 · masa de impacto 21.'),
  (date '2026-09-09', 'geopolitics', 90, 'Recalculado del briefing del 09/09 · masa de impacto 19.'),
  (date '2026-09-09', 'fdi', 18, 'Recalculado del briefing del 09/09 · masa de impacto 14.'),
  (date '2026-09-09', 'critical-minerals', 89, 'Recalculado del briefing del 09/09 · masa de impacto 18.'),
  (date '2026-09-09', 'real-estate', 39, 'Recalculado del briefing del 09/09 · masa de impacto 11.'),
  (date '2026-09-09', 'ma-growth', 24, 'Recalculado del briefing del 09/09 · masa de impacto 8.'),
  (date '2026-09-09', 'emerging-markets', 72, 'Recalculado del briefing del 09/09 · masa de impacto 13.'),
  (date '2026-09-09', 'trade-policy', 59, 'Recalculado del briefing del 09/09 · masa de impacto 12.'),
  (date '2026-09-09', 'food-agriculture', 68, 'Recalculado del briefing del 09/09 · masa de impacto 8.'),
  (date '2026-09-10', 'macro', 77, 'Recalculado del briefing del 10/09 · masa de impacto 14.'),
  (date '2026-09-10', 'geopolitics', 71, 'Recalculado del briefing del 10/09 · masa de impacto 10.'),
  (date '2026-09-10', 'fdi', 15, 'Recalculado del briefing del 10/09 · masa de impacto 7.'),
  (date '2026-09-10', 'critical-minerals', 64, 'Recalculado del briefing del 10/09 · masa de impacto 10.'),
  (date '2026-09-10', 'real-estate', 59, 'Recalculado del briefing del 10/09 · masa de impacto 6.'),
  (date '2026-09-10', 'ma-growth', 15, 'Recalculado del briefing del 10/09 · masa de impacto 7.'),
  (date '2026-09-10', 'emerging-markets', 65, 'Recalculado del briefing del 10/09 · masa de impacto 8.'),
  (date '2026-09-10', 'trade-policy', 83, 'Recalculado del briefing del 10/09 · masa de impacto 9.'),
  (date '2026-09-10', 'food-agriculture', 83, 'Recalculado del briefing del 10/09 · masa de impacto 9.'),
  (date '2026-09-11', 'macro', 77, 'Recalculado del briefing del 11/09 · masa de impacto 16.'),
  (date '2026-09-11', 'geopolitics', 89, 'Recalculado del briefing del 11/09 · masa de impacto 12.'),
  (date '2026-09-11', 'fdi', 49, 'Recalculado del briefing del 11/09 · masa de impacto 12.'),
  (date '2026-09-11', 'critical-minerals', 90, 'Recalculado del briefing del 11/09 · masa de impacto 19.'),
  (date '2026-09-11', 'real-estate', 38, 'Recalculado del briefing del 11/09 · masa de impacto 8.'),
  (date '2026-09-11', 'ma-growth', 53, 'Recalculado del briefing del 11/09 · masa de impacto 12.'),
  (date '2026-09-11', 'emerging-markets', 66, 'Recalculado del briefing del 11/09 · masa de impacto 9.'),
  (date '2026-09-11', 'trade-policy', 77, 'Recalculado del briefing del 11/09 · masa de impacto 13.'),
  (date '2026-09-11', 'food-agriculture', 84, 'Recalculado del briefing del 11/09 · masa de impacto 13.'),
  (date '2026-09-12', 'macro', 92, 'Recalculado del briefing del 12/09 · masa de impacto 13.'),
  (date '2026-09-12', 'geopolitics', 87, 'Recalculado del briefing del 12/09 · masa de impacto 8.'),
  (date '2026-09-12', 'fdi', 19, 'Recalculado del briefing del 12/09 · masa de impacto 9.'),
  (date '2026-09-12', 'critical-minerals', 41, 'Recalculado del briefing del 12/09 · masa de impacto 17.'),
  (date '2026-09-12', 'real-estate', 87, 'Recalculado del briefing del 12/09 · masa de impacto 9.'),
  (date '2026-09-12', 'ma-growth', 46, 'Recalculado del briefing del 12/09 · masa de impacto 7.'),
  (date '2026-09-12', 'emerging-markets', 63, 'Recalculado del briefing del 12/09 · masa de impacto 8.'),
  (date '2026-09-12', 'trade-policy', 82, 'Recalculado del briefing del 12/09 · masa de impacto 14.'),
  (date '2026-09-12', 'food-agriculture', 40, 'Recalculado del briefing del 12/09 · masa de impacto 7.'),
  (date '2026-09-13', 'macro', 84, 'Recalculado del briefing del 13/09 · masa de impacto 11.'),
  (date '2026-09-13', 'geopolitics', 84, 'Recalculado del briefing del 13/09 · masa de impacto 10.'),
  (date '2026-09-13', 'fdi', 84, 'Recalculado del briefing del 13/09 · masa de impacto 10.'),
  (date '2026-09-13', 'critical-minerals', 53, 'Recalculado del briefing del 13/09 · masa de impacto 8.'),
  (date '2026-09-13', 'real-estate', 43, 'Recalculado del briefing del 13/09 · masa de impacto 8.'),
  (date '2026-09-13', 'ma-growth', 68, 'Recalculado del briefing del 13/09 · masa de impacto 5.'),
  (date '2026-09-13', 'emerging-markets', 72, 'Recalculado del briefing del 13/09 · masa de impacto 10.'),
  (date '2026-09-13', 'trade-policy', 84, 'Recalculado del briefing del 13/09 · masa de impacto 10.'),
  (date '2026-09-13', 'food-agriculture', 67, 'Recalculado del briefing del 13/09 · masa de impacto 5.'),
  (date '2026-09-14', 'macro', 92, 'Recalculado del briefing del 14/09 · masa de impacto 16.'),
  (date '2026-09-14', 'geopolitics', 92, 'Recalculado del briefing del 14/09 · masa de impacto 16.'),
  (date '2026-09-14', 'fdi', 75, 'Recalculado del briefing del 14/09 · masa de impacto 10.'),
  (date '2026-09-14', 'critical-minerals', 92, 'Recalculado del briefing del 14/09 · masa de impacto 21.'),
  (date '2026-09-14', 'real-estate', 25, 'Recalculado del briefing del 14/09 · masa de impacto 7.'),
  (date '2026-09-14', 'ma-growth', 64, 'Recalculado del briefing del 14/09 · masa de impacto 9.'),
  (date '2026-09-14', 'emerging-markets', 63, 'Recalculado del briefing del 14/09 · masa de impacto 12.'),
  (date '2026-09-14', 'trade-policy', 55, 'Recalculado del briefing del 14/09 · masa de impacto 9.'),
  (date '2026-09-14', 'food-agriculture', 63, 'Recalculado del briefing del 14/09 · masa de impacto 7.'),
  (date '2026-09-15', 'macro', 84, 'Recalculado del briefing del 15/09 · masa de impacto 11.'),
  (date '2026-09-15', 'geopolitics', 92, 'Recalculado del briefing del 15/09 · masa de impacto 13.'),
  (date '2026-09-15', 'fdi', 48, 'Recalculado del briefing del 15/09 · masa de impacto 7.'),
  (date '2026-09-15', 'critical-minerals', 60, 'Recalculado del briefing del 15/09 · masa de impacto 13.'),
  (date '2026-09-15', 'real-estate', 27, 'Recalculado del briefing del 15/09 · masa de impacto 6.'),
  (date '2026-09-15', 'ma-growth', 45, 'Recalculado del briefing del 15/09 · masa de impacto 8.'),
  (date '2026-09-15', 'emerging-markets', 57, 'Recalculado del briefing del 15/09 · masa de impacto 8.'),
  (date '2026-09-15', 'trade-policy', 92, 'Recalculado del briefing del 15/09 · masa de impacto 11.'),
  (date '2026-09-15', 'food-agriculture', 56, 'Recalculado del briefing del 15/09 · masa de impacto 5.'),
  (date '2026-09-16', 'macro', 65, 'Recalculado del briefing del 16/09 · masa de impacto 17.'),
  (date '2026-09-16', 'geopolitics', 77, 'Recalculado del briefing del 16/09 · masa de impacto 7.'),
  (date '2026-09-16', 'fdi', 36, 'Recalculado del briefing del 16/09 · masa de impacto 7.'),
  (date '2026-09-16', 'critical-minerals', 84, 'Recalculado del briefing del 16/09 · masa de impacto 13.'),
  (date '2026-09-16', 'real-estate', 88, 'Recalculado del briefing del 16/09 · masa de impacto 11.'),
  (date '2026-09-16', 'ma-growth', 19, 'Recalculado del briefing del 16/09 · masa de impacto 9.'),
  (date '2026-09-16', 'emerging-markets', 69, 'Recalculado del briefing del 16/09 · masa de impacto 10.'),
  (date '2026-09-16', 'trade-policy', 20, 'Recalculado del briefing del 16/09 · masa de impacto 7.'),
  (date '2026-09-16', 'food-agriculture', 82, 'Recalculado del briefing del 16/09 · masa de impacto 4.'),
  (date '2026-09-17', 'macro', 77, 'Recalculado del briefing del 17/09 · masa de impacto 11.'),
  (date '2026-09-17', 'geopolitics', 77, 'Recalculado del briefing del 17/09 · masa de impacto 11.'),
  (date '2026-09-17', 'fdi', 50, 'Recalculado del briefing del 17/09 · masa de impacto 8.'),
  (date '2026-09-17', 'critical-minerals', 79, 'Recalculado del briefing del 17/09 · masa de impacto 13.'),
  (date '2026-09-17', 'real-estate', 56, 'Recalculado del briefing del 17/09 · masa de impacto 9.'),
  (date '2026-09-17', 'ma-growth', 28, 'Recalculado del briefing del 17/09 · masa de impacto 12.'),
  (date '2026-09-17', 'emerging-markets', 70, 'Recalculado del briefing del 17/09 · masa de impacto 11.'),
  (date '2026-09-17', 'trade-policy', 82, 'Recalculado del briefing del 17/09 · masa de impacto 13.'),
  (date '2026-09-17', 'food-agriculture', 45, 'Recalculado del briefing del 17/09 · masa de impacto 6.'),
  (date '2026-09-18', 'macro', 59, 'Recalculado del briefing del 18/09 · masa de impacto 14.'),
  (date '2026-09-18', 'geopolitics', 85, 'Recalculado del briefing del 18/09 · masa de impacto 12.'),
  (date '2026-09-18', 'fdi', 28, 'Recalculado del briefing del 18/09 · masa de impacto 11.'),
  (date '2026-09-18', 'critical-minerals', 62, 'Recalculado del briefing del 18/09 · masa de impacto 14.'),
  (date '2026-09-18', 'real-estate', 33, 'Recalculado del briefing del 18/09 · masa de impacto 10.'),
  (date '2026-09-18', 'ma-growth', 37, 'Recalculado del briefing del 18/09 · masa de impacto 10.'),
  (date '2026-09-18', 'emerging-markets', 34, 'Recalculado del briefing del 18/09 · masa de impacto 12.'),
  (date '2026-09-18', 'trade-policy', 53, 'Recalculado del briefing del 18/09 · masa de impacto 14.'),
  (date '2026-09-18', 'food-agriculture', 60, 'Recalculado del briefing del 18/09 · masa de impacto 8.'),
  (date '2026-09-19', 'macro', 53, 'Recalculado del briefing del 19/09 · masa de impacto 11.'),
  (date '2026-09-19', 'geopolitics', 87, 'Recalculado del briefing del 19/09 · masa de impacto 8.'),
  (date '2026-09-19', 'fdi', 45, 'Recalculado del briefing del 19/09 · masa de impacto 9.'),
  (date '2026-09-19', 'critical-minerals', 83, 'Recalculado del briefing del 19/09 · masa de impacto 18.'),
  (date '2026-09-19', 'real-estate', 44, 'Recalculado del briefing del 19/09 · masa de impacto 12.'),
  (date '2026-09-19', 'ma-growth', 28, 'Recalculado del briefing del 19/09 · masa de impacto 12.'),
  (date '2026-09-19', 'emerging-markets', 52, 'Recalculado del briefing del 19/09 · masa de impacto 9.'),
  (date '2026-09-19', 'trade-policy', 71, 'Recalculado del briefing del 19/09 · masa de impacto 14.'),
  (date '2026-09-19', 'food-agriculture', 77, 'Recalculado del briefing del 19/09 · masa de impacto 8.'),
  (date '2026-09-20', 'macro', 76, 'Recalculado del briefing del 20/09 · masa de impacto 9.'),
  (date '2026-09-20', 'geopolitics', 68, 'Recalculado del briefing del 20/09 · masa de impacto 9.'),
  (date '2026-09-20', 'fdi', 34, 'Recalculado del briefing del 20/09 · masa de impacto 6.'),
  (date '2026-09-20', 'critical-minerals', 62, 'Recalculado del briefing del 20/09 · masa de impacto 13.'),
  (date '2026-09-20', 'real-estate', 48, 'Recalculado del briefing del 20/09 · masa de impacto 8.'),
  (date '2026-09-20', 'ma-growth', 33, 'Recalculado del briefing del 20/09 · masa de impacto 4.'),
  (date '2026-09-20', 'emerging-markets', 20, 'Recalculado del briefing del 20/09 · masa de impacto 7.'),
  (date '2026-09-20', 'trade-policy', 79, 'Recalculado del briefing del 20/09 · masa de impacto 10.'),
  (date '2026-09-20', 'food-agriculture', 78, 'Recalculado del briefing del 20/09 · masa de impacto 6.'),
  (date '2026-09-21', 'macro', 78, 'Recalculado del briefing del 21/09 · masa de impacto 11.'),
  (date '2026-09-21', 'geopolitics', 92, 'Recalculado del briefing del 21/09 · masa de impacto 7.'),
  (date '2026-09-21', 'fdi', 55, 'Recalculado del briefing del 21/09 · masa de impacto 10.'),
  (date '2026-09-21', 'critical-minerals', 49, 'Recalculado del briefing del 21/09 · masa de impacto 11.'),
  (date '2026-09-21', 'real-estate', 36, 'Recalculado del briefing del 21/09 · masa de impacto 5.'),
  (date '2026-09-21', 'ma-growth', 64, 'Recalculado del briefing del 21/09 · masa de impacto 7.'),
  (date '2026-09-21', 'emerging-markets', 47, 'Recalculado del briefing del 21/09 · masa de impacto 12.'),
  (date '2026-09-21', 'trade-policy', 66, 'Recalculado del briefing del 21/09 · masa de impacto 9.'),
  (date '2026-09-21', 'food-agriculture', 15, 'Recalculado del briefing del 21/09 · masa de impacto 4.'),
  (date '2026-09-22', 'macro', 78, 'Recalculado del briefing del 22/09 · masa de impacto 17.'),
  (date '2026-09-22', 'geopolitics', 76, 'Recalculado del briefing del 22/09 · masa de impacto 14.'),
  (date '2026-09-22', 'fdi', 15, 'Recalculado del briefing del 22/09 · masa de impacto 10.'),
  (date '2026-09-22', 'critical-minerals', 77, 'Recalculado del briefing del 22/09 · masa de impacto 18.'),
  (date '2026-09-22', 'real-estate', 15, 'Recalculado del briefing del 22/09 · masa de impacto 12.'),
  (date '2026-09-22', 'ma-growth', 30, 'Recalculado del briefing del 22/09 · masa de impacto 15.'),
  (date '2026-09-22', 'emerging-markets', 20, 'Recalculado del briefing del 22/09 · masa de impacto 13.'),
  (date '2026-09-22', 'trade-policy', 58, 'Recalculado del briefing del 22/09 · masa de impacto 18.'),
  (date '2026-09-22', 'food-agriculture', 27, 'Recalculado del briefing del 22/09 · masa de impacto 13.'),
  (date '2026-09-23', 'macro', 71, 'Recalculado del briefing del 23/09 · masa de impacto 8.'),
  (date '2026-09-23', 'geopolitics', 27, 'Recalculado del briefing del 23/09 · masa de impacto 6.'),
  (date '2026-09-23', 'fdi', 15, 'Recalculado del briefing del 23/09 · masa de impacto 8.'),
  (date '2026-09-23', 'critical-minerals', 61, 'Recalculado del briefing del 23/09 · masa de impacto 9.'),
  (date '2026-09-23', 'real-estate', 32, 'Recalculado del briefing del 23/09 · masa de impacto 9.'),
  (date '2026-09-23', 'ma-growth', 15, 'Recalculado del briefing del 23/09 · masa de impacto 8.'),
  (date '2026-09-23', 'emerging-markets', 15, 'Recalculado del briefing del 23/09 · masa de impacto 8.'),
  (date '2026-09-23', 'trade-policy', 49, 'Recalculado del briefing del 23/09 · masa de impacto 9.'),
  (date '2026-09-23', 'food-agriculture', 43, 'Recalculado del briefing del 23/09 · masa de impacto 6.'),
  (date '2026-09-24', 'macro', 84, 'Recalculado del briefing del 24/09 · masa de impacto 11.'),
  (date '2026-09-24', 'geopolitics', 89, 'Recalculado del briefing del 24/09 · masa de impacto 13.'),
  (date '2026-09-24', 'fdi', 15, 'Recalculado del briefing del 24/09 · masa de impacto 13.'),
  (date '2026-09-24', 'critical-minerals', 84, 'Recalculado del briefing del 24/09 · masa de impacto 15.'),
  (date '2026-09-24', 'real-estate', 65, 'Recalculado del briefing del 24/09 · masa de impacto 8.'),
  (date '2026-09-24', 'ma-growth', 27, 'Recalculado del briefing del 24/09 · masa de impacto 9.'),
  (date '2026-09-24', 'emerging-markets', 72, 'Recalculado del briefing del 24/09 · masa de impacto 11.'),
  (date '2026-09-24', 'trade-policy', 61, 'Recalculado del briefing del 24/09 · masa de impacto 13.'),
  (date '2026-09-24', 'food-agriculture', 15, 'Recalculado del briefing del 24/09 · masa de impacto 8.'),
  (date '2026-09-25', 'macro', 40, 'Recalculado del briefing del 25/09 · masa de impacto 10.'),
  (date '2026-09-25', 'geopolitics', 80, 'Recalculado del briefing del 25/09 · masa de impacto 19.'),
  (date '2026-09-25', 'fdi', 33, 'Recalculado del briefing del 25/09 · masa de impacto 10.'),
  (date '2026-09-25', 'critical-minerals', 73, 'Recalculado del briefing del 25/09 · masa de impacto 15.'),
  (date '2026-09-25', 'real-estate', 68, 'Recalculado del briefing del 25/09 · masa de impacto 13.'),
  (date '2026-09-25', 'ma-growth', 37, 'Recalculado del briefing del 25/09 · masa de impacto 10.'),
  (date '2026-09-25', 'emerging-markets', 40, 'Recalculado del briefing del 25/09 · masa de impacto 12.'),
  (date '2026-09-25', 'trade-policy', 71, 'Recalculado del briefing del 25/09 · masa de impacto 12.'),
  (date '2026-09-25', 'food-agriculture', 69, 'Recalculado del briefing del 25/09 · masa de impacto 7.'),
  (date '2026-09-26', 'macro', 72, 'Recalculado del briefing del 26/09 · masa de impacto 17.'),
  (date '2026-09-26', 'geopolitics', 59, 'Recalculado del briefing del 26/09 · masa de impacto 7.'),
  (date '2026-09-26', 'fdi', 37, 'Recalculado del briefing del 26/09 · masa de impacto 8.'),
  (date '2026-09-26', 'critical-minerals', 77, 'Recalculado del briefing del 26/09 · masa de impacto 10.'),
  (date '2026-09-26', 'real-estate', 45, 'Recalculado del briefing del 26/09 · masa de impacto 9.'),
  (date '2026-09-26', 'ma-growth', 61, 'Recalculado del briefing del 26/09 · masa de impacto 10.'),
  (date '2026-09-26', 'emerging-markets', 43, 'Recalculado del briefing del 26/09 · masa de impacto 8.'),
  (date '2026-09-26', 'trade-policy', 71, 'Recalculado del briefing del 26/09 · masa de impacto 15.'),
  (date '2026-09-26', 'food-agriculture', 57, 'Recalculado del briefing del 26/09 · masa de impacto 9.'),
  (date '2026-09-27', 'macro', 62, 'Recalculado del briefing del 27/09 · masa de impacto 17.'),
  (date '2026-09-27', 'geopolitics', 69, 'Recalculado del briefing del 27/09 · masa de impacto 12.'),
  (date '2026-09-27', 'fdi', 18, 'Recalculado del briefing del 27/09 · masa de impacto 14.'),
  (date '2026-09-27', 'critical-minerals', 72, 'Recalculado del briefing del 27/09 · masa de impacto 21.'),
  (date '2026-09-27', 'real-estate', 67, 'Recalculado del briefing del 27/09 · masa de impacto 10.'),
  (date '2026-09-27', 'ma-growth', 38, 'Recalculado del briefing del 27/09 · masa de impacto 7.'),
  (date '2026-09-27', 'emerging-markets', 34, 'Recalculado del briefing del 27/09 · masa de impacto 13.'),
  (date '2026-09-27', 'trade-policy', 40, 'Recalculado del briefing del 27/09 · masa de impacto 11.'),
  (date '2026-09-27', 'food-agriculture', 56, 'Recalculado del briefing del 27/09 · masa de impacto 11.'),
  (date '2026-09-28', 'macro', 75, 'Recalculado del briefing del 28/09 · masa de impacto 12.'),
  (date '2026-09-28', 'geopolitics', 79, 'Recalculado del briefing del 28/09 · masa de impacto 14.'),
  (date '2026-09-28', 'fdi', 43, 'Recalculado del briefing del 28/09 · masa de impacto 9.'),
  (date '2026-09-28', 'critical-minerals', 67, 'Recalculado del briefing del 28/09 · masa de impacto 15.'),
  (date '2026-09-28', 'real-estate', 65, 'Recalculado del briefing del 28/09 · masa de impacto 10.'),
  (date '2026-09-28', 'ma-growth', 50, 'Recalculado del briefing del 28/09 · masa de impacto 9.'),
  (date '2026-09-28', 'emerging-markets', 48, 'Recalculado del briefing del 28/09 · masa de impacto 12.'),
  (date '2026-09-28', 'trade-policy', 33, 'Recalculado del briefing del 28/09 · masa de impacto 8.'),
  (date '2026-09-28', 'food-agriculture', 71, 'Recalculado del briefing del 28/09 · masa de impacto 4.'),
  (date '2026-09-29', 'macro', 92, 'Recalculado del briefing del 29/09 · masa de impacto 12.'),
  (date '2026-09-29', 'geopolitics', 58, 'Recalculado del briefing del 29/09 · masa de impacto 8.'),
  (date '2026-09-29', 'fdi', 28, 'Recalculado del briefing del 29/09 · masa de impacto 8.'),
  (date '2026-09-29', 'critical-minerals', 54, 'Recalculado del briefing del 29/09 · masa de impacto 10.'),
  (date '2026-09-29', 'real-estate', 43, 'Recalculado del briefing del 29/09 · masa de impacto 9.'),
  (date '2026-09-29', 'ma-growth', 34, 'Recalculado del briefing del 29/09 · masa de impacto 9.'),
  (date '2026-09-29', 'emerging-markets', 79, 'Recalculado del briefing del 29/09 · masa de impacto 10.'),
  (date '2026-09-29', 'trade-policy', 32, 'Recalculado del briefing del 29/09 · masa de impacto 11.'),
  (date '2026-09-29', 'food-agriculture', 80, 'Recalculado del briefing del 29/09 · masa de impacto 7.'),
  (date '2026-09-30', 'macro', 72, 'Recalculado del briefing del 30/09 · masa de impacto 20.'),
  (date '2026-09-30', 'geopolitics', 72, 'Recalculado del briefing del 30/09 · masa de impacto 17.'),
  (date '2026-09-30', 'fdi', 42, 'Recalculado del briefing del 30/09 · masa de impacto 11.'),
  (date '2026-09-30', 'critical-minerals', 73, 'Recalculado del briefing del 30/09 · masa de impacto 23.'),
  (date '2026-09-30', 'real-estate', 66, 'Recalculado del briefing del 30/09 · masa de impacto 15.'),
  (date '2026-09-30', 'ma-growth', 47, 'Recalculado del briefing del 30/09 · masa de impacto 19.'),
  (date '2026-09-30', 'emerging-markets', 58, 'Recalculado del briefing del 30/09 · masa de impacto 19.'),
  (date '2026-09-30', 'trade-policy', 70, 'Recalculado del briefing del 30/09 · masa de impacto 27.'),
  (date '2026-09-30', 'food-agriculture', 53, 'Recalculado del briefing del 30/09 · masa de impacto 13.'),
  (date '2026-10-01', 'macro', 92, 'Recalculado del briefing del 01/10 · masa de impacto 12.'),
  (date '2026-10-01', 'geopolitics', 71, 'Recalculado del briefing del 01/10 · masa de impacto 7.'),
  (date '2026-10-01', 'fdi', 73, 'Recalculado del briefing del 01/10 · masa de impacto 8.'),
  (date '2026-10-01', 'critical-minerals', 90, 'Recalculado del briefing del 01/10 · masa de impacto 9.'),
  (date '2026-10-01', 'real-estate', 83, 'Recalculado del briefing del 01/10 · masa de impacto 9.'),
  (date '2026-10-01', 'ma-growth', 44, 'Recalculado del briefing del 01/10 · masa de impacto 5.'),
  (date '2026-10-01', 'emerging-markets', 62, 'Recalculado del briefing del 01/10 · masa de impacto 7.'),
  (date '2026-10-01', 'trade-policy', 92, 'Recalculado del briefing del 01/10 · masa de impacto 10.'),
  (date '2026-10-01', 'food-agriculture', 92, 'Recalculado del briefing del 01/10 · masa de impacto 6.'),
  (date '2026-10-02', 'macro', 40, 'Recalculado del briefing del 02/10 · masa de impacto 9.'),
  (date '2026-10-02', 'geopolitics', 71, 'Recalculado del briefing del 02/10 · masa de impacto 4.'),
  (date '2026-10-02', 'fdi', 33, 'Recalculado del briefing del 02/10 · masa de impacto 8.'),
  (date '2026-10-02', 'critical-minerals', 63, 'Recalculado del briefing del 02/10 · masa de impacto 11.'),
  (date '2026-10-02', 'real-estate', 87, 'Recalculado del briefing del 02/10 · masa de impacto 9.'),
  (date '2026-10-02', 'ma-growth', 36, 'Recalculado del briefing del 02/10 · masa de impacto 5.'),
  (date '2026-10-02', 'emerging-markets', 42, 'Recalculado del briefing del 02/10 · masa de impacto 10.'),
  (date '2026-10-02', 'trade-policy', 87, 'Recalculado del briefing del 02/10 · masa de impacto 12.'),
  (date '2026-10-02', 'food-agriculture', 72, 'Recalculado del briefing del 02/10 · masa de impacto 6.'),
  (date '2026-10-03', 'macro', 50, 'Recalculado del briefing del 03/10 · masa de impacto 6.'),
  (date '2026-10-03', 'geopolitics', 86, 'Recalculado del briefing del 03/10 · masa de impacto 7.'),
  (date '2026-10-03', 'fdi', 66, 'Recalculado del briefing del 03/10 · masa de impacto 6.'),
  (date '2026-10-03', 'critical-minerals', 73, 'Recalculado del briefing del 03/10 · masa de impacto 8.'),
  (date '2026-10-03', 'real-estate', 54, 'Recalculado del briefing del 03/10 · masa de impacto 6.'),
  (date '2026-10-03', 'ma-growth', 75, 'Recalculado del briefing del 03/10 · masa de impacto 5.'),
  (date '2026-10-03', 'emerging-markets', 47, 'Recalculado del briefing del 03/10 · masa de impacto 7.'),
  (date '2026-10-03', 'trade-policy', 87, 'Recalculado del briefing del 03/10 · masa de impacto 8.'),
  (date '2026-10-03', 'food-agriculture', 84, 'Recalculado del briefing del 03/10 · masa de impacto 8.'),
  (date '2026-10-04', 'macro', 92, 'Recalculado del briefing del 04/10 · masa de impacto 8.'),
  (date '2026-10-04', 'geopolitics', 73, 'Recalculado del briefing del 04/10 · masa de impacto 12.'),
  (date '2026-10-04', 'fdi', 30, 'Recalculado del briefing del 04/10 · masa de impacto 7.'),
  (date '2026-10-04', 'critical-minerals', 37, 'Recalculado del briefing del 04/10 · masa de impacto 12.'),
  (date '2026-10-04', 'real-estate', 83, 'Recalculado del briefing del 04/10 · masa de impacto 9.'),
  (date '2026-10-04', 'ma-growth', 22, 'Recalculado del briefing del 04/10 · masa de impacto 5.'),
  (date '2026-10-04', 'emerging-markets', 76, 'Recalculado del briefing del 04/10 · masa de impacto 9.'),
  (date '2026-10-04', 'trade-policy', 67, 'Recalculado del briefing del 04/10 · masa de impacto 11.'),
  (date '2026-10-04', 'food-agriculture', 72, 'Recalculado del briefing del 04/10 · masa de impacto 12.'),
  (date '2026-10-05', 'macro', 54, 'Recalculado del briefing del 05/10 · masa de impacto 8.'),
  (date '2026-10-05', 'geopolitics', 65, 'Recalculado del briefing del 05/10 · masa de impacto 13.'),
  (date '2026-10-05', 'fdi', 36, 'Recalculado del briefing del 05/10 · masa de impacto 5.'),
  (date '2026-10-05', 'critical-minerals', 55, 'Recalculado del briefing del 05/10 · masa de impacto 13.'),
  (date '2026-10-05', 'real-estate', 77, 'Recalculado del briefing del 05/10 · masa de impacto 8.'),
  (date '2026-10-05', 'ma-growth', 39, 'Recalculado del briefing del 05/10 · masa de impacto 11.'),
  (date '2026-10-05', 'emerging-markets', 29, 'Recalculado del briefing del 05/10 · masa de impacto 9.'),
  (date '2026-10-05', 'trade-policy', 75, 'Recalculado del briefing del 05/10 · masa de impacto 10.'),
  (date '2026-10-05', 'food-agriculture', 75, 'Recalculado del briefing del 05/10 · masa de impacto 12.'),
  (date '2026-10-06', 'macro', 72, 'Recalculado del briefing del 06/10 · masa de impacto 10.'),
  (date '2026-10-06', 'geopolitics', 89, 'Recalculado del briefing del 06/10 · masa de impacto 16.'),
  (date '2026-10-06', 'fdi', 37, 'Recalculado del briefing del 06/10 · masa de impacto 10.'),
  (date '2026-10-06', 'critical-minerals', 28, 'Recalculado del briefing del 06/10 · masa de impacto 11.'),
  (date '2026-10-06', 'real-estate', 89, 'Recalculado del briefing del 06/10 · masa de impacto 13.'),
  (date '2026-10-06', 'ma-growth', 47, 'Recalculado del briefing del 06/10 · masa de impacto 8.'),
  (date '2026-10-06', 'emerging-markets', 52, 'Recalculado del briefing del 06/10 · masa de impacto 13.'),
  (date '2026-10-06', 'trade-policy', 78, 'Recalculado del briefing del 06/10 · masa de impacto 9.'),
  (date '2026-10-06', 'food-agriculture', 83, 'Recalculado del briefing del 06/10 · masa de impacto 9.'),
  (date '2026-10-07', 'macro', 78, 'Recalculado del briefing del 07/10 · masa de impacto 14.'),
  (date '2026-10-07', 'geopolitics', 73, 'Recalculado del briefing del 07/10 · masa de impacto 9.'),
  (date '2026-10-07', 'fdi', 52, 'Recalculado del briefing del 07/10 · masa de impacto 15.'),
  (date '2026-10-07', 'critical-minerals', 51, 'Recalculado del briefing del 07/10 · masa de impacto 23.'),
  (date '2026-10-07', 'real-estate', 27, 'Recalculado del briefing del 07/10 · masa de impacto 9.'),
  (date '2026-10-07', 'ma-growth', 56, 'Recalculado del briefing del 07/10 · masa de impacto 14.'),
  (date '2026-10-07', 'emerging-markets', 58, 'Recalculado del briefing del 07/10 · masa de impacto 13.'),
  (date '2026-10-07', 'trade-policy', 51, 'Recalculado del briefing del 07/10 · masa de impacto 15.'),
  (date '2026-10-07', 'food-agriculture', 43, 'Recalculado del briefing del 07/10 · masa de impacto 11.'),
  (date '2026-10-08', 'macro', 82, 'Recalculado del briefing del 08/10 · masa de impacto 15.'),
  (date '2026-10-08', 'geopolitics', 40, 'Recalculado del briefing del 08/10 · masa de impacto 7.'),
  (date '2026-10-08', 'fdi', 54, 'Recalculado del briefing del 08/10 · masa de impacto 11.'),
  (date '2026-10-08', 'critical-minerals', 92, 'Recalculado del briefing del 08/10 · masa de impacto 21.'),
  (date '2026-10-08', 'real-estate', 49, 'Recalculado del briefing del 08/10 · masa de impacto 6.'),
  (date '2026-10-08', 'ma-growth', 15, 'Recalculado del briefing del 08/10 · masa de impacto 11.'),
  (date '2026-10-08', 'emerging-markets', 53, 'Recalculado del briefing del 08/10 · masa de impacto 12.'),
  (date '2026-10-08', 'trade-policy', 58, 'Recalculado del briefing del 08/10 · masa de impacto 16.'),
  (date '2026-10-08', 'food-agriculture', 68, 'Recalculado del briefing del 08/10 · masa de impacto 8.'),
  (date '2026-10-09', 'macro', 88, 'Recalculado del briefing del 09/10 · masa de impacto 17.'),
  (date '2026-10-09', 'geopolitics', 84, 'Recalculado del briefing del 09/10 · masa de impacto 11.'),
  (date '2026-10-09', 'fdi', 74, 'Recalculado del briefing del 09/10 · masa de impacto 11.'),
  (date '2026-10-09', 'critical-minerals', 61, 'Recalculado del briefing del 09/10 · masa de impacto 17.'),
  (date '2026-10-09', 'real-estate', 92, 'Recalculado del briefing del 09/10 · masa de impacto 8.'),
  (date '2026-10-09', 'ma-growth', 25, 'Recalculado del briefing del 09/10 · masa de impacto 7.'),
  (date '2026-10-09', 'emerging-markets', 59, 'Recalculado del briefing del 09/10 · masa de impacto 6.'),
  (date '2026-10-09', 'trade-policy', 77, 'Recalculado del briefing del 09/10 · masa de impacto 10.'),
  (date '2026-10-09', 'food-agriculture', 86, 'Recalculado del briefing del 09/10 · masa de impacto 11.'),
  (date '2026-10-10', 'macro', 43, 'Recalculado del briefing del 10/10 · masa de impacto 8.'),
  (date '2026-10-10', 'geopolitics', 74, 'Recalculado del briefing del 10/10 · masa de impacto 8.'),
  (date '2026-10-10', 'fdi', 55, 'Recalculado del briefing del 10/10 · masa de impacto 14.'),
  (date '2026-10-10', 'critical-minerals', 24, 'Recalculado del briefing del 10/10 · masa de impacto 12.'),
  (date '2026-10-10', 'real-estate', 70, 'Recalculado del briefing del 10/10 · masa de impacto 9.'),
  (date '2026-10-10', 'ma-growth', 41, 'Recalculado del briefing del 10/10 · masa de impacto 7.'),
  (date '2026-10-10', 'emerging-markets', 65, 'Recalculado del briefing del 10/10 · masa de impacto 7.'),
  (date '2026-10-10', 'trade-policy', 56, 'Recalculado del briefing del 10/10 · masa de impacto 12.'),
  (date '2026-10-10', 'food-agriculture', 66, 'Recalculado del briefing del 10/10 · masa de impacto 6.')
on conflict (fecha, mesa) do update
  set valor = excluded.valor, fundamento = excluded.fundamento;

-- ── 4 · LA LECTURA PUBLICADA, TAMBIEN DESDE EL HISTORICO ────────────
-- risk_index guarda la LECTURA: el numero que publico el briefing ese
-- dia. ZRC OS tenia 21 dias; el historico da 49.
insert into risk_index (fecha, valor, estado) values
  (date '2026-08-19', 62, 'publicado'),
  (date '2026-08-20', 64, 'publicado'),
  (date '2026-08-21', 62, 'publicado'),
  (date '2026-08-22', 64, 'publicado'),
  (date '2026-08-23', 52, 'publicado'),
  (date '2026-08-24', 50, 'publicado'),
  (date '2026-08-25', 50, 'publicado'),
  (date '2026-08-26', 58, 'publicado'),
  (date '2026-08-28', 56, 'publicado'),
  (date '2026-08-29', 58, 'publicado'),
  (date '2026-08-30', 62, 'publicado'),
  (date '2026-08-31', 68, 'publicado'),
  (date '2026-09-01', 72, 'publicado'),
  (date '2026-09-02', 68, 'publicado'),
  (date '2026-09-03', 62, 'publicado'),
  (date '2026-09-07', 68, 'publicado'),
  (date '2026-09-08', 72, 'publicado'),
  (date '2026-09-09', 76, 'publicado'),
  (date '2026-09-10', 72, 'publicado'),
  (date '2026-09-11', 68, 'publicado'),
  (date '2026-09-12', 66, 'publicado'),
  (date '2026-09-13', 68, 'publicado'),
  (date '2026-09-14', 76, 'publicado'),
  (date '2026-09-15', 72, 'publicado'),
  (date '2026-09-16', 68, 'publicado'),
  (date '2026-09-17', 65, 'publicado'),
  (date '2026-09-18', 62, 'publicado'),
  (date '2026-09-19', 58, 'publicado'),
  (date '2026-09-20', 62, 'publicado'),
  (date '2026-09-21', 65, 'publicado'),
  (date '2026-09-22', 62, 'publicado'),
  (date '2026-09-23', 58, 'publicado'),
  (date '2026-09-24', 62, 'publicado'),
  (date '2026-09-25', 64, 'publicado'),
  (date '2026-09-26', 62, 'publicado'),
  (date '2026-09-27', 64, 'publicado'),
  (date '2026-09-28', 62, 'publicado'),
  (date '2026-09-29', 60, 'publicado'),
  (date '2026-09-30', 62, 'publicado'),
  (date '2026-10-01', 64, 'publicado'),
  (date '2026-10-02', 58, 'publicado'),
  (date '2026-10-03', 62, 'publicado'),
  (date '2026-10-04', 64, 'publicado'),
  (date '2026-10-05', 68, 'publicado'),
  (date '2026-10-06', 66, 'publicado'),
  (date '2026-10-07', 64, 'publicado'),
  (date '2026-10-08', 72, 'publicado'),
  (date '2026-10-09', 68, 'publicado'),
  (date '2026-10-10', 66, 'publicado')
on conflict (fecha) do nothing;   -- lo que ya estaba clasificado manda:
                                  -- degradado y reconstruido no se pisan.


-- ╔═══════════════════════════════════════════════════════════════════╗
-- ║  22_metodos.sql                                                 ║
-- ╚═══════════════════════════════════════════════════════════════════╝

-- =====================================================================
-- ZRC · CAPA 3 — DOS CONSTRUCCIONES, DOS SERIES
--
-- v_risk_serie mezclaba las dos: cogia la lectura historica para los
-- dias sin mesas y la de mesas para el resto, y devolvia una sola
-- linea. Eso es empalmar dos medidas distintas, que es exactamente lo
-- que no se hace con el GeoRisk y tampoco debe hacerse aqui.
--
-- Ahora cada dia puede tener las dos, cada una con su metodo, y quien
-- dibuje decide. La brecha entre ambas deja de ser un detalle oculto y
-- pasa a ser un dato: si la IA se separa sistematicamente de su propia
-- formula, eso hay que verlo.
--
-- Idempotente.
-- =====================================================================

drop view if exists v_pendientes_firma;
drop view if exists v_risk_estado;
drop view if exists v_risk_serie;

-- ── LA SERIE, CON LAS DOS CONSTRUCCIONES ────────────────────────────
create view v_risk_serie
  with (security_invoker = true) as
select fecha, valor, estado,
       'lectura'::text as metodo,
       null::int as cobertura, null::int as mesas_leidas
  from risk_index
union all
select fecha, valor, estado, 'mesas', cobertura, mesas_leidas
  from v_risk_dia
 order by fecha, metodo;

comment on view v_risk_serie is
  'metodo = lectura: el numero que publico el briefing ese dia, que lo '
  'propone la IA y no se puede reproducir desde las mesas. '
  'metodo = mesas: el indice derivado de las senales de cada mesa con '
  'la formula del propio briefing. No son el mismo numero y no van en '
  'la misma linea.';

-- ── EL ESTADO DE HOY ────────────────────────────────────────────────
-- Manda el indice de MESAS: es el que la firma puede defender. La
-- lectura del mismo dia va al lado, y la brecha entre las dos es la
-- medida de cuanto se separa la IA de su propia formula.
create view v_risk_estado
  with (security_invoker = true) as
with m as (select * from v_risk_dia order by fecha desc limit 1),
     ant as (select valor from v_risk_dia order by fecha desc offset 1 limit 1)
select m.fecha, m.valor, m.estado, 'mesas'::text as metodo, m.cobertura,
       m.valor - (select valor from ant)                  as delta,
       (select r.valor from risk_index r where r.fecha = m.fecha) as lectura,
       m.valor - (select r.valor from risk_index r where r.fecha = m.fecha) as brecha,
       (current_date - m.fecha)                           as dias_sin_actualizar,
       (select count(*) from v_risk_dia)::int             as dias_serie,
       (current_date - m.fecha) > 3                       as caducado
  from m;

-- ── LA COLA DE FIRMA, IGUAL QUE ESTABA ──────────────────────────────
create view v_pendientes_firma
  with (security_invoker = true) as
select 'indice_caducado'::text as motivo,
       'Indice de mesas sin actualizar desde ' || to_char(e.fecha, 'DD/MM')
         || ' (' || e.dias_sin_actualizar || ' dias). El barrido esta parado.' as detalle,
       1 as prioridad, e.fecha + 1 as vence_en
  from v_risk_estado e where e.caducado
union all
select 'mesas_sin_fundamento',
       d.sin_fundamento || ' lecturas de ' || to_char(d.fecha, 'DD/MM')
         || ' sin fundamento anotado: no son lecturas, son cifras sueltas.',
       4, null::date
  from v_risk_dia d
 where d.sin_fundamento > 0 and d.fecha >= current_date - 7;

grant select on v_risk_serie, v_risk_estado, v_pendientes_firma to authenticated;

-- ── COMPROBACION ────────────────────────────────────────────────────
select 'mesas activas' as concepto, (select count(*)::text from risk_mesas where activa) as valor
union all select 'mesas retiradas', (select count(*)::text from risk_mesas where not activa)
union all select 'dias con indice de mesas', (select count(*)::text from v_risk_dia)
union all select 'dias con lectura publicada', (select count(*)::text from risk_index)
union all select 'lecturas por mesa cargadas', (select count(*)::text from risk_lecturas)
union all select 'ultimo dia de mesas', (select coalesce(max(fecha)::text,'ninguno') from v_risk_dia)
union all select 'indice de mesas hoy', (select coalesce(valor::text,'-') from v_risk_estado)
union all select 'lectura del mismo dia', (select coalesce(lectura::text,'-') from v_risk_estado)
union all select 'brecha (mesas - lectura)', (select coalesce(brecha::text,'-') from v_risk_estado)
union all select 'caducado', (select case when caducado then 'SI' else 'no' end from v_risk_estado);
