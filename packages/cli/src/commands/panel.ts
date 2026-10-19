import {
  Animator,
  Ledger,
  atlasMotion,
  loadAgent,
  loadApiKey,
  loadAtlas,
  missingFaces,
  type AsciiMode,
} from '@ascii-avatar/core';
import { createGeminiTtsClient, loadGeminiConfig, type TtsClient } from '@ascii-avatar/gemini';
import {
  ensureRoot,
  ledgerPath,
  loadConfig,
  socketPath,
} from '../config.js';
import { startServer } from '../ipc.js';
import { PanelController } from '../panel-controller.js';
import { createAfplayPlayer, type AudioPlayer } from '../player.js';
import { runTty } from '../tty.js';

export interface PanelOptions {
  root: string;
  agent?: string;
  cols?: number;
  mode?: AsciiMode;
}

/** Sin audio: la voz se trata como no disponible y el avatar solo hace gestos. */
const SILENT_PLAYER: AudioPlayer = {
  play: () => ({ done: Promise.resolve(), stop: () => undefined }),
};

function buildTts(root: string): TtsClient | null {
  const key = loadApiKey(root);
  if (key === undefined) return null;
  try {
    return createGeminiTtsClient(loadGeminiConfig(process.env, key));
  } catch {
    return null;
  }
}

/** Abre el panel en esta terminal. Devuelve el código de salida. */
export async function runPanel(opts: PanelOptions): Promise<number> {
  const { root } = opts;
  const config = loadConfig(root);
  const name = opts.agent ?? config.activeAgent;
  if (name === null || name === undefined) {
    console.error('No hay un agente activo. Crea uno con `avatar create`.');
    return 1;
  }
  let voice: string;
  let voiceStyle: string | undefined;
  try {
    ({ voice, voiceStyle } = loadAgent(root, name));
  } catch {
    console.error(`No se encontró el agente "${name}". Crea uno con \`avatar create\`.`);
    return 1;
  }
  const missing = missingFaces(root, name);
  if (missing.length > 0) {
    console.error(`Al agente "${name}" le faltan caras (${missing.join(', ')}). Vuelve a correr \`avatar create\`.`);
    return 1;
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error('El panel necesita una terminal interactiva.');
    return 1;
  }

  ensureRoot(root);
  const cols = Math.min(opts.cols ?? config.cols, process.stdout.columns || config.cols);
  const mode = opts.mode ?? config.mode;
  const atlas = await loadAtlas(root, name, { cols, mode });

  let player: AudioPlayer = SILENT_PLAYER;
  let tts = buildTts(root);
  try {
    player = createAfplayPlayer();
  } catch {
    tts = null;
  }

  // Reloj monótono que arranca cerca de 0: el animador se pone al día en bucle si recibe Date.now().
  const now = (): number => performance.now();
  // Con poses o clips el avatar hace gestos; sin ellos, solo parpadea y habla como siempre.
  const animator = new Animator({ motion: atlasMotion(atlas) });
  animator.idle(now());
  const controller = new PanelController({
    root,
    animator,
    ledger: new Ledger(ledgerPath(root)),
    tts,
    player,
    config,
    agent: name,
    voice,
    ...(voiceStyle === undefined ? {} : { voiceStyle }),
    now,
  });

  // Si el proceso cae, que no quede un `afplay` huérfano ni el WAV temporal.
  process.on('exit', () => controller.stopAudio());
  let server;
  try {
    server = await startServer(socketPath(root), (m) => void controller.handle(m));
  } catch (error) {
    controller.close();
    console.error(error instanceof Error ? `No se pudo abrir el panel: ${error.message}` : String(error));
    return 1;
  }
  try {
    await runTty({
      agent: name,
      paper: mode === 'grabado',
      getFrame: () => atlas[animator.frame(now())] ?? atlas.neutral,
      speaking: () => animator.speaking(now()),
      fast: () => animator.fastFrames(now()),
      voiceOn: () => controller.voiceOn(),
      spentToday: () => controller.spentToday(),
      mxnPorUsd: config.mxnPorUsd,
      notice: () => controller.notice(),
      onToggleVoice: () => controller.setVoice(!controller.voiceOn()),
    });
  } finally {
    controller.close();
    await server.close();
  }
  return 0;
}
