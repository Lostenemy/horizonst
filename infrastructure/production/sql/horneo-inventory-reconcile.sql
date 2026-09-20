-- Caller contract:
--   * run inside one transaction holding the documented advisory lock;
--   * populate pg_temp.bootstrap_central_mapping(kind, overlay_id, central_id,
--     normalized_mac, source_active) from the protected central mapping first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bootstrap_central_mapping
    WHERE kind NOT IN ('gateway', 'tag')
       OR overlay_id IS NULL
       OR central_id IS NULL
       OR normalized_mac !~ '^[0-9a-f]{12}$'
       OR (kind = 'tag' AND source_active IS NULL)
       OR (kind = 'gateway' AND source_active IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'central mapping contains an invalid row';
  END IF;

  IF EXISTS (
    SELECT kind, overlay_id FROM bootstrap_central_mapping
    GROUP BY kind, overlay_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT kind, central_id FROM bootstrap_central_mapping
    GROUP BY kind, central_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT normalized_mac FROM bootstrap_central_mapping
    GROUP BY normalized_mac HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'central mapping is not one-to-one';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM gateways overlay
    LEFT JOIN bootstrap_central_mapping mapping
      ON mapping.kind = 'gateway'
     AND mapping.overlay_id = overlay.id
     AND mapping.normalized_mac = regexp_replace(lower(overlay.gateway_mac), '[-:]', '', 'g')
    WHERE mapping.central_id IS NULL
       OR (overlay.hardware_gateway_id IS NOT NULL
           AND overlay.hardware_gateway_id <> mapping.central_id)
  ) THEN
    RAISE EXCEPTION 'gateway reconciliation lacks exact coverage or contradicts an existing ID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tags overlay
    LEFT JOIN bootstrap_central_mapping mapping
      ON mapping.kind = 'tag'
     AND mapping.overlay_id = overlay.id
     AND mapping.normalized_mac = regexp_replace(lower(overlay.tag_uid), '[-:]', '', 'g')
     AND mapping.source_active = overlay.active
    WHERE mapping.central_id IS NULL
       OR (overlay.hardware_device_id IS NOT NULL
           AND overlay.hardware_device_id <> mapping.central_id)
  ) THEN
    RAISE EXCEPTION 'tag reconciliation lacks exact coverage, state equality or contradicts an existing ID';
  END IF;

  IF (SELECT count(*) FROM bootstrap_central_mapping WHERE kind = 'gateway') <>
     (SELECT count(*) FROM gateways)
     OR (SELECT count(*) FROM bootstrap_central_mapping WHERE kind = 'tag') <>
        (SELECT count(*) FROM tags) THEN
    RAISE EXCEPTION 'central mapping cardinality does not equal the complete Horneo inventory';
  END IF;
END
$$;

UPDATE gateways overlay
SET hardware_gateway_id = mapping.central_id
FROM bootstrap_central_mapping mapping
WHERE mapping.kind = 'gateway'
  AND mapping.overlay_id = overlay.id
  AND mapping.normalized_mac = regexp_replace(lower(overlay.gateway_mac), '[-:]', '', 'g')
  AND overlay.hardware_gateway_id IS NULL;

UPDATE tags overlay
SET hardware_device_id = mapping.central_id
FROM bootstrap_central_mapping mapping
WHERE mapping.kind = 'tag'
  AND mapping.overlay_id = overlay.id
  AND mapping.normalized_mac = regexp_replace(lower(overlay.tag_uid), '[-:]', '', 'g')
  AND mapping.source_active = overlay.active
  AND overlay.hardware_device_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM gateways WHERE hardware_gateway_id IS NULL)
     OR EXISTS (SELECT 1 FROM tags WHERE hardware_device_id IS NULL) THEN
    RAISE EXCEPTION 'reconciliation did not achieve complete central coverage';
  END IF;
  IF EXISTS (
    SELECT hardware_gateway_id FROM gateways
    GROUP BY hardware_gateway_id HAVING count(*) > 1
  ) OR EXISTS (
    SELECT hardware_device_id FROM tags
    GROUP BY hardware_device_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'reconciliation assigned one central ID to multiple overlays';
  END IF;
END
$$;
