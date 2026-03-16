-- Optional seed data for 360 PROTECTIVE executive demos.
-- Run manually on rfid_demo DB when you need realistic registered assets.

INSERT INTO public.rfid_demo_tags (epc, name, description, active)
VALUES
  ('000000000000000000000617', 'Contenedor frigorífico C-07', 'Zona carga A · Ruta Madrid-Valencia · Lote 2026-03', TRUE),
  ('000000000000000000000616', 'Palet mercancía peligrosa MP-03', 'Custodia ADR · expedición prioritaria', TRUE),
  ('000000000000000000000701', 'Jaula retorno logística JR-11', 'Consolidación nocturna · almacén central', TRUE),
  ('000000000000000000000702', 'Caja electrónica sensible ES-04', 'Control de impacto y acceso restringido', TRUE),
  ('000000000000000000000703', 'Módulo sanitario crítico SC-09', 'Cadena de custodia hospitalaria', TRUE),
  ('000000000000000000000704', 'Kit recambio operativo KR-21', 'Reposición técnica · zona mantenimiento', TRUE)
ON CONFLICT (epc)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = TRUE;
