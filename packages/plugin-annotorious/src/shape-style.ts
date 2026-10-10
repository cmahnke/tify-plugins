// Shape styling for the annotorious display layer.
//
// Display shapes are painted on a WebGL canvas (CSS cannot reach them), so
// this DrawingStyle expression is the only way to make the selected
// annotation stand out: a resting accent tint per annotation, and a heavier
// accent stroke once selected. The display renderer ignores the alpha
// channel of `fill`, so translucency goes through `fillOpacity`.
//
// All annotorious imports are type-only (erased at runtime), so this module
// can be unit-tested in Node without a browser.
import type { AnnotationState, DrawingStyle } from '@annotorious/openseadragon';

export function shapeStyle(_annotation: unknown, state?: AnnotationState): DrawingStyle {
  const selected = state?.selected === true;
  return {
    fill: '#0b5fff',
    fillOpacity: selected ? 0.4 : 0.2,
    stroke: '#0b5fff',
    strokeWidth: selected ? 4 : 2,
  };
}
