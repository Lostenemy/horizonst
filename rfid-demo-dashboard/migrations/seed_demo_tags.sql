-- Optional seed data for executive demos (logistics / institutional).
-- Run manually on rfid_demo DB when you need realistic registered assets.

INSERT INTO public.rfid_demo_tags (epc, name, description, active)
VALUES
  ('000000000000000000000617', 'Caja munición 5.56 · B17', 'Lote logístico ALFA · tránsito controlado', TRUE),
  ('000000000000000000000616', 'Contenedor repuestos MRO · C09', 'Repuestos críticos de mantenimiento', TRUE),
  ('E2000017221101441890C101', 'Palé raciones operativas · R12', 'Suministro de campaña · sector norte', TRUE),
  ('E2000017221101441890C102', 'Kit comunicaciones tácticas · K04', 'Equipo radio cifrado listo para despliegue', TRUE),
  ('E2000017221101441890C103', 'Botiquín avanzado · M21', 'Material sanitario de intervención', TRUE),
  ('E2000017221101441890C104', 'Unidad energía móvil · E08', 'Módulo baterías para operación remota', TRUE)
ON CONFLICT (epc)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = TRUE;
