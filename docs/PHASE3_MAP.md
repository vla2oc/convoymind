# Фаза 3 — Карта маршрута и живые парковки

Ты работаешь по `CLAUDE.md` в корне репозитория. Он важнее этого документа.
Первым делом прочитай `STATE.md`, `DECISIONS.md`, `NOT_NOW.md`, `docs/API_CONTRACT.md` и перескажи состояние в 5 строках. Не начинай, пока пользователь не подтвердил.

## Контекст (зачем фаза)

Проверено 2026-09-05 по коду: в рантайме не используется **ни одно реальное API**. Клиент TomTom (`src/core/api/tomtom.ts`) бьёт по настоящему URL с параметрами из документации, но и в Jest, и в приложении (рецепт `API_CONTRACT.md` § 6) его перехватывает MSW и отвечает генератор `src/core/mocks/routeGenerator.ts` — прямые линии между городами, 100 км/ч. Реальный TomTom не вызывался ни разу, ключа в `.env` нет. API парковок не существует вовсе: хост `mock.convoy-mind.local` выдуман, всё генерирует мок по сетке (`src/core/mocks/parkingGenerator.ts`).

Якорь (`src/core/planner/breaks.ts`) — точка маршрута, где накапливается 4:10 непрерывного вождения, плюс *плановое* время приезда. Парковки запрашиваются на это время (`at = plannedArrivalAt`) — это **прогноз занятости на момент приезда**, а не «сейчас»; поле `confidence` (0.6 прогноз / 0.9 в пределах часа) это и отражает. Динамика = периодически переспрашивать те же парковки (их `id` стабильны после исправления аудита) с актуальным `at`, показывать свободно/занято и предупреждать, если выбранная стала занятой. Мок сейчас меняет занятость только день/ночь, поэтому для «живой» карты ему нужен дрейф во времени — иначе на экране ничего не изменится.

## Что делаем

Экран 3 становится картой: сверху карточка-ответ (как в `PHASE2_APP.md`), ниже карта на весь экран с проложенным маршрутом и парковками вдоль него — свободными, занятыми и выбранными как остановки. Статус парковок обновляется по таймеру. Реальный TomTom включается по ключу (opt-in), без ключа и в тестах — мок.

Решения, подтверждённые пользователем 2026-09-05:
- **Реальный TomTom — opt-in по ключу.** Есть `EXPO_PUBLIC_TOMTOM_KEY` и `EXPO_PUBLIC_TOMTOM_LIVE=1` в `.env` → приложение ходит в настоящий API; иначе мок. Причина: прямая линия мока через пол-Европы на карте выглядит фальшиво.
- **Динамика — polling + мок-сценарий `'live'`.** Экран переспрашивает парковки раз в 30 с; сценарий `'live'` добавляет в мок дрейф занятости по минутным слотам, выключен по умолчанию — тесты фазы 1 и JSON в контракте не меняются. Автоперепланирование от текущей позиции — нет (`NOT_NOW.md`).
- **Карта — вместо ленты.** Лента из `PHASE2_APP.md` (экран 3) не строится; остановки — выделенные маркеры с callout.

**Порядок.** Часть 3a (ядро) не зависит от экранов — её можно делать **до фазы 2**. Тогда экран 3 в фазе 2 строится сразу как карта (шаги 6–8 ниже вместо шагов 5–6 `PHASE2_APP.md`), и лента не делается впустую. Правка `PHASE2_APP.md` (шаги 5–6 и путь `src/app/` вместо `app/`) — за владельцем.

## Критерий «работает» (формулируем до кода)

Часть 3a: `npm test` зелёный, существующие тесты не менялись (кроме добавления поля `route` в ожидания), плюс:
1. `planTrip` для Варшава → Франкфурт возвращает `route.points` (первая точка = origin, последняя = destination, ≥ 100 точек).
2. `getParkingsAlongRoute` через MSW делает ⌈длина / 25 км⌉ запросов parking-API, возвращает парковки без дублей, отсортированные по прогрессу вдоль маршрута, с `status` из `freeAt` и `chosen` для остановок из `stops`.
3. При `setMockScenario('live')` два запроса с `now` из разных минутных слотов дают разный `freeAt`; без сценария — вывод как раньше.
4. JSON в `API_CONTRACT.md` § 5 равен реальному выводу `planTrip` (проверка скриптом).

Часть 3b: в Expo Go для Варшава → Франкфурт экран 3 показывает карточку «Прибытие … · 2 перерыва · По норме», полилинию маршрута, ≥ 10 маркеров парковок, 2 выделенных; со сценарием `'live'` через минуту цвет хотя бы одного маркера меняется; со сценарием «все заняты» — красная карточка и маркер якоря. С реальным ключом и `EXPO_PUBLIC_TOMTOM_LIVE=1` полилиния идёт по дорогам.

## Стек (не расширять)

- `react-native-maps` — единственный новый пакет. `[проверено: docs.expo.dev, 2026-09-05]` «No additional setup is required when testing your project using Expo Go»; ставить `npx expo install react-native-maps`, версию — ту, что встанет. Ключ Google Maps нужен только для публикации на Android.
- `expo-maps` — **нет**: alpha, «not available in the Expo Go app».
- Компоненты `Polyline`, `Marker` и метод `fitToCoordinates` — `[предположение]`, проверить в `node_modules/react-native-maps` после установки, не по памяти.
- Тесты экрана — `@testing-library/react-native` (стек фазы 2); `react-native-maps` в Jest мокается заглушкой через `jest.mock`.

## Структура (новое и изменяемое)

```
src/core/
  planner/schedule.ts      # + PlanResult.route.points
  planner/corridor.ts      # getParkingsAlongRoute(), RoutedParking
  mocks/scenario.ts        # MockScenario = 'all-full' | 'live'
  mocks/parkingGenerator.ts# дрейф занятости при 'live'
  mocks/handlers.ts        # именованные экспорты handlers (для фильтра в native.ts)
  mocks/native.ts          # без TomTom-handler при EXPO_PUBLIC_TOMTOM_LIVE=1
  index.ts                 # + getParkingsAlongRoute, RoutedParking
src/app/result.tsx         # экран 3 = карточка + карта
__tests__/core/corridor.test.ts
__tests__/app/result.test.tsx
.env.example
docs/API_CONTRACT.md       # новые поля, функция, сценарий, переменные окружения
```

Правило фазы 1 остаётся: `src/core` не импортирует `react`, `react-native`, `expo-*` (тест `no-react-in-core.test.ts`).

## Шаги (один за раз, каждый — диф + команда проверки + реальный вывод + `STATE.md`)

### Часть 3a — ядро (без UI, тесты через MSW)

**Шаг 1. Геометрия в результате.** `src/core/planner/schedule.ts`: в ветку `ok` `PlanResult` добавить `route: { points: GeoPoint[] }` — конкатенация `legs[].points` последнего вызова TomTom (`routePoints()` уже есть). Тест в `schedule.test.ts`: первая точка = origin, последняя = destination, ≥ 100 точек. Обновить JSON в `API_CONTRACT.md` § 5 из реального вывода (массив точек в примере сократить с пометкой).

**Шаг 2. Парковки вдоль маршрута.** Новый `src/core/planner/corridor.ts`:
`getParkingsAlongRoute({ points, departureAt, drivingTimeSec, stops, corridorKm = 15, stepKm = 25 })` — идёт по полилинии, каждые `stepKm` (константы `// MVP: hardcoded, see NOT_NOW.md`) вызывает `getParkingsNear(точка, corridorKm, at = ETA в этой точке по пропорции расстояния)`, дедуп по `id`, сортировка по прогрессу вдоль маршрута. Возвращает `RoutedParking = Parking & { routeProgressM, etaAt, status: 'free' | 'full', chosen: boolean }` (`chosen` — `id` есть в `stops`). Экспорт из `index.ts`. Тесты через MSW (`recordRequests` из `__tests__/core/helpers.ts`): число запросов, дедуп, порядок, `chosen`, `status`.

**Шаг 3. Мок-сценарий `'live'`.** `scenario.ts`: `MockScenario = 'all-full' | 'live'`. `parkingGenerator.ts`: при `live` к `occupied` добавляется детерминированный дрейф `±MOCK_LIVE_AMPLITUDE` (доля ёмкости, MVP-константа), seed от `(id, floor(now / MOCK_LIVE_TICK_MS))`, `MOCK_LIVE_TICK_MS = 60_000`; `freeAt` в `[0, capacityTotal]`. Handler передаёт `now` как сейчас. Тесты в `parking.test.ts`: без сценария — существующие тесты не трогать; при `live` разные слоты `now` → разный `freeAt`, один слот → одинаковый.

**Шаг 4. Реальный TomTom opt-in.** `handlers.ts` — экспортировать handlers по имени; `native.ts` — при `process.env.EXPO_PUBLIC_TOMTOM_LIVE === '1'` регистрировать все handlers, кроме TomTom (MSW стоит с `onUnhandledRequest: 'bypass'`, запрос уходит в настоящий API). `.env.example` в git с `EXPO_PUBLIC_TOMTOM_KEY=` и `EXPO_PUBLIC_TOMTOM_LIVE=0` и комментарием. Jest (`server.ts`) не трогать. Тарифы TomTom — `[предположение]` есть бесплатная квота; проверить на странице тарифов до включения, записать в `DECISIONS.md`. Ручная проверка — на шаге 6 в Expo Go.

**Шаг 5. Контракт и документы.** `docs/API_CONTRACT.md`: поле `route`, `getParkingsAlongRoute` и `RoutedParking`, сценарий `'live'`, переменные окружения, что реальный TomTom меняет (плотные точки, даты с оффсетом, ошибки/лимиты). `STATE.md`, `DECISIONS.md`, `NOT_NOW.md`.

### Часть 3b — экран 3 как карта (в фазе 2 вместо шагов 5–6 или после неё)

**Шаг 6. Карта.** `npx expo install react-native-maps`. `src/app/result.tsx`: сверху карточка-ответ (`ok`: «Прибытие HH:MM · Вождение H:MM · N перерывов · По норме»; `conflict`: красная, `reason`, кнопки «Выехать раньше» / «Другая парковка» как в `PHASE2_APP.md`); ниже `MapView` на весь экран, `fitToCoordinates` по маршруту, `Polyline` из `result.route.points`, `Marker` на каждую `RoutedParking`: зелёный `free`, красный `full`, выделенный `chosen` с callout «название · свободно N из M · приезд HH:MM · перерыв 45 мин · вождение от предыдущей H:MM». Старт и финиш — свои маркеры. При `conflict` — маркер якоря и `nearestFreeParking`, если есть. Проверка: Expo Go, весь маршрут в кадре, маркеры видны.

**Шаг 7. Динамика.** Таймер `MAP_REFRESH_MS = 30_000` (константа) → `getParkingsAlongRoute` заново → цвета обновляются; подпись «обновлено HH:MM:SS». Dev-переключатель «Мок: live» (`setMockScenario('live')`) рядом с «все заняты» (только в `__DEV__`). Если `chosen` стала `full` — красная плашка «Выбранная парковка занята» и кнопка «Перепланировать» → `planTrip` с тем же входом (честно пометить в `DECISIONS.md`: перепланирование от старта, не от текущей позиции). Проверка: Expo Go, с `live` за минуту меняется хотя бы один маркер.

**Шаг 8. Тесты экрана и отчёт.** Второй Jest-проект `jest-expo/ios` в `jest.config.js` (`projects`) для `__tests__/app/**`. `__tests__/app/result.test.tsx` с `jest.mock('react-native-maps')`: рендер с фикстурой `PlanResult` из контракта показывает карточку с ETA и N маркеров с нужными цветами, 2 выделенных; конфликт — красная карточка; `jest.useFakeTimers` → повторный запрос через MSW (`recordRequests`). Отчёт в `STATE.md`: вывод `npm test`, список оставшихся `[предположение]`.

## Что НЕ делать

Автоперепланирование от текущей GPS-позиции, показания тахографа, реальный API парковок, `expo-maps`, пуши, сохранение поездок — всё уже в `NOT_NOW.md`, не спорить второй раз.
