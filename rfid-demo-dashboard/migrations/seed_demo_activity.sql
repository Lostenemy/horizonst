-- Optional seed for recent dashboard activity (read events + inventory state).
-- Run AFTER seed_demo_tags.sql for a convincing executive demo timeline.

-- Reset only demo-related sample EPCs used in this script.
DELETE FROM public.rfid_demo_read_events
WHERE epc IN (
  '000000000000000000000617',
  '000000000000000000000616',
  '000000000000000000000701',
  '000000000000000000000702',
  '000000000000000000000799'
);

DELETE FROM public.rfid_demo_inventory_state
WHERE epc IN (
  '000000000000000000000617',
  '000000000000000000000616',
  '000000000000000000000701',
  '000000000000000000000702',
  '000000000000000000000799'
);

INSERT INTO public.rfid_demo_read_events
  (epc, reader_mac, antenna, direction, is_registered, raw_payload, event_ts, processed_at, ignored_by_debounce, debounce_window_ms)
VALUES
  ('000000000000000000000617', 'Lector-Puerta-Almacén-01', 1, 'IN', TRUE,  '{"seed":"demo_activity","route":"entrada principal"}'::jsonb, NOW() - INTERVAL '14 minutes', NOW() - INTERVAL '14 minutes', FALSE, 0),
  ('000000000000000000000616', 'Lector-Acceso-360P',      2, 'IN', TRUE,  '{"seed":"demo_activity","route":"acceso controlado"}'::jsonb, NOW() - INTERVAL '12 minutes', NOW() - INTERVAL '12 minutes', FALSE, 0),
  ('000000000000000000000701', 'Lector-Zona-Carga-A',      1, 'IN', TRUE,  '{"seed":"demo_activity","route":"zona carga"}'::jsonb, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', FALSE, 0),
  ('000000000000000000000799', 'Lector-Zona-Carga-A',      1, 'IN', FALSE, '{"seed":"demo_activity","route":"activo sin alta"}'::jsonb, NOW() - INTERVAL '7 minutes',  NOW() - INTERVAL '7 minutes',  FALSE, 0),
  ('000000000000000000000702', 'Lector-Puerta-Almacén-01', 2, 'OUT', TRUE, '{"seed":"demo_activity","route":"salida muelle"}'::jsonb, NOW() - INTERVAL '5 minutes',  NOW() - INTERVAL '5 minutes',  FALSE, 0),
  ('000000000000000000000617', 'Lector-Puerta-Almacén-01', 1, 'IGNORED', TRUE, '{"seed":"demo_activity","route":"rebote controlado"}'::jsonb, NOW() - INTERVAL '4 minutes', NOW() - INTERVAL '4 minutes', TRUE, 1200),
  ('000000000000000000000616', 'Lector-Acceso-360P',       2, 'IN', TRUE,  '{"seed":"demo_activity","route":"relectura"}'::jsonb, NOW() - INTERVAL '3 minutes',  NOW() - INTERVAL '3 minutes',  FALSE, 0),
  ('000000000000000000000799', 'Lector-Zona-Carga-A',      1, 'IN', FALSE, '{"seed":"demo_activity","route":"sin identificar"}'::jsonb, NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes', FALSE, 0);

INSERT INTO public.rfid_demo_inventory_state
  (epc, is_active, is_registered, last_reader_mac, last_antenna, last_direction, first_seen_at, last_seen_at, last_event_ts, updated_at)
VALUES
  ('000000000000000000000617', TRUE,  TRUE,  'Lector-Puerta-Almacén-01', 1, 'IN',  NOW() - INTERVAL '14 minutes', NOW() - INTERVAL '4 minutes', NOW() - INTERVAL '4 minutes', NOW() - INTERVAL '4 minutes'),
  ('000000000000000000000616', TRUE,  TRUE,  'Lector-Acceso-360P',       2, 'IN',  NOW() - INTERVAL '12 minutes', NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '3 minutes'),
  ('000000000000000000000701', TRUE,  TRUE,  'Lector-Zona-Carga-A',      1, 'IN',  NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'),
  ('000000000000000000000702', FALSE, TRUE,  'Lector-Puerta-Almacén-01', 2, 'OUT', NOW() - INTERVAL '5 minutes',  NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '5 minutes'),
  ('000000000000000000000799', TRUE,  FALSE, 'Lector-Zona-Carga-A',      1, 'IN',  NOW() - INTERVAL '7 minutes',  NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes')
ON CONFLICT (epc)
DO UPDATE SET
  is_active = EXCLUDED.is_active,
  is_registered = EXCLUDED.is_registered,
  last_reader_mac = EXCLUDED.last_reader_mac,
  last_antenna = EXCLUDED.last_antenna,
  last_direction = EXCLUDED.last_direction,
  first_seen_at = EXCLUDED.first_seen_at,
  last_seen_at = EXCLUDED.last_seen_at,
  last_event_ts = EXCLUDED.last_event_ts,
  updated_at = EXCLUDED.updated_at;
