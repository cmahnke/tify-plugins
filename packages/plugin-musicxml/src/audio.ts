import { midiFromPitch, type MusicTimeline, type ParsedNote } from './musicxml-timeline';

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export type Instrument = 'piano' | 'organ' | 'strings' | 'flute' | 'synth';

export const INSTRUMENTS: Array<{ id: Instrument; label: string }> = [
  { id: 'piano', label: 'Piano' },
  { id: 'organ', label: 'Organ' },
  { id: 'strings', label: 'Strings' },
  { id: 'flute', label: 'Flute' },
  { id: 'synth', label: 'Synth' },
];

export interface TrackConfig {
  staff: number;
  instrument: Instrument;
}

interface Voice {
  /** oscillator waveforms of the stack (one per partial) */
  waves: OscillatorType[];
  /** frequency ratio of each stack member above the fundamental */
  partials: number[];
  /** gain of each stack member relative to the first */
  mix: number[];
  /** low-pass cutoff as a multiple of the fundamental (0 = no filter) */
  cutoff: number;
  attack: number;
  /** time constant of the decay from peak to sustain level */
  decay: number;
  /** sustain level relative to peak */
  sustain: number;
  release: number;
}

const VOICES: Record<Instrument, Voice> = {
  piano: {
    waves: ['triangle'],
    partials: [1],
    mix: [1],
    cutoff: 0,
    attack: 0.004,
    decay: 0.35,
    sustain: 0.12,
    release: 0.14,
  },
  organ: {
    waves: ['sine', 'sine', 'sine'],
    partials: [0.5, 1, 2],
    mix: [0.5, 1, 0.35],
    cutoff: 0,
    attack: 0.02,
    decay: 1,
    sustain: 0.9,
    release: 0.08,
  },
  strings: {
    waves: ['sawtooth'],
    partials: [1],
    mix: [1],
    cutoff: 6,
    attack: 0.09,
    decay: 0.8,
    sustain: 0.75,
    release: 0.22,
  },
  flute: {
    waves: ['sine'],
    partials: [1],
    mix: [1],
    cutoff: 0,
    attack: 0.06,
    decay: 1,
    sustain: 0.85,
    release: 0.1,
  },
  synth: {
    waves: ['square'],
    partials: [1],
    mix: [1],
    cutoff: 5,
    attack: 0.01,
    decay: 0.5,
    sustain: 0.45,
    release: 0.06,
  },
};

export interface PlaybackCallbacks {
  onNote?: (note: ParsedNote, index: number) => void;
  onEnd?: () => void;
}

/**
 * Simple Web Audio playback engine. Drives the note timeline and fires
 * `onNote` at each note onset so the UI can highlight it (score + scan).
 * Plays one or two tracks (staves) at once, each with its own instrument.
 */
export class MusicPlayer {
  private timeline: MusicTimeline;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timeouts: number[] = [];
  private playing = false;
  private tempo = 120;
  private tracks: TrackConfig[] = [{ staff: 1, instrument: 'piano' }];
  private startedAt = 0;
  private pausedAt = 0;
  private baseTime = 0;
  private cb: PlaybackCallbacks = {};
  /**
   * Restart generation: a scheduled setTimeout callback may already sit in
   * the task queue when stop()/play() reschedule (e.g. instrument or track
   * switch under load) — clearing it is then too late. Callbacks capture
   * the generation and stay silent unless it is still current, so stale
   * audio and highlights can never leak into the restarted playback.
   */
  private epoch = 0;

  constructor(timeline: MusicTimeline) {
    this.timeline = timeline;
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
  }

  /** Schedule notes of the given tracks; identical staffs are deduplicated. */
  setTracks(tracks: TrackConfig[]): void {
    const seen = new Set<number>();
    const unique: TrackConfig[] = [];
    for (const t of tracks) {
      if (seen.has(t.staff)) continue;
      seen.add(t.staff);
      unique.push(t);
    }
    this.tracks = unique.length > 0 ? unique : [{ staff: 1, instrument: 'piano' }];
  }

  setCallbacks(cb: PlaybackCallbacks): void {
    this.cb = cb;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private beatToSeconds(beats: number): number {
    return (60 / this.tempo) * beats;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.3;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private noteToFreq(note: ParsedNote): number {
    const midi = midiFromPitch(note.step, note.alter, note.octave);
    return midiToFreq(midi);
  }

  private playTone(freq: number, at: number, durSec: number, instrument: Instrument): void {
    const ctx = this.ensureContext();
    if (!this.master) return;
    const voice = VOICES[instrument];
    // Start on the exact musical grid time (baseTime + beat offset), not at
    // "now": the firing setTimeout only drives the UI callbacks, so the audio
    // stays on the beat even when the main thread jitters.
    const t0 = this.baseTime + at;
    const peak = 0.55 / Math.max(1, voice.mix.length * 0.6);
    const atk = t0 + voice.attack;
    const dec = Math.max(atk + 0.01, Math.min(atk + voice.decay, t0 + durSec));
    const end = Math.max(dec, t0 + durSec);
    const stop = end + voice.release + 0.05;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, atk);
    env.gain.exponentialRampToValueAtTime(peak * voice.sustain, dec);
    env.gain.setValueAtTime(peak * voice.sustain, end);
    env.gain.exponentialRampToValueAtTime(0.0001, stop);
    env.connect(this.master);
    const destination: AudioNode =
      voice.cutoff > 0
        ? (() => {
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = Math.min(freq * voice.cutoff, ctx.sampleRate / 2.2);
            filter.connect(env);
            return filter;
          })()
        : env;
    this.connectStack(ctx, voice, freq, destination, t0, stop);
  }

  private connectStack(
    ctx: AudioContext,
    voice: Voice,
    freq: number,
    destination: AudioNode,
    t0: number,
    stop: number,
  ): void {
    for (let i = 0; i < voice.waves.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = voice.waves[i];
      osc.frequency.value = freq * voice.partials[i];
      const gain = ctx.createGain();
      gain.gain.value = voice.mix[i];
      osc.connect(gain);
      gain.connect(destination);
      osc.start(t0);
      osc.stop(stop);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    }
  }

  play(): void {
    if (this.playing) return;
    const ctx = this.ensureContext();
    this.playing = true;
    this.epoch++;
    const epoch = this.epoch;
    // Small lead-in so a still-resuming context has its clock running before
    // the first grid time is reached.
    this.baseTime = ctx.currentTime + 0.05;
    const now = performance.now();
    this.startedAt = now - this.pausedAt;
    this.pausedAt = 0;

    let absBeat = 0;
    // OMR output occasionally contains artifact notes: zero-duration notes
    // and repeated notes at the same position. Both would fire at the same
    // instant, so zero-duration notes are skipped and only the first note of
    // a beat is scheduled (per track: two staves legitimately share onsets).
    const scheduledBeats = new Set<string>();
    for (const measure of this.timeline.measures) {
      // per-measure absolute beat start (using a running measure beat offset)
      for (const n of measure.notes) {
        if (n.grace || n.durationDiv <= 0) continue;
        const track = this.tracks.find((t) => t.staff === n.staff);
        if (!track) continue;
        const onBeat = Math.max(0, absBeat + n.beatStart);
        const key = `${String(track.staff)}:${String(Math.round(onBeat * 1000))}`;
        if (scheduledBeats.has(key)) continue;
        scheduledBeats.add(key);
        const atSec = this.beatToSeconds(onBeat);
        const durSec = Math.max(0.12, this.beatToSeconds(n.durationDiv / this.timeline.divisions));
        const index = this.timeline.notes.indexOf(n);
        const id = window.setTimeout(() => {
          if (!this.playing || epoch !== this.epoch) return;
          this.playTone(this.noteToFreq(n), atSec, durSec, track.instrument);
          this.cb.onNote?.(n, index);
        }, atSec * 1000);
        this.timeouts.push(id);
      }
      absBeat += measure.beats;
    }

    const totalSec = this.beatToSeconds(absBeat) * 1000;
    const endId = window.setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.stop();
      this.cb.onEnd?.();
    }, totalSec + 200);
    this.timeouts.push(endId);
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.pausedAt = performance.now() - this.startedAt;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    if (this.ctx) void this.ctx.suspend();
  }

  stop(): void {
    this.epoch++;
    this.playing = false;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    this.pausedAt = 0;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
