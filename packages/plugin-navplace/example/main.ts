import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import '@projektemacher/tify-plugin-core/demo.css';
import '@projektemacher/tify-plugin-navplace/navplace.css';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import Tify from 'tify';
import {
  TIFY_TRANSLATIONS_URL,
  applyStaticTranslations,
  createTranslator,
} from '@projektemacher/tify-plugin-core';
import { navPlacePlugin } from '@projektemacher/tify-plugin-navplace';
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
const input = document.querySelector('#manifest') as HTMLInputElement;
// Live navPlace demo (public/demo/navplace/): cookbook-style manifest with a
// navPlace FeatureCollection. import.meta.env.BASE_URL keeps this working
// under the GitHub Pages sub-path as well as localhost.
const demoUrl = new URL(
  `${import.meta.env.BASE_URL}demo/navplace/manifest.json`,
  window.location.origin,
).toString();
input.value = params.get('manifest') ?? demoUrl;
// Optional basemap override (?style=<maplibre style url>), passed straight
// through to the plugin.
const styleOverride = params.get('style') ?? undefined;

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
    plugin = await navPlacePlugin(tify, {
      panelEl: document.querySelector('#panel') as HTMLElement,
      style: styleOverride,
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
