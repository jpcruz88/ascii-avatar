import { loadAgent, updateAgentVoice, type AgentConfig } from '@ascii-avatar/core';

export interface VozOptions {
  root: string;
  name: string;
  /** Nombre de la voz de Gemini (por ejemplo `Algenib`). */
  voz?: string;
  /** Estilo de voz en texto libre; `''` lo quita. */
  estilo?: string;
}

function describe(agent: AgentConfig): string {
  const estilo = agent.voiceStyle === undefined ? '(sin estilo)' : agent.voiceStyle;
  return `Voz de ${agent.name}: ${agent.voice}\nEstilo: ${estilo}`;
}

/**
 * `avatar voz <nombre> [--voz <Nombre>] [--estilo "<texto>"]`: sin banderas muestra la voz y el estilo
 * del agente; con ellas los guarda en su `agent.json`. El panel lee el agente al abrirse.
 */
export function runVoz(opts: VozOptions): { ok: boolean; message: string } {
  const { root, name, voz, estilo } = opts;
  try {
    if (voz === undefined && estilo === undefined) {
      return { ok: true, message: describe(loadAgent(root, name)) };
    }
    const agent = updateAgentVoice(root, name, {
      ...(voz === undefined ? {} : { voice: voz }),
      ...(estilo === undefined ? {} : { voiceStyle: estilo }),
    });
    return {
      ok: true,
      message: `${describe(agent)}\nGuardado. Si el panel está abierto, ciérralo (q) y vuelve a abrirlo para que use el cambio.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? (error.message.split('\n')[0] ?? 'Error.') : 'Error.' };
  }
}
