import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { recordRequests } from '../core/helpers';
import { setMockScenario } from '../../src/core/mocks/scenario';

import InputScreen from '../../src/app/index';
import ResultScreen, { MAP_REFRESH_MS } from '../../src/app/result';
import { formatClock } from '../../src/ui/time';
import type { PlanResult } from '../../src/core';
import { resetTrip, setTripState } from '../../src/ui/tripStore';
import { Palette, type ThemeColors } from '../../src/ui/theme';
import { LABELS, OK_RESULT, TRIP_INPUT } from './fixtures';
import { fitToCoordinatesCalls } from './maps-mock';

/** Схема (светлая/тёмная) в тестовом окружении не задана явно — принимаем цвет из любой палитры. */
function isColor(value: unknown, token: keyof ThemeColors): boolean {
  return value === Palette.light[token] || value === Palette.dark[token];
}

afterEach(() => resetTrip());

function seed(result: PlanResult) {
  setTripState({
    status: 'done',
    input: TRIP_INPUT,
    labels: LABELS,
    stages: ['route', 'anchors', 'parkings', 'schedule'],
    result,
  });
}

function PlanningStub() {
  return <Text>Расчёт</Text>;
}

function renderResult() {
  return renderRouter(
    { index: InputScreen, planning: PlanningStub, result: ResultScreen },
    { initialUrl: '/result' }
  );
}

/** Цвет пина каждой парковки на карте: id → pinColor. */
function colorsById(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of screen.queryAllByTestId(/^marker-parking-/)) {
    out[String(m.props.testID).replace('marker-parking-', '')] = String(m.props.pinColor);
  }
  return out;
}

/** Запросы, ушедшие в Parking-API (у TomTom другой хост). */
function parkingRequests(requests: Request[]): Request[] {
  return requests.filter((r) => new URL(r.url).host === 'mock.convoy-mind.local');
}

/** Карта догружает парковки коридора асинхронно: без ожидания setState прилетает после теста. */
function settled() {
  return screen.findByText(/^Парковок: [1-9]\d* · остановок: \d+ · обновлено /);
}

describe('Экран 3 — ok (фикстура API_CONTRACT.md § 5)', () => {
  test('карточка-ответ: ETA, вождение 8:54, 2 перерыва, По норме', async () => {
    seed(OK_RESULT);
    renderResult();
    await settled();

    expect(screen.getByTestId('result-card-ok')).toBeTruthy();
    expect(screen.getByText(`Прибытие ${formatClock('2026-09-07T14:24:21.000Z')}`)).toBeTruthy();
    expect(screen.getByText(/^Вождение 8:54 · 2 перерыва · /)).toBeTruthy();
    expect(screen.getByText('По норме')).toBeTruthy();
    expect(screen.queryByText('Нужен суточный отдых')).toBeNull();
    expect(screen.queryByTestId('result-card-conflict')).toBeNull();
  });

  test('карта: полилиния по route.points, маркеры старта и финиша, кадр по маршруту', async () => {
    seed(OK_RESULT);
    renderResult();

    expect(await screen.findByTestId('route-map')).toBeTruthy();
    expect(screen.queryByTestId('conflict-map')).toBeNull();
    await settled();

    const expectedCoords = OK_RESULT.route.points.map((pt) => ({ latitude: pt.lat, longitude: pt.lon }));
    expect(screen.getByTestId('route-polyline').props.coordinates).toEqual(expectedCoords);

    expect(screen.getByTestId('marker-origin').props.coordinate).toEqual(expectedCoords[0]);
    expect(screen.getByTestId('marker-origin').props.title).toBe('Варшава');
    expect(screen.getByTestId('marker-destination').props.coordinate).toEqual(expectedCoords[expectedCoords.length - 1]);
    expect(screen.getByTestId('marker-destination').props.title).toBe('Франкфурт');
    expect(screen.getByTestId('marker-destination').props.description).toBe(
      `Прибытие ${formatClock('2026-09-07T14:24:21.000Z')}`
    );

    // onMapReady в моке вызывается сразу — карта строит кадр по всем точкам маршрута.
    expect(fitToCoordinatesCalls).toHaveLength(1);
    expect(fitToCoordinatesCalls[0].coordinates).toEqual(expectedCoords);
  });

  test('маркеры парковок: >= 10, ровно 2 выделенных (остановки плана), цвет по статусу', async () => {
    seed(OK_RESULT);
    renderResult();

    // Парковки приезжают из getParkingsAlongRoute через MSW — ждём первый маркер.
    await screen.findByTestId(`marker-parking-${OK_RESULT.stops[0].parking.id}`);
    const markers = screen.getAllByTestId(/^marker-parking-/);
    expect(markers.length).toBeGreaterThanOrEqual(10);

    const chosen = markers.filter((m) => isColor(m.props.pinColor, 'primary'));
    expect(chosen).toHaveLength(2);
    for (const stop of OK_RESULT.stops) {
      const marker = screen.getByTestId(`marker-parking-${stop.parking.id}`);
      expect(isColor(marker.props.pinColor, 'primary')).toBe(true);
      expect(marker.props.title).toBe(stop.parking.name);
      expect(marker.props.description).toContain(`приезд ${formatClock(stop.arrivalAt)}`);
      expect(marker.props.description).toContain('перерыв 45 мин');
    }

    // Остальные — только зелёные (свободна) или красные (занята), третьего цвета нет.
    for (const m of markers.filter((x) => !isColor(x.props.pinColor, 'primary'))) {
      expect(isColor(m.props.pinColor, 'success') || isColor(m.props.pinColor, 'danger')).toBe(true);
    }
    expect(screen.getByTestId('map-badge')).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Парковок: ${markers.length} · остановок: 2 · обновлено \\d\\d:\\d\\d:\\d\\d$`))).toBeTruthy();
  });

  test('requiresDailyRest → «Нужен суточный отдых» и предупреждение', async () => {
    seed({ ...OK_RESULT, requiresDailyRest: true });
    renderResult();
    await settled();
    expect(screen.getByText('Нужен суточный отдых')).toBeTruthy();
    expect(screen.getByText(/суточный отдых обязателен, в расписание не включён/)).toBeTruthy();
    expect(screen.queryByText('По норме')).toBeNull();
  });

  test('без остановок → «без перерывов», карта есть, выделенных маркеров нет', async () => {
    seed({ ...OK_RESULT, stops: [], drivingTimeSec: 1992 });
    renderResult();

    expect(screen.getByText(/· без перерывов · /)).toBeTruthy();
    expect(await screen.findByTestId('route-map')).toBeTruthy();
    await screen.findByText(/^Парковок: \d+ · остановок: 0 · обновлено /);
    expect(screen.getAllByTestId(/^marker-parking-/).filter((m) => isColor(m.props.pinColor, 'primary'))).toHaveLength(0);
  });

  // --- шаг 7: динамика ---------------------------------------------------------------------------

  test(`таймер: через ${MAP_REFRESH_MS} мс парковки коридора запрашиваются заново`, async () => {
    jest.useFakeTimers();
    const rec = recordRequests();
    try {
      seed(OK_RESULT);
      renderResult();

      await waitFor(() => expect(parkingRequests(rec.requests).length).toBeGreaterThan(0));
      const first = parkingRequests(rec.requests).length;
      expect(first).toBe(36); // ceil(890 км / 25 км) — тот же счёт, что в corridor.test.ts

      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAP_REFRESH_MS);
      });
      await waitFor(() => expect(parkingRequests(rec.requests).length).toBe(first * 2));

      // Между тиками лишних запросов нет.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAP_REFRESH_MS - 1);
      });
      expect(parkingRequests(rec.requests)).toHaveLength(first * 2);
    } finally {
      rec.stop();
      jest.useRealTimers();
    }
  });

  test("выбранная парковка занята → плашка и «Перепланировать» → /planning", async () => {
    setMockScenario('all-full'); // все парковки коридора становятся full, включая остановки плана
    seed(OK_RESULT);
    renderResult();

    const banner = await screen.findByTestId('lost-parking-banner');
    expect(banner).toBeTruthy();
    expect(screen.getByText('Выбранная парковка занята')).toBeTruthy();
    expect(screen.getByText(/Mock parking 5FC8-1/)).toBeTruthy();

    fireEvent.press(screen.getByText('Перепланировать'));
    expect(screen).toHavePathname('/planning');
  });

  test('без сценария выбранные парковки свободны — плашки нет', async () => {
    seed(OK_RESULT);
    renderResult();
    await settled();
    expect(screen.queryByTestId('lost-parking-banner')).toBeNull();
  });

  test("сценарий 'live': после обновлений по таймеру цвет хотя бы одного маркера меняется", async () => {
    // Модерн-таймеры Jest двигают и Date.now, от которого зависит минутный слот дрейфа мока.
    // Стартуем ровно на границе минуты: два тика по 30 с = +60 с — гарантированно следующий слот.
    const start = Date.parse('2026-09-07T10:00:00.000Z');
    jest.useFakeTimers({ now: start });
    try {
      setMockScenario('live');
      seed(OK_RESULT);
      renderResult();

      await waitFor(() => expect(screen.queryAllByTestId(/^marker-parking-/).length).toBeGreaterThan(0));
      const colorsBefore = colorsById();
      expect(Object.keys(colorsBefore).length).toBeGreaterThanOrEqual(10);

      // Первый тик — та же минута: набор и цвета обязаны совпасть (иначе экран мигал бы).
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAP_REFRESH_MS);
      });
      expect(colorsById()).toEqual(colorsBefore);

      // Второй тик — следующая минута: дрейф другой.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(MAP_REFRESH_MS);
      });
      const colorsAfter = colorsById();

      expect(Object.keys(colorsAfter)).toEqual(Object.keys(colorsBefore)); // маркеры не «прыгают»
      const changed = Object.keys(colorsAfter).filter((id) => colorsAfter[id] !== colorsBefore[id]);
      expect(changed.length).toBeGreaterThanOrEqual(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('без результата → «Нет результата», «Новый маршрут» → /', () => {
    renderResult();
    expect(screen.getByText('Нет результата')).toBeTruthy();
    fireEvent.press(screen.getByText('Новый маршрут'));
    expect(screen).toHavePathname('/');
  });
});
