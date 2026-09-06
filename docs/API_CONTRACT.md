# API-контракт ядра Convoy Mind (фазы 1 и 3 → экраны)

Единственный документ, который читает агент, пишущий экраны. Всё, что здесь написано, проверено тестами
`__tests__/core/**` (`npm test`) 2026-09-05, разделы про фазу 3 — 2026-09-06; непроверенное помечено `[предположение]`.
Нумерация разделов стабильна: на неё ссылаются `STATE.md` и `__tests__/core/contract.test.ts`. Новое добавляется
подразделами и в конец, разделы не перенумеровываются.
Ядро — чистый TypeScript в `src/core`, без React и Expo; экраны его только вызывают.

## 1. Как импортировать

```ts
import { planTrip, getParkingsAlongRoute } from '@/core';
import type { TripInput, PlanOptions, PlanStage, PlanResult, Stop, Conflict, ConflictCode, Parking, Anchor, GeoPoint } from '@/core';
// Фаза 3 (карта):
import { CORRIDOR_RADIUS_KM, CORRIDOR_STEP_KM } from '@/core';
import type { RoutedParking, GetParkingsAlongRouteInput } from '@/core';
```

Алиас `@/*` → `src/*` задан в `tsconfig.json`, шаблон приложения уже им пользуется (`@/components/...`).
Единственный публичный вход — `src/core/index.ts`. Из `src/core/**` экраны больше ничего не импортируют,
кроме моков по прямому пути (раздел 6).

## 2. Сигнатура

```ts
planTrip(input: TripInput, options?: PlanOptions): Promise<PlanResult>
```

`options.onProgress(stage)` вызывается после каждой завершённой стадии в порядке `route → anchors → parkings → schedule`
(экран 2: «Маршрут построен / Остановки расставлены / Парковки проверены / Расписание собрано»). При `conflict` или
ошибке последующие стадии не сообщаются; при маршруте без остановок все четыре всё равно приходят. Колбэк не должен бросать.
Добавлено в фазе 2 (`DECISIONS.md`, 2026-09-05), покрыто `__tests__/core/progress.test.ts`.

Типы — дословно из `src/core/planner/schedule.ts`:

```ts
export interface TripInput {
  origin: GeoPoint;
  destination: GeoPoint;
  /** Время выезда, ISO/RFC 3339 с оффсетом; уходит в TomTom как departAt без изменений. */
  departureAt: string;
  vehicleWeightKg: number;
}

export interface Stop {
  parking: Parking;
  /** Из legs[i].summary.arrivalTime второго вызова TomTom. */
  arrivalAt: string;
  /** arrivalAt + pauseSec (считается здесь, не берётся из следующего плеча). */
  departAt: string;
  pauseSec: number;
  /** legs[i].summary.travelTimeInSeconds — вождение от предыдущей остановки (или старта). */
  drivingSecFromPrev: number;
}

export type ConflictCode = 'no-free-parking' | 'parking-lost-after-reroute' | 'leg-exceeds-continuous-limit';

export interface Conflict {
  code: ConflictCode;
  /** Человекочитаемый текст (английский). */
  reason: string;
  /** Якорь остановки, на котором план не сошёлся. */
  anchor: Anchor;
  /** Ближайшая свободная парковка, если хоть где-то нашлась (радиус CONFLICT_SEARCH_RADIUS_KM или повторный запрос). */
  nearestFreeParking?: Parking;
}

/** Стадии planTrip в порядке выполнения — для экрана расчёта (фаза 2). */
export type PlanStage = 'route' | 'anchors' | 'parkings' | 'schedule';

export interface PlanOptions {
  onProgress?: (stage: PlanStage) => void;
}

export type PlanResult =
  | {
      status: 'ok';
      departureAt: string;
      /** routes[0].summary.arrivalTime последнего вызова TomTom. */
      arrivalAt: string;
      /** Сумма legs[].summary.travelTimeInSeconds — без пауз. */
      drivingTimeSec: number;
      stops: Stop[];
      /** drivingTimeSec >= 9:00 — суточный отдых нужен, но не планируется (NOT_NOW). */
      requiresDailyRest: boolean;
      /** Геометрия маршрута последнего вызова TomTom — для карты (фаза 3). */
      route: { points: GeoPoint[] };
    }
  | { status: 'conflict'; conflict: Conflict };
```

`Parking` (`src/core/api/types.ts`): `{ id, name, lat, lon, capacityTotal, freeAt, confidence }` — `freeAt` свободных мест
на момент приезда, `confidence` 0.6 (прогноз) или 0.9 (в пределах часа от «сейчас»).
`Anchor` (`src/core/planner/breaks.ts`): `{ lat, lon, plannedArrivalAt, drivenSecFromPrev, drivenSecFromStart }` — где и когда
планировалась остановка. `GeoPoint`: `{ lat, lon }`.

### `getParkingsAlongRoute` (фаза 3, для карты)

```ts
getParkingsAlongRoute(input: GetParkingsAlongRouteInput): Promise<RoutedParking[]>
```

Типы — дословно из `src/core/planner/corridor.ts`:

```ts
export interface RoutedParking extends Parking {
  /** Расстояние от старта вдоль маршрута до ближайшей к парковке вершины полилинии, м. */
  routeProgressM: number;
  /** Расчётное время проезда мимо этой парковки, ISO. */
  etaAt: string;
  /** freeAt >= 1 — тот же порог, по которому planTrip выбирает остановку. */
  status: 'free' | 'full';
  /** Парковка выбрана планировщиком как остановка (её id есть в stops). */
  chosen: boolean;
}

export interface GetParkingsAlongRouteInput {
  /** Геометрия маршрута от старта до финиша — PlanResult.route.points. */
  points: GeoPoint[];
  /** Время выезда, ISO/RFC 3339 (любой разбираемый Date.parse). */
  departureAt: string;
  /** Суммарное вождение без пауз — PlanResult.drivingTimeSec. */
  drivingTimeSec: number;
  /** Остановки плана — по ним ставится chosen и добавляются паузы в ETA. */
  stops: Stop[];
  corridorKm?: number;
  stepKm?: number;
}
```

Вызов из экрана — прямо из `ok`-результата:

```ts
const parkings = await getParkingsAlongRoute({
  points: result.route.points,
  departureAt: result.departureAt,
  drivingTimeSec: result.drivingTimeSec,
  stops: result.stops,
});
```

Плохой вход (< 2 точек, `drivingTimeSec < 0`, неразбираемый `departureAt`, `stepKm <= 0`, `corridorKm <= 0`) —
`throw` **до** сети, как и у `planTrip`.

## 3. Что делает `planTrip` (по диаграмме)

1. TomTom `calculateRoute` A → B с `traffic=live`, без остановок.
2. Якоря остановок там, где накоплено 4:10 непрерывного вождения (4:30 по AETR минус запас 20 мин).
3. Для каждого якоря — парковки в радиусе 25 км на плановое время приезда; берётся ближайшая с `freeAt ≥ 1`.
4. TomTom через выбранные парковки с паузой 45 мин на каждой.
5. Проверка «всё сходится»: приезд сдвинулся от плана больше чем на 30 мин → парковка перепроверяется по новому времени;
   любое плечо длиннее 4:30 → конфликт.

## 4. Семантика результата

### `status: 'ok'`
- `stops` — в порядке следования, может быть пустым (маршрут короче 4:30 → один вызов TomTom, без парковок).
- `stop.arrivalAt` — из TomTom; `stop.departAt = arrivalAt + pauseSec`; `pauseSec` всегда 2700.
- `stop.drivingSecFromPrev` — вождение от предыдущей остановки или старта, всегда ≤ 16200 (4:30).
- `drivingTimeSec` — вождение без пауз; `arrivalAt` — финиш с учётом пауз.
- `requiresDailyRest: true` — вождение ≥ 9:00. Суточный отдых **не планируется** (MVP): экран показывает предупреждение,
  остановки при этом рассчитаны как обычно.

### `status: 'conflict'`

| `conflict.code` | Когда | Что показать |
|---|---|---|
| `no-free-parking` | В 25 км от якоря нет свободных на плановое время | `reason`, место и время из `anchor`; `nearestFreeParking` — ближайшая свободная в 50 км, если есть |
| `parking-lost-after-reroute` | После маршрута через парковки приезд сдвинулся > 30 мин, и выбранная парковка на новое время занята | `reason` (содержит сдвиг в минутах); `nearestFreeParking` — другая свободная из того же ответа, если есть |
| `leg-exceeds-continuous-limit` | Плечо между остановками длиннее 4:30 (парковки сместили остановку по маршруту) | `reason`; `nearestFreeParking` отсутствует |

`reason` — английский текст, готовый к показу. Больше одной итерации «занято → другая парковка» ядро не делает (MVP).

### `RoutedParking` (результат `getParkingsAlongRoute`)

- Список отсортирован по `routeProgressM` (от старта к финишу), без дублей по `id`.
- `status: 'free'` ⟺ `freeAt >= 1`. Это тот же порог, по которому `planTrip` выбирает остановку.
- `chosen: true` — парковка есть в `result.stops`. Таких ровно столько, сколько остановок.
- `etaAt` выбранной парковки — **приезд** на остановку, а не отъезд после перерыва: он совпадает с
  соответствующим `stop.arrivalAt` (на моке — до секунды).
- Число запросов к Parking-API за вызов — `ceil(длина маршрута / stepKm)`. Для Варшава → Франкфурт
  (890 км) при шаге по умолчанию это 36 запросов, ответ — 45 парковок.
- Функцию можно звать повторно (polling): `id` парковок стабильны, меняются только `freeAt` и `status`,
  так что маркеры на карте не «прыгают».

`[предположение]`, помеченное в коде: `etaAt` считается по `routeProgressM` самой парковки, а занятость
пришла из запроса, чей `at` может отличаться на `corridorKm` / скорость (~9 мин на 100 км/ч). На моке
это не видно — занятость зависит только от периода суток.

### Ошибки (Promise reject, **не** conflict)
- Плохой вход: неразбираемый `departureAt`, `vehicleWeightKg ≤ 0`, нечисловые координаты.
- Нет `EXPO_PUBLIC_TOMTOM_KEY`.
- HTTP не `ok` от TomTom или Parking-API; ответ TomTom без `routes`.

Экран показывает это как ошибку приложения, не как конфликт расписания.

### Даты
- `departureAt` в результате — строка, как передали. Передавать RFC 3339 с оффсетом, например `2026-09-07T06:00:00+02:00`
  (уходит в TomTom как `departAt` без изменений).
- Остальные даты — из TomTom как есть: мок отдаёт UTC (`...Z`), реальный API — с оффсетом точки отправления `[предположение]`.
  Сравнивать через `Date.parse`, не по строке; форматирование в локальное время водителя — задача фазы 2.

### Сеть
`fetch` на `https://api.tomtom.com/maps/orbis/routing/calculateRoute/...` и `https://mock.convoy-mind.local/v1/parkings`.
Второго хоста не существует: без включённых моков (раздел 6) `planTrip` упадёт на парковках.

## 5. Реальный вывод (скопирован из теста, не написан от руки)

Вход:

```ts
{
  origin: { lat: 52.2297, lon: 21.0122 },      // Варшава
  destination: { lat: 50.1109, lon: 8.6821 },  // Франкфурт
  departureAt: '2026-09-07T06:00:00+02:00',
  vehicleWeightKg: 40000,
}
```

`status: 'ok'`:

Массив `route.points` сокращён: показаны первые 3 и последняя точки, полное число — в маркере ниже.
Всё остальное сверяется дословно тестом `__tests__/core/contract.test.ts` (он же генерирует `__tests__/screens/fixtures.ts`).

<!-- contract:ok points=181 head=3 tail=1 -->

```json
{
  "status": "ok",
  "departureAt": "2026-09-07T06:00:00+02:00",
  "arrivalAt": "2026-09-07T14:24:21.000Z",
  "drivingTimeSec": 32061,
  "stops": [
    {
      "parking": {
        "id": "mock-5fc8bd88-1",
        "name": "Mock parking 5FC8-1",
        "lat": 51.270353,
        "lon": 15.127847,
        "capacityTotal": 57,
        "freeAt": 27,
        "confidence": 0.6
      },
      "arrivalAt": "2026-09-07T08:11:15.000Z",
      "departAt": "2026-09-07T08:56:15.000Z",
      "pauseSec": 2700,
      "drivingSecFromPrev": 15075
    },
    {
      "parking": {
        "id": "mock-481aea79-1",
        "name": "Mock parking 481A-1",
        "lat": 50.257708,
        "lon": 9.424686,
        "capacityTotal": 38,
        "freeAt": 13,
        "confidence": 0.6
      },
      "arrivalAt": "2026-09-07T13:06:09.000Z",
      "departAt": "2026-09-07T13:51:09.000Z",
      "pauseSec": 2700,
      "drivingSecFromPrev": 14994
    }
  ],
  "requiresDailyRest": false,
  "route": {
    "points": [
      {
        "lat": 52.2297,
        "lon": 21.0122
      },
      {
        "lat": 52.218279,
        "lon": 20.942148
      },
      {
        "lat": 52.206858,
        "lon": 20.872096
      },
      {
        "lat": 50.1109,
        "lon": 8.6821
      }
    ]
  }
}
```

То же с `setMockScenario('all-full')`:

```json
{
  "status": "conflict",
  "conflict": {
    "code": "no-free-parking",
    "reason": "No free parking within 25 km of the planned break point (51.226587, 15.174708) at 2026-09-07T08:10:00.000Z.",
    "anchor": {
      "lat": 51.226587,
      "lon": 15.174708,
      "plannedArrivalAt": "2026-09-07T08:10:00.000Z",
      "drivenSecFromPrev": 15000,
      "drivenSecFromStart": 15000
    }
  }
}
```

### Пресеты для экрана (мок детерминирован, результат воспроизводим)

| Маршрут | Координаты | Результат |
|---|---|---|
| Варшава → Франкфурт | `52.2297, 21.0122` → `50.1109, 8.6821` | `ok`, 2 остановки, ≈ 8:54 вождения |
| Варшава → Лодзь | → `51.7592, 19.456` | `ok`, 0 остановок |
| Варшава → Париж | → `48.8566, 2.3522` | `ok`, 3 остановки, `requiresDailyRest: true` |
| Любой + `setMockScenario('all-full')` | | `conflict`, `no-free-parking`, без `nearestFreeParking` |

Выезд во всех пресетах `2026-09-07T06:00:00+02:00`, вес 40000. Ночной выезд (22–06 UTC) даёт занятость 85–100 % и может
дать конфликт без сценария.

## 6. Как включить моки в приложении

Файлы (уже есть):
- `msw.polyfills.js` (корень) — полифиллы; импортировать **до** `msw/native`. Три штуки:
  `fast-text-encoding` и `react-native-url-polyfill/auto` из официальной инструкции MSW,
  плюс `installMswDomPolyfills(globalThis)` и `installMswResponseBodyShim(globalThis)` из
  `src/core/mocks/domPolyfills.ts` — без первого на телефоне падает «Property 'MessageEvent' doesn't
  exist», без второго мок-ответ приходит с HTTP 200 и пустым телом (см. ниже).
- `src/core/mocks/native.ts` — `server` из `msw/native` с теми же handlers, что в тестах (TomTom + Parking-API).
- `src/core/mocks/scenario.ts` — `setMockScenario('all-full' | null)`, `getMockScenario()`.

Подключение — в `src/app/_layout.tsx` (корневой layout) раньше любого другого кода:

```ts
if (__DEV__) {
  require('../../msw.polyfills');
  const { server } = require('@/core/mocks/native');
  server.listen({ onUnhandledRequest: 'bypass' });
}
```

- `require` внутри блока, а не `import` наверху: `import` поднимается и ломает порядок «полифиллы → msw/native».
- **DOM-классы, которых нет в Hermes.** `msw` 2.15 требует их уже при загрузке модулей, до любого запроса:
  зависимость `rettime` объявляет `class TypedEvent extends MessageEvent`, а `msw/lib/core/ws` на верхнем
  уровне делает `new BroadcastChannel(...)` (его тянет любой `import { http } from 'msw'`). RN 0.86 ставит
  глобальные `Event`, `EventTarget`, `CustomEvent` (`react-native/src/private/setup/setUpDOM.js`), но
  `MessageEvent` и `BroadcastChannel` — нет. Это ставит `installMswDomPolyfills` (идемпотентна: на web,
  где оба класса есть, ничего не делает). Известная проблема msw в RN: https://github.com/mswjs/mswjs.io/issues/453.
- **Глобальный `Response` в RN не спецификационный.** Он из `whatwg-fetch`
  (`react-native/Libraries/Network/fetch.js`), построен на XMLHttpRequest, стримов не знает:
  `Response.prototype.body` не существует. Expo SDK 57 подменяет только глобальный `fetch`
  (`expo/src/winter/runtime.native.ts`), `Response` оставляет от RN. А `@mswjs/interceptors` собирает
  мок-ответ как `new FetchResponse(decompressResponse(raw) || raw.body, …)` — телом становится
  `undefined`, клиент получает 200 с пустой строкой и падает на `res.json()`
  («JSON Parse error: Unexpected end of input»). Это чинит `installMswResponseBodyShim`: геттер
  `.body` отдаёт инициализатор тела (строку/Blob/`null`), а не `ReadableStream`. Ставится только
  если геттера нет — на web no-op. Граница: шим перестанет работать, если появится handler,
  использующий `finalize` (стриминг/SSE) — подробности в JSDoc функции.
- Порядка «полифиллы в `_layout.tsx`» достаточно, потому что **ни один модуль маршрута не тянет `msw` на
  верхнем уровне**: `@/core/index.ts` моки не экспортирует, `scenario.ts` вообще без импортов, а
  `mocks/{handlers,server,native}.ts` вне `mocks/` никто не импортирует, кроме `_layout.tsx`
  (проверено grep 2026-09-06). Если это перестанет быть правдой — Expo Router вычисляет модули маршрутов
  при старте, и полифиллы придётся вынести в entry-шим перед `expo-router/entry`.
- `onUnhandledRequest: 'bypass'` — запросы Metro/Expo мимо handlers проходят как есть (в Jest стоит `'error'`).
  Допустимые значения `'bypass' | 'warn' | 'error'` — проверено по типам msw 2.15.0.
- Dev-переключатели сценариев из `@/core/mocks/scenario`, сброс — `setMockScenario(null)`:
  - `setMockScenario('all-full')` — все парковки заняты (`freeAt: 0`), `planTrip` даёт `conflict`;
  - `setMockScenario('live')` — занятость дрейфует по минутным слотам реального времени (фаза 3).
    Внутри одной минуты ответ тот же, между минутами — другой; меняется **только** `freeAt`,
    `id`, координаты, ёмкость и `confidence` те же. Нужен, чтобы на карте было видно обновление
    статусов по таймеру. Замер на маршруте Варшава → Франкфурт: за минуту `freeAt` меняется у ~40
    парковок из 45, `status` — у 3–9.
- Экран 3 перезапрашивает коридор раз в `MAP_REFRESH_MS = 30_000` мс (`src/app/result.tsx`) и подписывает
  «обновлено HH:MM:SS». Со сценарием `'live'` два обновления внутри одной минуты дают одинаковый ответ,
  а на переходе через минуту цвета маркеров меняются — это не баг, а длина слота `MOCK_LIVE_TICK_MS`.
- Оба dev-переключателя на экране 1 взаимоисключающие: сценарий в моке один (`MockScenario | null`).
- Ключ: файл `.env` в корне (в `.gitignore`) со строкой `EXPO_PUBLIC_TOMTOM_KEY=...`. С моками подходит любое непустое значение:
  мок проверяет только наличие. Без ключа `planTrip` бросает ошибку до сети. Шаблон — `.env.example` (в git).
- Рецепт проверен 2026-09-05 на web (`expo start --web`, Chrome): перехват работает, в консоли Metro `[msw] GET …/parkings`.
  Metro при этом пишет WARN «Falling back to file-based resolution» для `msw/native` и `@mswjs/interceptors/*` — ожидаемо
  (см. `DECISIONS.md`).
- `[подтверждено владельцем]` **Сквозной сценарий в Expo Go проходит (2026-09-06).** Не `[проверено]`:
  запускал и смотрел владелец, у агента симуляторов нет.
  Хронология того дня: первый запуск упал на `Property 'MessageEvent' doesn't exist`; второй — на
  `JSON Parse error: Unexpected end of input`; после обоих фиксов владелец сообщил, что приложение
  работает. Поэлементно (полилиния, маркеры, `fitToCoordinates`, callout, таймер) не сверялось.
  Регрессию этого стыка ловит `node scripts/msw-native-repro.cjs`: глобалы whatwg-fetch, резолв msw
  с условием `react-native`, вариант `bare` обязан воспроизвести ошибку, `fixed` — пройти.
  Запускать после апгрейда `msw`, `@mswjs/interceptors`, `expo` или `react-native`.

## 7. Чего не делать при работе над экранами

- Не менять `src/core/**` из экранов. Если контракта не хватает — вопрос владельцу и строка в `docs/DECISIONS.md`.
  (Ядро правится своими шагами: в фазе 2 это был `onProgress`, в фазе 3 — `route.points` и `corridor.ts`.)
- Не импортировать моки через `@/core` — их там нет намеренно (msw не должен попасть в прод-бандл).
- Не считать нормы AETR на экране — всё уже в `PlanResult`.
- Экраны кладутся в `src/app/`, не в `app/`: `PHASE2_APP.md` в этом месте устарел (см. `DECISIONS.md`).

## 8. Ограничения MVP, важные для экрана (полный список — `docs/NOT_NOW.md`)

- Один рабочий день: при вождении ≥ 9:00 только флаг, суточный отдых не планируется.
- Одна итерация «парковка занята → другая».
- Парковки — мок **всегда**, даже при `EXPO_PUBLIC_TOMTOM_LIVE=1`: имена `Mock parking XXXX-n`, позиции детерминированы по ячейкам сетки 0.3° (свойство географии, не запроса). Реального API парковок не существует.
- Только координаты, без геокодинга адресов — на экране пресеты.
- Карта (фаза 3) показывает парковки только вдоль маршрута, коридором ±15 км; съезды и время до парковки не считаются.
- **Карта работает только на iOS/Android.** `react-native-maps` не совместим с `react-native-web`
  (`Marker`/`Polyline` импортируют `codegenNativeComponent`, которого в `react-native-web` нет) и роняет
  весь web-бандл, а не только карту. Поэтому пакет импортируется единственным файлом `src/ui/routeMap.tsx`,
  рядом лежит `src/ui/routeMap.web.tsx` — те же данные списком, без пакета; Metro подставляет `.web` сам.
  Экран `src/app/result.tsx` пакет не импортирует. Не переносить импорт `react-native-maps` в экран.
- Показания тахографа на входе не принимаются: водитель считается выехавшим после отдыха.

## 9. Константы (для подписей на экране)

| Константа | Где | Значение |
|---|---|---|
| `BREAK_SEC` | `planner/aetr.ts` | 2700 (45 мин) |
| `MAX_CONTINUOUS_DRIVING_SEC` | `planner/aetr.ts` | 16200 (4:30) |
| `MAX_DAILY_DRIVING_SEC` | `planner/aetr.ts` | 32400 (9:00) |
| `BREAK_LOOKAHEAD_MIN` | `planner/breaks.ts` | 20 |
| `PARKING_SEARCH_RADIUS_KM` | `planner/schedule.ts` | 25 |
| `CONFLICT_SEARCH_RADIUS_KM` | `planner/schedule.ts` | 50 |
| `MAX_ARRIVAL_SHIFT_SEC` | `planner/schedule.ts` | 1800 (30 мин) |
| `CORRIDOR_RADIUS_KM` | `planner/corridor.ts` | 15 (экспортируется из `@/core`) |
| `CORRIDOR_STEP_KM` | `planner/corridor.ts` | 25 (экспортируется из `@/core`) |
| `MOCK_LIVE_TICK_MS` | `mocks/parkingGenerator.ts` | 60 000 — длина слота дрейфа в сценарии `'live'` |
| `MOCK_LIVE_AMPLITUDE` | `mocks/parkingGenerator.ts` | 0.35 доли ёмкости |
| `MAP_REFRESH_MS` | `src/app/result.tsx` (экран, не ядро) | 30 000 — период опроса коридора на карте |

Из `@/core` экспортируются только `CORRIDOR_RADIUS_KM` и `CORRIDOR_STEP_KM` (экран передаёт их в `getParkingsAlongRoute` или полагается на дефолты). Остальные — внутренние: длительность паузы есть в `stop.pauseSec`. Если экрану нужны другие — сказать, добавим в `index.ts`.

## 10. Реальный TomTom (фаза 3, шаг 4) — opt-in

Включается **только** точным `EXPO_PUBLIC_TOMTOM_LIVE=1` в `.env` (шаблон — `.env.example` в git; `'0'`, `'true'`,
`'yes'`, пустое значение и отсутствие переменной оставляют мок). При `1` TomTom-handler не регистрируется в
`mocks/native.ts`, и запрос уходит в настоящий API — MSW в приложении поднят с `onUnhandledRequest: 'bypass'`.
Parking-API мокается всегда. На тесты флаг не влияет: `jest.setup.ts` и `mocks/server.ts` его не читают.

Флаг читается один раз при импорте `mocks/native.ts`, то есть при старте приложения — переключение на лету не
предусмотрено, только перезапуск.

Что меняется в данных по сравнению с моком (`[предположение]`, пока живой вызов не сделан):

| | Мок | Реальный TomTom |
|---|---|---|
| Геометрия | прямые между локациями, точка каждые 5 км (Варшава → Франкфурт — 181 точка) | по дорогам, точки плотные — точек станет заметно больше |
| Скорость | ровно 100 км/ч | переменная, с трафиком (`traffic=live` уже в запросе) |
| Даты | ISO UTC (`…Z`) | с оффсетом точки отправления. Сравнивать через `Date.parse`, не по строке |
| Ошибки | 400/403 нашего формата | коды и тело TomTom; ядро смотрит только на `res.ok` и бросает `TomTom calculateRoute: HTTP <код>` |
| Лимиты | нет | `[предположение]` бесплатный тариф Routing API — «Free 20K monthly» по https://docs.tomtom.com/pricing (2026-09-06), вторым источником не подтверждено. `planTrip` делает 1–2 вызова на расчёт |

На ядро это не влияет: вождение считается по `legs[].summary.travelTimeInSeconds`, ETA берётся из
`summary.arrivalTime`, геометрия — из `legs[].points[]`. Плотнее точки — точнее якоря и полилиния на карте.
Число запросов `getParkingsAlongRoute` вырастет пропорционально длине маршрута по дорогам (она больше прямой).
