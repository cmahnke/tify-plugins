import type { MusicTimeline, ParsedNote } from './musicxml-timeline';

export interface StaffGridPoint {
  x: number;
  y: number[];
}

export interface StaffEntry {
  bbox: [number, number, number, number];
  lineCount: number;
  grid?: StaffGridPoint[];
}

/** MIDI note number for a reference staff line. */
const REF: Record<string, number> = {
  G: 64, // treble, bottom line = E4
  F: 43, // bass, bottom line = G2
  C: 60, // alto (approximation), bottom line C4
};

/** total beats of a system (sum of its measures) */
function systemBeats(timeline: MusicTimeline, system: number): number {
  let total = 0;
  for (const m of timeline.measures) if (m.system === system) total += m.beats;
  return total;
}

/** beat offset of a note from the start of its system */
function beatInSystem(timeline: MusicTimeline, note: ParsedNote): number {
  let beats = 0;
  for (const m of timeline.measures) {
    if (m.system > note.system) break;
    if (m.system === note.system) {
      if (m.number < note.measureNumber) beats += m.beats;
      else if (m.number === note.measureNumber) {
        beats += note.beatStart;
        break;
      }
    }
  }
  return beats;
}

/** Interpolate the 5 line Y positions of a sub-staff at a given X. */
function lineYsAt(staff: StaffEntry, x: number, subStaff: 1 | 2): number[] {
  const grid = staff.grid;
  if (!grid || grid.length === 0) return [];
  const first = grid[0];
  const linesPerStaff = first.y.length / 2;
  const base = subStaff === 1 ? 0 : linesPerStaff;

  if (x <= grid[0].x) {
    return first.y.slice(base, base + linesPerStaff);
  }
  if (x >= grid[grid.length - 1].x) {
    const last = grid[grid.length - 1];
    return last.y.slice(base, base + linesPerStaff);
  }
  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i];
    const b = grid[i + 1];
    if (x >= a.x && x <= b.x) {
      const t = (x - a.x) / (b.x - a.x || 1);
      const out: number[] = [];
      for (let k = 0; k < linesPerStaff; k++) {
        out.push(a.y[base + k] + (b.y[base + k] - a.y[base + k]) * t);
      }
      return out;
    }
  }
  return first.y.slice(base, base + linesPerStaff);
}

/** MIDI from step/alter/octave (matches musicxml-timeline.midiFromPitch). */
function midi(step: string, alter: number, octave: number): number {
  const map: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (octave + 1) * 12 + (map[step] ?? 0) + alter;
}

/**
 * Map a played note to page coordinates on the given staff entry using the
 * OMR staff grid. `r` is the suggested marker radius, scaled to the detected
 * staff line spacing so the marker matches the note-head size on the scan.
 * Returns null when the entry has no usable staff geometry.
 */
export function noteCoordOnStaff(
  timeline: MusicTimeline,
  note: ParsedNote,
  staffEntry: StaffEntry | undefined,
): { x: number; y: number; r: number; unit: number } | null {
  if (!staffEntry || !staffEntry.grid || staffEntry.grid.length === 0) return null;

  const bbox = staffEntry.bbox;
  const [x0, , x1] = bbox;
  const span = x1 - x0;
  if (span <= 0) return null;

  const sysBeats = systemBeats(timeline, note.system);
  const beat = beatInSystem(timeline, note);
  const frac = sysBeats > 0 ? beat / sysBeats : 0;
  const x = x0 + Math.max(0, Math.min(1, frac)) * span;

  const subStaff: 1 | 2 = note.staff === 2 ? 2 : 1;
  const clef = subStaff === 1 ? noteClef(timeline, note, 1) : noteClef(timeline, note, 2);
  const lines = lineYsAt(staffEntry, x, subStaff);
  if (lines.length < 2) return null;

  const ref = REF[clef] ?? 60;
  const noteMidi = midi(note.step, note.alter, note.octave);
  const unit = Math.abs(lines[1] - lines[0]) || 1;
  // The reference pitches are the clef's bottom-line pitches and the grid
  // line Y values are ordered top-to-bottom, so the anchor is the LAST line
  // (the bottom one) and larger steps move up (smaller Y).
  const wholeSteps = (noteMidi - ref) / 2;
  const y = lines[lines.length - 1] - wholeSteps * unit;
  // Note-head sized; pages are displayed far below 1:1, so callers that need
  // something visible at fit zoom should scale from `unit` (one staff space).
  const r = Math.max(6, Math.min(40, unit * 0.45));

  return { x, y, r, unit };
}

function noteClef(timeline: MusicTimeline, note: ParsedNote, staff: 1 | 2): string {
  for (const m of timeline.measures) {
    if (m.system === note.system && m.number <= note.measureNumber) {
      // use the clef of the measure the note is in (or earlier)
      return staff === 1 ? m.clef1 : m.clef2;
    }
  }
  return staff === 1 ? 'G' : 'F';
}
