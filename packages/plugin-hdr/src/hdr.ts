// HDR status plugin for TIFY.
//
// Reports device/browser HDR capability and whether the current image
// service advertises HDR via the placeholder profile URI. The dock button
// carries the capability tint. Display-only; the HDR canvas hook itself
// (`enableHdrCanvasOnce()`) must run BEFORE `new Tify()` — see
// example/main.ts.
import type Tify from 'tify';
import {
  describeImageService,
  getInfoJsonForCurrentPage,
  probeHdrSupport,
  type HdrSupport,
  type ImageServiceDescription,
} from './hdr-lib';
import { createTranslator, type TranslateFn } from '@projektemacher/tify-plugin-core';
import {
  createSidePanel,
  onPagesChange,
  waitReady,
  type SidePanel,
  type TifyPlugin,
} from '@projektemacher/tify-plugin-core';
import { DOCK_ICONS, dockPanel, type DockHandle } from '@projektemacher/tify-plugin-core';

export interface HdrOptions {
  /** Panel content host (sidecar unless docked into the viewer). */
  panelEl: HTMLElement;
  /**
   * Result of `enableHdrCanvasOnce()` — call it before `new Tify()` and pass
   * the result so the panel can explain the setup state (flag hint, fallback).
   */
  hook?: HdrSupport | null;
  /**
   * 'auto' (default): dock into TIFY when recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  dock?: boolean | 'auto';
}

export interface HdrPlugin extends TifyPlugin {
  refresh(): void;
  /** Image API service description for the current page (null if unreachable). */
  getServiceDescription(): Promise<ImageServiceDescription | null>;
}

/** One label/value row; field-name labels render monospace (spec identifiers). */
function addRow(
  tbody: HTMLTableSectionElement,
  label: string,
  value: string,
  monoLabel = false,
): void {
  const row = document.createElement('tr');
  const th = document.createElement('th');
  th.scope = 'row';
  if (monoLabel) {
    const code = document.createElement('code');
    code.textContent = label;
    th.append(code);
  } else {
    th.textContent = label;
  }
  const td = document.createElement('td');
  td.textContent = value;
  row.append(th, td);
  tbody.append(row);
}

function renderService(t: TranslateFn, host: HTMLElement, desc: ImageServiceDescription): void {
  host.innerHTML = '';
  const heading = document.createElement('h3');
  heading.textContent = t('Image service');
  host.append(heading);
  const verdict = document.createElement('p');
  const pill = document.createElement('span');
  pill.className = `pill ${desc.hdrAdvertised ? 'is-valid' : 'is-unknown'}`;
  pill.textContent = t(desc.hdrAdvertised ? 'HDR advertised' : 'HDR not advertised');
  verdict.append(pill);
  host.append(verdict);
  const table = document.createElement('table');
  const tbody = document.createElement('tbody');
  if (desc.serviceId) {
    const row = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = t('Service');
    const td = document.createElement('td');
    const link = document.createElement('a');
    const base = desc.serviceId.endsWith('/') ? desc.serviceId : `${desc.serviceId}/`;
    link.href = `${base}info.json`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = desc.serviceId;
    td.append(link);
    row.append(th, td);
    tbody.append(row);
  }
  const version = desc.apiVersion === 'unknown' ? t('unknown') : desc.apiVersion;
  addRow(tbody, t('API version'), version);
  addRow(tbody, t('Profile'), desc.profile === '' ? '–' : desc.profile);
  const caps: Array<[string, string[]]> =
    desc.apiVersion === '3'
      ? [
          ['extraFormats', desc.extraFormats],
          ['extraQualities', desc.extraQualities],
          ['extraFeatures', desc.extraFeatures],
        ]
      : [
          ['formats', desc.formats],
          ['qualities', desc.qualities],
          ['supports', desc.supports],
        ];
  for (const [field, values] of caps) {
    addRow(tbody, field, values.length > 0 ? values.join(', ') : '–', true);
  }
  table.append(tbody);
  host.append(table);
}

export async function hdrPlugin(tify: Tify, options: HdrOptions): Promise<HdrPlugin> {
  await waitReady(tify);
  const de = (
    (await import('./i18n/translations/de.json')) as unknown as {
      default: Record<string, string>;
    }
  ).default;
  const { t } = await createTranslator(tify, { de });
  const panel: SidePanel = createSidePanel(options.panelEl, t('HDR'));
  const serviceBody = document.createElement('div');
  serviceBody.className = 'tify-plugin-service';
  panel.body.append(serviceBody);
  // Setup note (previously the example banner): flag hint and fallback in one place.
  if (options.hook) {
    const hook = options.hook;
    const note = document.createElement('p');
    note.className = 'tify-plugin-note';
    note.textContent = hook.enabled
      ? t('Needs an HDR display to be visible; SDR fallback otherwise.')
      : `${t(hook.reasonKey, hook.reasonVars ?? {})} ${t('Viewer still works (SDR).')}`;
    panel.body.append(note);
  }

  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  const dock: DockHandle | null = dockPanel({
    tify,
    id: 'hdr',
    label: t('HDR'),
    iconSvg: DOCK_ICONS.image,
    contentEl: options.panelEl,
    mode: options.dock,
  });

  const paintTint = (): void => {
    if (!dock) return;
    const probe = probeHdrSupport();
    dock.setTint(probe.hdrDisplay && probe.hdrCanvas ? 'ok' : 'neutral');
    dock.setTitle(
      [
        t('Display HDR: {value}', { value: t(probe.hdrDisplay ? 'yes' : 'no') }),
        t('Canvas HDR: {value}', { value: t(probe.hdrCanvas ? 'yes' : 'no') }),
        t('HDR bit depth: {value}', { value: t(probe.bitDepthHdr ? 'yes' : 'no') }),
      ].join('\n'),
    );
  };

  const renderHdrBlock = async (): Promise<void> => {
    const probe = probeHdrSupport();
    panel.status.textContent = [
      t('Display HDR: {value}', { value: t(probe.hdrDisplay ? 'yes' : 'no') }),
      t('Canvas HDR: {value}', { value: t(probe.hdrCanvas ? 'yes' : 'no') }),
      t('HDR bit depth: {value}', { value: t(probe.bitDepthHdr ? 'yes' : 'no') }),
    ].join(' · ');
    serviceBody.innerHTML = '';
    try {
      const current = await getInfoJsonForCurrentPage(tify);
      if (!current) {
        serviceBody.textContent = t('Image service: unknown (manifest unreachable)');
        return;
      }
      renderService(t, serviceBody, describeImageService(current.info, current.serviceId));
    } catch {
      serviceBody.textContent = t('Image service: info.json unreachable (CORS?)');
    }
  };

  const getServiceDescription = async (): Promise<ImageServiceDescription | null> => {
    try {
      const current = await getInfoJsonForCurrentPage(tify);
      if (!current) return null;
      return describeImageService(current.info, current.serviceId);
    } catch {
      return null;
    }
  };

  const refresh = (): void => {
    if (disposed) return;
    paintTint();
    void renderHdrBlock().catch(() => undefined);
  };

  unsubscribe = onPagesChange(tify, refresh);
  await renderHdrBlock().catch(() => undefined);
  paintTint();

  return {
    refresh,
    getServiceDescription,
    destroy() {
      disposed = true;
      unsubscribe?.();
      dock?.destroy();
      options.panelEl.classList.remove('tify-plugin-panel');
      options.panelEl.innerHTML = '';
    },
  };
}
