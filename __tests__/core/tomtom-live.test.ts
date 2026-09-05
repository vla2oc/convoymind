import { setupServer } from 'msw/node';
import { calculateRoute } from '../../src/core/api/tomtom';
import { getParkingsNear } from '../../src/core/api/parking';
import { appHandlers, handlers, isTomTomLive, parkingsNear, tomtomCalculateRoute } from '../../src/core/mocks/handlers';
import { server as globalServer } from '../../src/core/mocks/server';

// Фаза 3, шаг 4: реальный TomTom по opt-in. Сам поход в настоящий API из тестов не делается —
// проверяется ровно то, что решает `mocks/native.ts`: какой набор handlers регистрировать.
// (`native.ts` импортирует `msw/native`, который в Jest-проекте `core` не грузится, поэтому
// выбор набора вынесен в чистую функцию `appHandlers`.)

const WARSAW = { lat: 52.2297, lon: 21.0122 };
const FRANKFURT = { lat: 50.1109, lon: 8.6821 };
const ROUTE_REQ = { origin: WARSAW, destination: FRANKFURT, departAt: '2026-09-07T06:00:00+02:00', vehicleWeightKg: 40_000 };

describe('appHandlers — выбор набора для приложения', () => {
  test('LIVE выключен: оба handler зарегистрированы (как в фазах 1–2)', () => {
    expect(appHandlers({ tomtomLive: false })).toEqual(handlers);
    expect(appHandlers({ tomtomLive: false })).toContain(tomtomCalculateRoute);
    expect(appHandlers({ tomtomLive: false })).toContain(parkingsNear);
  });

  test('LIVE включён: TomTom не мокается, парковки мокаются всегда', () => {
    const live = appHandlers({ tomtomLive: true });
    expect(live).not.toContain(tomtomCalculateRoute);
    expect(live).toContain(parkingsNear);
    expect(live).toHaveLength(1);
  });
});

describe('isTomTomLive — читает EXPO_PUBLIC_TOMTOM_LIVE', () => {
  const saved = process.env.EXPO_PUBLIC_TOMTOM_LIVE;
  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_TOMTOM_LIVE;
    else process.env.EXPO_PUBLIC_TOMTOM_LIVE = saved;
  });

  test("включает только точное '1'", () => {
    process.env.EXPO_PUBLIC_TOMTOM_LIVE = '1';
    expect(isTomTomLive()).toBe(true);

    for (const v of ['0', '', 'true', 'yes', '01']) {
      process.env.EXPO_PUBLIC_TOMTOM_LIVE = v;
      expect(isTomTomLive()).toBe(false);
    }
    delete process.env.EXPO_PUBLIC_TOMTOM_LIVE;
    expect(isTomTomLive()).toBe(false);
  });
});

describe('поведение сервера с набором LIVE (без похода в настоящий API)', () => {
  // Отдельный сервер с набором `tomtomLive: true` и 'error' на неперехваченное: если TomTom-handler
  // действительно не зарегистрирован, запрос к api.tomtom.com не найдёт обработчика и упадёт —
  // в приложении на его месте стоит 'bypass', и запрос уходит в настоящий API.
  //
  // Глобальный сервер из jest.setup.ts на это время закрывается: иначе слушают двое и порядок
  // перехвата — деталь реализации msw, а не наше поведение.
  const live = setupServer(...appHandlers({ tomtomLive: true }));

  beforeAll(() => {
    globalServer.close();
    live.listen({ onUnhandledRequest: 'error' });
  });
  afterEach(() => live.resetHandlers());
  afterAll(() => {
    live.close();
    globalServer.listen({ onUnhandledRequest: 'error' });
  });

  test('запрос к TomTom мимо моков, запрос к парковкам перехвачен', async () => {
    await expect(calculateRoute(ROUTE_REQ)).rejects.toThrow();

    const parkings = await getParkingsNear({ ...WARSAW, radiusKm: 25, at: '2026-09-07T08:10:00.000Z' });
    expect(parkings.length).toBeGreaterThan(0);
    expect(parkings[0]).toMatchObject({ id: expect.any(String), capacityTotal: expect.any(Number) });
  });
});
