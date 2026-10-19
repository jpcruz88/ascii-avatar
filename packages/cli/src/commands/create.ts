import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BudgetExceededError,
  CREATION_CAP_USD,
  DEFAULT_MXN_PER_USD,
  FACE_IDS,
  POSE_IDS,
  assertWithinCap,
  createAgent,
  decodeImage,
  formatMxn,
  frameToAnsi,
  imageToAscii,
  listPoses,
  loadAgent,
  missingFaces,
  recoverPoses,
  saveFace,
  savePose,
  validateAgentName,
  type AgentStyle,
  type AsciiMode,
  type FaceId,
  type Ledger,
  type PoseId,
} from '@ascii-avatar/core';
import {
  ENGRAVING_BASE_PROMPT,
  ENGRAVING_FACE_PROMPTS,
  ESTIMATED_FACE_COST_USD,
  FACE_PROMPTS,
  ImageRefusedError,
  POSE_PROMPTS,
  PROMPTS_VERSION,
  estimateCreationCostUsd,
  generateImage,
  type EngravingFaceId,
  type ImageClient,
  type ImageEditInput,
} from '@ascii-avatar/gemini';
import { loadConfig, saveConfig } from '../config.js';
import { ImageInputError, readPhoto, readSize, toPng, type Photo } from '../image-input.js';

export interface CreateDeps {
  root: string;
  name: string;
  /** Obligatoria si el agente no existe; si ya existe se reutiliza la foto guardada. */
  photoPath?: string;
  imageClient: ImageClient;
  ledger: Ledger;
  /** Tope de gasto de creación por agente. Por defecto `CREATION_CAP_USD`. */
  cap?: number;
  ask: (question: string) => Promise<boolean>;
  out: (line: string) => void;
  mode: AsciiMode;
  cols: number;
  /** Tipo de cambio para mostrar los montos en pesos. Por defecto `DEFAULT_MXN_PER_USD`. */
  mxnPorUsd?: number;
  /**
   * Estilo pedido con `--estilo`. Sin indicarlo: el que tenga guardado el agente o, si es nuevo,
   * `grabado`. Un agente viejo sin estilo guardado cuenta como `foto`.
   */
  style?: AgentStyle;
  /** Solo estilo `grabado`: generar también las 8 poses. Por defecto sí; `--sin-poses` lo apaga. */
  poses?: boolean;
}

export interface CreateResult {
  status: 'done' | 'declined' | 'capped' | 'failed';
  message: string;
}

const PREVIEW_FACE: FaceId = 'mouth_open';

/** Error esperado de esta orden: su mensaje ya está en español y es seguro mostrarlo tal cual. */
class CreateFailure extends ImageInputError {}

function storedPhotoPath(root: string, name: string): string {
  const dir = join(root, 'agents', name);
  for (const ext of ['png', 'jpg', 'webp']) {
    const file = join(dir, `photo.${ext}`);
    if (existsSync(file)) return file;
  }
  throw new CreateFailure(`El agente "${name}" no tiene su foto guardada. Pásala con la ruta de la foto.`);
}

const AUTH_FAILURE = /api key|API_KEY|permission|unauth|401|403/i;
const KEY_HINT = 'Revisa tu llave: borra ~/.ascii-avatar/secrets.json y vuelve a correr avatar create.';

/** Texto corto y sin llaves de API ni trazas, para mostrar un error inesperado. */
function safeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = (raw.split('\n')[0] ?? '')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[llave oculta]')
    .replace(/([?&]key=)[^\s&]+/gi, '$1[oculta]')
    .trim();
  const short = clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
  return AUTH_FAILURE.test(raw.split('\n')[0] ?? '') ? `${short.replace(/\.$/, '')}. ${KEY_HINT}` : short;
}

/** "1 grabado base + 7 caras + 8 poses": lo que falta generar en el estilo grabado. */
function grabadoParts(needBase: boolean, faces: number, poses: number): string {
  const parts: string[] = [];
  if (needBase) parts.push('1 grabado base');
  if (faces > 0) parts.push(`${faces} ${faces === 1 ? 'cara' : 'caras'}`);
  if (poses > 0) parts.push(`${poses} ${poses === 1 ? 'pose' : 'poses'}`);
  return parts.join(' + ');
}

export async function runCreate(deps: CreateDeps): Promise<CreateResult> {
  const { root, name, imageClient, ledger, ask, out } = deps;
  const cap = deps.cap ?? CREATION_CAP_USD;
  const rate = deps.mxnPorUsd ?? DEFAULT_MXN_PER_USD;
  /** Los montos se manejan en USD; al usuario se le muestran siempre en pesos. */
  const mxn = (usd: number): string => formatMxn(usd, rate);
  const agentDir = join(root, 'agents', name);
  let style: AgentStyle = deps.style ?? 'grabado';
  let withPoses = false;
  const manualHint = (): string =>
    (style === 'grabado'
      ? 'Gemini rechazó generar una imagen (probable filtro de contenido). Lo ya generado quedó guardado. '
      : 'Gemini rechazó editar la foto (probable filtro de contenido). ') +
    `Puedes aportar tus propias 8 imágenes PNG, ` +
    `con estos nombres: ${FACE_IDS.join(', ')}. Ponlas en una carpeta y corre: avatar create ${name} --caras <carpeta>`;
  const missingPoses = (): PoseId[] => {
    if (!withPoses) return [];
    const have = new Set(existsSync(agentDir) ? listPoses(root, name) : []);
    return POSE_IDS.filter((id) => !have.has(id));
  };

  try {
    validateAgentName(name);
    const exists = existsSync(join(agentDir, 'agent.json'));
    let missing: FaceId[] = [...FACE_IDS];
    let photo: Photo | undefined;

    if (exists) {
      const stored = loadAgent(root, name).style ?? 'foto';
      if (deps.style !== undefined && deps.style !== stored) {
        throw new CreateFailure(
          `El agente "${name}" se creó con el estilo ${stored} y no se puede cambiar a ${deps.style}. ` +
            `Usa otro nombre para empezar con el estilo nuevo, o borra la carpeta ${agentDir} para empezar de cero. ` +
            'No se gastó nada.',
        );
      }
      style = stored;
    }
    withPoses = style === 'grabado' && deps.poses !== false;
    if (style === 'foto' && deps.poses === false) {
      out('Aviso: --sin-poses no tiene efecto con el estilo foto (ese estilo no genera poses).');
    }

    if (exists) {
      // Un reemplazo de poses interrumpido se arregla antes de contar: si no, se volverían a cobrar.
      recoverPoses(root, name);
      missing = missingFaces(root, name);
      if (missing.length === 0 && missingPoses().length === 0) {
        const what = withPoses ? `sus ${FACE_IDS.length} caras y ${POSE_IDS.length} poses` : `las ${FACE_IDS.length} caras`;
        return { status: 'done', message: `El agente "${name}" ya tiene ${what}. No hay nada que generar.` };
      }
      photo = await readPhoto(storedPhotoPath(root, name));
      if (deps.photoPath !== undefined) {
        const given = await readPhoto(deps.photoPath);
        if (!given.buf.equals(photo.buf)) {
          throw new CreateFailure(
            `El agente "${name}" ya tiene otra foto guardada y no se puede cambiar. ` +
              `Usa otro nombre para empezar con la foto nueva, o borra la carpeta ${agentDir} para empezar de cero. ` +
              'No se gastó nada.',
          );
        }
      }
      out('Se reutiliza la foto guardada del agente.');
    } else {
      if (deps.photoPath === undefined) {
        throw new CreateFailure(`El agente "${name}" no existe: indica la ruta de la foto para crearlo.`);
      }
      photo = await readPhoto(deps.photoPath);
    }

    /**
     * Una llamada de pago: tope antes, y guardar y registrar el costo justo después. Con `fit`, la
     * imagen se lleva al lienzo del grabado base y, si llegó de otro tamaño, se avisa.
     */
    const pay = async (
      done: string,
      input: ImageEditInput,
      save: (png: Buffer) => void,
      fit?: { size: { width: number; height: number }; what: string; file: string },
    ): Promise<Buffer> => {
      assertWithinCap(ledger.spentCreation(name), ESTIMATED_FACE_COST_USD, cap, rate);
      const { image, costUsd, costEstimated } = await generateImage(imageClient, input);
      let png: Buffer;
      let warning: string | undefined;
      try {
        if (fit !== undefined) {
          const got = await readSize(image, fit.what);
          if (got.width !== fit.size.width || got.height !== fit.size.height) {
            warning =
              `Aviso: ${fit.what} llegó de ${got.width}×${got.height} px y se ajustó al lienzo del grabado base ` +
              `(${fit.size.width}×${fit.size.height} px). Si se ve desalineada, borra ${fit.file} y vuelve a correr ` +
              `avatar create ${name} para regenerarla.`;
          }
        }
        png = await toPng(image, fit?.size); // Gemini devuelve JPEG; todo se guarda siempre como PNG real
        save(png);
      } finally {
        ledger.record('create', name, costUsd); // lo cobrado se registra aunque falle la conversión o el guardado
      }
      out(`${done} (${mxn(costUsd)}${costEstimated ? ' (estimado)' : ''})`);
      if (warning !== undefined) out(warning);
      return png;
    };
    const preview = async (png: Buffer, mode: AsciiMode): Promise<void> => {
      try {
        out(frameToAnsi(imageToAscii(await decodeImage(png), { cols: deps.cols, mode })));
      } catch {
        out('(no se pudo mostrar la vista previa)');
      }
    };

    if (style === 'grabado') {
      const needBase = missing.includes('neutral');
      const faces = missing.filter((id): id is EngravingFaceId => id !== 'neutral');
      const poses = missingPoses();
      const total = (needBase ? 1 : 0) + faces.length + poses.length;
      out(`Estilo grabado: ${grabadoParts(needBase, faces.length, poses.length)} (${total} imágenes).`);
      out(`Estimado: ${mxn(estimateCreationCostUsd(total))} (tope ${mxn(cap)})`);
      out(`Ya gastado en este agente: ${mxn(ledger.spentCreation(name))}`);
      if (!(await ask('¿Generar las imágenes? (s/N)'))) {
        return { status: 'declined', message: 'Cancelado: no se gastó nada.' };
      }
      if (!exists) createAgent(root, name, photo.buf, { promptsVersion: PROMPTS_VERSION, style: 'grabado' });

      if (needBase) {
        const png = await pay(
          'Grabado base listo',
          { prompt: ENGRAVING_BASE_PROMPT, image: photo.buf, mimeType: photo.mimeType },
          (p) => saveFace(root, name, 'neutral', p),
        );
        await preview(png, 'grabado');
        const left = total - 1;
        if (left > 0 && !(await ask('¿Se parece? ¿Seguimos? (s/N)'))) {
          return {
            status: 'declined',
            message:
              `Te quedaste con el grabado base (ya cobrado). Faltan ${left} imágenes; vuelve a correr el comando para continuar. ` +
              `Para empezar de cero con otra foto u otro estilo, usa otro nombre de agente o borra la carpeta ${agentDir}.`,
          };
        }
      }

      // Las caras y las poses salen de editar el grabado base, no la foto: así conservan el estilo.
      const base = readFileSync(join(agentDir, 'faces', 'neutral.png'));
      const size = await readSize(base, 'el grabado base');
      const fromBase = (prompt: string): ImageEditInput => ({ prompt, image: base, mimeType: 'image/png' });
      for (const id of faces) {
        await pay(`Cara ${id} lista`, fromBase(ENGRAVING_FACE_PROMPTS[id]), (p) => saveFace(root, name, id, p), {
          size,
          what: `la cara ${id}`,
          file: join(agentDir, 'faces', `${id}.png`),
        });
      }
      for (const id of poses) {
        await pay(`Pose ${id} lista`, fromBase(POSE_PROMPTS[id]), (p) => savePose(root, name, id, p), {
          size,
          what: `la pose ${id}`,
          file: join(agentDir, 'poses', `${id}.png`),
        });
      }

      const left = [...missingFaces(root, name), ...missingPoses()];
      if (left.length > 0) throw new CreateFailure(`Faltan imágenes tras la generación: ${left.join(', ')}.`);
      activateIfNone(root, name);
      const what = withPoses ? `sus ${FACE_IDS.length} caras y ${POSE_IDS.length} poses` : `sus ${FACE_IDS.length} caras (sin poses)`;
      return {
        status: 'done',
        message:
          `Listo: el agente "${name}" tiene ${what} en estilo grabado. ` +
          `Gasto total en creación: ${mxn(ledger.spentCreation(name))}.\n` +
          `Opcional: para movimientos fluidos (6 clips de cabeza, generados en tu equipo y sin costo; ` +
          `requiere LivePortrait instalado, ver el README), corre: avatar movimientos ${name}`,
      };
    }

    out(`Estimado: ${mxn(estimateCreationCostUsd(missing.length))} (tope ${mxn(cap)})`);
    out(`Ya gastado en este agente: ${mxn(ledger.spentCreation(name))}`);
    if (!(await ask('¿Generar las caras? (s/N)'))) {
      return { status: 'declined', message: 'Cancelado: no se gastó nada.' };
    }

    if (!exists) createAgent(root, name, photo.buf, { promptsVersion: PROMPTS_VERSION, style: 'foto' });
    const fromPhoto = (id: FaceId): ImageEditInput => ({ prompt: FACE_PROMPTS[id], image: photo.buf, mimeType: photo.mimeType });
    const generate = (id: FaceId): Promise<Buffer> =>
      pay(`Cara ${id} lista`, fromPhoto(id), (p) => saveFace(root, name, id, p));

    if (missing.includes(PREVIEW_FACE)) {
      const png = await generate(PREVIEW_FACE);
      await preview(png, deps.mode);
      missing = missing.filter((id) => id !== PREVIEW_FACE);
      if (missing.length > 0 && !(await ask('¿Seguimos con las demás caras? (s/N)'))) {
        return {
          status: 'declined',
          message: `Te quedaste con la vista previa (ya cobrada). Faltan ${missing.length} caras; vuelve a correr el comando para continuar.`,
        };
      }
    }

    for (const id of missing) await generate(id);

    const left = missingFaces(root, name);
    if (left.length > 0) throw new CreateFailure(`Faltan caras tras la generación: ${left.join(', ')}.`);
    activateIfNone(root, name);
    return {
      status: 'done',
      message: `Listo: el agente "${name}" tiene sus ${FACE_IDS.length} caras. Gasto total en creación: ${mxn(ledger.spentCreation(name))}.`,
    };
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      const faces = missingFaces(root, name);
      if (style === 'grabado') {
        const poses = missingPoses();
        const left = [
          ...(faces.length > 0 ? [`caras: ${faces.join(', ')}`] : []),
          ...(poses.length > 0 ? [`poses: ${poses.join(', ')}`] : []),
        ];
        return {
          status: 'capped',
          message: `Se alcanzó el tope de creación (${mxn(cap)}). Lo ya generado queda guardado; faltan ${left.join('; ')}.`,
        };
      }
      return {
        status: 'capped',
        message:
          `Se alcanzó el tope de creación (${mxn(cap)}). Las caras ya generadas quedan guardadas; ` +
          `faltan: ${faces.join(', ')}.`,
      };
    }
    if (error instanceof ImageRefusedError) return { status: 'failed', message: manualHint() };
    if (error instanceof ImageInputError) return { status: 'failed', message: error.message };
    const what = style === 'grabado' ? 'las imágenes' : 'las caras';
    return {
      status: 'failed',
      message: `No se pudo completar la creación: ${safeMessage(error).replace(/\.$/, '')}. Lo ya generado quedó guardado; al volver a correr solo se generan ${what} que faltan.`,
    };
  }
}

/** Si no hay agente activo, deja este como activo. */
function activateIfNone(root: string, name: string): void {
  const config = loadConfig(root);
  if (config.activeAgent === null) saveConfig(root, { ...config, activeAgent: name });
}
