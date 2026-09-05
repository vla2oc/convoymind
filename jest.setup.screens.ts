// Setup проекта `screens` (jest-expo/ios). Тот же MSW, что и в ядре: planTrip ходит через моки, не через jest.mock.
import { setMockScenario } from './src/core/mocks/scenario';
import { server } from './src/core/mocks/server';

process.env.EXPO_PUBLIC_TOMTOM_KEY = 'test-key';

// react-native-maps в тестовом окружении падает на TurboModuleRegistry.getEnforcing('RNMapsAirModule') —
// нативного модуля нет. Мок один на все тесты экранов, см. __tests__/screens/maps-mock.tsx.
jest.mock('react-native-maps', () => require('./__tests__/screens/maps-mock'));
afterEach(() => require('./__tests__/screens/maps-mock').resetMapsMock());

// jest-expo подключает expo/src/winter, который подменяет fetch на expo/fetch (в Jest — заглушка без нативного модуля).
// installGlobal в __DEV__ сохраняет оригинал как `original<name>` (имя без капитализации — см. expo/src/winter/installGlobal.ts).
const g = globalThis as unknown as { fetch: typeof fetch; originalfetch?: typeof fetch };
if (typeof g.originalfetch !== 'function') {
  throw new Error('jest.setup.screens: expected globalThis.originalfetch (Node fetch backed up by expo installGlobal)');
}
g.fetch = g.originalfetch;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setMockScenario(null);
});
afterAll(() => server.close());
