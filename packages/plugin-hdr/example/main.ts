import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import Tify from 'tify';
import { DOCK_ICONS, TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import { applyStaticTranslations, createTranslator } from '@projektemacher/tify-plugin-core';
import { enableHdrCanvasOnce, hdrPlugin, type HdrPlugin } from '@projektemacher/tify-plugin-hdr';

// The 70s wallpaper UltraHDR manifest: single canvas, Image API 2 service
// advertising HDR via the placeholder profile URI. Any manifest URL works
// via the input box below.
export const DEFAULT_HDR_MANIFEST = 'https://christianmahnke.de/post/hdr-iiif/manifest.json';

const params = new URLSearchParams(window.location.search);
const de = (
  (await import('../src/i18n/translations/de.json')) as unknown as {
    default: Record<string, string>;
  }
).default;
const { lang, t } = await createTranslator(undefined, { de });
applyStaticTranslations(t, lang);
const manifestInput = document.querySelector('#manifest') as HTMLInputElement;
manifestInput.value = params.get('manifest') ?? DEFAULT_HDR_MANIFEST;

// In-viewer toggle for the docked panel (mirrors TIFY's toolbar dock button).
const toggle = document.querySelector('#toggle-panel');
if (toggle) {
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${DOCK_ICONS.image}</svg>`;
  toggle.addEventListener('click', () => {
    document.querySelector('.tify-plugin-dock-btn')?.dispatchEvent(new MouseEvent('click'));
  });
}

// CRITICAL ORDER: hook getContext before TIFY creates its OpenSeadragon canvas.
// The result is passed to the plugin, which explains the setup state in the panel.
const hdrHook = enableHdrCanvasOnce();

let tify: Tify | null = null;
let plugin: HdrPlugin | null = null;

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
    plugin = await hdrPlugin(tify, {
      panelEl: document.querySelector('#panel') as HTMLElement,
      hook: hdrHook,
    });
  } catch (error) {
    console.error(error);
  }
}

document.querySelector('#load-manifest')?.addEventListener('click', () => {
  const manifestUrl = manifestInput.value.trim();
  if (!manifestUrl) return;
  const next = new URL(window.location.href);
  next.searchParams.set('manifest', manifestUrl);
  window.history.replaceState({}, '', next);
  void load(manifestUrl);
});

void load(manifestInput.value);
