# ascii-avatar V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un panel de terminal con la cara ASCII de un agente (creada desde una foto con Gemini) que reacciona, gesticula y opcionalmente habla cada respuesta de Claude Code.

**Architecture:** Monorepo TypeScript con tres paquetes: `core` (ASCII, audio, animación, presupuesto, almacén del agente; sin red), `gemini` (único sitio que habla con la API de Gemini, detrás de interfaces pequeñas para poder probar con dobles) y `cli` (comandos `avatar`, panel, canal local por socket Unix, hook de Claude Code). Un hook de Claude Code envía texto por el socket al panel, que vive en un split que abre el usuario.

**Tech Stack:** Node ≥ 20 (la máquina tiene 26), TypeScript estricto ESM, npm workspaces, Vitest, tsx, `sharp` (decodificar imágenes), `@google/genai` (API Interactions de Gemini), `afplay` (audio en macOS).

**Spec:** `docs/superpowers/specs/2026-10-18-ascii-avatar-design.md` (con las correcciones de la sección "Correcciones al spec" al final de este plan; léelas primero).

## Global Constraints

- Licencia MIT; todo el código en TypeScript; pruebas con Vitest (TDD: prueba que falla primero, luego código mínimo).
- Color de 24 bits en terminal (`\x1b[38;2;R;G;Bm`); panel de 60 a 80 columnas por defecto, ancho configurable.
- Tope duro de creación por agente: **$1.60 USD**; meta normal < **$0.60 USD**; límite diario de voz por defecto **$0.30 USD**, configurable. El estimado se muestra antes de gastar y hay confirmación explícita.
- La llave de Gemini nunca va en el repo ni en la carpeta del agente; vive en `~/.ascii-avatar/secrets.json` con permisos `0600` (o en `GEMINI_API_KEY`).
- Una sola llave de Gemini para imágenes y voz. Claude es el cerebro; el avatar solo es la cara.
- Todas las imágenes de un agente comparten cámara, pose, luz y encuadre; solo cambia la cara.
- Nunca se lee en voz alta la respuesta completa: solo un resumen corto hecho con reglas locales (sin código, rutas, URLs ni tablas).
- El panel lo abre el usuario a mano (`avatar panel`). Interruptor de voz: `avatar voice on|off` más la tecla `v` en el panel; recuerda la última opción.
- macOS primero (`afplay`); el reproductor va detrás de una interfaz para añadir Linux después.
- El hook de Claude Code nunca debe bloquear ni romper a Claude Code: si el panel no corre, sale con código 0 en menos de 500 ms.
- Los modelos de Gemini y sus precios cambian: ids y tarifas viven en `packages/gemini/src/models.ts` y `pricing.ts`, con override por variable de entorno; el costo real se calcula con los tokens de uso que devuelve la API.
- Commits en español, terminan con la línea `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Foto inválida** (no es imagen, HEIC, muy chica, enorme, sin rostro): `create` falla con mensaje claro y **sin gastar**; la vista previa de una sola imagen es la defensa contra "sin rostro". Prueba en Task 7.
2. **Generación interrumpida** (red caída, llave inválida, cuota, filtro de seguridad que rechaza editar el rostro): no se pierden ni se cobran dos veces las imágenes ya hechas; volver a correr `create` solo genera las que faltan; si Gemini rechaza, el mensaje apunta a la ruta manual. Prueba en Task 7.
3. **Respuesta de Claude vacía, solo código o enorme**: resumen vacío → no hay TTS ni gasto, pero sí gesto. Pruebas en Tasks 9 y 12.
4. **Hook sin panel** (no corre, o quedó un archivo de socket huérfano): sale con 0 rápido; al iniciar, el panel limpia un socket huérfano. Pruebas en Tasks 12 y 13.
5. **Terminal más angosta que el panel o redimensionada en vivo** y **límite diario alcanzado a mitad del día**: el panel no se cae; recorta o avisa, y degrada a solo gestos con aviso visible. Pruebas en Task 12.

---

## File Structure

```
package.json                     workspaces, scripts (test, build)
tsconfig.base.json  vitest.config.ts  LICENSE  README.md  .gitignore
packages/core/src/
  faces.ts                        FACE_IDS, FaceId, ExpressionId
  ascii/types.ts convert.ts decode.ts ansi.ts   imagen → AsciiFrame → ANSI
  audio/wav.ts mouth.ts           WAV → timeline de boca (y timeline sintético)
  text/summary.ts expression.ts   resumen hablable y expresión por contenido
  budget/ledger.ts                gasto y topes
  agent/store.ts secrets.ts       carpeta del agente, llave
  anim/animator.ts                máquina de estados de la cara
packages/gemini/src/
  models.ts pricing.ts config.ts prompts.ts images.ts tts.ts
packages/cli/src/
  bin.ts commands/{create,panel,voice,install-hook,hook}.ts
  ipc.ts panel-controller.ts player.ts tty.ts config.ts
packages/cli/spike/               experimento desechable (Task 4)
```

Cada paquete tiene su carpeta `test/`. `core` no importa nada de `gemini` ni de `cli`.

---

### Task 1: Esqueleto del monorepo

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `LICENSE` (MIT, año 2026, titular "ascii-avatar contributors"), `packages/{core,gemini,cli}/package.json` y `tsconfig.json`, `packages/core/src/faces.ts`
- Test: `packages/core/test/faces.test.ts`

**Interfaces:**
- Produces (`@ascii-avatar/core`): `FACE_IDS = ['neutral','mouth_mid','mouth_open','blink','smile','serious','surprised','sad'] as const`; `type FaceId`; `type ExpressionId = 'neutral'|'smile'|'serious'|'surprised'|'sad'`. `mouth_closed` = `neutral` (la cara neutral lleva la boca cerrada).
- Paquetes: `@ascii-avatar/core`, `@ascii-avatar/gemini`, `@ascii-avatar/cli` (con `bin: { avatar: dist/bin.js }`). `npm test` corre Vitest en todo el monorepo.

- [ ] **Step 1: Write the failing test** `faces.test.ts`: `FACE_IDS` tiene longitud 8, contiene `'neutral'`, `'mouth_open'`, `'blink'`, y no tiene duplicados.
- [ ] **Step 2: Run** `npm test` → FAIL (módulo no existe). Antes: `npm install` con las dependencias de desarrollo `typescript`, `vitest`, `tsx`, `@types/node`; runtime `sharp` en core y `@google/genai` en gemini.
- [ ] **Step 3: Implement** `faces.ts` y la configuración de workspaces/TS estricto/ESM (`"type": "module"`, `moduleResolution: NodeNext`).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** `chore: esqueleto del monorepo con vitest`.

### Task 2: Imagen → cuadro ASCII → ANSI

**Files:**
- Create: `packages/core/src/ascii/{types,convert,decode,ansi}.ts`
- Test: `packages/core/test/ascii.test.ts`

**Interfaces:**
- Produces:
  - `interface Rgb {r:number;g:number;b:number}`; `interface Cell {ch:string; fg:Rgb; bg:Rgb|null}`; `interface AsciiFrame {cols:number; rows:number; cells:Cell[]}` (fila por fila).
  - `interface RawImage {width:number; height:number; data:Uint8Array}` (RGBA 8 bits).
  - `type AsciiMode = 'glyphs'|'halfblock'`.
  - `decodeImage(buf: Buffer): Promise<RawImage>` (con sharp).
  - `imageToAscii(img: RawImage, opts:{cols:number; mode:AsciiMode}): AsciiFrame`. Filas = `round(height/width*cols/2)` en ambos modos (la celda es 1:2). `glyphs`: rampa `" .:-=+*#%@"` por luminosidad, `fg` = color promedio del bloque, `bg` = null. `halfblock`: `ch='▀'`, `fg` = píxel de arriba, `bg` = píxel de abajo.
  - `frameToAnsi(frame: AsciiFrame): string` (filas unidas por `\n`, cada fila termina con `\x1b[0m`, sin movimientos de cursor).
  - `frameDiff(a: AsciiFrame, b: AsciiFrame): number` → 0 a 1, diferencia media de luminosidad por celda; lanza si las dimensiones difieren.

- [ ] **Step 1: Write the failing tests** (`ascii.test.ts`):
  - imagen negra 8×8, `cols:8, mode:'glyphs'` → todas las celdas `ch === ' '`; blanca → `'@'`.
  - imagen 200×100, `cols:40` → `rows === 10` en `glyphs` y en `halfblock`.
  - imagen 1×2 con arriba rojo `(255,0,0)` y abajo azul `(0,0,255)`, `halfblock`, `cols:1` → una celda `ch '▀'`, `fg {255,0,0}`, `bg {0,0,255}`.
  - `frameToAnsi` de un cuadro 2×1 contiene `\x1b[38;2;255;0;0m` con el color exacto y termina con `\x1b[0m`; no contiene `\x1b[H` ni `\x1b[2J`.
  - `frameDiff(f, f) === 0`; negro vs. blanco `=== 1`; dimensiones distintas lanza.
  - `decodeImage` de un PNG 2×2 creado con `sharp({create:…})` devuelve `width 2`, `height 2`, `data.length 16`.
- [ ] **Step 2: Run** `npx vitest run packages/core/test/ascii.test.ts` → FAIL.
- [ ] **Step 3: Implement** los cuatro archivos. El remuestreo (promedio por bloque) lo decide quien implementa; debe ser determinista.
- [ ] **Step 4: Run** la prueba y luego `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(core): conversión de imagen a cuadros ASCII y ANSI`.

### Task 3: Adaptador de imágenes de Gemini

**Files:**
- Create: `packages/gemini/src/{models,pricing,config,prompts,images}.ts`
- Test: `packages/gemini/test/{config,prompts,images}.test.ts`, `packages/gemini/test/live.test.ts` (solo corre con `RUN_LIVE=1` y `GEMINI_API_KEY`; si no, `describe.skip`)

**Interfaces:**
- Consumes: `FaceId`, `FACE_IDS` de core.
- Produces:
  - `models.ts`: `IMAGE_MODEL` (por defecto `gemini-nano-banana-2.1`, override `ASCII_AVATAR_IMAGE_MODEL`), `TTS_MODEL` (override `ASCII_AVATAR_TTS_MODEL`; el id vigente se verifica en Task 10).
  - `pricing.ts`: `IMAGE_RATES = {inputPerMTok:1.5, outputImagePerMTok:30}`, `TTS_RATES = {inputPerMTok:1.0, outputAudioPerMTok:20, audioTokensPerSecond:25}` (de https://ai.google.dev/gemini-api/docs/pricing, verificar al construir), `imageCostUsd(inputTokens:number, outputTokens:number): number`, `ESTIMATED_FACE_COST_USD = 0.037`, `estimateCreationCostUsd(faceCount:number): number`.
  - `config.ts`: `loadGeminiConfig(env?: NodeJS.ProcessEnv): {apiKey:string; imageModel:string; ttsModel:string}`; lanza `MissingApiKeyError` sin `GEMINI_API_KEY`.
  - `prompts.ts`: `PROMPTS_VERSION = 1`; `FACE_PROMPTS: Record<FaceId,string>`. Cada prompt en inglés empieza con `"Edit this portrait."`, incluye `"Keep the same camera, pose, lighting, framing and background."` y solo describe el cambio de la cara (p. ej. `mouth_open`: boca abierta como diciendo "ah", sin enseñar de más los dientes).
  - `images.ts`: `interface ImageClient {editImage(i:{prompt:string; image:Buffer; mimeType:string}): Promise<{png:Buffer; inputTokens:number; outputTokens:number}>}`; `createGeminiImageClient(cfg): ImageClient` (SDK real, API Interactions, tamaño de salida más pequeño que acepte la API: verificar con la doc `/websites/ai_google_dev_gemini-api` vía `npx ctx7@latest docs`); `generateFace(client: ImageClient, photo: Buffer, mimeType: string, face: FaceId): Promise<{png:Buffer; costUsd:number}>`.

- [ ] **Step 1: Write the failing tests:**
  - `loadGeminiConfig({})` lanza `MissingApiKeyError`; con `{GEMINI_API_KEY:'k'}` devuelve `apiKey 'k'` y `imageModel 'gemini-nano-banana-2.1'`; con `ASCII_AVATAR_IMAGE_MODEL:'x'` devuelve `'x'`.
  - Para cada `FaceId`, `FACE_PROMPTS[id]` contiene `"same camera, pose, lighting, framing"`.
  - `imageCostUsd(1300, 1120)` ≈ `0.03555` (`toBeCloseTo(0.03555, 5)`).
  - `estimateCreationCostUsd(8)` está entre `0.25` y `0.40`.
  - `generateFace` con cliente falso que devuelve `{png, inputTokens:1300, outputTokens:1120}`: devuelve ese `png`, `costUsd ≈ 0.03555`, y el cliente recibió el prompt de `FACE_PROMPTS['smile']` y la foto.
- [ ] **Step 2: Run** `npx vitest run packages/gemini` → FAIL.
- [ ] **Step 3: Implement.** El cliente real sigue el ejemplo de edición con `ai.interactions.create` de la doc oficial; extrae `output_image` y los tokens de uso del resultado. La prueba en vivo genera **una** cara y comprueba que devuelve un PNG (cuesta ~$0.04; nunca corre por defecto).
- [ ] **Step 4: Run** pruebas → PASS. Con tu llave: `RUN_LIVE=1 GEMINI_API_KEY=… npx vitest run packages/gemini/test/live.test.ts`; si el id del modelo no existe, listar modelos con el SDK y corregir `models.ts`.
- [ ] **Step 5: Commit** `feat(gemini): adaptador de edición de imágenes con costo real por tokens`.

### Task 4: Experimento desechable (puerta de decisión)

Rama `spike/ascii-faces`. Es **desechable**: sin pruebas salvo la métrica; lo aprendido vuelve al diseño y se borra el resto.

**Files:**
- Create: `packages/cli/spike/spike.ts`, `packages/core/src/ascii/drift.ts` (se conserva)
- Test: `packages/core/test/drift.test.ts`

**Interfaces:**
- Consumes: `decodeImage`, `imageToAscii`, `frameToAnsi`, `frameDiff`, `generateFace`, `FACE_IDS`.
- Produces: `cornerDrift(a: AsciiFrame, b: AsciiFrame): number` → `frameDiff` solo sobre las esquinas superiores (10 % del ancho × 15 % del alto cada una): mide si el fondo "tiembla" entre dos caras.

- [ ] **Step 1: Write the failing test:** `cornerDrift(f, f) === 0`; dos cuadros iguales salvo el centro (donde difiere 1.0) → `cornerDrift === 0`; dos cuadros que difieren solo en las esquinas superiores → `> 0.5`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `drift.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Escribir `spike.ts`:** `npx tsx packages/cli/spike/spike.ts --photo <ruta> --out <dir> --cap 0.50 [--faces-dir <dir>]`. Genera (o lee de `--faces-dir`) las 8 caras con tope de gasto y caché en `--out`; imprime `cornerDrift` y `frameDiff` de `neutral` contra cada cara; luego muestra en la terminal, a 6 cuadros por segundo y en bucle, la secuencia `neutral, mouth_mid, mouth_open, mouth_mid, neutral, blink, smile`, primero en modo `glyphs` y luego `halfblock`, a 70 columnas.
- [ ] **Step 6: Commit** `feat: medida de deriva de fondo y experimento de caras` (solo `drift.ts` y su prueba a `main`; el spike queda en la rama).
- [ ] **Step 7 — PUERTA, DETENERSE AQUÍ:** pedir al usuario que ejecute el spike con su foto (gasto máximo $0.50) y responder: (a) ¿se parece a la persona y la definición se acerca a la referencia?, (b) ¿el cambio de cuadros tiembla?, (c) ¿qué modo prefiere, `glyphs` o `halfblock`? Si Gemini rechaza editar el rostro o no mantiene la identidad, el camino principal pasa a la ruta manual (`--faces-dir`) y se avisa al usuario antes de seguir. No continuar con la Task 5 sin su respuesta; el modo elegido se vuelve el valor por defecto de `mode`.

### Task 5: Carpeta del agente y llave

**Files:**
- Create: `packages/core/src/agent/{store,secrets}.ts`
- Test: `packages/core/test/{store,secrets}.test.ts`

**Interfaces:**
- Consumes: `FaceId`, `FACE_IDS`, `decodeImage`, `imageToAscii`, `AsciiFrame`, `AsciiMode`.
- Produces:
  - `interface AgentConfig {name:string; voice:string; personality:string; createdAt:string; promptsVersion:number}`.
  - `validateAgentName(name:string): void` → solo `^[a-z0-9-]{1,32}$`; lanza `InvalidAgentNameError` si no.
  - `createAgent(root:string, name:string, photo:Buffer, opts?:{voice?:string; personality?:string}): AgentConfig` (voz por defecto `Kore`; escribe `agent.json` y `photo.png` en `<root>/agents/<name>/`).
  - `saveFace(root:string, name:string, id:FaceId, png:Buffer): void`; `missingFaces(root:string, name:string): FaceId[]`; `loadAgent(root:string, name:string): AgentConfig`.
  - `loadAtlas(root:string, name:string, opts:{cols:number; mode:AsciiMode}): Promise<Record<FaceId, AsciiFrame>>` (falla si faltan caras).
  - `saveApiKey(root:string, key:string): void` (archivo `<root>/secrets.json`, permisos `0600`); `loadApiKey(root:string, env?:NodeJS.ProcessEnv): string|undefined` (primero `GEMINI_API_KEY`, luego el archivo).

- [ ] **Step 1: Write the failing tests:** `validateAgentName('../x')` y `'Ab'` lanzan; `'luna-2'` pasa. `createAgent` crea `agent.json` legible por `loadAgent`. `missingFaces` devuelve las 8 al inicio y 7 tras `saveFace(…,'neutral',…)`. Tras `saveApiKey(root,'SECRET123')`, `statSync(secrets).mode & 0o777 === 0o600`, `loadApiKey(root,{})==='SECRET123'`, `loadApiKey(root,{GEMINI_API_KEY:'ENV'})==='ENV'`, y ningún archivo de la carpeta del agente contiene `'SECRET123'`. `loadAtlas` con 8 PNG de 4×4 devuelve 8 cuadros del ancho pedido.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(core): almacén del agente y manejo seguro de la llave`.

### Task 6: Presupuesto

**Files:**
- Create: `packages/core/src/budget/ledger.ts`
- Test: `packages/core/test/ledger.test.ts`

**Interfaces:**
- Produces: `CREATION_CAP_USD = 1.6`, `DEFAULT_DAILY_LIMIT_USD = 0.3`; `class BudgetExceededError extends Error`; `class Ledger { constructor(file:string, now?:()=>Date); record(kind:'create'|'voice', agent:string, usd:number): void; spentToday(): number; spentCreation(agent:string): number }` (archivo JSONL; "hoy" es la fecha local); `assertWithinCap(spent:number, next:number, cap:number): void` lanza `BudgetExceededError` si `spent + next > cap`.

- [ ] **Step 1: Write the failing tests:** dos instancias sobre el mismo archivo ven los mismos totales; `spentToday` no cuenta registros de ayer (reloj falso que cruza la medianoche); `spentCreation('luna')` suma solo `create` de `luna`; `assertWithinCap(1.55, 0.06, 1.6)` lanza y `(1.5, 0.06, 1.6)` no; una línea corrupta en el JSONL se ignora sin romper.
- [ ] **Step 2–4:** Run FAIL → implement → PASS. **Step 5: Commit** `feat(core): registro de gasto y topes`.

### Task 7: Comando `create`

**Files:**
- Create: `packages/cli/src/commands/create.ts`
- Test: `packages/cli/test/create.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 5 y 6.
- Produces: `runCreate(deps: CreateDeps): Promise<{status:'done'|'declined'|'capped'|'failed'; message:string}>` con `CreateDeps = {root:string; name:string; photoPath:string; imageClient:ImageClient; ledger:Ledger; cap?:number; ask:(q:string)=>Promise<boolean>; out:(s:string)=>void; mode:AsciiMode; cols:number}`.
- Flujo: validar foto (existe, formato `png|jpeg|webp` por cabecera, 256 px a 8000 px por lado, ≤ 10 MB) → **sin gastar** si falla; mostrar `Estimado: $X USD (tope $1.60)`; confirmar; generar primero `mouth_open` y mostrarla en ASCII; preguntar si seguir; generar solo las caras faltantes (en orden de `FACE_IDS`), registrar cada una en el ledger, y detenerse con `status:'capped'` si la siguiente superaría el tope; ante error del cliente guardar lo hecho y devolver `status:'failed'` con el mensaje (si parece rechazo de contenido, sugerir `--faces-dir` manual).

- [ ] **Step 1: Write the failing tests** (cliente falso que cuenta llamadas):
  - camino feliz: 8 PNG guardados, `ledger.spentCreation(name)` igual a la suma de costos, `out` contiene `"Estimado"` antes de la primera llamada al cliente.
  - `ask` responde `false` tras la vista previa → `status:'declined'`, 1 llamada, 1 cara guardada.
  - tope `0.05` → `status:'capped'`, `missingFaces` no vacío, mensaje contiene `"tope"`.
  - el cliente lanza en la llamada 5 → `status:'failed'`, 4 caras guardadas; volver a correr genera solo las 4 faltantes (total de llamadas = 5 + 4).
  - archivo de texto como foto, y PNG de 100×100 → `status:'failed'`, 0 llamadas, gasto 0.
- [ ] **Step 2–4:** Run FAIL → implement → PASS. **Step 5: Commit** `feat(cli): comando create con vista previa, tope y reanudación`.

### Task 8: Audio → movimiento de boca

**Files:**
- Create: `packages/core/src/audio/{wav,mouth}.ts`
- Test: `packages/core/test/{wav,mouth}.test.ts`

**Interfaces:**
- Produces: `parseWav(buf: Buffer): {sampleRate:number; samples:Float32Array}` (PCM 16 bits mono; lanza `InvalidWavError` si no es WAV); `type MouthLevel = 'closed'|'mid'|'open'`; `interface MouthStep {tMs:number; level:MouthLevel}`; `mouthTimeline(samples:Float32Array, sampleRate:number): MouthStep[]` (ventanas de 50 ms; niveles según RMS relativo al pico: < 15 % `closed`, < 50 % `mid`, resto `open`; ningún nivel dura menos de 80 ms); `syntheticMouthTimeline(text:string): {steps:MouthStep[]; durationMs:number}` para voz apagada (determinista a partir del texto; duración `max(1200, 55·caracteres)` ms; empieza y termina en `closed`).

- [ ] **Step 1: Write the failing tests:** WAV generado en la prueba (cabecera + senoidal) se parsea con `sampleRate 24000`; bytes aleatorios lanzan `InvalidWavError`; silencio → todo `closed`; senoidal fuerte → contiene `open`; rampa de amplitud → el orden de primera aparición es `closed`, `mid`, `open`; ninguna racha de un mismo nivel menor a 80 ms salvo la última; sintético: mismo texto da la misma salida, último paso `closed`, texto de 60 caracteres contiene `mid` y `open`, texto vacío → `durationMs 1200` y solo `closed`.
- [ ] **Step 2–4:** Run FAIL → implement → PASS. **Step 5: Commit** `feat(core): movimiento de boca desde audio y texto`.

### Task 9: Resumen hablable y expresión

**Files:**
- Create: `packages/core/src/text/{summary,expression}.ts`
- Test: `packages/core/test/{summary,expression}.test.ts`

**Interfaces:**
- Produces: `spokenSummary(text:string, opts?:{maxChars?:number}): string` (por defecto 220; quita bloques de código, código en línea, rutas de archivo, URLs, líneas de tabla con `|`, marcas de markdown y encabezados; toma frases completas hasta el máximo; conserva acentos; devuelve `''` si no queda texto hablable); `pickExpression(text:string): ExpressionId` (reglas por palabras en español e inglés: éxito → `smile` ("listo", "hecho", "pasaron", "passed", "done", "✓"); fallo → `sad` ("error", "falló", "failed", "no se pudo"); aviso → `serious` ("cuidado", "warning", "ojo", "irreversible"); sorpresa → `surprised` ("¡", "wow", "increíble", "sorprendente"); si no, `neutral`; gana la primera regla en ese orden).

- [ ] **Step 1: Write the failing tests:** texto con bloque ```` ```ts … ``` ```` y prosa → la salida no contiene `` ` `` ni el código; `"Edité /Users/x/src/a.ts y https://x.com/y"` → sin ruta ni URL; filas `| a | b |` desaparecen; `"**Hecho** — ## Título"` → sin `*` ni `#`; solo código → `''`; texto de 1 000 caracteres → `length ≤ 220` y termina en `.`, `?` o `!`; `"Corrección: añadí el acento en canción."` conserva `ó`. Tabla de expresiones: `"Listo, las pruebas pasaron"` → `smile`; `"Falló el build"` → `sad`; `"Cuidado, esto es irreversible"` → `serious`; `"¡Increíble!"` → `surprised`; `"Revisé el archivo"` → `neutral`; `"Error, pero ya quedó listo"` → `sad`.
- [ ] **Step 2–4:** Run FAIL → implement → PASS. **Step 5: Commit** `feat(core): resumen hablable y expresión por contenido`.

### Task 10: Voz con Gemini TTS

**Files:**
- Create: `packages/gemini/src/tts.ts`
- Test: `packages/gemini/test/tts.test.ts` (más un caso en `live.test.ts`)

**Interfaces:**
- Produces: `interface TtsClient {speak(i:{text:string; voice:string}): Promise<{wav:Buffer; inputTokens:number; outputTokens:number}>}`; `createGeminiTtsClient(cfg): TtsClient`; `ttsCostUsd(inputTokens:number, outputTokens:number): number`; `synthesizeSpeech(client:TtsClient, text:string, voice:string): Promise<{wav:Buffer; costUsd:number}>`.
- La doc oficial muestra ids distintos (`gemini-3.8-flash-tts` en ejemplos, `gemini-3.1-flash-tts-preview` en la página de precios): al construir, confirmar con `npx ctx7@latest docs /websites/ai_google_dev_gemini-api "text-to-speech model id"` y con la prueba en vivo, y dejar el id resultante en `models.ts`. Pedir `audio/wav` a 24 000 Hz, voz por defecto `Kore`. Verificar si el modelo devuelve marcas de tiempo o visemas; en V1 no se usan (la boca va por volumen).

- [ ] **Step 1: Write the failing tests:** `ttsCostUsd(100, 250)` ≈ `0.0051` (`100·1/1e6 + 250·20/1e6`); `synthesizeSpeech` con cliente falso devuelve el `wav` y ese `costUsd`; el cliente recibió `voice 'Kore'`.
- [ ] **Step 2–4:** Run FAIL → implement → PASS; prueba en vivo con `RUN_LIVE=1`: sintetizar `"Hola"` y comprobar que `parseWav` (Task 8) lo lee y dura entre 0.3 s y 3 s. **Step 5: Commit** `feat(gemini): síntesis de voz con costo por tokens`.

### Task 11: Animador de la cara

**Files:**
- Create: `packages/core/src/anim/animator.ts`
- Test: `packages/core/test/animator.test.ts`

**Interfaces:**
- Consumes: `FaceId`, `ExpressionId`, `MouthStep`, `MouthLevel`.
- Produces: `class Animator { constructor(opts:{rng?:()=>number}); thinking(nowMs:number): void; say(nowMs:number, i:{steps:MouthStep[]; durationMs:number; expression:ExpressionId}): void; idle(nowMs:number): void; frame(nowMs:number): FaceId }`.
- Reglas: en reposo, `neutral` con parpadeo (`blink` durante 150 ms) cada 3 a 6 s según `rng`; pensando, `neutral` con parpadeo cada 1.5 a 2.5 s; al hablar, 500 ms de la expresión (`neutral`→`neutral`, `smile`→`smile`, etc.), luego las bocas (`closed`→`neutral`, `mid`→`mouth_mid`, `open`→`mouth_open`) según el tiempo, y al terminar mantiene la expresión 3 s y vuelve a reposo.

- [ ] **Step 1: Write the failing tests** (tiempo y `rng` falsos): en reposo con `rng ()=>0` el parpadeo ocurre a los 3 000 ms (`frame(3000)==='blink'`, `frame(3200)==='neutral'`); `say` con expresión `smile` → `frame(0)==='smile'`, tras 500 ms un paso `open` da `'mouth_open'`, un paso `closed` da `'neutral'`; terminada la duración + 3 000 ms vuelve a `neutral`; `thinking` parpadea antes de 3 000 ms; llamar `say` en pleno `say` reemplaza al anterior.
- [ ] **Step 2–4:** Run FAIL → implement → PASS. **Step 5: Commit** `feat(core): animador de cara con parpadeo y habla`.

### Task 12: Panel (canal local, controlador, TTY)

**Files:**
- Create: `packages/cli/src/{ipc,panel-controller,player,config,tty}.ts`, `packages/cli/src/commands/panel.ts`
- Test: `packages/cli/test/{ipc,panel-controller,fit}.test.ts`

**Interfaces:**
- Consumes: Tasks 5, 6, 8, 9, 10, 11.
- Produces:
  - `ipc.ts`: `type Msg = {type:'thinking'}|{type:'say'; text:string}|{type:'voice'; on:boolean}`; `startServer(path:string, onMsg:(m:Msg)=>void): Promise<{close():Promise<void>}>` (JSON por líneas; líneas inválidas se ignoran; si `path` existe sin nadie escuchando, se borra antes de escuchar); `sendIfListening(path:string, m:Msg, timeoutMs?:number): Promise<boolean>` (resuelve `false` en < 200 ms si no hay socket).
  - `config.ts`: `interface CliConfig {activeAgent:string|null; voice:boolean; dailyLimitUsd:number; mode:AsciiMode; cols:number}`; `loadConfig(root:string): CliConfig` (por defecto `voice:false`, `dailyLimitUsd:0.3`, `cols:70`, `mode` = el modo elegido por el usuario en la puerta de la Task 4); `saveConfig(root:string, c:CliConfig): void`; `socketPath(root:string): string` = `<root>/avatar.sock`. `root` por defecto `~/.ascii-avatar` (override `ASCII_AVATAR_HOME`).
  - `player.ts`: `interface AudioPlayer {play(wav:Buffer): {done:Promise<void>; stop():void}}`; `createAfplayPlayer(): AudioPlayer` (escribe un WAV temporal y lanza `afplay`; `stop` mata solo el PID guardado de ese proceso).
  - `panel-controller.ts`: `class PanelController { constructor(d:{root:string; animator:Animator; ledger:Ledger; tts:TtsClient|null; player:AudioPlayer; config:CliConfig; agent:string; now:()=>number}); handle(m:Msg): Promise<void>; notice(): string|null; spentToday(): number }`. Lógica: `thinking` → animador; `say` → `spokenSummary` y `pickExpression`; si el resumen está vacío → solo gesto; si voz apagada → `syntheticMouthTimeline`; si voz encendida y `ledger.spentToday()` ≥ límite → gesto con `notice() === 'Límite diario de voz alcanzado'`; si no → `synthesizeSpeech`, registrar gasto `voice`, `mouthTimeline` del WAV y reproducir.
  - `tty.ts`: `fitFrame(frame:AsciiFrame, termCols:number, termRows:number): {frame:AsciiFrame|null; notice:string|null}` (recorta al centro si la terminal es más angosta; si es menor a 20 columnas × 10 filas devuelve `frame:null` y `"Terminal muy pequeña"`); bucle de pantalla alterna a ~12 cuadros por segundo, oculta el cursor, restaura todo al salir (`q`, Ctrl-C), tecla `v` alterna la voz y guarda `config.voice`; pie con el nombre del agente, `voz: on|off` y `gasto hoy: $0.000`.

- [ ] **Step 1: Write the failing tests:**
  - ipc: el servidor recibe un mensaje enviado por el cliente; una línea basura no rompe la entrega del siguiente mensaje; `sendIfListening` en ruta inexistente resuelve `false` en < 200 ms; con un archivo de socket huérfano, `startServer` arranca bien.
  - controlador (dobles de TTS y reproductor): `say` con voz encendida llama 1 vez a TTS y 1 vez a `play`, y `ledger.spentToday()` igual al costo; voz apagada → 0 llamadas a TTS; texto solo código → 0 llamadas pero el animador queda con la expresión `neutral`; con `ledger` ya en $0.30 y límite $0.30 → 0 llamadas a TTS y `notice() === 'Límite diario de voz alcanzado'`; `voice` en mensaje cambia `config.voice` y se guarda.
  - `fitFrame` de un cuadro de 80 columnas en una terminal de 60 → ancho 60 y `notice null`; en 15×8 → `frame null` y aviso.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Verificación manual** (el TTY no tiene prueba automática): `npx tsx packages/cli/src/bin.ts panel` en un split; en otra terminal enviar `{"type":"say","text":"Hola"}` con `nc -U ~/.ascii-avatar/avatar.sock`; comprobar que la cara reacciona, que `v` alterna, que `q` restaura la terminal y que redimensionar la ventana no la rompe. Pegar la salida real en la conversación.
- [ ] **Step 6: Commit** `feat(cli): panel con canal local, controlador y pantalla`.

### Task 13: Hook de Claude Code, instalación y comandos finales

Los detalles del hook (campos del JSON de entrada, formato de `settings.json`, eventos) se verificaron con la documentación de Claude Code; ver "Datos verificados del hook" al final de este plan.

**Files:**
- Create: `packages/cli/src/bin.ts`, `packages/cli/src/commands/{hook,install-hook,voice}.ts`
- Test: `packages/cli/test/{hook,install-hook,voice}.test.ts`

**Interfaces:**
- Consumes: `Msg`, `sendIfListening`, `socketPath`, `loadConfig`, `saveConfig` (Task 12).
- Produces:
  - `hook.ts`: `extractHookMessage(stdin:string): Msg|null` (`hook_event_name==='Stop'` con `last_assistant_message` no vacío → `{type:'say', text}`; `UserPromptSubmit` → `{type:'thinking'}`; cualquier otra cosa o JSON inválido → `null`); `runHook(stdin:string, root:string): Promise<0>` (siempre resuelve `0`, usa `sendIfListening` con 200 ms).
  - `install-hook.ts`: `HOOK_MARKER = '--from-ascii-avatar'`; `installHook(settingsPath:string, bin?:string): {changed:boolean}` añade a `hooks.Stop` y `hooks.UserPromptSubmit` una entrada `{matcher:'*', hooks:[{type:'command', command:'<bin> hook <HOOK_MARKER>', timeout:5}]}` (`bin` por defecto `avatar`); `uninstallHook(settingsPath:string): {changed:boolean}` quita solo las entradas con `HOOK_MARKER`. Idempotente; copia `settings.json.bak-<timestamp>` solo si cambia algo; conserva todas las demás claves y hooks; si el JSON es inválido lanza y **no escribe**.
  - `voice.ts`: `runVoice(arg:string, root:string): Promise<{ok:boolean; message:string}>` (`on|off`; guarda en la configuración y avisa al panel si está escuchando; otro valor → `ok:false`).
  - `bin.ts`: subcomandos `create`, `panel`, `voice`, `hook`, `install-hook [--uninstall]`; código de salida distinto de 0 solo en `create`/`voice`/`install-hook` con error, nunca en `hook`.

- [ ] **Step 1: Write the failing tests:**
  - `extractHookMessage` con un Stop de ejemplo (`{"hook_event_name":"Stop","last_assistant_message":"Listo"}`) → `{type:'say', text:'Listo'}`; `UserPromptSubmit` → `thinking`; Stop con mensaje `""` → `null`; `"no es json"` → `null`.
  - `runHook` sin socket resuelve `0` en < 500 ms; con un servidor de la Task 12 escuchando, este recibe el mensaje.
  - `installHook` sobre un `settings.json` con otros hooks y claves (`theme`, `PreToolUse`) → ambas entradas añadidas y todo lo demás idéntico (`toEqual`); segunda llamada → `changed:false` y archivo sin cambios; hay exactamente un `.bak-*` tras la primera; `uninstallHook` deja el archivo igual al original; JSON inválido → lanza y el archivo queda intacto.
  - `runVoice('on', root)` deja `loadConfig(root).voice === true`; `runVoice('maybe', root)` → `ok:false`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Verificación manual del contrato real del hook:** instalar un hook temporal que guarde el stdin (`cat > /tmp/hook-stdin.json`) en `Stop`, hacer una pregunta corta en Claude Code y confirmar que existe `last_assistant_message`; si no existe, leer el último mensaje de texto del asistente desde `transcript_path` (JSONL) y ajustar `extractHookMessage` con su prueba. Quitar el hook temporal. Pegar la salida real.
- [ ] **Step 6: Commit** `feat(cli): hook de Claude Code, instalación idempotente y comando voice`.

### Task 14: README y verificación de punta a punta

**Files:**
- Create/Modify: `README.md`
- Docs only: sin pruebas nuevas.

- [ ] **Step 1:** README en español: qué es, requisitos (Node ≥ 20, macOS, terminal con color de 24 bits), instalación (`npm install`, `npm run build`, `npm link`), `avatar create`, `avatar install-hook`, `avatar panel`, `avatar voice on|off`, costos y topes con las cifras de las restricciones globales, y cómo aportar un paquete de caras manual (contrato de encuadre y los 8 nombres de `FACE_IDS`).
- [ ] **Step 2: Verificación de punta a punta con `superpowers:verification-before-completion`**, mostrando la salida real: `npm test` en verde; crear un agente con la foto del usuario y comprobar `gasto de creación < $0.60` en el ledger; con el panel abierto en un split y el hook instalado, escribir en Claude Code y ver que la cara reacciona a cada respuesta; con voz encendida habla un resumen corto con la boca moviéndose; con voz apagada solo gesticula; reproducir el criterio de éxito de la sección 11 del spec y pedirle al usuario su juicio visual sobre la definición.
- [ ] **Step 3: Commit** `docs: README y guía de uso`.

---

## Correcciones al spec

Aplicadas al spec antes de empezar (commit aparte):
- `gemini-2.5-flash-image` **fue retirado el 2 de octubre de 2026**; el modelo vigente según la doc es `gemini-nano-banana-2.1` (~$0.0336 por imagen de 1K, ~$0.0168 por lotes). Los ids se leen de configuración.
- npm workspaces en lugar de pnpm (Node 25+ ya no trae corepack y la máquina no tiene pnpm).
- El paquete V1 son **8 imágenes** (no 10 a 12): `neutral`, `mouth_mid`, `mouth_open`, `blink`, `smile`, `serious`, `surprised`, `sad`. Las bocas `o/e/f/m` quedan fuera de V1 porque la sincronía es por volumen.
- El atlas ASCII no se guarda en disco: se calcula al iniciar el panel según su ancho.
- Voz: la doc oficial cobra el audio de salida a ~$20 por millón de tokens y 25 tokens por segundo, es decir ~$0.03 por minuto de voz; el límite diario de $0.30 alcanza para ~10 minutos de voz.

## Datos verificados del hook de Claude Code

Obtenidos de la documentación de Claude Code (informe de un agente de consulta) y cotejados con el `settings.json` real del usuario; el contrato exacto se confirma otra vez en el Step 5 de la Task 13.

- Evento `Stop`: el comando recibe por stdin un JSON con `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `stop_hook_active` y `last_assistant_message` (el texto del último mensaje del asistente).
- `UserPromptSubmit` se dispara al enviar el usuario un mensaje; sirve para el estado "pensando".
- Formato en `settings.json`: `"hooks": { "<Evento>": [ { "matcher": "...", "hooks": [ { "type": "command", "command": "...", "timeout": 5 } ] } ] }`. Los settings de usuario, proyecto y locales se combinan; el plan instala en el global (`~/.claude/settings.json`).
- No se usa `asyncRewake`: el hook ya sale en menos de 500 ms por diseño.
