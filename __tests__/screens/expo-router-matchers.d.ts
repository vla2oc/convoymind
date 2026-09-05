// expo-router/testing-library расширяет expect (build/testing-library/expect.js), но не поставляет типы.
// Объявляем то, что определено там: toHavePathname, toHavePathnameWithParams, toHaveSegments, toHaveSearchParams, toHaveRouterState.
declare namespace jest {
  interface Matchers<R> {
    toHavePathname(expected: string): R;
    toHavePathnameWithParams(expected: string): R;
    toHaveSegments(expected: string[]): R;
    toHaveSearchParams(expected: Record<string, string | string[]>): R;
    toHaveRouterState(expected: unknown): R;
  }
}
