export interface ParsedNote {
  measureNumber: number;
  system: number;
  staff: number;
  voice: number;
  step: string;
  alter: number;
  octave: number;
  /** duration in divisions */
  durationDiv: number;
  /** beat (quarter-note units) within the measure */
  beatStart: number;
  chord: boolean;
  rest: boolean;
  grace: boolean;
}

export interface ParsedMeasure {
  number: number;
  system: number;
  divisions: number;
  /** clef sign for staff 1 (upper) */
  clef1: 'G' | 'F' | 'C';
  /** clef sign for staff 2 (lower) */
  clef2: 'G' | 'F' | 'C';
  /** total measure duration in beats */
  beats: number;
  notes: ParsedNote[];
}

export interface MusicTimeline {
  measures: ParsedMeasure[];
  /** all sounding notes in performance order (non-rest) */
  notes: ParsedNote[];
  /** number of systems (0-based indices used) */
  systemCount: number;
  /** divisions per quarter note (global) */
  divisions: number;
}

const STEP_OFFSET: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseNote(
  el: Element,
  measureNumber: number,
  system: number,
  voice: number,
): ParsedNote | null {
  const chord = el.getElementsByTagName('chord').length > 0;
  const rest = el.getElementsByTagName('rest').length > 0;
  const grace = el.getElementsByTagName('grace').length > 0;

  const durEl = el.getElementsByTagName('duration')[0];
  const durationDiv = durEl ? parseInt(durEl.textContent ?? '0', 10) : 0;

  let staff = 1;
  const staffEl = el.getElementsByTagName('staff')[0];
  if (staffEl) staff = parseInt(staffEl.textContent ?? '1', 10) || 1;

  const voiceEl = el.getElementsByTagName('voice')[0];
  const v = voiceEl ? parseInt(voiceEl.textContent ?? String(voice), 10) : voice;

  let step = '';
  let alter = 0;
  let octave = 0;
  if (!rest) {
    const pitch = el.getElementsByTagName('pitch')[0];
    if (pitch) {
      step = (pitch.getElementsByTagName('step')[0]?.textContent ?? 'C').toUpperCase();
      alter = parseInt(pitch.getElementsByTagName('alter')[0]?.textContent ?? '0', 10) || 0;
      octave = parseInt(pitch.getElementsByTagName('octave')[0]?.textContent ?? '4', 10) || 4;
    }
  }

  return {
    measureNumber,
    system,
    staff,
    voice: v,
    step,
    alter,
    octave,
    durationDiv,
    beatStart: 0,
    chord,
    rest,
    grace,
  };
}

export function parseMusicXML(xmlText: string): MusicTimeline {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const part = doc.getElementsByTagName('part')[0];
  const measureEls = Array.from(part?.getElementsByTagName('measure') ?? []);

  const measures: ParsedMeasure[] = [];
  let system = 0;
  let divisions = 1;
  let clef1: 'G' | 'F' | 'C' = 'G';
  let clef2: 'G' | 'F' | 'C' = 'F';

  for (const mEl of measureEls) {
    const number = parseInt(mEl.getAttribute('number') ?? '0', 10) || 0;

    if (mEl.getElementsByTagName('print').length > 0) {
      const print = mEl.getElementsByTagName('print')[0];
      if (print.getAttribute('new-system') === 'yes') system += 1;
    }

    // attributes
    const attrEls = Array.from(mEl.getElementsByTagName('attributes'));
    for (const a of attrEls) {
      const div = a.getElementsByTagName('divisions')[0];
      if (div) divisions = parseInt(div.textContent ?? String(divisions), 10) || divisions;
      const clefEls = Array.from(a.getElementsByTagName('clef'));
      for (const [index, c] of clefEls.entries()) {
        // A missing <clef number> implies the clef's position in the list.
        const n = parseInt(c.getAttribute('number') ?? String(index + 1), 10) || index + 1;
        const sign = (c.getElementsByTagName('sign')[0]?.textContent ?? 'G').toUpperCase() as
          'G' | 'F' | 'C';
        if (n === 1) clef1 = sign;
        else if (n === 2) clef2 = sign;
      }
    }

    // iterate events in order with a single position cursor: notes advance
    // it, backup/forward move it for the events that follow (per the
    // MusicXML spec, a backup rewinds the position for the following voice).
    let pos = 0;
    const notes: ParsedNote[] = [];

    for (const child of Array.from(mEl.children)) {
      const tag = child.tagName;
      if (tag === 'note') {
        const voice = parseInt(child.getElementsByTagName('voice')[0]?.textContent ?? '0', 10) || 1;
        const note = parseNote(child, number, system, voice);
        if (note) {
          // OMR artifacts: rests (occasionally pitches) with absurd durations
          // (e.g. a 32-beat "breve" rest in a 4/4 bar) would stall the
          // playback timeline for half a minute. No real single note exceeds
          // a breve (8 beats), so anything longer is dropped entirely.
          if (note.durationDiv / divisions > 8) continue;
          note.beatStart = pos;
          notes.push(note);
          // chord members share the base note's position; grace notes are free
          if (!note.grace && !note.chord) pos += note.durationDiv / divisions;
        }
      } else if (tag === 'backup') {
        const d = child.getElementsByTagName('duration')[0];
        pos -= d ? parseInt(d.textContent ?? '0', 10) / divisions : 0;
      } else if (tag === 'forward') {
        const d = child.getElementsByTagName('duration')[0];
        pos += d ? parseInt(d.textContent ?? '0', 10) / divisions : 0;
      }
    }

    measures.push({ number, system, divisions, clef1, clef2, beats: pos, notes });
  }

  const systemCount = measures.length ? measures[measures.length - 1].system + 1 : 0;

  const timeline: ParsedNote[] = [];
  for (const m of measures) {
    for (const n of m.notes) {
      if (!n.rest && !n.grace) timeline.push(n);
    }
  }

  return { measures, notes: timeline, systemCount, divisions };
}

/** MIDI note number for a pitch. */
export function midiFromPitch(step: string, alter: number, octave: number): number {
  const semi = (STEP_OFFSET[step] ?? 0) + alter;
  return (octave + 1) * 12 + semi;
}
