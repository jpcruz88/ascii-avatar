import { loadConfig, saveConfig, socketPath } from '../config.js';
import { sendIfListening } from '../ipc.js';

/** `avatar voice on|off`: recuerda la opción y avisa al panel si está abierto. */
export async function runVoice(arg: string, root: string): Promise<{ ok: boolean; message: string }> {
  const value = arg.trim().toLowerCase();
  if (value !== 'on' && value !== 'off') return { ok: false, message: 'Uso: avatar voice on|off' };
  const on = value === 'on';
  saveConfig(root, { ...loadConfig(root), voice: on });
  const notified = await sendIfListening(socketPath(root), { type: 'voice', on });
  const state = on ? 'activada' : 'desactivada';
  return {
    ok: true,
    message: notified
      ? `Voz ${state}. Se avisó al panel abierto.`
      : `Voz ${state}. No hay un panel abierto: se aplicará la próxima vez que lo abras.`,
  };
}
