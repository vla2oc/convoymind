// Пресеты для экрана 1: геокодинга нет (NOT_NOW.md), поэтому города с координатами.
// Координаты — те же, что в docs/API_CONTRACT.md § 5 (результат мока воспроизводим).
import type { GeoPoint } from '@/core';

export interface CityPreset {
  id: string;
  name: string;
  point: GeoPoint;
}

export const CITY_PRESETS: readonly CityPreset[] = [
  { id: 'warsaw', name: 'Варшава', point: { lat: 52.2297, lon: 21.0122 } },
  { id: 'lodz', name: 'Лодзь', point: { lat: 51.7592, lon: 19.456 } },
  { id: 'frankfurt', name: 'Франкфурт', point: { lat: 50.1109, lon: 8.6821 } },
  { id: 'paris', name: 'Париж', point: { lat: 48.8566, lon: 2.3522 } },
];

export const DEFAULT_ORIGIN_ID = 'warsaw';
export const DEFAULT_DESTINATION_ID = 'frankfurt';

/** «Фура 40 т» — единственный пресет веса (PHASE2_APP.md, экран 1). */
export const DEFAULT_VEHICLE_WEIGHT_KG = 40000;

/** Сдвиги времени выезда относительно «сейчас» (PHASE2_APP.md, экран 1). */
export const DEPARTURE_OFFSETS: readonly { min: number; label: string }[] = [
  { min: 0, label: 'Сейчас' },
  { min: 30, label: '+30 мин' },
  { min: 60, label: '+1 ч' },
  { min: 120, label: '+2 ч' },
];
