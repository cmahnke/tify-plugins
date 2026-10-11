import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import Tify from 'tify';
import { TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';
import { imageOverlaysPlugin } from '@projektemacher/tify-plugin-image-overlays';
import type { TifyPlugin } from '@projektemacher/tify-plugin-core';

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
