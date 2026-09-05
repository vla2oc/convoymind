import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planTrip, type PlanResult } from '../../src/core';
import { setMockScenario } from '../../src/core/mocks/scenario';

// Критерий фазы 3, п. 3a.4: JSON в docs/API_CONTRACT.md § 5 равен реальному выводу planTrip.
// Здесь же генерируются фикстуры экранов, чтобы § 5 и __tests__/screens/fixtures.ts не разъезжались.
//
// Массив route.points в § 5 сокращён (в реальном выводе ~181 точка): в документе лежат первые `head`
// и последние `tail` точек, их число объявлено маркером <!-- contract:ok points=N head=H tail=T -->.
// Сверяются: все поля кроме route.points дословно; для points — общее число и совпадение
// показанных точек с началом и концом реального массива.
//
// Обновить документ и фикстуры после осознанного изменения вывода:
//   UPDATE_CONTRACT=1 npx jest --selectProjects core contract
// (в этом режиме тест не проверяет, а перезаписывает; коммитить только вместе с причиной в DECISIONS.md)

const ROOT = join(__dirname, '..', '..');
const CONTRACT_PATH = join(ROOT, 'docs', 'API_CONTRACT.md');
const FIXTURES_PATH = join(ROOT, '__tests__', 'screens', 'fixtures.ts');
const UPDATE = process.env.UPDATE_CONTRACT === '1';

const TRIP = {
  origin: { lat: 52.2297, lon: 21.0122 }, // Варшава
  destination: { lat: 50.1109, lon: 8.6821 }, // Франкфурт
  departureAt: '2026-09-07T06:00:00+02:00',
  vehicleWeightKg: 40_000,
};
const LABELS = { originName: 'Варшава', destinationName: 'Франкфурт' };

const MARKER_RE = /<!-- contract:ok points=(\d+) head=(\d+) tail=(\d+) -->/;
const JSON_BLOCK_RE = /```json\n([\s\S]*?)```/g;

/** Два ```json-блока § 5: ok и conflict. Границы секции — по заголовкам, не по номерам строк. */
function section5(md: string): { start: number; end: number } {
  const start = md.indexOf('## 5. ');
  const end = md.indexOf('### Пресеты для экрана', start);
  if (start < 0 || end < 0) throw new Error('API_CONTRACT.md: § 5 не найден — изменилась структура документа');
  return { start, end };
}

function jsonBlocks(md: string): { text: string; from: number; to: number }[] {
  const { start, end } = section5(md);
  const body = md.slice(start, end);
  const found: { text: string; from: number; to: number }[] = [];
  for (const m of body.matchAll(JSON_BLOCK_RE)) {
    found.push({ text: m[1], from: start + m.index! + '```json\n'.length, to: start + m.index! + m[0].length - '```'.length });
  }
  if (found.length !== 2) throw new Error(`API_CONTRACT.md § 5: ожидались 2 json-блока, найдено ${found.length}`);
  return found;
}

type Ok = Extract<PlanResult, { status: 'ok' }>;

function expectOk(r: PlanResult): Ok {
  if (r.status !== 'ok') throw new Error(`ожидался ok, получен conflict: ${r.conflict.reason}`);
  return r;
}

/** Результат с сокращённым route.points — ровно то, что лежит в документе и в фикстурах. */
function elide(ok: Ok, head: number, tail: number): Ok {
  return { ...ok, route: { points: [...ok.route.points.slice(0, head), ...ok.route.points.slice(-tail)] } };
}

function fixturesFile(ok: Ok, conflict: PlanResult): string {
  return `// Сгенерировано из docs/API_CONTRACT.md § 5 (первый и второй \`\`\`json-блоки), не править руками.
// Обновить: UPDATE_CONTRACT=1 npx jest --selectProjects core contract
// route.points сокращён так же, как в § 5 (см. __tests__/core/contract.test.ts).
import type { PlanResult, TripInput } from '../../src/core';

export const TRIP_INPUT: TripInput = ${JSON.stringify(TRIP, null, 2)};

export const LABELS = ${JSON.stringify(LABELS)};

export const OK_RESULT: Extract<PlanResult, { status: 'ok' }> = ${JSON.stringify(ok, null, 2)};

export const CONFLICT_RESULT: Extract<PlanResult, { status: 'conflict' }> = ${JSON.stringify(conflict, null, 2)};
`;
}

describe('docs/API_CONTRACT.md § 5 — реальный вывод planTrip', () => {
  test('JSON в документе совпадает с выводом planTrip (и фикстуры экранов из него же)', async () => {
    const okReal = expectOk(await planTrip(TRIP));
    setMockScenario('all-full');
    const conflictReal = await planTrip(TRIP);
    expect(conflictReal.status).toBe('conflict');

    const md = readFileSync(CONTRACT_PATH, 'utf8');
    const marker = MARKER_RE.exec(md.slice(section5(md).start, section5(md).end));
    if (!marker && !UPDATE) throw new Error('API_CONTRACT.md § 5: нет маркера <!-- contract:ok points=… -->');
    const head = marker ? Number(marker[2]) : 3;
    const tail = marker ? Number(marker[3]) : 1;
    const okElided = elide(okReal, head, tail);

    if (UPDATE) {
      const blocks = jsonBlocks(md);
      let next = md.slice(0, blocks[0].from) + JSON.stringify(okElided, null, 2) + '\n' + md.slice(blocks[0].to);
      const blocks2 = jsonBlocks(next);
      next = next.slice(0, blocks2[1].from) + JSON.stringify(conflictReal, null, 2) + '\n' + next.slice(blocks2[1].to);
      next = next.replace(
        MARKER_RE,
        `<!-- contract:ok points=${okReal.route.points.length} head=${head} tail=${tail} -->`
      );
      writeFileSync(CONTRACT_PATH, next);
      writeFileSync(FIXTURES_PATH, fixturesFile(okElided, conflictReal as Extract<PlanResult, { status: 'conflict' }>));
      console.log(`UPDATE_CONTRACT=1: перезаписаны § 5 и fixtures.ts (points=${okReal.route.points.length})`);
      return;
    }

    const [okBlock, conflictBlock] = jsonBlocks(md);
    expect(JSON.parse(conflictBlock.text)).toEqual(conflictReal);
    expect(JSON.parse(okBlock.text)).toEqual(okElided);
    expect(Number(marker![1])).toBe(okReal.route.points.length);
  });

  test('__tests__/screens/fixtures.ts собран из тех же данных', async () => {
    const md = readFileSync(CONTRACT_PATH, 'utf8');
    const [okBlock, conflictBlock] = jsonBlocks(md);
    const expected = fixturesFile(
      JSON.parse(okBlock.text) as Ok,
      JSON.parse(conflictBlock.text) as Extract<PlanResult, { status: 'conflict' }>
    );
    expect(readFileSync(FIXTURES_PATH, 'utf8')).toBe(expected);
  });
});
