import { haversineMeters } from '../geo';
import type { GeoPoint } from '../types';
import { BREAK_SEC, MAX_CONTINUOUS_DRIVING_SEC } from './aetr';

// Где вдоль маршрута наступает 4:30 непрерывного вождения — расстановка якорей остановок.
// Чистый модуль: без сети; геометрия и суммарное время — из ответа TomTom (вызов 1).
//
// MVP-допущение (см. NOT_NOW.md «точное время по точкам»): время распределено пропорционально
// расстоянию вдоль точек маршрута. Суточный лимит 9:00 здесь не учитывается — флаг
// requiresDailyRest ставит планировщик (schedule.ts).

// MVP: hardcoded, see NOT_NOW.md — запас: якорь ставим за 20 мин до порога 4:30
export const BREAK_LOOKAHEAD_MIN = 20;
/** Непрерывное вождение до якоря: 4:30 − 20 мин = 4:10. */
export const ANCHOR_THRESHOLD_SEC = MAX_CONTINUOUS_DRIVING_SEC - BREAK_LOOKAHEAD_MIN * 60;

export interface Anchor extends GeoPoint {
  /** Плановый приезд на якорь, ISO UTC; учитывает BREAK_SEC на каждом предыдущем якоре. */
  plannedArrivalAt: string;
  /** Вождение от предыдущего якоря (или старта), сек. */
  drivenSecFromPrev: number;
  /** Вождение от старта без учёта пауз, сек. */
  drivenSecFromStart: number;
}

export interface PlaceBreakAnchorsInput {
  /** Геометрия маршрута от старта до финиша (все плечи подряд), минимум две точки. */
  points: GeoPoint[];
  /** Суммарное время вождения маршрута без пауз, сек (routes[0].summary.travelTimeInSeconds). */
  travelTimeSec: number;
  /** Время выезда, ISO/RFC 3339 (любой разбираемый Date.parse). */
  departureAt: string;
}

/**
 * Якорь ставится линейной интерполяцией внутри сегмента ровно там, где непрерывное вождение
 * достигает ANCHOR_THRESHOLD_SEC. Очередной якорь не ставится, если от предыдущего якоря (или старта)
 * до финиша меньше MAX_CONTINUOUS_DRIVING_SEC — водитель легально доезжает без перерыва.
 */
export function placeBreakAnchors(input: PlaceBreakAnchorsInput): Anchor[] {
  const { points, travelTimeSec, departureAt } = input;
  if (points.length < 2) throw new Error(`placeBreakAnchors: need at least 2 points, got ${points.length}`);
  if (!Number.isFinite(travelTimeSec) || travelTimeSec < 0) {
    throw new Error(`placeBreakAnchors: travelTimeSec must be >= 0, got ${travelTimeSec}`);
  }
  const departMs = Date.parse(departureAt);
  if (Number.isNaN(departMs)) throw new Error(`placeBreakAnchors: bad departureAt "${departureAt}"`);

  // Накопленная дистанция по точкам.
  const cumM: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cumM.push(cumM[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  const totalM = cumM[cumM.length - 1];
  if (travelTimeSec === 0 || totalM === 0) return [];
  const secPerMeter = travelTimeSec / totalM;

  const anchors: Anchor[] = [];
  let prevAnchorSec = 0;
  let nextThresholdSec = ANCHOR_THRESHOLD_SEC;

  for (let i = 1; i < points.length; i++) {
    if (travelTimeSec - prevAnchorSec < MAX_CONTINUOUS_DRIVING_SEC) break;
    const tA = cumM[i - 1] * secPerMeter;
    const tB = cumM[i] * secPerMeter;

    // Один сегмент может вместить несколько порогов (например, маршрут из двух точек).
    while (nextThresholdSec <= tB && travelTimeSec - prevAnchorSec >= MAX_CONTINUOUS_DRIVING_SEC) {
      const f = tB === tA ? 0 : (nextThresholdSec - tA) / (tB - tA);
      const from = points[i - 1];
      const to = points[i];
      const pausesBeforeSec = anchors.length * BREAK_SEC;
      anchors.push({
        lat: round6(from.lat + (to.lat - from.lat) * f),
        lon: round6(from.lon + (to.lon - from.lon) * f),
        plannedArrivalAt: new Date(departMs + (nextThresholdSec + pausesBeforeSec) * 1000).toISOString(),
        drivenSecFromPrev: nextThresholdSec - prevAnchorSec,
        drivenSecFromStart: nextThresholdSec,
      });
      prevAnchorSec = nextThresholdSec;
      nextThresholdSec = prevAnchorSec + ANCHOR_THRESHOLD_SEC;
    }
  }
  return anchors;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
