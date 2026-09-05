import { server } from '../../src/core/mocks/server';

/** Записывает все запросы, ушедшие в MSW (клоны, чтобы тело можно было читать). */
export function recordRequests() {
  const requests: Request[] = [];
  const listener = (event: { request: Request }) => {
    requests.push(event.request.clone());
  };
  server.events.on('request:start', listener);
  return { requests, stop: () => server.events.removeListener('request:start', listener) };
}
