import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import '@projektemacher/tify-plugin-core/demo.css';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import Tify from 'tify';
import {
  COOKBOOK_MANIFEST,
  TIFY_TRANSLATIONS_URL,
  applyStaticTranslations,
  createTranslator,
  setFeatureWarnings,
} from '@projektemacher/tify-plugin-core';
import { infoPanelPlugin } from '@projektemacher/tify-plugin-core';
import type { TifyPlugin } from '@projektemacher/tify-plugin-core';

// Syntax-highlight the static code example below the viewer.
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.highlightAll();

const de = (
  (await import('../src/i18n/translations/de.json')) as unknown as {
    default: Record<string, string>;
  }
).default;
const { lang, t } = await createTranslator(undefined, { de });
applyStaticTranslations(t, lang);

const params = new URLSearchParams(window.location.search);
// The panel example loads no feature plugins, so the console warns about
// every manifest feature. ?warnings=0 silences that (hosts can call
// setFeatureWarnings(false) themselves).
if (params.get('warnings') === '0') setFeatureWarnings(false);
const input = document.querySelector('#manifest') as HTMLInputElement;
input.value = params.get('manifest') ?? COOKBOOK_MANIFEST;

let tify: Tify | null = null;
let plugin: TifyPlugin | null = null;

async function load(manifestUrl: string): Promise<void> {
  plugin?.destroy();
  plugin = null;
  tify?.destroy();
  document.querySelector('#tify')!.innerHTML = '';
  tify = new Tify({
    container: '#tify',
    manifestUrl,
    translationsDirUrl: TIFY_TRANSLATIONS_URL,
  });
  try {
    await tify.ready;
    plugin = await infoPanelPlugin(tify, {
      panelEl: document.querySelector('#panel') as HTMLElement,
    });
  } catch (error) {
    console.error(error);
  }
}

document.querySelector('#load')?.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return;
  const next = new URL(window.location.href);
  next.searchParams.set('manifest', url);
  window.history.replaceState({}, '', next);
  void load(url);
});

void load(input.value);
