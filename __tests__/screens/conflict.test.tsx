import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import InputScreen from '../../src/app/index';
import ResultScreen, { EARLIER_SHIFT_MIN } from '../../src/app/result';
import { formatClock, toRfc3339Local } from '../../src/ui/time';
import { resetTrip, setTripState } from '../../src/ui/tripStore';
import { CONFLICT_RESULT, LABELS, OK_RESULT, TRIP_INPUT } from './fixtures';

afterEach(() => resetTrip());

function seed(result: typeof CONFLICT_RESULT) {
  setTripState({ status: 'done', input: TRIP_INPUT, labels: LABELS, stages: ['route', 'anchors'], result });
}

function renderResult() {
  return renderRouter({ index: InputScreen, result: ResultScreen }, { initialUrl: '/result' });
}

describe('Экран 3 — conflict (фикстура API_CONTRACT.md § 5)', () => {
  test('красная карточка с reason и плановой остановкой, без ленты и без nearestFreeParking', () => {
    seed(CONFLICT_RESULT);
    renderResult();

    expect(screen.getByTestId('result-card-conflict')).toBeTruthy();
    expect(screen.getByText('Не сходится')).toBeTruthy();
    expect(screen.getByText(CONFLICT_RESULT.conflict.reason)).toBeTruthy();
    expect(screen.getByText(new RegExp(`^Плановая остановка ${formatClock('2026-09-07T08:10:00.000Z')} · 51.2266, 15.1747$`))).toBeTruthy();
    expect(screen.queryByText('Ближайшая свободная')).toBeNull();
    expect(screen.queryByTestId('result-card-ok')).toBeNull();
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.getByText('Выехать раньше')).toBeTruthy();
    expect(screen.getByText('Другая парковка')).toBeTruthy();
  });

  test('карта конфликта: маркер якоря, без полилинии и без карты маршрута', () => {
    seed(CONFLICT_RESULT);
    renderResult();

    expect(screen.getByTestId('conflict-map')).toBeTruthy();
    expect(screen.queryByTestId('route-map')).toBeNull();
    // У conflict в PlanResult нет route — рисовать нечего.
    expect(screen.queryByTestId('route-polyline')).toBeNull();

    const anchor = screen.getByTestId('marker-anchor');
    expect(anchor.props.coordinate).toEqual({ latitude: 51.226587, longitude: 15.174708 });
    expect(anchor.props.title).toBe('Плановая остановка');
    expect(anchor.props.description).toContain(formatClock('2026-09-07T08:10:00.000Z'));
    expect(screen.queryAllByTestId(/^marker-parking-/)).toHaveLength(0);
  });

  test('карта конфликта: nearestFreeParking — второй маркер', () => {
    const nearest = OK_RESULT.stops[0].parking;
    seed({ ...CONFLICT_RESULT, conflict: { ...CONFLICT_RESULT.conflict, nearestFreeParking: nearest } });
    renderResult();

    const marker = screen.getByTestId(`marker-parking-${nearest.id}`);
    expect(marker.props.coordinate).toEqual({ latitude: nearest.lat, longitude: nearest.lon });
    expect(marker.props.title).toBe(nearest.name);
    expect(marker.props.description).toContain('Ближайшая свободная');
  });

  test('nearestFreeParking показывается с именем и местами', () => {
    const nearest = OK_RESULT.stops[0].parking;
    seed({ ...CONFLICT_RESULT, conflict: { ...CONFLICT_RESULT.conflict, nearestFreeParking: nearest } });
    renderResult();
    expect(screen.getByText('Ближайшая свободная')).toBeTruthy();
    expect(screen.getByText('Mock parking 5FC8-1')).toBeTruthy();
    expect(screen.getByText('свободно 27 из 57')).toBeTruthy();
  });

  test('«Выехать раньше» → экран 1 с departureAt на 30 мин раньше, чип «в HH:MM»', () => {
    seed(CONFLICT_RESULT);
    const r = renderResult();

    fireEvent.press(screen.getByText('Выехать раньше'));

    const expected = toRfc3339Local(new Date(Date.parse(TRIP_INPUT.departureAt) - EARLIER_SHIFT_MIN * 60_000));
    expect(screen).toHavePathname('/');
    expect(r.getSearchParams()).toEqual({ departureAt: expected });
    expect(screen.getByTestId('offset-fixed')).toBeTruthy();
    expect(screen.getByText(`в ${formatClock(expected)}`)).toBeTruthy();
  });

  test('«Другая парковка» → «Скоро» (NOT_NOW.md)', () => {
    seed(CONFLICT_RESULT);
    renderResult();
    fireEvent.press(screen.getByText('Другая парковка'));
    expect(screen.getByText('Скоро')).toBeTruthy();
    expect(screen.queryByText('Другая парковка')).toBeNull();
  });
});
