#!/usr/bin/env node
// Punto de entrada del comando `avatar`. Los demás comandos se agregan en tareas posteriores.
import { runPanel } from './commands/panel.js';
import { defaultRoot } from './config.js';

const [command] = process.argv.slice(2);
if (command === 'panel') {
  process.exitCode = await runPanel({ root: defaultRoot() });
}
