-- Caller contract:
--   * run inside one transaction holding the documented advisory lock;
--   * populate pg_temp.bootstrap_horneo_inventory(kind, overlay_id,
--     normalized_mac, source_active) from the protected exchange file first.
DO $$
DECLARE
  horneo_company_id UUID;
BEGIN
  SELECT id INTO STRICT horneo_company_id
  FROM companies
  WHERE code = 'horneo';

  IF EXISTS (
    SELECT 1 FROM bootstrap_horneo_inventory
    WHERE kind NOT IN ('gateway', 'tag')
       OR overlay_id IS NULL
       OR normalized_mac !~ '^[0-9a-f]{12}$'
       OR (kind = 'tag' AND source_active IS NULL)
       OR (kind = 'gateway' AND source_active IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'bootstrap inventory contains an invalid row';
  END IF;

  IF EXISTS (
    SELECT kind, overlay_id FROM bootstrap_horneo_inventory
    GROUP BY kind, overlay_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT kind, normalized_mac FROM bootstrap_horneo_inventory
    GROUP BY kind, normalized_mac HAVING count(*) > 1
  ) OR EXISTS (
    SELECT normalized_mac FROM bootstrap_horneo_inventory
    GROUP BY normalized_mac HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'bootstrap inventory contains duplicate or colliding normalized identities';
  END IF;

  IF EXISTS (
    SELECT regexp_replace(lower(mac_address), '[-:]', '', 'g')
    FROM gateways GROUP BY 1 HAVING count(*) > 1
  ) OR EXISTS (
    SELECT regexp_replace(lower(ble_mac), '[-:]', '', 'g')
    FROM devices GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'central inventory contains duplicate normalized identities';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bootstrap_horneo_inventory source
    JOIN gateways central
      ON source.kind = 'gateway'
     AND regexp_replace(lower(central.mac_address), '[-:]', '', 'g') = source.normalized_mac
    WHERE central.company_id IS DISTINCT FROM horneo_company_id
  ) THEN
    RAISE EXCEPTION 'an existing central gateway contradicts the Horneo company identity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bootstrap_horneo_inventory source
    JOIN devices central
      ON source.kind = 'tag'
     AND regexp_replace(lower(central.ble_mac), '[-:]', '', 'g') = source.normalized_mac
    WHERE central.company_id IS DISTINCT FROM horneo_company_id
       OR central.device_type <> 'tag'
       OR central.active IS DISTINCT FROM source.source_active
       OR central.status <> CASE WHEN source.source_active THEN 'active' ELSE 'inactive' END
  ) THEN
    RAISE EXCEPTION 'an existing central device contradicts the Horneo tag identity or state';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM bootstrap_horneo_inventory source
    JOIN devices central_device
      ON source.kind = 'gateway'
     AND regexp_replace(lower(central_device.ble_mac), '[-:]', '', 'g') = source.normalized_mac
  ) OR EXISTS (
    SELECT 1
    FROM bootstrap_horneo_inventory source
    JOIN gateways central_gateway
      ON source.kind = 'tag'
     AND regexp_replace(lower(central_gateway.mac_address), '[-:]', '', 'g') = source.normalized_mac
  ) THEN
    RAISE EXCEPTION 'a source identity collides with the opposite central hardware type';
  END IF;
END
$$;

INSERT INTO gateways(mac_address, company_id)
SELECT source.normalized_mac, company.id
FROM bootstrap_horneo_inventory source
CROSS JOIN companies company
WHERE source.kind = 'gateway'
  AND company.code = 'horneo'
  AND NOT EXISTS (
    SELECT 1 FROM gateways existing
    WHERE regexp_replace(lower(existing.mac_address), '[-:]', '', 'g') = source.normalized_mac
  );

INSERT INTO devices(ble_mac, company_id, device_type, active, status)
SELECT source.normalized_mac,
       company.id,
       'tag',
       source.source_active,
       CASE WHEN source.source_active THEN 'active' ELSE 'inactive' END
FROM bootstrap_horneo_inventory source
CROSS JOIN companies company
WHERE source.kind = 'tag'
  AND company.code = 'horneo'
  AND NOT EXISTS (
    SELECT 1 FROM devices existing
    WHERE regexp_replace(lower(existing.ble_mac), '[-:]', '', 'g') = source.normalized_mac
  );

CREATE TEMP TABLE bootstrap_horneo_mapping ON COMMIT PRESERVE ROWS AS
SELECT source.kind,
       source.overlay_id,
       CASE WHEN source.kind = 'gateway' THEN gateway.id ELSE device.id END AS central_id,
       source.normalized_mac,
       source.source_active
FROM bootstrap_horneo_inventory source
LEFT JOIN gateways gateway
  ON source.kind = 'gateway'
 AND regexp_replace(lower(gateway.mac_address), '[-:]', '', 'g') = source.normalized_mac
LEFT JOIN devices device
  ON source.kind = 'tag'
 AND regexp_replace(lower(device.ble_mac), '[-:]', '', 'g') = source.normalized_mac;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bootstrap_horneo_mapping WHERE central_id IS NULL) THEN
    RAISE EXCEPTION 'central inventory bootstrap did not resolve every source identity';
  END IF;
  IF (SELECT count(*) FROM bootstrap_horneo_mapping) <>
     (SELECT count(*) FROM bootstrap_horneo_inventory) THEN
    RAISE EXCEPTION 'central inventory bootstrap changed source cardinality';
  END IF;
  IF EXISTS (
    SELECT kind, central_id FROM bootstrap_horneo_mapping
    GROUP BY kind, central_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple overlays resolved to one central identity';
  END IF;
END
$$;
