import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import Tify from 'tify';
import { TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';
import { imageOverlaysPlugin } from '@projektemacher/tify-plugin-image-overlays';
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
// Live TEI demo (public/demo/tei/): word boxes over cookbook tiles, so the
// example opens in TEI mode. import.meta.env.BASE_URL keeps this working
// under the GitHub Pages sub-path as well as localhost.
const demoUrl = new URL(
  `${import.meta.env.BASE_URL}demo/tei/manifest.json`,
  window.location.origin,
).toString();
input.value = params.get('manifest') ?? demoUrl;

// Optional rendering initials (undefined when absent, so plugin defaults apply).
const showAnnotations = params.has('annotations') ? params.get('annotations') !== '0' : undefined;
const showOutlines = params.has('outlines') ? params.get('outlines') !== '0' : undefined;
const fillParam = params.get('fill');
const fillColor =
  fillParam && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(fillParam) ? fillParam : undefined;
const opacityParam = params.get('opacity');
const opacityValue = opacityParam === null ? Number.NaN : Number.parseFloat(opacityParam);
const fillOpacity = Number.isFinite(opacityValue) ? opacityValue : undefined;

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
    plugin = await imageOverlaysPlugin(tify, {
      markers: 3,
      panelEl: document.querySelector('#panel') as HTMLElement,
      showAnnotations,
      showOutlines,
      fillColor,
      fillOpacity,
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
