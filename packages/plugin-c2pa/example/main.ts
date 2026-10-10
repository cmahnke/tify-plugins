import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import Tify from 'tify';
import {
  COOKBOOK_MANIFEST,
  DOCK_ICONS,
  TIFY_TRANSLATIONS_URL,
  applyStaticTranslations,
  createTranslator,
} from '@projektemacher/tify-plugin-core';
import {
  DEFAULT_TRUST_ANCHORS_URL,
  c2paPlugin,
  type C2paPlugin,
} from '@projektemacher/tify-plugin-c2pa';

const params = new URLSearchParams(window.location.search);
const de = (
  (await import('../src/i18n/translations/de.json')) as unknown as {
    default: Record<string, string>;
  }
).default;
const { lang, t } = await createTranslator(undefined, { de });
applyStaticTranslations(t, lang);
const manifestInput = document.querySelector('#manifest') as HTMLInputElement;
manifestInput.value = params.get('manifest') ?? COOKBOOK_MANIFEST;
const initialTrust = params.get('trustAnchors') ?? DEFAULT_TRUST_ANCHORS_URL;
const showTrust = document.querySelector('#show-trust') as HTMLInputElement;
const editTrust = document.querySelector('#edit-trust') as HTMLInputElement;

function trustConfig(): { url: string | null; show: boolean; editable: boolean } {
  return {
    url: initialTrust === '' ? null : initialTrust,
    show: showTrust.checked,
    editable: editTrust.checked,
  };
}

let tify: Tify | null = null;
let plugin: C2paPlugin | null = null;

async function load(
  manifestUrl: string,
  trustAnchors: { url: string | null; show: boolean; editable: boolean },
): Promise<void> {
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
    plugin = await c2paPlugin(tify, {
      panelEl: document.querySelector('#panel') as HTMLElement,
      trustAnchors,
      maxTiles: 8,
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
  void load(manifestUrl, trustConfig());
});

for (const box of [showTrust, editTrust]) {
  box.addEventListener('change', () => {
    if (editTrust.checked) showTrust.checked = true;
    if (!showTrust.checked) editTrust.checked = false;
    plugin?.destroy();
    plugin = null;
    void load(
      manifestInput.value.trim() === '' ? COOKBOOK_MANIFEST : manifestInput.value,
      trustConfig(),
    );
  });
}

// In-viewer toggle for the docked panel (mirrors TIFY's toolbar dock button).
const toggle = document.querySelector('#toggle-panel');
if (toggle) {
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${DOCK_ICONS.shield}</svg>`;
  toggle.addEventListener('click', () => {
    document.querySelector('.tify-plugin-dock-btn')?.dispatchEvent(new MouseEvent('click'));
  });
}
void load(manifestInput.value, trustConfig());
