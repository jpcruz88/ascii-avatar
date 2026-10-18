import { randomBytes } from 'node:crypto';
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Escribe `data` en `path` de forma atómica: primero a un archivo temporal en la
 * misma carpeta (creado con `wx`, nombre único) y luego `renameSync` al destino.
 * Un corte a mitad de la escritura nunca deja un destino truncado; si falla, se
 * borra el temporal. Con `mode`, el temporal nace con esos permisos, así que el
 * contenido nunca es legible por otros ni por un instante.
 */
export function writeFileAtomic(path: string, data: string | Uint8Array, mode?: number): void {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, data, { flag: 'wx', ...(mode === undefined ? {} : { mode }) });
    if (mode !== undefined) chmodSync(tmp, mode);
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
