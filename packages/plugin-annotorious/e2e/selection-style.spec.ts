import { expect, test } from '@playwright/test';
import { shapeStyle } from '../src/shape-style';

// The annotorious display layer paints on a WebGL canvas: no DOM shapes, no
// readable pixels, so the exported shapeStyle DrawingStyle expression IS the
// verifiable contract. Imported in Node, it runs in dev and preview alike.
test('resting annotations get the accent style, selection gets the heavy one', () => {
  const unselected = shapeStyle({}, { selected: false });
  const selected = shapeStyle({}, { selected: true });

  // Resting: translucent accent tint + medium accent stroke.
  expect(unselected).toEqual({
    fill: '#0b5fff',
    fillOpacity: 0.2,
    stroke: '#0b5fff',
    strokeWidth: 2,
  });

  // Selected: stronger tint + double-weight stroke — obvious on the scan.
  expect(selected.fill).toBe(unselected.fill);
  expect(selected.stroke).toBe(unselected.stroke);
  expect(selected.fillOpacity).toBeGreaterThan(unselected.fillOpacity as number);
  expect(selected.strokeWidth).toBe(4);
  expect(selected.strokeWidth).toBeGreaterThan(unselected.strokeWidth as number);

  // Hover without selection must not look selected.
  expect(shapeStyle({}, { hovered: true })).toEqual(unselected);
});
