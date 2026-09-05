import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { getMockScenario } from '../../src/core/mocks/scenario';
import InputScreen from '../../src/app/index';
import PlanningScreen from '../../src/app/planning';
import ResultScreen from '../../src/app/result';
import { PLANNING_MIN_VISIBLE_MS } from '../../src/ui/planningStages';
import { getTripState, resetTrip } from '../../src/ui/tripStore';
import { recordRequests } from '../core/helpers';

const NAV_TIMEOUT = PLANNING_MIN_VISIBLE_MS + 2000;

afterEach(() => resetTrip());

function renderApp() {
  return renderRouter({ index: InputScreen, planning: PlanningScreen, result: ResultScreen }, { initialUrl: '/' });
}

describe('Экран 1 — Ввод', () => {
  test('«Построить маршрут» → planTrip через MSW с координатами пресетов → /planning → /result', async () => {
    const rec = recordRequests();
    renderApp();

    fireEvent.press(screen.getByText('Построить маршрут'));
    expect(screen).toHavePathname('/planning');

    await waitFor(() => expect(rec.requests.length).toBeGreaterThanOrEqual(1));
    const first = rec.requests[0];
    const url = new URL(first.url);
    expect(first.method).toBe('POST');
    expect(url.hostname).toBe('api.tomtom.com');
    // Варшава → Франкфурт по умолчанию (src/ui/presets.ts), координаты в пути URL через двоеточие.
    expect(url.pathname).toContain('/52.2297,21.0122:50.1109,8.6821/json');
    expect(url.searchParams.get('vehicleWeight')).toBe('40000');
    expect(url.searchParams.get('departAt')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    // planTrip дошёл до конца через моки — экран 2 увёл на результат (после PLANNING_MIN_VISIBLE_MS).
    await waitFor(() => expect(screen).toHavePathname('/result'), { timeout: NAV_TIMEOUT });
    // Экран 3 догружает парковки коридора асинхронно — дожидаемся, иначе setState прилетит после теста.
    await screen.findByText(/^Парковок: [1-9]\d* · остановок: \d+ · обновлено /);
    rec.stop();
  });

  test('смена пресета «Куда» на Лодзь → координаты Лодзи в запросе к TomTom', async () => {
    const rec = recordRequests();
    renderApp();

    fireEvent.press(screen.getByTestId('destination-lodz'));
    fireEvent.press(screen.getByText('Построить маршрут'));

    await waitFor(() => expect(rec.requests.length).toBeGreaterThanOrEqual(1));
    expect(new URL(rec.requests[0].url).pathname).toContain('/52.2297,21.0122:51.7592,19.456/json');
    await waitFor(() => expect(screen).toHavePathname('/result'), { timeout: NAV_TIMEOUT });
    // Экран 3 догружает парковки коридора асинхронно — дожидаемся, иначе setState прилетит после теста.
    await screen.findByText(/^Парковок: [1-9]\d* · остановок: \d+ · обновлено /);
    rec.stop();
  });

  test('сдвиг выезда +1 ч → departAt примерно через час от «сейчас»', async () => {
    const rec = recordRequests();
    const before = Date.now();
    renderApp();

    fireEvent.press(screen.getByTestId('offset-60'));
    fireEvent.press(screen.getByText('Построить маршрут'));

    await waitFor(() => expect(rec.requests.length).toBeGreaterThanOrEqual(1));
    const departAt = Date.parse(new URL(rec.requests[0].url).searchParams.get('departAt') ?? '');
    expect(departAt - before).toBeGreaterThanOrEqual(60 * 60_000 - 1000);
    expect(departAt - before).toBeLessThan(60 * 60_000 + 60_000);
    rec.stop();
  });

  test('dev-переключатель «все парковки заняты» → planTrip через MSW → красная карточка на /result', async () => {
    renderApp();

    fireEvent(screen.getByLabelText('Мок: все парковки заняты'), 'valueChange', true);
    expect(getMockScenario()).toBe('all-full');
    fireEvent.press(screen.getByText('Построить маршрут'));

    await waitFor(() => expect(screen).toHavePathname('/result'), { timeout: NAV_TIMEOUT });
    expect(screen.getByTestId('result-card-conflict')).toBeTruthy();
    expect(screen.getByText(/^No free parking within 25 km/)).toBeTruthy();
    expect(screen.queryByTestId('result-card-ok')).toBeNull();
  });

  test('невалидный вес → кнопка отключена, запросов нет, остаёмся на /', () => {
    const rec = recordRequests();
    renderApp();

    fireEvent.changeText(screen.getByLabelText('Вес авто, кг'), '0');
    expect(screen.getByText('Введите вес больше 0')).toBeTruthy();
    fireEvent.press(screen.getByText('Построить маршрут'));

    expect(screen).toHavePathname('/');
    // startPlanning не вызывался: стор не тронут, значит planTrip и запросов нет.
    expect(getTripState().status).toBe('idle');
    expect(rec.requests).toHaveLength(0);
    rec.stop();
  });
});
