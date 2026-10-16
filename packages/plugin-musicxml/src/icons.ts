// Hand-authored transport glyphs (aria-hidden), same format as core's
// DOCK_ICONS: 24×24 viewBox path strings; state is carried by tint + label.

export const TRANSPORT_ICONS = {
  /** Solid triangle pointing right (play). */
  play: '<path d="M8 5v14l11-7z"/>',
  /** Two vertical bars (pause). */
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  /** Solid square (stop). */
  stop: '<path d="M7 7h10v10H7z"/>',
} as const;

export type TransportIcon = keyof typeof TRANSPORT_ICONS;

/** Inline SVG element for a transport icon (top-center button glyph). */
export function transportIconSvg(
  doc: Document,
  icon: TransportIcon,
  className = 'player-btn-icon',
): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = TRANSPORT_ICONS[icon];
  return svg;
}
