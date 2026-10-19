/** Apertura de la boca: 0 cerrada, 2 a medias, 4 abierta; 1 y 3 son los cuadros intermedios. */
export type MouthLevel = 0 | 1 | 2 | 3 | 4;

export interface MouthStep {
  /** Milisegundos desde el inicio del audio en que empieza este nivel. */
  tMs: number;
  level: MouthLevel;
}

const TOP_LEVEL = 4;

/** Duración de cada ventana de análisis del audio. */
const WINDOW_MS = 20;
/** Antes de cambiar de dirección (abrir → cerrar o al revés) un nivel se mantiene al menos esto. */
export const MOUTH_MIN_HOLD_MS = 60;
/** RMS absoluto por debajo del cual una ventana es silencio (boca cerrada). */
const NOISE_FLOOR = 0.005;
/**
 * Percentil del RMS de las ventanas con sonido que cuenta como «abierta del todo». Con el 95 los
 * golpes de las oclusivas fijaban la referencia y la voz normal se quedaba en el nivel 2; con el
 * 85 las sílabas acentuadas llegan a 3 y 4.
 */
const REFERENCE_PERCENTILE = 0.85;
/** Constantes de tiempo del seguidor de envolvente: abre rápido y cierra más despacio. */
const ATTACK_MS = 25;
const RELEASE_MS = 90;
/** Curva suave: con exponente > 1 los sonidos débiles abren un poco menos. */
const EASING_EXPONENT = 1.2;
/** Fronteras entre niveles sobre la apertura suavizada (0..1) y margen de histéresis a cada lado. */
const LEVEL_EDGES = [0.2, 0.4, 0.6, 0.8] as const;
const HYSTERESIS = 0.05;

const SYNTHETIC_MIN_MS = 1200;
const SYNTHETIC_MS_PER_CHAR = 55;
/** Paso de la boca sin audio: un cuadro a 24 fps, para que cada nivel intermedio llegue a verse. */
const SYNTHETIC_TICK_MS = 40;
/** Redondeo algo generoso del arco: las sílabas cortas llegan a abrir un nivel más. */
const SYNTHETIC_ROUND_UP = 0.3;

function clampLevel(n: number): MouthLevel {
  return Math.max(0, Math.min(TOP_LEVEL, Math.round(n))) as MouthLevel;
}

/** Pasos comprimidos: solo los cambios de nivel, a `tickMs` por elemento. */
function toSteps(perTick: readonly MouthLevel[], tickMs: number): MouthStep[] {
  const steps: MouthStep[] = [{ tMs: 0, level: perTick[0] ?? 0 }];
  perTick.forEach((level, i) => {
    if (level !== steps.at(-1)!.level) steps.push({ tMs: i * tickMs, level });
  });
  return steps;
}

/**
 * RMS de cada ventana de `windowSize` muestras (la última puede ser más corta). Una ventana con una
 * muestra NaN o infinita vale 0 (silencio): si no, el seguidor de envolvente quedaría en NaN y la
 * boca congelada hasta el final.
 */
function windowRms(samples: Float32Array, windowSize: number): number[] {
  const rms: number[] = [];
  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!;
    const value = Math.sqrt(sum / (end - start));
    rms.push(Number.isFinite(value) ? value : 0);
  }
  return rms;
}

/**
 * Convierte audio en pasos de boca con una apertura continua:
 *
 * 1. RMS por ventana de 20 ms; una ventana bajo el piso absoluto (0.005), o con una muestra NaN o
 *    infinita, es silencio.
 * 2. Se normaliza contra el percentil 85 de las ventanas con sonido (robusto a picos sueltos).
 * 3. Seguidor de envolvente: ataque de ~25 ms y liberación de ~90 ms.
 * 4. Curva suave (`x^1.2`) y cuantización a 5 niveles con histéresis (no cambia por diferencias mínimas).
 * 5. La boca se mueve de a un nivel por ventana (pasa por los intermedios) y, antes de cambiar de
 *    dirección, mantiene el nivel al menos 60 ms (no tiembla).
 *
 * El primer paso está siempre en `tMs` 0. Determinista.
 */
export function mouthTimeline(samples: Float32Array, sampleRate: number): MouthStep[] {
  const windowSize = Math.max(1, Math.round((sampleRate * WINDOW_MS) / 1000));
  const rms = windowRms(samples, windowSize);
  const voiced = rms.filter((v) => v >= NOISE_FLOOR).sort((a, b) => a - b);
  if (voiced.length === 0) return [{ tMs: 0, level: 0 }];
  const reference = voiced[Math.max(0, Math.ceil(REFERENCE_PERCENTILE * voiced.length) - 1)]!;

  const attack = 1 - Math.exp(-WINDOW_MS / ATTACK_MS);
  const release = 1 - Math.exp(-WINDOW_MS / RELEASE_MS);
  const holdWindows = Math.ceil(MOUTH_MIN_HOLD_MS / WINDOW_MS);

  let envelope = 0;
  let level = 0;
  let direction = 0;
  let heldWindows = Infinity;
  const perWindow: MouthLevel[] = [];
  for (const v of rms) {
    const x = v < NOISE_FLOOR ? 0 : Math.min(1, v / reference);
    envelope += (x - envelope) * (x > envelope ? attack : release);
    const openness = envelope ** EASING_EXPONENT;

    // Nivel objetivo con histéresis: para cruzar una frontera hay que pasarla por el margen.
    let target = level;
    while (target < TOP_LEVEL && openness >= LEVEL_EDGES[target]! + HYSTERESIS) target++;
    while (target > 0 && openness < LEVEL_EDGES[target - 1]! - HYSTERESIS) target--;

    const step = Math.sign(target - level);
    const reverses = step !== 0 && direction !== 0 && step !== direction;
    if (step !== 0 && (!reverses || heldWindows >= holdWindows)) {
      level += step;
      direction = step;
      heldWindows = 1;
    } else {
      heldWindows++;
    }
    perWindow.push(level as MouthLevel);
  }
  return toSteps(perWindow, WINDOW_MS);
}

const VOWEL_GROUPS = /[aeiouáéíóúüàèìòùâêîôû]+/giu;
const WORDS = /[\p{L}\p{N}]+/gu;
const ACCENTED = /[áéíóúàèìòùâêîôû]/iu;
/**
 * Peso (en caracteres de 55 ms) de las pausas: la puntuación alarga el silencio y la duración. Un
 * fin de frase deja la boca cerrada unos 440 ms (lo bastante para que el avatar asienta entre
 * frases) y una coma unos 220 ms.
 */
const SHORT_PAUSE = /[,;:]/u;
const LONG_PAUSE = /[.!?…]/u;
const SHORT_PAUSE_WEIGHT = 3;
const LONG_PAUSE_WEIGHT = 7;
/** Tope del peso entre dos palabras: ninguna pausa pasa de unos 550 ms por mucha puntuación que se junte. */
const MAX_GAP_WEIGHT = 10;
/** Abreviaturas cuyo punto final no cierra la frase si sigue una minúscula. */
const ABBREVIATIONS = new Set(['etc', 'ej', 'p.ej', 'e.g', 'i.e', 'vs', 'sr', 'sra', 'dr', 'dra', 'aprox', 'pág', 'núm', 'no']);
const DIGIT = /\p{N}/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const LOWER = /\p{Ll}/u;

/**
 * Si el punto en `i` no es fin de frase: entre dígitos (`3.14`), pegado a una letra o dígito
 * (`e.g`, `mouth.ts`) o al final de una abreviatura conocida seguida de una minúscula (`etc. y`).
 */
function isInnerDot(chars: readonly string[], i: number): boolean {
  const prev = chars[i - 1] ?? '';
  const next = chars[i + 1] ?? '';
  if (WORD_CHAR.test(next) && WORD_CHAR.test(prev)) return true;
  let j = i + 1;
  while (j < chars.length && /\s/u.test(chars[j]!)) j++;
  if (j === i + 1 || j >= chars.length || !LOWER.test(chars[j]!)) return false;
  let k = i;
  while (k > 0 && (WORD_CHAR.test(chars[k - 1]!) || chars[k - 1] === '.')) k--;
  return ABBREVIATIONS.has(chars.slice(k, i).join('').toLowerCase());
}

/**
 * Peso de cada carácter (por punto de código): 1, o más si es una pausa. Varios signos de pausa
 * seguidos (`...`, `?!`) cuentan como uno; un punto que no cierra frase pesa 1; y el peso de lo que
 * hay entre dos palabras se recorta a `MAX_GAP_WEIGHT`.
 */
function charWeights(text: string): number[] {
  const chars = [...text];
  const weights = chars.map((c, i): number => {
    if (LONG_PAUSE.test(c)) {
      if (i > 0 && LONG_PAUSE.test(chars[i - 1]!)) return 0;
      if (c === '.' && chars[i + 1] !== '.' && isInnerDot(chars, i)) return 1;
      return LONG_PAUSE_WEIGHT;
    }
    if (SHORT_PAUSE.test(c)) {
      return c === ',' && DIGIT.test(chars[i - 1] ?? '') && DIGIT.test(chars[i + 1] ?? '') ? 1 : SHORT_PAUSE_WEIGHT;
    }
    return 1;
  });
  let gap = 0;
  chars.forEach((c, i) => {
    if (WORD_CHAR.test(c)) {
      gap = 0;
      return;
    }
    const allowed = Math.max(0, MAX_GAP_WEIGHT - gap);
    weights[i] = Math.min(weights[i]!, allowed);
    gap += weights[i]!;
  });
  return weights;
}

/** Cuánto abre cada vocal en su sílaba tónica: la a abre más, la i y la u menos. */
function vowelOpenness(vowels: string): number {
  const plain = vowels.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (plain.includes('a')) return 4;
  if (plain.includes('e') || plain.includes('o')) return 3;
  return 2;
}

/** Hash simple y estable (FNV-1a de 32 bits) de una cadena. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

interface Syllable {
  startMs: number;
  endMs: number;
  peak: number;
  /** Abre desde cerrada (inicio de palabra) o desde el nivel 1 (dentro de la palabra). */
  fromClosed: boolean;
  /** Cierra del todo al terminar (fin de palabra) o baja solo al nivel 1. */
  toClosed: boolean;
}

/** Sílabas aproximadas del texto, con su tiempo y su apertura máxima. */
function syllables(text: string, durationMs: number): Syllable[] {
  // Tiempo de inicio de cada carácter (unidad UTF-16) según su peso; la duración total no cambia.
  const startWeight: number[] = [];
  const weights = charWeights(text);
  let total = 0;
  let n = 0;
  for (const c of text) {
    startWeight.push(total);
    total += weights[n++]!;
    if (c.length === 2) startWeight.push(total - 0.5);
  }
  startWeight.push(total);
  const msAt = (index: number): number => (startWeight[index]! / total) * durationMs;

  const out: Syllable[] = [];
  for (const word of text.matchAll(WORDS)) {
    const start = word.index;
    const end = start + word[0].length;
    const groups = [...word[0].matchAll(VOWEL_GROUPS)];
    // Cortes: la consonante justo antes de cada vocal (desde la segunda) pasa a la sílaba siguiente.
    const cuts = [start];
    for (let j = 1; j < groups.length; j++) {
      const prevEnd = start + groups[j - 1]!.index + groups[j - 1]![0].length;
      cuts.push(Math.max(prevEnd, start + groups[j]!.index - 1));
    }
    cuts.push(end);
    const count = cuts.length - 1;
    const accented = groups.findIndex((g) => ACCENTED.test(g[0]));
    const stressed = accented >= 0 ? accented : Math.max(0, count - 2);
    for (let k = 0; k < count; k++) {
      const vowels = groups[k]?.[0] ?? '';
      let peak = groups.length === 0 ? 2 : vowelOpenness(vowels);
      // Variación estable: la tónica abre del todo y las átonas, según un hash, igual o un nivel menos.
      if (k !== stressed && hash(`${text.slice(cuts[k], cuts[k + 1])}#${out.length}`) % 2 === 0) peak -= 1;
      out.push({
        startMs: msAt(cuts[k]!),
        endMs: msAt(cuts[k + 1]!),
        peak: Math.max(1, peak),
        fromClosed: k === 0,
        toClosed: k === count - 1,
      });
    }
  }
  return out;
}

/**
 * Movimiento de boca sin audio, para cuando la voz está apagada. Es una función pura del texto:
 * cada sílaba aproximada (corte antes de cada grupo de vocales; una palabra sin vocales es una
 * sílaba) dibuja un arco que abre y cierra pasando por los niveles intermedios. La vocal decide
 * cuánto abre (a > e, o > i, u), la sílaba tónica abre más y un hash del texto varía los picos.
 * Entre palabras la boca cierra un momento y la puntuación la deja cerrada más tiempo (un fin de
 * frase unos 440 ms, una coma unos 220 ms; `...` o `?!` cuentan como un solo fin de frase, el punto
 * de `3.14`, `mouth.ts` o `etc. y` no es pausa, y ninguna pausa pasa de unos 550 ms). Dura 55 ms
 * por carácter, con cada coma contando como 3 y cada fin de frase como 7, y al menos 1200 ms;
 * empieza y termina en 0 y nunca salta más de un nivel por paso.
 */
export function syntheticMouthTimeline(text: string): { steps: MouthStep[]; durationMs: number } {
  // Como la longitud en unidades UTF-16, con el peso de las pausas encima.
  let weight = text.length;
  for (const w of charWeights(text)) weight += w - 1;
  const durationMs = Math.max(SYNTHETIC_MIN_MS, SYNTHETIC_MS_PER_CHAR * weight);
  const sylls = syllables(text, durationMs);
  const ticks = Math.floor(durationMs / SYNTHETIC_TICK_MS);

  // Objetivo por paso: el arco de la sílaba que cae en el centro del paso, o 0 entre palabras.
  const target: number[] = [];
  let s = 0;
  for (let i = 0; i < ticks; i++) {
    const t = (i + 0.5) * SYNTHETIC_TICK_MS;
    while (s < sylls.length && sylls[s]!.endMs <= t) s++;
    const syl = sylls[s];
    if (syl === undefined || t < syl.startMs) {
      target.push(0);
      continue;
    }
    const u = (t - syl.startMs) / (syl.endMs - syl.startMs);
    const base = (u < 0.5 ? syl.fromClosed : syl.toClosed) ? 0 : 1;
    target.push(base + (syl.peak - base) * Math.sqrt(Math.sin(Math.PI * u)));
  }
  if (target.length > 0) {
    target[0] = 0;
    target[target.length - 1] = 0;
  }

  // La boca más abierta posible que no supera el objetivo y cambia de a un nivel por paso:
  // los cierres se respetan y los arcos cortos no alcanzan su pico.
  const level = target.map((v) => Math.max(0, Math.round(v + SYNTHETIC_ROUND_UP)));
  for (let i = 1; i < level.length; i++) level[i] = Math.min(level[i]!, level[i - 1]! + 1);
  for (let i = level.length - 2; i >= 0; i--) level[i] = Math.min(level[i]!, level[i + 1]! + 1);

  return { steps: toSteps(level.map(clampLevel), SYNTHETIC_TICK_MS), durationMs };
}
