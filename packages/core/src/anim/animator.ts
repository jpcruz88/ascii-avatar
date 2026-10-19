import type { MouthLevel, MouthStep } from '../audio/mouth.js';
import {
  MOUTH_FRAMES,
  clipFrameId,
  easeFrameId,
  poseFrameId,
  type ClipId,
  type ExpressionId,
  type FrameId,
  type Motion,
  type PoseId,
} from '../faces.js';

/** Cuánto dura la cara de parpadeo. */
const BLINK_MS = 150;
/**
 * Al empezar a hablar se muestra la expresión antes de mover la boca. El audio debe empezar a
 * sonar cuando termina este avance, para que boca y voz vayan juntas.
 */
export const SPEECH_LEAD_IN_MS = 500;
const LEAD_IN_MS = SPEECH_LEAD_IN_MS;
/** La boca se adelanta un poco al audio, como al hablar de verdad (se prepara antes de sonar). */
export const MOUTH_ANTICIPATION_MS = 60;
/** Al terminar de hablar se mantiene la expresión antes de volver a reposo. */
const HOLD_MS = 3000;
/** Rango [mínimo, máximo] en ms entre parpadeos, según el modo de reposo. */
const BLINK_EVERY_MS = { idle: [3000, 6000], thinking: [1500, 2500] } as const;

/** Los clips se reproducen a su ritmo natural: 24 cuadros por segundo. */
export const CLIP_FPS = 24;
const CLIP_FRAME_MS = 1000 / CLIP_FPS;
/** En reposo, un gesto cada 4 a 9 s (contados desde el fin del anterior). */
const IDLE_GESTURE_EVERY_MS = [4000, 9000] as const;
/** Cuánto se sostiene una pose suelta en reposo (mirar a un lado, o un ladeo sin clip). */
const IDLE_POSE_HOLD_MS = [800, 1500] as const;
/** Pesos de cada tipo de gesto de reposo: mirar o girar, ladear y, rara vez, asentir. */
const GLANCE_WEIGHT = 0.5;
const TILT_WEIGHT = 0.4;
const NOD_WEIGHT = 0.1;
/** Pensando: tras el clip de pensar se sostiene una pose suave y se descansa antes de repetir. */
const THINK_POSE_HOLD_MS = [1500, 3000] as const;
const THINK_PAUSE_MS = [2000, 4000] as const;
const SOFT_POSES: readonly PoseId[] = ['look_left', 'look_right', 'turn_left', 'turn_right'];
/** Hablando: una pausa de la boca de al menos esto entre frases admite un gesto. */
const PHRASE_PAUSE_MS = 350;
/** Hablando: como mucho un gesto cada tanto (entre inicios). */
const SPEECH_GESTURE_EVERY_MS = 3000;
/** Un tramo de ida y vuelta necesita al menos este pico (en cuadros) para que se note. */
const MIN_PINGPONG_PEAK = 3;
/** Al hablar se prefiere asentir; si no, ladear. */
const SPEECH_NOD_WEIGHT = 0.7;
/** El panel sube a 24 fps un poco antes de que empiece un clip, para no perder su primer cuadro. */
const FAST_LOOKAHEAD_MS = 100;
/**
 * Al interrumpir un gesto, la cabeza vuelve a neutral en a lo sumo esto: cabe en el avance de la
 * expresión (`SPEECH_LEAD_IN_MS`), así la boca empieza a su hora aunque se interrumpa un gesto.
 */
const RETURN_MAX_MS = 480;
/**
 * Cuadros que dura el regreso de una pose (su cuadro `ease:`). Las poses se sueltan siempre así,
 * no por un clip del mismo gesto: poses y clips vienen de fuentes distintas y saltar de una pose a
 * un cuadro del clip podría no casar.
 */
const EASE_FRAMES = 2;

export interface AnimatorOptions {
  /** Fuente de números en [0, 1). Por defecto `Math.random`; en pruebas se inyecta una fija. */
  rng?: () => number;
  /** Poses y clips que tiene el agente (ver `atlasMotion`). Sin ellos, la cara solo parpadea y habla. */
  motion?: Motion;
}

export interface SayOptions {
  steps: MouthStep[];
  durationMs: number;
  expression: ExpressionId;
}

type RestMode = keyof typeof BLINK_EVERY_MS;

/**
 * Un tramo de gesto: cuadros de un clip (en orden de reproducción), una pose sostenida o el cuadro
 * de regreso de una pose (`ease:`, la pose mezclada con neutral).
 */
type Segment =
  | { kind: 'clip'; clip: ClipId; frames: number[] }
  | { kind: 'pose'; pose: PoseId; ms: number }
  | { kind: 'ease'; pose: PoseId; ms: number };

interface Gesture {
  /** Identidad del gesto, para no repetir el mismo dos veces seguidas. */
  key: string;
  segments: Segment[];
}

interface Planned {
  atMs: number;
  gesture: Gesture;
}

interface Active extends Planned {
  endMs: number;
}

type Rest = {
  kind: 'rest';
  mode: RestMode;
  nextBlinkMs: number;
  next: Planned | null;
  active: Active | null;
  lastKey: string | null;
};
type Speech = {
  kind: 'speech';
  startMs: number;
  say: SayOptions;
  /** Regreso a neutral del gesto que se interrumpió al empezar a hablar (dentro del avance). */
  intro: Active | null;
  gestures: Active[];
};
type State = Rest | Speech;

interface Candidate {
  weight: number;
  key: string;
  build: () => Segment;
}

const segmentMs = (s: Segment): number => (s.kind === 'clip' ? s.frames.length * CLIP_FRAME_MS : s.ms);
const gestureMs = (g: Gesture): number => g.segments.reduce((ms, s) => ms + segmentMs(s), 0);
const allFrames = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/**
 * Máquina de estados de la cara. Es pura: el tiempo solo entra por los argumentos `nowMs`
 * (reloj monótono, en ms) y un `nowMs` menor al último visto se trata como igual a este.
 * Los parpadeos se agendan desde el inicio del anterior (o desde que se entra al reposo)
 * y `frame` pone la agenda al día aunque pase mucho tiempo entre llamadas.
 *
 * Con poses y clips (`motion`), además:
 * - En reposo, cada 4 a 9 s hace un gesto elegido con pesos: mirar a un lado (pose `look_*`
 *   sostenida 0,8 a 1,5 s, o un clip `turn_*`), ladear la cabeza (clip `tilt_*`, o su pose si no
 *   hay clip) o, rara vez, asentir (clip `nod`). Nunca repite el mismo gesto dos veces seguidas.
 * - Pensando, reproduce el clip `think`, sostiene una pose suave (`look_*` o `turn_*`) y descansa
 *   de 2 a 4 s antes de repetir.
 * - Hablando, la boca sigue de frente; en una pausa de la boca de 350 ms o más entre frases asiente
 *   (o ladea) con un clip, como mucho una vez cada 3 s. Si el clip no cabe en la pausa, hace un
 *   tramo de ida y vuelta de sus primeros cuadros, que termina en neutral.
 * - Si llega `say`, `thinking` o `idle` a mitad de un gesto, la cabeza no salta: un clip vuelve
 *   hacia su cuadro 0 (acelerado si hace falta, en a lo sumo 480 ms, dentro del avance de la
 *   expresión) y una pose se suelta por su cuadro `ease:` (una interrupción durante ese regreso
 *   lo deja terminar). Un `thinking` mientras ya piensa no reinicia nada.
 * - Nunca parpadea durante un gesto (los cuadros de un clip ya traen sus ojos): un parpadeo que cae
 *   dentro se hace al terminar, y un gesto que empieza durante un parpadeo espera a que acabe.
 * - Los clips van a 24 cuadros por segundo; `fastFrames` avisa cuándo el panel debe dibujar rápido.
 */
export class Animator {
  private readonly rng: () => number;
  private readonly motion: Motion;
  private lastMs = 0;
  private state: State;

  constructor({ rng = Math.random, motion = { poses: [], clips: {} } }: AnimatorOptions = {}) {
    this.rng = rng;
    this.motion = motion;
    this.state = this.rest('idle', 0);
  }

  /** El usuario envió un mensaje; se ignora si la respuesta ya está sonando o si ya está pensando. */
  thinking(nowMs: number): void {
    const t = this.tick(nowMs);
    if (this.state.kind === 'speech' && t < this.speechEndMs(this.state)) return;
    this.frame(t);
    if (this.state.kind === 'rest' && this.state.mode === 'thinking') return;
    this.state = this.rest('thinking', t, this.interruption(t));
  }

  /** Llegó la respuesta; reemplaza cualquier habla en curso. */
  say(nowMs: number, say: SayOptions): void {
    const startMs = this.tick(nowMs);
    const intro = this.interruption(startMs);
    this.state = { kind: 'speech', startMs, say, intro, gestures: this.speechGestures(startMs, say) };
  }

  idle(nowMs: number): void {
    const t = this.tick(nowMs);
    this.state = this.rest('idle', t, this.interruption(t));
  }

  /** Si la boca se está moviendo (desde `say` hasta que termina el audio): el panel dibuja más rápido. */
  speaking(nowMs: number): boolean {
    const t = this.tick(nowMs);
    return this.state.kind === 'speech' && t < this.speechEndMs(this.state);
  }

  /**
   * Si el panel debe dibujar a 24 fps: al hablar, mientras se ve un clip y un poco antes de que
   * empiece uno (para no perder su primer cuadro). Una pose sostenida no lo necesita.
   */
  fastFrames(nowMs: number): boolean {
    if (this.speaking(nowMs)) return true;
    const t = this.lastMs;
    this.frame(t);
    const state = this.state;
    if (state.kind === 'speech') return false;
    if (state.active !== null) return (this.segmentAt(state.active, t)?.kind ?? 'pose') !== 'pose';
    const next = state.next;
    return next !== null && next.gesture.segments[0]?.kind === 'clip' && next.atMs - t <= FAST_LOOKAHEAD_MS;
  }

  frame(nowMs: number): FrameId {
    const t = this.tick(nowMs);
    let state = this.state;
    if (state.kind === 'speech') {
      const holdEndMs = this.speechEndMs(state) + HOLD_MS;
      if (t < holdEndMs) return this.speechFace(state, t);
      state = this.state = this.rest('idle', holdEndMs);
    }
    return this.restFace(state, t);
  }

  private tick(nowMs: number): number {
    this.lastMs = Math.max(this.lastMs, nowMs);
    return this.lastMs;
  }

  private speechEndMs({ startMs, say }: Speech): number {
    return startMs + LEAD_IN_MS + Math.max(0, say.durationMs);
  }

  /**
   * Cara durante el habla y la espera posterior (la expresión, o la boca entre medias). Los pasos
   * se ven `MOUTH_ANTICIPATION_MS` antes de su tiempo en el audio (recortados en 0).
   */
  private speechFace(speech: Speech, t: number): FrameId {
    const { startMs, say } = speech;
    const elapsed = t - startMs - LEAD_IN_MS;
    const intro = speech.intro;
    if (intro !== null && t >= intro.atMs && t < intro.endMs) return this.gestureFrame(intro, t);
    if (elapsed < 0 || t >= this.speechEndMs(speech)) return say.expression;
    for (const g of speech.gestures) {
      if (t >= g.atMs && t < g.endMs) return this.gestureFrame(g, t);
    }
    let level: MouthLevel = 0;
    for (const step of say.steps) {
      if (step.tMs - MOUTH_ANTICIPATION_MS > elapsed) break;
      level = step.level;
    }
    return MOUTH_FRAMES[level];
  }

  /**
   * Gestos del habla, decididos al empezar: en cada pausa de la boca de `PHRASE_PAUSE_MS` o más
   * entre dos frases (no la del principio ni la del final), un clip de asentir o ladear que cabe
   * entero en la pausa (o su tramo de ida y vuelta), a lo sumo uno cada `SPEECH_GESTURE_EVERY_MS`.
   */
  private speechGestures(startMs: number, say: SayOptions): Active[] {
    const { clips } = this.motion;
    const tilts = (['tilt_left', 'tilt_right'] as const).filter((c) => (clips[c] ?? 0) > 0);
    const nod = (clips.nod ?? 0) > 0;
    if (!nod && tilts.length === 0) return [];
    const out: Active[] = [];
    let lastAudioMs = -Infinity;
    let voiced = false;
    const { steps, durationMs } = say;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (step.level !== 0) {
        voiced = true;
        continue;
      }
      const end = steps[i + 1]?.tMs;
      if (!voiced || end === undefined || end > durationMs) continue;
      const pauseMs = end - step.tMs;
      if (pauseMs < PHRASE_PAUSE_MS || step.tMs - lastAudioMs < SPEECH_GESTURE_EVERY_MS) continue;
      const pick = nod && (tilts.length === 0 || this.rng() < SPEECH_NOD_WEIGHT);
      const clip: ClipId = pick ? 'nod' : tilts[Math.min(tilts.length - 1, Math.floor(this.rng() * tilts.length))]!;
      const frames = fitClip(clips[clip]!, pauseMs);
      if (frames === undefined) continue;
      const atMs = startMs + LEAD_IN_MS + Math.max(0, step.tMs - MOUTH_ANTICIPATION_MS);
      const gesture: Gesture = { key: `clip:${clip}`, segments: [{ kind: 'clip', clip, frames }] };
      out.push({ atMs, endMs: atMs + gestureMs(gesture), gesture });
      lastAudioMs = step.tMs;
    }
    return out;
  }

  /** Reposo desde `sinceMs`; con `intro`, primero el regreso a neutral del gesto interrumpido. */
  private rest(mode: RestMode, sinceMs: number, intro: Active | null = null): Rest {
    let nextBlinkMs = sinceMs + this.blinkInterval(mode);
    if (intro === null) {
      return { kind: 'rest', mode, nextBlinkMs, next: this.plan(mode, sinceMs, null), active: null, lastKey: null };
    }
    if (nextBlinkMs < intro.endMs) nextBlinkMs = intro.endMs;
    return { kind: 'rest', mode, nextBlinkMs, next: null, active: intro, lastKey: null };
  }

  /** El gesto que se ve en `t` (ya puesto al día), o `null`. */
  private visibleGesture(t: number): Active | null {
    this.frame(t);
    const s = this.state;
    const covers = (g: Active | null): g is Active => g !== null && t >= g.atMs && t < g.endMs;
    if (s.kind === 'rest') return covers(s.active) ? s.active : null;
    if (covers(s.intro)) return s.intro;
    return s.gestures.find(covers) ?? null;
  }

  /**
   * Regreso a neutral si en `t` se ve un gesto: un clip vuelve desde su cuadro actual hasta el 0
   * (a lo sumo `RETURN_MAX_MS`, saltando cuadros si hace falta); una pose se suelta por su cuadro
   * `ease:`, y si ya se estaba soltando, termina lo que le falta. `null` si no hace falta regresar.
   */
  private interruption(t: number): Active | null {
    const g = this.visibleGesture(t);
    if (g === null) return null;
    const at = this.locate(g, t);
    if (at === undefined) return null;
    let segment: Segment | null = null;
    if (at.seg.kind === 'clip') {
      const n = at.seg.frames[at.index]!;
      if (n > 0) segment = { kind: 'clip', clip: at.seg.clip, frames: backTo0(n - 1) };
    } else if (at.seg.kind === 'pose') {
      segment = { kind: 'ease', pose: at.seg.pose, ms: EASE_FRAMES * CLIP_FRAME_MS };
    } else {
      const left = at.startMs + at.seg.ms - t;
      if (left > 0) segment = { kind: 'ease', pose: at.seg.pose, ms: left };
    }
    if (segment === null) return null;
    const gesture: Gesture = { key: 'return', segments: [segment] };
    return { atMs: t, endMs: t + gestureMs(gesture), gesture };
  }

  private blinkInterval(mode: RestMode): number {
    const [min, max] = BLINK_EVERY_MS[mode];
    return min + this.rng() * (max - min);
  }

  private between([min, max]: readonly [number, number]): number {
    return min + this.rng() * (max - min);
  }

  /** Agenda el próximo gesto desde `fromMs`; `null` si el agente no tiene con qué hacerlo. */
  private plan(mode: RestMode, fromMs: number, lastKey: string | null): Planned | null {
    return mode === 'idle' ? this.planIdle(fromMs, lastKey) : this.planThinking(fromMs, lastKey);
  }

  private planIdle(fromMs: number, lastKey: string | null): Planned | null {
    const all = this.idleCandidates();
    if (all.length === 0) return null;
    // Nunca el mismo dos veces seguidas, salvo que sea el único posible.
    const candidates = all.length > 1 ? all.filter((c) => c.key !== lastKey) : all;
    const atMs = fromMs + this.between(IDLE_GESTURE_EVERY_MS);
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let r = this.rng() * total;
    let chosen = candidates[candidates.length - 1]!;
    for (const c of candidates) {
      if (r < c.weight) {
        chosen = c;
        break;
      }
      r -= c.weight;
    }
    return { atMs, gesture: { key: chosen.key, segments: [chosen.build()] } };
  }

  /** Gestos de reposo posibles con su peso: cada tipo reparte su peso entre sus variantes. */
  private idleCandidates(): Candidate[] {
    const { poses, clips } = this.motion;
    const hasPose = (p: PoseId): boolean => poses.includes(p);
    const hasClip = (c: ClipId): boolean => (clips[c] ?? 0) > 0;
    const clip = (c: ClipId): Omit<Candidate, 'weight'> => ({
      key: `clip:${c}`,
      build: () => ({ kind: 'clip', clip: c, frames: allFrames(clips[c]!) }),
    });
    const pose = (p: PoseId): Omit<Candidate, 'weight'> => ({
      key: `pose:${p}`,
      build: () => ({ kind: 'pose', pose: p, ms: this.between(IDLE_POSE_HOLD_MS) }),
    });
    const groups: [number, Omit<Candidate, 'weight'>[]][] = [
      [
        GLANCE_WEIGHT,
        [
          ...(['look_left', 'look_right'] as const).filter(hasPose).map(pose),
          ...(['turn_left', 'turn_right'] as const).flatMap((d) => (hasClip(d) ? [clip(d)] : hasPose(d) ? [pose(d)] : [])),
        ],
      ],
      [TILT_WEIGHT, (['tilt_left', 'tilt_right'] as const).flatMap((d) => (hasClip(d) ? [clip(d)] : hasPose(d) ? [pose(d)] : []))],
      [NOD_WEIGHT, hasClip('nod') ? [clip('nod')] : []],
    ];
    return groups.flatMap(([weight, variants]) => variants.map((v) => ({ ...v, weight: weight / variants.length })));
  }

  /** Pensando: clip `think` (si hay) y una pose suave sostenida (si hay); el primero, en el acto. */
  private planThinking(fromMs: number, lastKey: string | null): Planned | null {
    const think = this.motion.clips.think ?? 0;
    const soft = SOFT_POSES.filter((p) => this.motion.poses.includes(p));
    if (think === 0 && soft.length === 0) return null;
    // El primero va en el acto (también tras regresar de un gesto interrumpido); luego, con pausa.
    const atMs = lastKey === null || lastKey === 'return' ? fromMs : fromMs + this.between(THINK_PAUSE_MS);
    const segments: Segment[] = [];
    if (think > 0) segments.push({ kind: 'clip', clip: 'think', frames: allFrames(think) });
    if (soft.length > 0) {
      const pose = soft[Math.min(soft.length - 1, Math.floor(this.rng() * soft.length))]!;
      segments.push({ kind: 'pose', pose, ms: this.between(THINK_POSE_HOLD_MS) });
    }
    return { atMs, gesture: { key: 'think', segments } };
  }

  /**
   * Cara en reposo. Recorre los sucesos en orden (fin de un gesto, parpadeos, inicio del siguiente)
   * hasta `t`, así el resultado no depende de cada cuánto se llame.
   */
  private restFace(state: Rest, t: number): FrameId {
    for (;;) {
      const active = state.active;
      if (active !== null) {
        if (t < active.endMs) return this.gestureFrame(active, t);
        state.active = null;
        state.lastKey = active.gesture.key;
        state.next = this.plan(state.mode, active.endMs, state.lastKey);
        continue;
      }
      const next = state.next;
      const limit = next === null ? t : Math.min(t, next.atMs);
      while (limit >= state.nextBlinkMs + BLINK_MS) state.nextBlinkMs += this.blinkInterval(state.mode);
      if (next !== null && t >= next.atMs) {
        if (next.atMs >= state.nextBlinkMs) {
          // Un parpadeo en curso: el gesto espera a que termine.
          next.atMs = state.nextBlinkMs + BLINK_MS;
          continue;
        }
        const endMs = next.atMs + gestureMs(next.gesture);
        // Un parpadeo que caería dentro del gesto se hace al terminarlo.
        if (state.nextBlinkMs < endMs) state.nextBlinkMs = endMs;
        state.active = { ...next, endMs };
        state.next = null;
        continue;
      }
      return t >= state.nextBlinkMs ? 'blink' : 'neutral';
    }
  }

  /** Tramo del gesto que se ve en `t`, cuándo empezó y, si es un clip, la posición en su lista de cuadros. */
  private locate(g: Active, t: number): { seg: Segment; index: number; startMs: number } | undefined {
    let from = g.atMs;
    for (const seg of g.gesture.segments) {
      const ms = segmentMs(seg);
      if (t < from + ms) {
        const index =
          seg.kind === 'clip' ? Math.min(seg.frames.length - 1, Math.max(0, Math.floor((t - from) / CLIP_FRAME_MS))) : 0;
        return { seg, index, startMs: from };
      }
      from += ms;
    }
    return undefined;
  }

  private segmentAt(g: Active, t: number): { kind: Segment['kind']; frame: FrameId } | undefined {
    const at = this.locate(g, t);
    if (at === undefined) return undefined;
    const { seg, index } = at;
    if (seg.kind === 'clip') return { kind: 'clip', frame: clipFrameId(seg.clip, seg.frames[index]!) };
    return { kind: seg.kind, frame: seg.kind === 'pose' ? poseFrameId(seg.pose) : easeFrameId(seg.pose) };
  }

  private gestureFrame(g: Active, t: number): FrameId {
    return this.segmentAt(g, t)?.frame ?? 'neutral';
  }
}

/**
 * Cuadros de `from` hasta 0 (de mayor a menor). Si no caben en `RETURN_MAX_MS` a 24 fps, se toman
 * cuadros repartidos por igual, siempre con el primero y el 0.
 */
function backTo0(from: number): number[] {
  const path = allFrames(from + 1).reverse();
  const room = Math.max(2, Math.floor(RETURN_MAX_MS / CLIP_FRAME_MS));
  if (path.length <= room) return path;
  return Array.from({ length: room }, (_, i) => path[Math.round((i * (path.length - 1)) / (room - 1))]!);
}

/**
 * Cuadros de un clip de `count` cuadros que caben en `pauseMs`: el clip entero si cabe; si no, un
 * tramo de ida y vuelta (0, 1, …, k, …, 1, 0) que termina en neutral, o `undefined` si ni eso cabe.
 */
function fitClip(count: number, pauseMs: number): number[] | undefined {
  const room = Math.floor(pauseMs / CLIP_FRAME_MS);
  if (count <= room) return allFrames(count);
  const peak = Math.min(Math.floor((room - 1) / 2), Math.floor((count - 1) / 2));
  if (peak < MIN_PINGPONG_PEAK) return undefined;
  return [...allFrames(peak + 1), ...allFrames(peak).reverse()];
}
