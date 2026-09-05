import { getParkingsNear, PARKING_API_BASE } from '../../src/core/api/parking';
import { haversineMeters } from '../../src/core/geo';
import {
  generateParkings,
  MOCK_CAPACITY_MAX,
  MOCK_CAPACITY_MIN,
  MOCK_CONFIDENCE_FORECAST,
  MOCK_CONFIDENCE_NOW,
  MOCK_LIVE_AMPLITUDE,
  MOCK_LIVE_TICK_MS,
  MOCK_NIGHT_OCCUPANCY,
} from '../../src/core/mocks/parkingGenerator';
import { setMockScenario } from '../../src/core/mocks/scenario';
import { recordRequests } from './helpers';

// Якорь ≈ середина Варшава → Франкфурт; время — днём по UTC (08:10Z), как первый якорь happy path шага 7.
const ANCHOR = { lat: 51.4, lon: 16.2 };
const DAY_AT = '2026-09-07T08:10:00.000Z';
const NIGHT_AT = '2026-09-07T23:00:00.000Z';
const RADIUS_KM = 25;

describe('getParkingsNear (шаг 4)', () => {
  test('GET на наш мок-URL, query дошли как переданы, ответ по схеме', async () => {
    const rec = recordRequests();
    try {
      const parkings = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT });

      expect(rec.requests).toHaveLength(1);
      const req = rec.requests[0];
      const url = new URL(req.url);
      expect(req.method).toBe('GET');
      expect(`${url.origin}${url.pathname}`).toBe(`${PARKING_API_BASE}/parkings`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        lat: '51.4',
        lon: '16.2',
        radiusKm: '25',
        at: DAY_AT,
      });

      expect(parkings.length).toBeGreaterThanOrEqual(1); // в ячейке сетки минимум одна парковка
      for (const p of parkings) {
        expect(typeof p.id).toBe('string');
        expect(typeof p.name).toBe('string');
        expect(haversineMeters(ANCHOR, p)).toBeLessThanOrEqual(RADIUS_KM * 1000 + 50); // 50 м — округление до 1e-6°
        expect(p.capacityTotal).toBeGreaterThanOrEqual(MOCK_CAPACITY_MIN);
        expect(p.capacityTotal).toBeLessThanOrEqual(MOCK_CAPACITY_MAX);
        expect(p.freeAt).toBeGreaterThanOrEqual(1); // днём свободные места гарантированы
        expect(p.freeAt).toBeLessThanOrEqual(p.capacityTotal);
        expect(p.confidence).toBe(MOCK_CONFIDENCE_FORECAST); // at далеко от «сейчас»
      }
      expect(new Set(parkings.map((p) => p.id)).size).toBe(parkings.length);
    } finally {
      rec.stop();
    }
  });

  test('один вход → одинаковый ответ; другой центр → другой ответ', async () => {
    const a = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT });
    const b = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT });
    expect(b).toEqual(a);

    const c = await getParkingsNear({ lat: 50.5, lon: 10.9, radiusKm: RADIUS_KM, at: DAY_AT });
    expect(c).not.toEqual(a);
  });

  test('ночью (22–06 UTC) занято ≥ 85 %', async () => {
    const parkings = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: NIGHT_AT });
    for (const p of parkings) {
      expect(p.freeAt).toBeLessThanOrEqual(Math.ceil(p.capacityTotal * (1 - MOCK_NIGHT_OCCUPANCY.min)));
    }
  });

  test("сценарий 'all-full': все freeAt === 0", async () => {
    setMockScenario('all-full');
    const parkings = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT });
    expect(parkings.length).toBeGreaterThanOrEqual(1);
    expect(parkings.every((p) => p.freeAt === 0)).toBe(true);
  });

  test('после afterEach сценарий сброшен: снова есть свободные места', async () => {
    const parkings = await getParkingsNear({ ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT });
    expect(parkings.some((p) => p.freeAt >= 1)).toBe(true);
  });

  test('мок отвечает 400 на нечисловой lat', async () => {
    const res = await fetch(`${PARKING_API_BASE}/parkings?lat=abc&lon=16.2&radiusKm=25&at=${DAY_AT}`);
    expect(res.status).toBe(400);
  });
});

describe('generateParkings — парковки как свойство географии (исправление находки аудита)', () => {
  const base = { ...ANCHOR, at: DAY_AT, now: 0 };
  const byId = (list: ReturnType<typeof generateParkings>) => new Map(list.map((p) => [p.id, p]));

  test('радиус 50 км ⊇ радиус 25 км: общие парковки идентичны, снаружи есть новые', () => {
    const r25 = generateParkings({ ...base, radiusKm: 25 });
    const r50 = generateParkings({ ...base, radiusKm: 50 });
    const in50 = byId(r50);

    expect(r50.length).toBeGreaterThan(r25.length);
    for (const p of r25) expect(in50.get(p.id)).toEqual(p);
    for (const p of r50) expect(haversineMeters(ANCHOR, p)).toBeLessThanOrEqual(50_000 + 50);
  });

  test('соседний центр (+10 км): общие парковки идентичны по id, координатам и freeAt', () => {
    const a = generateParkings({ ...base, radiusKm: 25 });
    const b = generateParkings({ ...base, lat: ANCHOR.lat + 10 / 111.32, radiusKm: 25 });
    const inB = byId(b);
    const shared = a.filter((p) => inB.has(p.id));

    expect(shared.length).toBeGreaterThan(0);
    for (const p of shared) expect(inB.get(p.id)).toEqual(p);
  });

  test('ближайшие первыми', () => {
    const list = generateParkings({ ...base, radiusKm: 50 });
    const d = list.map((p) => haversineMeters(ANCHOR, p));
    expect([...d].sort((x, y) => x - y)).toEqual(d);
  });
});

describe('generateParkings — confidence', () => {
  const base = { ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT };
  const atMs = Date.parse(DAY_AT);

  test('0.9, если at в пределах часа от now; 0.6 — иначе', () => {
    const near = generateParkings({ ...base, now: atMs + 59 * 60 * 1000 });
    expect(near.every((p) => p.confidence === MOCK_CONFIDENCE_NOW)).toBe(true);

    const far = generateParkings({ ...base, now: atMs - 61 * 60 * 1000 });
    expect(far.every((p) => p.confidence === MOCK_CONFIDENCE_FORECAST)).toBe(true);
  });
});

// --- фаза 3, шаг 3: сценарий 'live' ---------------------------------------------------------------
// Без сценария поведение мока не меняется — тесты выше не тронуты. Здесь только дрейф.

describe("generateParkings — сценарий 'live' (фаза 3, шаг 3)", () => {
  const base = { ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT };
  const SLOT0 = 1_800_000_000_000; // кратно MOCK_LIVE_TICK_MS, чтобы слоты считались явно
  const slot = (k: number, offsetMs = 0) => SLOT0 + k * MOCK_LIVE_TICK_MS + offsetMs;

  test('внутри одного минутного слота ответ не меняется', () => {
    const a = generateParkings({ ...base, now: slot(0), live: true });
    const b = generateParkings({ ...base, now: slot(0, MOCK_LIVE_TICK_MS - 1), live: true });
    expect(b).toEqual(a);
  });

  test('в разных слотах freeAt другой', () => {
    const a = generateParkings({ ...base, now: slot(0), live: true });
    const b = generateParkings({ ...base, now: slot(1), live: true });
    expect(a.length).toBeGreaterThan(0);
    expect(b.map((p) => p.freeAt)).not.toEqual(a.map((p) => p.freeAt));
  });

  test('дрейфует только freeAt: id, координаты и ёмкость те же, что без сценария', () => {
    const plain = generateParkings({ ...base, now: slot(0) });
    const live = generateParkings({ ...base, now: slot(3), live: true });

    expect(live.map((p) => p.id)).toEqual(plain.map((p) => p.id));
    for (const [i, p] of live.entries()) {
      expect(p.lat).toBe(plain[i].lat);
      expect(p.lon).toBe(plain[i].lon);
      expect(p.capacityTotal).toBe(plain[i].capacityTotal);
      expect(p.confidence).toBe(plain[i].confidence);
    }
  });

  test('freeAt остаётся в [0, capacityTotal] и не уходит дальше амплитуды', () => {
    for (let k = 0; k < 20; k++) {
      for (const p of generateParkings({ ...base, now: slot(k), live: true })) {
        expect(p.freeAt).toBeGreaterThanOrEqual(0);
        expect(p.freeAt).toBeLessThanOrEqual(p.capacityTotal);
      }
    }
    // Отклонение от «спокойного» значения не больше амплитуды (+1 место на округление).
    const plain = generateParkings({ ...base, now: slot(0) });
    for (let k = 0; k < 20; k++) {
      const live = generateParkings({ ...base, now: slot(k), live: true });
      for (const [i, p] of live.entries()) {
        const maxDelta = Math.ceil(p.capacityTotal * MOCK_LIVE_AMPLITUDE) + 1;
        expect(Math.abs(p.freeAt - plain[i].freeAt)).toBeLessThanOrEqual(maxDelta);
      }
    }
  });

  test('live: false и отсутствие флага дают один и тот же результат', () => {
    expect(generateParkings({ ...base, now: slot(7), live: false })).toEqual(generateParkings({ ...base, now: slot(7) }));
  });
});

describe("Parking-API через MSW — сценарий 'live'", () => {
  test('setMockScenario(\'live\') → ответы разных минут различаются, одной минуты — совпадают', async () => {
    const spy = jest.spyOn(Date, 'now');
    try {
      setMockScenario('live');
      const at = { ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT };
      const t0 = Math.floor(Date.now() / MOCK_LIVE_TICK_MS) * MOCK_LIVE_TICK_MS;

      spy.mockReturnValue(t0);
      const a = await getParkingsNear(at);
      spy.mockReturnValue(t0 + MOCK_LIVE_TICK_MS - 1);
      const aSameSlot = await getParkingsNear(at);
      spy.mockReturnValue(t0 + MOCK_LIVE_TICK_MS);
      const b = await getParkingsNear(at);

      expect(a.length).toBeGreaterThan(0);
      expect(aSameSlot).toEqual(a);
      expect(b.map((p) => p.freeAt)).not.toEqual(a.map((p) => p.freeAt));
      expect(b.map((p) => p.id)).toEqual(a.map((p) => p.id)); // id стабильны — маркеры на карте не прыгают
    } finally {
      spy.mockRestore();
    }
  });

  test('без сценария ответы разных минут одинаковы (дрейф выключен по умолчанию)', async () => {
    const spy = jest.spyOn(Date, 'now');
    try {
      const at = { ...ANCHOR, radiusKm: RADIUS_KM, at: DAY_AT };
      const t0 = Math.floor(Date.now() / MOCK_LIVE_TICK_MS) * MOCK_LIVE_TICK_MS;

      spy.mockReturnValue(t0);
      const a = await getParkingsNear(at);
      spy.mockReturnValue(t0 + 5 * MOCK_LIVE_TICK_MS);
      const b = await getParkingsNear(at);

      expect(b.map((p) => p.freeAt)).toEqual(a.map((p) => p.freeAt));
    } finally {
      spy.mockRestore();
    }
  });
});
