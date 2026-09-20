DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM gateways
    WHERE gateway_mac IS NULL
       OR gateway_mac = ''
       OR regexp_replace(lower(gateway_mac), '[-:]', '', 'g') !~ '^[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Horneo gateways contain an empty or invalid technical MAC';
  END IF;

  IF EXISTS (
    SELECT 1 FROM tags
    WHERE tag_uid IS NULL
       OR tag_uid = ''
       OR regexp_replace(lower(tag_uid), '[-:]', '', 'g') !~ '^[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'Horneo tags contain an empty or invalid technical UID';
  END IF;

  IF EXISTS (
    SELECT regexp_replace(lower(gateway_mac), '[-:]', '', 'g')
    FROM gateways
    GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Horneo gateways contain duplicate normalized MAC values';
  END IF;

  IF EXISTS (
    SELECT regexp_replace(lower(tag_uid), '[-:]', '', 'g')
    FROM tags
    GROUP BY 1 HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Horneo tags contain duplicate normalized UID values';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM gateways gateway
    JOIN tags tag
      ON regexp_replace(lower(tag.tag_uid), '[-:]', '', 'g') =
         regexp_replace(lower(gateway.gateway_mac), '[-:]', '', 'g')
  ) THEN
    RAISE EXCEPTION 'Horneo contains a gateway/tag normalized identity collision';
  END IF;
END
$$;

SELECT
  (SELECT count(*) FROM gateways) AS gateway_count,
  (SELECT count(*) FROM tags) AS tag_count;
