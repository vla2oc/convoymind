import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

import type { TripInput } from '../../src/core';
import { setMockScenario } from '../../src/core/mocks/scenario';
import InputScreen from '../../src/app/index';
import PlanningScreen from '../../src/app/planning';
import { PLANNING_MIN_VISIBLE_MS } from '../../src/ui/planningStages';
import { resetTrip, startPlanning } from '../../src/ui/tripStore';

const ResultStub = () => null;
const TRIP: TripInput = {
  origin: { lat: 52.2297, lon: 21.0122 },
  destination: { lat: 50.1109, lon: 8.6821 },
  departureAt: '2026-09-07T06:00:00+02:00',
  vehicleWeightKg: 40_000,
};
const LABELS = { originName: 'Варшава', destinationName: 'Франкфурт' };
const NAV_TIMEOUT = PLANNING_MIN_VISIBLE_MS + 2000;

afterEach(() => resetTrip());

function renderPlanning() {
  return renderRouter({ index: InputScreen, planning: PlanningScreen, result: ResultStub }, { initialUrl: '/planning' });
}

function stageChecked(id: string): boolean {
  return screen.getByTestId(`stage-${id}`).props.accessibilityState.checked === true;
}

describe('Экран 2 — Расчёт', () => {
  test('четыре стадии из planTrip загораются, потом → /result (не раньше минимального времени)', async () => {
    const t0 = Date.now();
    startPlanning(TRIP, LABELS);
    renderPlanning();

    expect(screen.getByText('Варшава → Франкфурт')).toBeTruthy();
    for (const label of ['Маршрут построен', 'Остановки расставлены', 'Парковки проверены', 'Расписание собрано']) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    await waitFor(() => expect(stageChecked('schedule')).toBe(true));
    expect(['route', 'anchors', 'parkings', 'schedule'].every(stageChecked)).toBe(true);
    expect(screen).toHavePathname('/planning');

    await waitFor(() => expect(screen).toHavePathname('/result'), { timeout: NAV_TIMEOUT });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(PLANNING_MIN_VISIBLE_MS - 50);
  });

  test('all-full: горят две стадии, третья нет, конфликт всё равно уводит на /result', async () => {
    setMockScenario('all-full');
    startPlanning(TRIP, LABELS);
    renderPlanning();

    await waitFor(() => expect(stageChecked('anchors')).toBe(true));
    // Пока экран 2 на месте (минимальное время показа не вышло): конфликт оборвал стадии после anchors.
    expect(screen).toHavePathname('/planning');
    expect(stageChecked('route')).toBe(true);
    expect(stageChecked('parkings')).toBe(false);
    expect(stageChecked('schedule')).toBe(false);
    await waitFor(() => expect(screen).toHavePathname('/result'), { timeout: NAV_TIMEOUT });
  });

  test('ошибка planTrip (плохой вход) → «Ошибка расчёта», текст и кнопка «К вводу»; на /result не уходим', async () => {
    startPlanning({ ...TRIP, vehicleWeightKg: 0 }, LABELS);
    renderPlanning();

    await waitFor(() => expect(screen.getByText('Ошибка расчёта')).toBeTruthy());
    expect(screen.getByText(/vehicleWeightKg must be > 0/)).toBeTruthy();
    expect(screen.getByText('К вводу')).toBeTruthy();
    expect(stageChecked('route')).toBe(false);
    expect(screen).toHavePathname('/planning');
  });

  test('без запуска расчёта — «Нет данных для расчёта» и кнопка «К вводу»', () => {
    renderPlanning();
    expect(screen.getByText('Нет данных для расчёта')).toBeTruthy();
    expect(screen.getByText('К вводу')).toBeTruthy();
  });
});
