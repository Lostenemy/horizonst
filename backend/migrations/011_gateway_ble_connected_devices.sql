-- Añade la lectura observada 2201 sin modificar filas históricas del diario.
ALTER TABLE hardware_gateway_reads
  DROP CONSTRAINT hardware_gateway_reads_msg_type_check;

ALTER TABLE hardware_gateway_reads
  ADD CONSTRAINT hardware_gateway_reads_msg_type_check CHECK (
    (msg_id = 2002 AND read_type = 'gateway_identity') OR
    (msg_id = 2011 AND read_type = 'led_state') OR
    (msg_id = 2040 AND read_type = 'ble_scan_switch') OR
    (msg_id = 2041 AND read_type = 'filter_relation') OR
    (msg_id = 2057 AND read_type = 'duplicate_rule') OR
    (msg_id = 2201 AND read_type = 'ble_connected_devices')
  );

CREATE TABLE hardware_gateway_ble_snapshots (
  gateway_id INTEGER PRIMARY KEY,
  company_id UUID NOT NULL,
  msg_id INTEGER NOT NULL DEFAULT 2201 CHECK (msg_id = 2201),
  device_count INTEGER NOT NULL CHECK (device_count >= 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, company_id),
  CONSTRAINT hardware_gateway_ble_snapshots_gateway_company_fk
    FOREIGN KEY (gateway_id, company_id) REFERENCES gateways(id, company_id) ON DELETE CASCADE
);

CREATE TABLE hardware_gateway_ble_snapshot_items (
  gateway_id INTEGER NOT NULL,
  company_id UUID NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  device_mac CHAR(12) NOT NULL CHECK (device_mac ~ '^[0-9a-f]{12}$'),
  firmware_type INTEGER NOT NULL,
  PRIMARY KEY (gateway_id, position),
  UNIQUE (gateway_id, device_mac),
  CONSTRAINT hardware_gateway_ble_snapshot_items_snapshot_company_fk
    FOREIGN KEY (gateway_id, company_id)
    REFERENCES hardware_gateway_ble_snapshots(gateway_id, company_id) ON DELETE CASCADE
);

CREATE INDEX idx_hardware_gateway_ble_snapshots_company
  ON hardware_gateway_ble_snapshots(company_id, observed_at DESC);

COMMENT ON TABLE hardware_gateway_ble_snapshots IS
  'Última fotografía observada de la respuesta 2201; incluso device_count=0 representa una lista vacía válida.';
COMMENT ON TABLE hardware_gateway_ble_snapshot_items IS
  'Elementos ordenados de la última fotografía 2201; no confirman una conexión ni se correlacionan inequívocamente con una petición.';
COMMENT ON COLUMN hardware_gateway_ble_snapshot_items.firmware_type IS
  'Código entero bruto type comunicado por el firmware; no es un enum ni se le asigna semántica de producto.';
