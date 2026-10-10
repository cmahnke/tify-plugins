// Plugin i18n, aligned with TIFY's own conventions
// (https://github.com/tify-iiif-viewer/tify/blob/main/src/plugins/i18n.js):
//
// - Keys are static English source strings; English needs no catalogue.
// - Lookup precedence mirrors TIFY: per-instance
//   `tify.options.translations[lang][key]` override → language catalogue →
//   English key with `[bracket hints]` stripped.
// - Language follows `tify.options.language` (so `tify.setLanguage()` switches
//   our UI too), then `?lang=`, then the browser language.
// - One deliberate deviation: `{placeholder}` interpolation for counts, URLs
//   and signer names. Keys stay static and single-line so the coverage script
//   (`npm run test:i18n`) can scan them like TIFY's `build/i18n.js` does.
// - Every workspace owns its catalogue: `src/i18n/translations/{lang}.json`
//   (`$language` first, keys sorted), lazily imported next to the caller and
//   passed to createTranslator() — core itself bundles no UI strings.
import type Tify from 'tify';

export type PluginLanguage = 'de' | 'en';

export type TranslateVars = Record<string, string | number>;

export type TranslateFn = (key: string, vars?: TranslateVars) => string;

export interface Translator {
  lang: PluginLanguage;
  t: TranslateFn;
}

/** Per-language catalogues owned by the calling package. */
export type Catalogues = Partial<Record<PluginLanguage, Record<string, string>>>;

/** TIFY convention: `[...]` hints are translator aids, stripped in fallback. */
export function stripHints(english: string): string {
  return english.replace(/\s*\[.+?\]/g, '');
}

function substitute(template: string, vars: TranslateVars): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}

export function detectLanguage(tify?: Tify | null): PluginLanguage {
  const query = new URLSearchParams(window.location.search).get('lang');
  if (query?.toLowerCase().startsWith('de')) return 'de';
  if (query && /^[a-z]{2}/i.test(query)) return 'en';
  const option = (tify?.options?.language as string | undefined)?.toLowerCase();
  if (option?.startsWith('de')) return 'de';
  if (option && option !== 'en') return 'en';
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de')) {
    return 'de';
  }
  return 'en';
}

export async function createTranslator(
  tify?: Tify | null,
  catalogues: Catalogues = {},
): Promise<Translator> {
  const lang = detectLanguage(tify);
  const catalogue = catalogues[lang] ?? {};
  const t: TranslateFn = (key, vars = {}) => {
    const overrides = tify?.options?.translations as
      Record<string, Record<string, string>> | undefined;
    const template = overrides?.[lang]?.[key] ?? catalogue[key] ?? stripHints(key);
    if (import.meta.env.DEV && lang !== 'en' && !(key in catalogue) && !overrides?.[lang]?.[key]) {
      console.warn(`[tify-plugins] Missing translation for "${key}"`);
    }
    return substitute(template, vars);
  };
  return { lang, t };
}

/**
 * Translate static example chrome: the data-i18n attribute swaps text content,
 * data-i18n-aria swaps aria-label. Also sets `<html lang>`.
 */
export function applyStaticTranslations(t: TranslateFn, lang: PluginLanguage): void {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n');
    if (key) element.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    const key = element.getAttribute('data-i18n-aria');
    if (key) element.setAttribute('aria-label', t(key));
  });
}
