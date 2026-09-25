/** Effective exposure end shared by the live panel and inspection exports.
 * ended_at remains the operational confirmation time for timeout closures.
 */
export function sessionExposureEndSql(sessionAlias: 's' = 's'): string {
  return `CASE WHEN ${sessionAlias}.ended_at IS NOT NULL
    THEN COALESCE(${sessionAlias}.started_at + ${sessionAlias}.duration_seconds * INTERVAL '1 second', ${sessionAlias}.ended_at)
    ELSE LEAST(NOW(), COALESCE((
      SELECT MAX(ps.last_presence_at)
      FROM tag_gateway_presence_state ps
      LEFT JOIN gateways seen_gateway
        ON seen_gateway.hardware_gateway_id = ps.hardware_gateway_id
      WHERE ps.hardware_device_id = ${sessionAlias}.hardware_device_id
        AND ps.last_presence_at >= ${sessionAlias}.started_at
        AND (${sessionAlias}.cold_room_id IS NULL OR seen_gateway.cold_room_id = ${sessionAlias}.cold_room_id)
    ), ${sessionAlias}.started_at))
  END`;
}

export function sessionExposureSecondsSql(sessionAlias: 's' = 's'): string {
  return `FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (
    ${sessionExposureEndSql(sessionAlias)} - ${sessionAlias}.started_at
  ))))::int`;
}
