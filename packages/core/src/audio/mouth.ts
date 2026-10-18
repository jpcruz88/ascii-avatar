export type MouthLevel = 'closed' | 'mid' | 'open';

export interface MouthStep {
  /** Milisegundos desde el inicio del audio en que empieza este nivel. */
  tMs: number;
  level: MouthLevel;
}

/** Duración de cada ventana de análisis. */
const WINDOW_MS = 50;
/** Ningún nivel dura menos de esto (salvo el último). */
const MIN_HOLD_MS = 80;
/** RMS relativo al pico por debajo del cual la boca está cerrada. */
const CLOSED_BELOW = 0.15;
/** RMS relativo al pico por debajo del cual la boca está a medias. */
const MID_BELOW = 0.5;
/** RMS absoluto del pico por debajo del cual todo el clip se considera silencio. */
const NOISE_FLOOR = 0.005;

const SYNTHETIC_MIN_MS = 1200;
const SYNTHETIC_MS_PER_CHAR = 55;

/**
 * Convierte audio en pasos de boca: ventanas de 50 ms, RMS por ventana y niveles relativos al
 * pico del clip (< 15 % `closed`, < 50 % `mid`, resto `open`). Si el pico es ruido
 * (< 0.005) todo el clip queda `closed`. Una racha menor a 80 ms se fusiona con el nivel
 * anterior; la primera y la última racha están exentas.
 */
export function mouthTimeline(samples: Float32Array, sampleRate: number): MouthStep[] {
  const windowSize = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  const rms: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    rms.push(Math.sqrt(sum / (end - start)));
  }

  const peak = rms.reduce((max, v) => Math.max(max, v), 0);
  if (rms.length === 0 || peak < NOISE_FLOOR) return [{ tMs: 0, level: 'closed' }];

  const perWindow = rms.map((v): MouthLevel => {
    const ratio = v / peak;
    if (ratio < CLOSED_BELOW) return 'closed';
    if (ratio < MID_BELOW) return 'mid';
    return 'open';
  });

  // Rachas de ventanas consecutivas con el mismo nivel.
  const runs: { level: MouthLevel; startWindow: number; windows: number }[] = [];
  perWindow.forEach((level, i) => {
    const last = runs.at(-1);
    if (last !== undefined && last.level === level) last.windows++;
    else runs.push({ level, startWindow: i, windows: 1 });
  });

  // Fusiona hacia atrás las rachas cortas (excepto la primera y la última).
  const kept: { level: MouthLevel; startWindow: number }[] = [];
  runs.forEach((run, i) => {
    const prev = kept.at(-1);
    const isLast = i === runs.length - 1;
    const tooShort = run.windows * WINDOW_MS < MIN_HOLD_MS;
    if (prev === undefined) kept.push({ level: run.level, startWindow: run.startWindow });
    else if (prev.level === run.level) return;
    else if (tooShort && !isLast) return;
    else kept.push({ level: run.level, startWindow: run.startWindow });
  });

  return kept.map((r) => ({ tMs: r.startWindow * WINDOW_MS, level: r.level }));
}

const VOWELS = /[aeiouáéíóúüàèìòùâêîôûAEIOUÁÉÍÓÚÜÀÈÌÒÙÂÊÎÔÛ]+/g;
const WORDS = /[\p{L}\p{N}]+/gu;

/** Hash simple y estable (FNV-1a de 32 bits) de una cadena. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Movimiento de boca sin audio, para cuando la voz está apagada. Es una función pura del texto:
 * un pulso por grupo de vocales (o por palabra si no hay vocales), con `mid` u `open` según un
 * hash de los caracteres (alternando entre pulsos vecinos). Dura `max(1200, 55 * caracteres)` ms, empieza y termina en `closed`
 * y ningún nivel dura menos de 80 ms.
 */
export function syntheticMouthTimeline(text: string): { steps: MouthStep[]; durationMs: number } {
  const durationMs = Math.max(SYNTHETIC_MIN_MS, SYNTHETIC_MS_PER_CHAR * text.length);

  let groups = [...text.matchAll(VOWELS)];
  if (groups.length === 0) groups = [...text.matchAll(WORDS)];

  // Pulsos [inicio, fin, nivel]; el primero deja al menos 80 ms de `closed` y el último también.
  const pulses: { start: number; end: number; level: MouthLevel }[] = [];
  const latestEnd = durationMs - MIN_HOLD_MS;
  for (const group of groups) {
    const natural = Math.round((group.index / text.length) * durationMs);
    const prev = pulses.at(-1);
    let start = Math.max(natural, prev === undefined ? MIN_HOLD_MS : prev.end);
    // Un hueco menor a 80 ms no puede ser un `closed` válido: el pulso se pega al anterior.
    if (prev !== undefined && start - prev.end < MIN_HOLD_MS) start = prev.end;
    const end = start + Math.max(MIN_HOLD_MS, group[0].length * SYNTHETIC_MS_PER_CHAR);
    if (end > latestEnd) break;
    // El hash decide la fase y el índice alterna: siempre hay variedad entre pulsos vecinos.
    const level: MouthLevel = ((hash(group[0].toLowerCase()) >>> 16) + pulses.length) % 2 === 0 ? 'open' : 'mid';
    pulses.push({ start, end, level });
  }

  const steps: MouthStep[] = [{ tMs: 0, level: 'closed' }];
  const push = (tMs: number, level: MouthLevel): void => {
    if (steps.at(-1)!.level !== level) steps.push({ tMs, level });
  };
  for (const [i, pulse] of pulses.entries()) {
    push(pulse.start, pulse.level);
    const next = pulses[i + 1];
    if (next === undefined || next.start > pulse.end) push(pulse.end, 'closed');
  }
  return { steps, durationMs };
}
