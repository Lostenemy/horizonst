-- Optional seed data for commercial demos.
-- Run manually on rfid_demo DB when you need realistic registered tags.

INSERT INTO public.rfid_demo_tags (epc, name, description, active)
VALUES
  ('E2000017221101441890C101', 'Palet farmacéutico A-12', 'Zona picking norte · Lote 2026-03', TRUE),
  ('E2000017221101441890C102', 'Caja cadena frío B-07', 'Expedición hospitalaria · Ruta Madrid', TRUE),
  ('E2000017221101441890C103', 'Contenedor instrumental C-03', 'Material quirúrgico estéril', TRUE),
  ('E2000017221101441890C104', 'Activo móvil logística D-21', 'Carro de reparto interno', TRUE),
  ('E2000017221101441890C105', 'Kit diagnóstico E-09', 'Laboratorio central · Inventario crítico', TRUE)
ON CONFLICT (epc)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = TRUE;
