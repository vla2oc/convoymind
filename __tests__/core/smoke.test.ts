import { http, HttpResponse } from 'msw';
import { server } from '../../src/core/mocks/server';

// Дымовой тест сетевого слоя: реальный fetch перехватывается MSW.
test('fetch перехватывается MSW и возвращает {ok:true}', async () => {
  server.use(http.get('https://example.test/ping', () => HttpResponse.json({ ok: true })));

  const res = await fetch('https://example.test/ping');

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ ok: true });
});

test('запрос мимо handlers падает (onUnhandledRequest: error)', async () => {
  // MSW печатает ошибку в console.error перед тем, как уронить запрос — глушим и проверяем.
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  await expect(fetch('https://example.test/unhandled')).rejects.toThrow();
  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('without a matching request handler'));

  consoleError.mockRestore();
});
