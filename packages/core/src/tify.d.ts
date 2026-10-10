// Minimal ambient types for the `tify` package, which ships no TypeScript
// declarations (main: dist/tify.js). Covers the documented surface from
// https://github.com/tify-iiif-viewer/tify/blob/main/doc/api.md plus the
// internals plugins legitimately touch (options, viewer, app).

declare module 'tify' {
  export interface TifyConstructorOptions {
    container?: string | HTMLElement | null;
    manifestUrl?: string | null;
    translationsDirUrl?: string | null;
    language?: string;
    view?: string | null;
    views?: string[];
    viewer?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export default class Tify {
    constructor(options?: TifyConstructorOptions);
    /** Fulfilled once mounted and the manifest has loaded. */
    ready: Promise<void>;
    /** Merged constructor options (live). */
    options: Record<string, any>;
    /** OpenSeadragon viewer, exposed after mount (full OSD API). */
    viewer: any;
    /** Underlying Vue app instance. */
    app: any;
    mount(container: string | HTMLElement): void;
    destroy(): void;
    setPage(pageOrPages: number | number[]): unknown;
    setLanguage(language: string): Promise<unknown>;
    setView(name: string | null): unknown;
    toggleDoublePage(forced?: boolean): unknown;
    toggleFullscreen(forced?: boolean): void;
    resetImage(...args: unknown[]): void;
    resetScan(...args: unknown[]): void;
    [key: string]: any;
  }
}

declare module 'tify/dist/tify.css';
