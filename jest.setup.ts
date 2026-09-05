import { setMockScenario } from './src/core/mocks/scenario';
import { server } from './src/core/mocks/server';

// Ключ TomTom в тестах — фиктивный; реальный API из тестов не вызывается.
process.env.EXPO_PUBLIC_TOMTOM_KEY = 'test-key';

// Любой запрос мимо MSW — ошибка: доказывает, что весь сетевой слой идёт через моки.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  setMockScenario(null);
});
afterAll(() => server.close());
