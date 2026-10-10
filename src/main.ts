// Catalog landing page: translate static chrome, links are static.
// No top-level await here: the build target predates it, so boot async.
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';

void import('./i18n/translations/de.json').then((module) =>
  createTranslator(undefined, {
    de: (module as unknown as { default: Record<string, string> }).default,
  }).then(({ lang, t }) => {
    applyStaticTranslations(t, lang);
  }),
);
