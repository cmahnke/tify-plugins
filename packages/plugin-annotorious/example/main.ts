import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import '@annotorious/openseadragon/annotorious-openseadragon.css';
import Tify from 'tify';
import { DOCK_ICONS, TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';
import { annotoriousPlugin, type AnnotoriousPlugin } from '@projektemacher/tify-plugin-annotorious';

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
input.value = params.get('manifest') ?? DEFAULT_ANNOTATED_MANIFEST;

// In-viewer toggle for the docked panel (mirrors TIFY's toolbar dock button).
const toggle = document.querySelector('#toggle-panel');
if (toggle) {
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${DOCK_ICONS.comment}</svg>`;
  toggle.addEventListener('click', () => {
    document.querySelector('.tify-plugin-dock-btn')?.dispatchEvent(new MouseEvent('click'));
  });
}

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

document.querySelector('#load')?.addEventListener('click', () => {
  const url = input.value.trim();
  if (!url) return;
  const next = new URL(window.location.href);
  next.searchParams.set('manifest', url);
  window.history.replaceState({}, '', next);
  void load(url);
});

void load(input.value);
