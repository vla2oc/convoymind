import type { Parking, RoutedParking, Stop } from '@/core';

import { formatClock, formatDurationHm, formatHm } from './time';

/** Русское множественное число: pluralRu(2, ['перерыв', 'перерыва', 'перерывов']) → 'перерыва'. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

/** «свободно 27 из 57» (+ «на HH:MM», если передано время). */
export function freeLine(p: Parking, at?: string): string {
  const base = `свободно ${p.freeAt} из ${p.capacityTotal}`;
  return at ? `${base} на ${formatClock(at)}` : base;
}

/**
 * Подпись парковки на карте. Для остановки плана — полная (PHASE3_MAP.md, шаг 6),
 * для остальных — занятость и время проезда мимо.
 */
export function parkingCallout(p: RoutedParking, stop: Stop | undefined): string {
  if (!stop) return `${freeLine(p)} · ${p.status === 'free' ? 'свободна' : 'занята'} · проезд ${formatClock(p.etaAt)}`;
  return [
    freeLine(p),
    `приезд ${formatClock(stop.arrivalAt)}`,
    `перерыв ${formatDurationHm(stop.pauseSec)}`,
    `вождение от предыдущей ${formatHm(stop.drivingSecFromPrev)}`,
  ].join(' · ');
}
