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

/** Small tolerance for beat comparisons (float beat positions). */
const BEAT_EPS = 1e-6;
/** Lead-in before the first grid time (context resume, timer setup). */
const LEAD_IN = 0.05;
/** How long play() waits for a suspended context to resume before virtual-clock playback. */
const RESUME_WATCHDOG_MS = 250;

/** Promise that resolves after `ms` — loses the race once resume() settles first. */
function watchdog(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/**
 * Simple Web Audio playback engine. Drives the note timeline and fires
 * `onNote` at each note onset so the UI can highlight it (score + scan).
 * Plays one or more tracks (staves) at once, each with its own instrument.
 *
 * The playback position is tracked in beats: `fromBeat` is the beat that
 * sounds at context time `baseTime`, and every grid time derives from that
 * anchor at the current tempo. `setTempo()` mid-playback re-anchors at the
 * currently playing beat and reschedules the remaining notes — the change is
 * audible immediately without restarting the piece. `pause()` remembers the
 * beat; `play()` resumes from there.
 */
export class MusicPlayer {
  private timeline: MusicTimeline;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private deadAudio = false;
  private frozenAudio = false;
  private fallbackBase = 0;
  private fallbackOffset = 0;
  private timeouts: number[] = [];
  private playing = false;
  private tempo = 120;
  private tracks: TrackConfig[] = [{ staff: 1, instrument: 'piano' }];
  /** Beat that sounds at context time `baseTime` (moving anchor). */
  private fromBeat = 0;
  private baseTime = 0;
  /** Beat paused at (0 = start from the beginning). */
  private pausedBeat = 0;
  private cb: PlaybackCallbacks = {};
  /**
   * Restart generation: a scheduled setTimeout callback may already sit in
   * the task queue when stop()/play()/setTempo() reschedule (e.g. instrument
   * or track switch under load) — clearing it is then too late. Callbacks
   * capture the generation and stay silent unless it is still current, so
   * stale audio and highlights can never leak into the restarted playback.
   */
  private epoch = 0;

  constructor(timeline: MusicTimeline) {
    this.timeline = timeline;
  }

  /**
   * Set the playback tempo (BPM). While playing, the change takes effect
   * immediately: the current beat is derived from the audio clock, pending
   * timers are dropped and the remaining notes are rescheduled on the new
   * grid — notes already sounding ring out naturally.
   */
  setTempo(bpm: number): void {
    const next = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
    if (next === this.tempo) return;
    if (!this.playing) {
      this.tempo = next;
      return;
    }
    const nowBeat = this.beatNow();
    this.epoch += 1;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    this.tempo = next;
    // No lead-in on a live change: the current beat continues sounding now.
    this.fromBeat = nowBeat;
    this.baseTime = this.now();
    this.scheduleFrom(nowBeat, this.epoch);
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

  /** Seconds between two beats at the current tempo. */
  private beatToSeconds(beats: number): number {
    return (60 / this.tempo) * beats;
  }

  /** Context time at which the given absolute beat sounds. */
  private secOf(beat: number): number {
    return this.baseTime + this.beatToSeconds(beat - this.fromBeat);
  }

  /** The beat sounding right now (meaningful while playing). */
  private beatNow(): number {
    return this.fromBeat + ((this.now() - this.baseTime) * this.tempo) / 60;
  }

  private now(): number {
    if (this.ctx && !this.frozenAudio) return this.ctx.currentTime;
    return this.fallbackOffset + (performance.now() - this.fallbackBase) / 1000;
  }

  private ensureContext(): AudioContext | null {
    if (this.deadAudio) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.3;
        this.master.connect(this.ctx.destination);
      } catch {
        this.deadAudio = true;
        this.ctx = null;
        this.master = null;
        return null;
      }
    }
    return this.ctx;
  }

  private noteToFreq(note: ParsedNote): number {
    const midi = midiFromPitch(note.step, note.alter, note.octave);
    return midiToFreq(midi);
  }

  private playTone(freq: number, t0: number, durSec: number, instrument: Instrument): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const voice = VOICES[instrument];
    // t0 is the exact musical grid time on the audio clock, not "now": the
    // firing setTimeout only drives the UI callbacks, so the audio stays on
    // the beat even when the main thread jitters.
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

  /**
   * Schedule every note onset at or after `startBeat` (plus the end-of-piece
   * timer) on the current tempo grid. Only future onsets are scheduled: a
   * mid-piece resume or tempo change must never re-strike notes already
   * played (their oscillators exist only after their timer fired, so nothing
   * else needs cancelling).
   */
  private scheduleFrom(startBeat: number, epoch: number): void {
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
        if (onBeat < startBeat - BEAT_EPS) continue;
        const key = `${String(track.staff)}:${String(Math.round(onBeat * 1000))}`;
        if (scheduledBeats.has(key)) continue;
        scheduledBeats.add(key);
        const atSec = this.secOf(onBeat);
        const durSec = Math.max(0.12, this.beatToSeconds(n.durationDiv / this.timeline.divisions));
        const index = this.timeline.notes.indexOf(n);
        const id = window.setTimeout(
          () => {
            if (!this.playing || epoch !== this.epoch) return;
            this.playTone(this.noteToFreq(n), atSec, durSec, track.instrument);
            this.cb.onNote?.(n, index);
          },
          Math.max(0, (atSec - this.now()) * 1000),
        );
        this.timeouts.push(id);
      }
      absBeat += measure.beats;
    }

    const endId = window.setTimeout(
      () => {
        if (epoch !== this.epoch) return;
        this.stop();
        this.cb.onEnd?.();
      },
      Math.max(0, (this.secOf(absBeat) - this.now()) * 1000) + 200,
    );
    this.timeouts.push(endId);
  }

  play(): void {
    if (this.playing) return;
    const ctx = this.ensureContext();
    this.playing = true;
    this.epoch += 1;
    const epoch = this.epoch;
    // Resume a paused playback from the paused beat; a fresh start begins at 0.
    const resumeBeat = this.pausedBeat;
    this.pausedBeat = 0;
    const start = (): void => {
      // stop() may have won the race against the pending resume.
      if (!this.playing || epoch !== this.epoch) return;
      this.baseTime = this.now() + LEAD_IN;
      this.fromBeat = resumeBeat;
      this.scheduleFrom(resumeBeat, epoch);
    };
    // Resuming a suspended context must await the resume: the clock is
    // frozen until then, so the grid anchor would drift if set early. A
    // resume() also cancels a suspend() that is still in flight (rapid
    // pause → play).
    if (this.deadAudio || this.frozenAudio) {
      this.fallbackOffset = 0;
      this.fallbackBase = performance.now();
      start();
    } else if (ctx && (resumeBeat > 0 || ctx.state === 'suspended')) {
      // A context may construct fine yet never start running (no audio
      // device on CI runners): its resume() then never settles, so race it
      // against a watchdog and fall back to the virtual clock — the context
      // itself stays usable as a silent oscillator factory.
      let resumed: Promise<void>;
      try {
        resumed = ctx.resume();
      } catch {
        resumed = Promise.reject();
      }
      void Promise.race([resumed, watchdog(RESUME_WATCHDOG_MS)]).then(
        () => {
          if (!this.playing || epoch !== this.epoch) return;
          if (ctx.state !== 'running') {
            this.frozenAudio = true;
            this.fallbackBase = performance.now();
          }
          start();
        },
        () => {
          if (!this.playing || epoch !== this.epoch) return;
          this.frozenAudio = true;
          this.fallbackBase = performance.now();
          start();
        },
      );
    } else {
      start();
    }
  }

  pause(): void {
    if (!this.playing) return;
    this.pausedBeat = this.beatNow();
    this.playing = false;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    if (this.deadAudio || this.frozenAudio) {
      this.fallbackOffset += (performance.now() - this.fallbackBase) / 1000;
    } else if (this.ctx) {
      void this.ctx.suspend();
    }
  }

  stop(): void {
    this.epoch += 1;
    this.playing = false;
    for (const id of this.timeouts) window.clearTimeout(id);
    this.timeouts = [];
    this.pausedBeat = 0;
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
