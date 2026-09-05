// Экран 2: подписи стадий planTrip (порядок — как в ядре, API_CONTRACT.md § 2).
import type { PlanStage } from '@/core';

export const PLAN_STAGES: readonly { id: PlanStage; label: string }[] = [
  { id: 'route', label: 'Маршрут построен' },
  { id: 'anchors', label: 'Остановки расставлены' },
  { id: 'parkings', label: 'Парковки проверены' },
  { id: 'schedule', label: 'Расписание собрано' },
];

/**
 * Минимальное время показа экрана 2. Стадии приходят из ядра (не имитация), но с моками расчёт
 * занимает миллисекунды — без паузы водитель не увидит, что было проверено. См. DECISIONS.md.
 */
export const PLANNING_MIN_VISIBLE_MS = 1200;
