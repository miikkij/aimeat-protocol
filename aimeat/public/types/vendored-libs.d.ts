/**
 * @file vendored-libs.d.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Type stubs for the vendored, minified ESM libraries the frontend imports by bare
 *   specifier (preact, preact/hooks, htm). The browser resolves these via the importmap to
 *   public/lib/*.mjs at runtime; this stub exists only so `tsc --noEmit` (checkJs) resolves the
 *   imports without trying to type-check minified third-party bundles. Exports are intentionally
 *   loose (`any`) — htm template rendering is untyped regardless, so precise framework types add
 *   little here. tsconfig.frontend.json maps the bare specifiers to this file via "paths".
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial stubs for preact / preact/hooks / htm
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module 'preact' {
  export const h: any;
  export const Fragment: any;
  export const render: any;
  export const hydrate: any;
  export const cloneElement: any;
  export const createContext: any;
  export const createRef: any;
  export const isValidElement: any;
  export const toChildArray: any;
  export const options: any;
  export class Component {
    constructor(props?: any, context?: any);
    setState(state?: any, callback?: () => void): void;
    forceUpdate(callback?: () => void): void;
    render(props?: any, state?: any, context?: any): any;
    props: any;
    state: any;
    context: any;
    base?: any;
  }
  const preact: any;
  export default preact;
}

declare module 'preact/hooks' {
  export const useState: any;
  export const useEffect: any;
  export const useLayoutEffect: any;
  export const useRef: any;
  export const useCallback: any;
  export const useMemo: any;
  export const useReducer: any;
  export const useContext: any;
  export const useErrorBoundary: any;
  export const useId: any;
}

declare module 'htm' {
  const htm: any;
  export default htm;
}
