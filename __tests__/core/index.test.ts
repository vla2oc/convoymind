import * as fs from 'node:fs';
import * as path from 'node:path';
import { planTrip } from '../../src/core';
import type { PlanResult, TripInput } from '../../src/core';

// Шаг 8: публичный вход src/core/index.ts.

test('planTrip доступен из src/core и проходит через MSW', async () => {
  const input: TripInput = {
    origin: { lat: 52.2297, lon: 21.0122 }, // Варшава
    destination: { lat: 51.7592, lon: 19.456 }, // Лодзь, < 4:30 — без остановок
    departureAt: '2026-09-07T06:00:00+02:00',
    vehicleWeightKg: 40_000,
  };
  const result: PlanResult = await planTrip(input);

  expect(result.status).toBe('ok');
  if (result.status === 'ok') expect(result.stops).toEqual([]);
});

test('src/core/index.ts не тянет моки и msw', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/core/index.ts'), 'utf8');
  const imports = src.split('\n').filter((line) => /^\s*(export|import)\b.*\bfrom\b/.test(line));

  expect(imports.length).toBeGreaterThan(0);
  expect(imports.filter((line) => /mocks|msw/.test(line))).toEqual([]);
});
