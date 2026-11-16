// E2E test page for the panel host modes (resolvePanelHost): which host a
// plugin renders into is chosen via ?mode=; #destroy tears the plugin down
// so specs can assert owned vs. page-owned host cleanup.
import 'tify/dist/tify.css';
import '@projektemacher/tify-plugin-core/style.css';
import Tify from 'tify';
import { COOKBOOK_MANIFEST, TIFY_TRANSLATIONS_URL } from '@projektemacher/tify-plugin-core';
import type { TifyPlugin } from '@projektemacher/tify-plugin-core';
import { sidePanelPlugin } from '@projektemacher/tify-plugin-side-panel';
import { annotoriousPlugin } from '@projektemacher/tify-plugin-annotorious';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode') ?? 'auto';
const manifestUrl = params.get('manifest') ?? COOKBOOK_MANIFEST;

const tify = new Tify({
  container: '#tify',
  manifestUrl,
  translationsDirUrl: TIFY_TRANSLATIONS_URL,
});
await tify.ready;

let plugin: TifyPlugin | null = null;
if (mode === 'explicit') {
  plugin = await sidePanelPlugin(tify, {
    panelEl: document.querySelector('#host') as HTMLElement,
  });
} else if (mode === 'none') {
  plugin = await sidePanelPlugin(tify, { panelEl: null });
} else if (mode === 'sidecar') {
  plugin = await sidePanelPlugin(tify, { dock: false });
} else if (mode === 'overlays') {
  plugin = await annotoriousPlugin(tify, { panelEl: null });
} else {
  plugin = await sidePanelPlugin(tify, {});
}

document.querySelector('#destroy')?.addEventListener('click', () => {
  plugin?.destroy();
  plugin = null;
});
