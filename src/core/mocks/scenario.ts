// Переключатель мок-сценариев. Один механизм для тестов и dev-переключателя фазы 2;
// planTrip о моках не знает. См. DECISIONS.md (2026-09-05, «setMockScenario вместо заголовка»).

/**
 * - `all-full` — все парковки заняты (накладывается в handler поверх генератора).
 * - `live` — занятость дрейфует по минутным слотам реального времени (внутри генератора),
 *   чтобы на карте было видно обновление статусов. По умолчанию выключен: без сценария
 *   поведение моков ровно такое же, как в фазах 1–2.
 */
export type MockScenario = 'all-full' | 'live';

let current: MockScenario | null = null;

/** null — обычное поведение моков. */
export function setMockScenario(scenario: MockScenario | null): void {
  current = scenario;
}

export function getMockScenario(): MockScenario | null {
  return current;
}
