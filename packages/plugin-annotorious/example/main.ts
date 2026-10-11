import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import '@annotorious/openseadragon/annotorious-openseadragon.css';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import Tify from 'tify';
import { TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';
import { annotoriousPlugin, type AnnotoriousPlugin } from '@projektemacher/tify-plugin-annotorious';

// Syntax-highlight the static code example below the viewer.
hljs.registerLanguage('typescript', typescript);
hljs.highlightAll();

export const DEFAULT_ANNOTATED_MANIFEST =
  'https://iiif.io/api/cookbook/recipe/0021-tagging/manifest.json';

const params = new URLSearchParams(window.location.search);
const de = (
  (await import('../src/i18n/translations/de.json')) as unknown as {
    default: Record<string, string>;
  }
).default;
const { lang, t } = await createTranslator(undefined, { de });
applyStaticTranslations(t, lang);
const input = document.querySelector('#manifest') as HTMLInputElement;
const presetSelect = document.querySelector('#manifest-preset') as HTMLSelectElement;
const presetUrls = Array.from(presetSelect.options)
  .map((option) => option.value)
  .filter((value) => value !== '');
const initial = params.get('manifest') ?? DEFAULT_ANNOTATED_MANIFEST;
input.value = initial;
presetSelect.value = presetUrls.includes(initial) ? initial : '';

let tify: Tify | null = null;
let plugin: AnnotoriousPlugin | null = null;

async function load(manifestUrl: string): Promise<void> {
  plugin?.destroy();
  plugin = null;
  tify?.destroy();
  document.querySelector('#tify')!.innerHTML = '';
  (document.querySelector('#panel') as HTMLElement).innerHTML = '';
  tify = new Tify({
    container: '#tify',
    manifestUrl,
    translationsDirUrl: TIFY_TRANSLATIONS_URL,
  });
  try {
    await tify.ready;
    plugin = await annotoriousPlugin(tify, {
      panelEl: document.querySelector('#panel') as HTMLElement,
    });
  } catch (error) {
    console.error(error);
  }
}

function applyUrl(url: string): void {
  const next = new URL(window.location.href);
  next.searchParams.set('manifest', url);
  window.history.replaceState({}, '', next);
  void load(url);
}

document.querySelector('#load')?.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return;
  presetSelect.value = presetUrls.includes(url) ? url : '';
  applyUrl(url);
});

presetSelect.addEventListener('change', () => {
  if (!presetSelect.value) return;
  input.value = presetSelect.value;
  applyUrl(presetSelect.value);
});

input.addEventListener('input', () => {
  const url = input.value.trim();
  presetSelect.value = presetUrls.includes(url) ? url : '';
});

void load(input.value);
