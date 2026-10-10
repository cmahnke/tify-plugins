// Dock custom panels inside TIFY's viewer chrome, imitating native views.
//
// TIFY offers no view-registration API (App.vue renders a hardcoded set of
// View* sections), so this helper injects a panel into `.tify-main` plus a
// native-looking button into the header's `-view` group. Behavior mimics
// exclusive views: opening docks the panel (TIFY view reset to media),
// picking a native view closes it again.
//
// Robustness: if TIFY's DOM is not recognized (selectors below are verified
// against tify@0.36.2), dockPanel() returns null (or throws with mode:true)
// and callers fall back to rendering beside the viewer.
import type Tify from 'tify';

/** Hand-authored decorative glyphs (aria-hidden); state is carried by tint + label. */
export const DOCK_ICONS = {
  /** Three-line list (side panel). */
  list: '<path d="M4 6h16v2H4zM4 11h16v2H4zM4 16h16v2H4z"/>',
  /** Picture/mountain/sun (HDR). */
  image:
    '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v8.6l3.5-3.5a1 1 0 0 1 1.4 0l3.1 3.1 3-3a1 1 0 0 1 1.4 0L20 14.8V7H5zm3.5 1A1.75 1.75 0 1 1 8.5 11.5 1.75 1.75 0 0 1 8.5 8z"/>',
  /** Shield with check (trust/provenance). */
  shield:
    '<path d="M12 2 4 5.5V11c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5.5L12 2zm0 2.3 5.5 2.2V11c0 3.9-2.6 7.6-5.5 8.9-2.9-1.3-5.5-5-5.5-8.9V6.5L12 4.3z"/><path d="M10.6 14.6l-2.1-2.1 1.1-1.1 1 1 3.7-3.7 1.1 1.1z"/>',
  /** Speech bubble (annotations). */
  comment:
    '<path d="M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4 4v-4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v8h12V6H5z"/>',
  /** Eighth note (score). */
  music:
    '<ellipse cx="9" cy="17" rx="3" ry="2.4" transform="rotate(-20 9 17)"/><path d="M11.6 16.6V5.5L20 3.6v2L13.4 7v9.6z"/>',
} as const;

export type DockMode = boolean | 'auto';

function tifyScope(tify: Tify): ParentNode {
  const container =
    typeof tify.options?.container === 'string'
      ? document.querySelector(tify.options.container)
      : null;
  return container ?? document;
}

/**
 * Anchor for the dock button. TIFY 0.36 renders no visible `-view` group in
 * the desktop header (the view list lives inside hidden dropdown contents —
 * `.tify-dropdown-content.-mobile-only`), so prefer the header's `-toggle`
 * group (next to TIFY's own view toggle). Other versions expose a plain
 * `-view` group; the controls column is the last resort.
 */
function pickHeaderGroup(scope: ParentNode): HTMLElement | null {
  const toggleGroup = scope.querySelector('.tify-header .tify-header-button-group.-toggle');
  if (toggleGroup instanceof HTMLElement) return toggleGroup;
  for (const group of scope.querySelectorAll('.tify-header-button-group.-view')) {
    if (group instanceof HTMLElement && !group.closest('.tify-dropdown-content')) return group;
  }
  const column = scope.querySelector('.tify-header .tify-header-column.-controls');
  return column instanceof HTMLElement ? column : null;
}

function headerButton(id: string, label: string, iconSvg: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tify-header-button tify-plugin-dock-btn tify-plugin-dock-${id}`;
  button.title = label;
  button.innerHTML = `<svg class="tify-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconSvg}</svg><span class="tify-header-button-label"></span>`;
  const labelEl = button.querySelector('.tify-header-button-label');
  if (labelEl) labelEl.textContent = label;
  return button;
}

export type DockTint = 'ok' | 'bad' | 'neutral';

export interface DockOptions {
  tify: Tify;
  /** Short id used for classes/ids, e.g. 'provenance'. */
  id: string;
  /** Translated button label. */
  label: string;
  iconSvg: string;
  /** Panel content host (keeps working as a sidecar when docking is off). */
  contentEl: HTMLElement;
  /**
   * 'auto' (default): dock when TIFY's DOM is recognized, else sidecar.
   * true: dock or throw. false: never dock.
   */
  mode?: DockMode;
  onToggle?: (open: boolean) => void;
}

export interface DockHandle {
  readonly docked: true;
  isOpen(): boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Status tint on the dock button icon (does not affect open state). */
  setTint(tint: DockTint): void;
  /** Hover tooltip on the dock button. */
  setTitle(title: string): void;
  destroy(): void;
}

export function dockPanel(options: DockOptions): DockHandle | null {
  const { tify, id, label, iconSvg, contentEl } = options;
  const mode = options.mode ?? 'auto';
  if (mode === false) return null;
  const scope = tifyScope(tify);
  const main = scope.querySelector('.tify-main');
  const viewGroup = pickHeaderGroup(scope);
  if (!(main instanceof HTMLElement) || !(viewGroup instanceof HTMLElement)) {
    if (mode === true) {
      throw new Error(`tify-plugins: cannot dock panel "${id}" (TIFY DOM not recognized)`);
    }
    return null;
  }

  const button = headerButton(id, label, iconSvg);
  if (!contentEl.id) contentEl.id = `tify-plugin-dock-${id}`;
  button.setAttribute('aria-controls', contentEl.id);
  button.setAttribute('aria-expanded', 'false');
  viewGroup.append(button);

  const home = { parent: contentEl.parentElement, next: contentEl.nextSibling };
  contentEl.classList.add('tify-plugin-dock');
  contentEl.hidden = true;
  main.append(contentEl);
  main.dataset.pluginDocks = String(Number(main.dataset.pluginDocks ?? 0) + 1);
  main.classList.add('tify-plugin-has-dock');

  let disposed = false;
  let open = false;
  let prevView: string | null = null;
  let internal = false;

  const paint = (): void => {
    button.setAttribute('aria-expanded', String(open));
    contentEl.hidden = !open;
    options.onToggle?.(open);
  };
  const openPanel = (): void => {
    if (disposed || open) return;
    open = true;
    prevView = (tify.options?.view as string | null) ?? null;
    internal = true;
    try {
      tify.setView(null);
    } finally {
      internal = false;
    }
    paint();
  };
  const closePanel = (restore: boolean): void => {
    if (disposed || !open) return;
    open = false;
    paint();
    if (restore) {
      internal = true;
      try {
        tify.setView(prevView);
      } finally {
        internal = false;
      }
    }
  };
  const onClick = (): void => {
    if (open) closePanel(true);
    else openPanel();
  };
  button.addEventListener('click', onClick);
  // Native view picked while ours is open: close silently (user's choice stands).
  const timer = window.setInterval(() => {
    if (disposed || internal || !open) return;
    if ((tify.options?.view as string | null | undefined) != null) closePanel(false);
  }, 500);

  return {
    docked: true as const,
    isOpen: () => open,
    open: openPanel,
    close: () => closePanel(true),
    toggle: () => {
      if (open) closePanel(true);
      else openPanel();
    },
    setTint(tint: DockTint) {
      button.classList.toggle('is-ok', tint === 'ok');
      button.classList.toggle('is-bad', tint === 'bad');
      button.classList.toggle('is-neutral', tint === 'neutral');
    },
    setTitle(title: string) {
      button.title = title;
    },
    destroy() {
      disposed = true;
      window.clearInterval(timer);
      button.remove();
      const remaining = Math.max(0, Number(main.dataset.pluginDocks ?? 1) - 1);
      if (remaining === 0) {
        delete main.dataset.pluginDocks;
        main.classList.remove('tify-plugin-has-dock');
      } else {
        main.dataset.pluginDocks = String(remaining);
      }
      contentEl.classList.remove('tify-plugin-dock');
      contentEl.hidden = false;
      if (home.parent) home.parent.insertBefore(contentEl, home.next);
      if (open) {
        open = false;
        try {
          tify.setView(prevView);
        } catch {
          // Ignore teardown races.
        }
      }
    },
  };
}
