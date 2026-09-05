import type { Parking, ParkingsQuery, ParkingsResponse } from './types';

/**
 * Parking-API — наш мок-эндпоинт (схема в api/types.ts). Реального API нет; в приложении запрос
 * перехватывает MSW (mocks/native.ts), в тестах — mocks/server.ts.
 */
export const PARKING_API_BASE = 'https://mock.convoy-mind.local/v1';

export function buildParkingsUrl(q: ParkingsQuery): URL {
  const url = new URL(`${PARKING_API_BASE}/parkings`);
  url.searchParams.set('lat', String(q.lat));
  url.searchParams.set('lon', String(q.lon));
  url.searchParams.set('radiusKm', String(q.radiusKm));
  url.searchParams.set('at', q.at);
  return url;
}

export async function getParkingsNear(q: ParkingsQuery): Promise<Parking[]> {
  const res = await fetch(buildParkingsUrl(q), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Parking API: HTTP ${res.status}`);

  const data = (await res.json()) as ParkingsResponse;
  if (!Array.isArray(data.parkings)) throw new Error('Parking API: response has no parkings');
  return data.parkings;
}
