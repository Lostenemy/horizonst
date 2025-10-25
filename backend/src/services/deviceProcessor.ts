import dayjs from 'dayjs';
import { pool } from '../db/pool';
import { ProcessedDeviceRecord } from '../types';

interface GatewayRow {
  id: number;
  place_id: number | null;
}

interface DeviceRow {
  id: number;
  owner_id: number | null;
}

interface DeviceRecordRow {
  id: number;
  place_id: number | null;
  recorded_at: Date;
}

const THIRTY_SECONDS = 30;
const FIVE_MINUTES = 300;

export const handleDeviceRecord = async (record: ProcessedDeviceRecord): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const gatewayMac = record.gatewayMac.toUpperCase();
    const gatewayResult = await client.query<GatewayRow>(
      `SELECT g.id, gp.place_id
       FROM gateways g
       LEFT JOIN LATERAL (
         SELECT place_id
         FROM gateway_places
         WHERE gateway_id = g.id AND active = true
         ORDER BY assigned_at DESC
         LIMIT 1
       ) gp ON TRUE
       WHERE g.mac_address = $1 AND g.active = true
       LIMIT 1`,
      [gatewayMac]
    );
    const gateway = gatewayResult.rows[0];
    if (!gateway) {
      await client.query('ROLLBACK');
      return;
    }

    const deviceResult = await client.query<DeviceRow>(
      `SELECT id, owner_id FROM devices WHERE ble_mac = $1 AND active = true LIMIT 1`,
      [record.bleMac.toUpperCase()]
    );
    const device = deviceResult.rows[0];
    if (!device) {
      await client.query('ROLLBACK');
      return;
    }

    const placeId = gateway.place_id;
    const now = dayjs();

    const lastRecordResult = await client.query<DeviceRecordRow>(
      `SELECT id, place_id, recorded_at
       FROM device_records
       WHERE device_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [device.id]
    );

    const lastRecord = lastRecordResult.rows[0];
    let action: 'insert' | 'update' | 'skip' = 'insert';

    if (lastRecord) {
      const lastPlace = lastRecord.place_id;
      const diffSeconds = now.diff(dayjs(lastRecord.recorded_at), 'second');
      const samePlace = (lastPlace ?? null) === (placeId ?? null);

      if (samePlace) {
        if (diffSeconds < THIRTY_SECONDS) {
          action = 'skip';
        } else if (diffSeconds <= FIVE_MINUTES) {
          action = 'update';
        } else {
          action = 'insert';
        }
      } else {
        action = 'insert';
      }
    }

    if (action === 'skip') {
      await client.query('COMMIT');
      return;
    }

    const additionalData = record.additionalData ? JSON.stringify(record.additionalData) : null;

    if (action === 'update' && lastRecord) {
      await client.query(
        `UPDATE device_records
         SET gateway_id = $1,
             place_id = $2,
             rssi = $3,
             adv_type = $4,
             raw_payload = $5,
             battery_voltage_mv = $6,
             temperature_c = $7,
             humidity = $8,
             movement_count = $9,
             additional_data = $10::jsonb,
             updated_at = $11
         WHERE id = $12`,
        [
          gateway.id,
          placeId,
          record.rssi,
          record.advType ?? null,
          record.rawData ?? null,
          record.batteryVoltageMv ?? null,
          record.temperatureC ?? null,
          record.humidity ?? null,
          record.movementCount ?? null,
          additionalData,
          now.toDate(),
          lastRecord.id
        ]
      );
    } else {
      await client.query(
        `INSERT INTO device_records
           (device_id, gateway_id, place_id, rssi, adv_type, raw_payload, battery_voltage_mv,
            temperature_c, humidity, movement_count, additional_data, recorded_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)`,
        [
          device.id,
          gateway.id,
          placeId,
          record.rssi,
          record.advType ?? null,
          record.rawData ?? null,
          record.batteryVoltageMv ?? null,
          record.temperatureC ?? null,
          record.humidity ?? null,
          record.movementCount ?? null,
          additionalData,
          now.toDate()
        ]
      );
    }

    await client.query(
      `UPDATE devices
       SET last_seen_at = $1,
           last_gateway_id = $2,
           last_place_id = $3,
           last_rssi = $4,
           last_temperature_c = $5,
           last_battery_mv = $6,
           updated_at = $1
       WHERE id = $7`,
      [
        now.toDate(),
        gateway.id,
        placeId,
        record.rssi,
        record.temperatureC ?? null,
        record.batteryVoltageMv ?? null,
        device.id
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing device record', error);
  } finally {
    client.release();
  }
};
