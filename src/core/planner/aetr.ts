// Нормы режима труда и отдыха водителя (AETR), только то, что нужно MVP.
// Числа — из docs/PHASE1_CORE.md, шаг 5. Разбиение перерыва 15+30, продление до 10 ч,
// недельные лимиты, экипаж — NOT_NOW.md. Модуль чистый: без сети, без дат, только секунды.

// MVP: hardcoded, see NOT_NOW.md — после 4:30 непрерывного вождения обязателен перерыв
export const MAX_CONTINUOUS_DRIVING_SEC = 4.5 * 3600;
// MVP: hardcoded, see NOT_NOW.md — длительность перерыва (ровно 45 мин, без разбиения)
export const BREAK_SEC = 45 * 60;
// MVP: hardcoded, see NOT_NOW.md — суточное вождение не более 9:00; дальше только суточный отдых
export const MAX_DAILY_DRIVING_SEC = 9 * 3600;

export type BreakType = 'break45' | 'dailyRest';

export interface BreakRequirement {
  /** Что обязательно прямо сейчас; null — можно ехать дальше. */
  type: BreakType | null;
  /** Сколько секунд ещё можно ехать до ближайшего порога; 0, если порог уже достигнут. */
  remainingSec: number;
}

/**
 * Пороги включительные: ровно на 4:30 непрерывного (или 9:00 суточного) вождения ехать дальше нельзя.
 * При одновременном достижении обоих порогов приоритет у суточного отдыха.
 * @param drivenSinceBreakSec — непрерывное вождение с последнего перерыва, сек
 * @param drivenTodaySec — суммарное вождение за день, сек (≥ drivenSinceBreakSec)
 */
export function nextRequiredBreak(drivenSinceBreakSec: number, drivenTodaySec: number): BreakRequirement {
  if (!Number.isFinite(drivenSinceBreakSec) || drivenSinceBreakSec < 0) {
    throw new Error(`nextRequiredBreak: drivenSinceBreakSec must be >= 0, got ${drivenSinceBreakSec}`);
  }
  if (!Number.isFinite(drivenTodaySec) || drivenTodaySec < 0) {
    throw new Error(`nextRequiredBreak: drivenTodaySec must be >= 0, got ${drivenTodaySec}`);
  }
  if (drivenSinceBreakSec > drivenTodaySec) {
    throw new Error(
      `nextRequiredBreak: drivenSinceBreakSec (${drivenSinceBreakSec}) cannot exceed drivenTodaySec (${drivenTodaySec})`
    );
  }

  if (drivenTodaySec >= MAX_DAILY_DRIVING_SEC) return { type: 'dailyRest', remainingSec: 0 };
  if (drivenSinceBreakSec >= MAX_CONTINUOUS_DRIVING_SEC) return { type: 'break45', remainingSec: 0 };

  return {
    type: null,
    remainingSec: Math.min(
      MAX_CONTINUOUS_DRIVING_SEC - drivenSinceBreakSec,
      MAX_DAILY_DRIVING_SEC - drivenTodaySec
    ),
  };
}
