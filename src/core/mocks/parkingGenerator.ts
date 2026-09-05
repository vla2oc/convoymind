import type { Parking } from '../api/types';
import { haversineMeters } from '../geo';

// Детерминированный генератор парковок для Parking-API (схема в api/types.ts).
// Парковки — свойство географии, а не запроса: мир разбит на ячейки сетки, в каждой ячейке
// детерминированный (seed от индексов ячейки) набор парковок с фиксированными id, позицией,
// ёмкостью и «характером» занятости. Запрос любого центра и радиуса возвращает подмножество
// одного и того же множества: запрос на 50 км — надмножество запроса на 25 км с тем же центром.
// Занятость зависит от периода суток (день/ночь по UTC), не от конкретного часа.
// См. DECISIONS.md (2026-09-05, «парковки по сетке» — исправление находки аудита).

// MVP: hardcoded, see NOT_NOW.md — размер ячейки сетки, градусы (0.3° ≈ 33 км по широте, ≈ 21 км по долготе на 51°)
export const MOCK_CELL_DEG = 0.3;
// MVP: hardcoded, see NOT_NOW.md — парковок в ячейке; минимум 1, чтобы в радиусе 25 км всегда что-то было
export const MOCK_PARKINGS_PER_CELL_MIN = 1;
export const MOCK_PARKINGS_PER_CELL_MAX = 2;
// MVP: hardcoded, see NOT_NOW.md — мест для грузовиков на парковке
export const MOCK_CAPACITY_MIN = 20;
export const MOCK_CAPACITY_MAX = 80;
// MVP: hardcoded, see NOT_NOW.md — ночь по UTC: [22, 06)
export const MOCK_NIGHT_START_HOUR_UTC = 22;
export const MOCK_NIGHT_END_HOUR_UTC = 6;
// MVP: hardcoded, see NOT_NOW.md — доля занятых мест ночью / днём
export const MOCK_NIGHT_OCCUPANCY = { min: 0.85, max: 1.0 };
export const MOCK_DAY_OCCUPANCY = { min: 0.4, max: 0.7 };
// MVP: hardcoded, see NOT_NOW.md — сценарий 'live': длина слота дрейфа и его амплитуда (доля ёмкости).
// Амплитуда крупная намеренно: днём занято 40–70 %, и меньший дрейф не доводил бы парковку до нуля,
// то есть цвет маркера на карте не менялся бы (критерий 3b фазы 3).
export const MOCK_LIVE_TICK_MS = 60 * 1000;
export const MOCK_LIVE_AMPLITUDE = 0.35;
// MVP: hardcoded, see NOT_NOW.md — confidence: «сейчас» (at в пределах часа от now) / прогноз
export const MOCK_CONFIDENCE_NOW = 0.9;
export const MOCK_CONFIDENCE_FORECAST = 0.6;
export const MOCK_NOW_WINDOW_MS = 60 * 60 * 1000;

const KM_PER_DEG_LAT = 111.32;

export interface GenerateParkingsInput {
  lat: number;
  lon: number;
  radiusKm: number;
  /** Момент, на который нужна занятость (любой разбираемый Date.parse). */
  at: string;
  /** Текущее время, мс (Date.now() в handler; в тестах — фиксированное). */
  now: number;
  /**
   * Сценарий 'live': к занятости добавляется детерминированный дрейф ±MOCK_LIVE_AMPLITUDE,
   * seed от (id парковки, номер минутного слота из `now`). Внутри одного слота ответ не меняется.
   * По умолчанию false — обычное поведение мока.
   */
  live?: boolean;
}

/** Парковка без занятости — то, что не зависит от запроса. */
interface StaticParking {
  id: string;
  name: string;
  lat: number;
  lon: number;
  capacityTotal: number;
  /** 0..1 — положение внутри диапазона занятости периода; постоянно для парковки. */
  occupancyFactor: number;
}

export function generateParkings(input: GenerateParkingsInput): Parking[] {
  const { lat, lon, radiusKm, at, now, live = false } = input;
  const atMs = Date.parse(at);
  if (Number.isNaN(atMs)) throw new Error(`generateParkings: bad at "${at}"`);
  if (!(radiusKm > 0)) throw new Error(`generateParkings: radiusKm must be > 0, got ${radiusKm}`);

  const occupancy = isNightUtc(atMs) ? MOCK_NIGHT_OCCUPANCY : MOCK_DAY_OCCUPANCY;
  const confidence = Math.abs(atMs - now) <= MOCK_NOW_WINDOW_MS ? MOCK_CONFIDENCE_NOW : MOCK_CONFIDENCE_FORECAST;
  const center = { lat, lon };
  const radiusM = radiusKm * 1000;
  // Слот дрейфа: один и тот же ответ в пределах минуты, разный — между минутами.
  const liveSlot = Math.floor(now / MOCK_LIVE_TICK_MS);

  // Ячейки, пересекающие описанный вокруг круга прямоугольник.
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LAT * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  const cyFrom = Math.floor((lat - dLat) / MOCK_CELL_DEG);
  const cyTo = Math.floor((lat + dLat) / MOCK_CELL_DEG);
  const cxFrom = Math.floor((lon - dLon) / MOCK_CELL_DEG);
  const cxTo = Math.floor((lon + dLon) / MOCK_CELL_DEG);

  const found: { parking: Parking; distanceM: number }[] = [];
  for (let cy = cyFrom; cy <= cyTo; cy++) {
    for (let cx = cxFrom; cx <= cxTo; cx++) {
      for (const p of cellParkings(cx, cy)) {
        const distanceM = haversineMeters(center, p);
        if (distanceM > radiusM) continue;
        const share = occupancy.min + p.occupancyFactor * (occupancy.max - occupancy.min);
        const drift = live ? (mulberry32(hashString(`${p.id}@${liveSlot}`))() * 2 - 1) * MOCK_LIVE_AMPLITUDE : 0;
        const occupied = clamp(Math.round(p.capacityTotal * (share + drift)), 0, p.capacityTotal);
        found.push({
          distanceM,
          parking: {
            id: p.id,
            name: p.name,
            lat: p.lat,
            lon: p.lon,
            capacityTotal: p.capacityTotal,
            freeAt: p.capacityTotal - occupied,
            confidence,
          },
        });
      }
    }
  }
  // Ближайшие первыми; при равном расстоянии — по id, чтобы порядок был воспроизводим.
  found.sort((a, b) => a.distanceM - b.distanceM || (a.parking.id < b.parking.id ? -1 : 1));
  return found.map((f) => f.parking);
}

/** Парковки одной ячейки сетки — всегда одни и те же для (cx, cy). */
function cellParkings(cx: number, cy: number): StaticParking[] {
  const seed = hashString(`${cx},${cy}`);
  const rand = mulberry32(seed);
  const seedHex = seed.toString(16).padStart(8, '0');
  const count = MOCK_PARKINGS_PER_CELL_MIN + Math.floor(rand() * (MOCK_PARKINGS_PER_CELL_MAX - MOCK_PARKINGS_PER_CELL_MIN + 1));

  const parkings: StaticParking[] = [];
  for (let i = 0; i < count; i++) {
    parkings.push({
      id: `mock-${seedHex}-${i + 1}`,
      name: `Mock parking ${seedHex.slice(0, 4).toUpperCase()}-${i + 1}`,
      lat: round6((cy + rand()) * MOCK_CELL_DEG),
      lon: round6((cx + rand()) * MOCK_CELL_DEG),
      capacityTotal: MOCK_CAPACITY_MIN + Math.floor(rand() * (MOCK_CAPACITY_MAX - MOCK_CAPACITY_MIN + 1)),
      occupancyFactor: rand(),
    });
  }
  return parkings;
}

function isNightUtc(ms: number): boolean {
  const hour = new Date(ms).getUTCHours();
  return hour >= MOCK_NIGHT_START_HOUR_UTC || hour < MOCK_NIGHT_END_HOUR_UTC;
}

/** FNV-1a 32-bit — хэш строки в беззнаковое 32-битное число (seed). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — маленький детерминированный PRNG, [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
