import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Для Jest. Жизненный цикл (listen/resetHandlers/close) — в jest.setup.ts.
export const server = setupServer(...handlers);
