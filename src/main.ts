// Catalog landing page: example cards with descriptions and a live EN/DE
// language toggle. The toggle writes ?lang= to the URL (shareable) and
// re-applies the translations in place.
import '@projektemacher/tify-plugin-core/style.css';
import {
  applyStaticTranslations,
  createTranslator,
  type PluginLanguage,
} from '@projektemacher/tify-plugin-core';

const DE = (
  (await import('./i18n/translations/de.json')) as unknown as {
    default: Record<string, string>;
  }
).default;

async function apply(lang: PluginLanguage): Promise<void> {
  // createTranslator detects the language from ?lang= (kept in sync by the
  // toggle), then the browser default.
  const { t } = await createTranslator(undefined, { de: DE });
  applyStaticTranslations(t, lang);
  document.documentElement.lang = lang;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.lang-btn')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
}

function currentLang(): PluginLanguage {
  const param = new URLSearchParams(window.location.search).get('lang');
  if (param?.toLowerCase().startsWith('de')) return 'de';
  if (param && /^[a-z]{2}/i.test(param)) return 'en';
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

let lang = currentLang();

for (const button of document.querySelectorAll<HTMLButtonElement>('.lang-btn')) {
  button.addEventListener('click', () => {
    const next = button.dataset.lang as PluginLanguage | undefined;
    if (!next || next === lang) return;
    lang = next;
    const url = new URL(window.location.href);
    url.searchParams.set('lang', lang);
    window.history.replaceState({}, '', url);
    void apply(lang);
  });
}

await apply(lang);
