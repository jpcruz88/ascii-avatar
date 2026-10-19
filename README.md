# ascii-avatar

Una cara hecha de caracteres de terminal para tu agente de IA. Subes una foto una sola vez, el sistema genera un paquete de ocho caras con Gemini y, desde ese momento, un panel lateral de tu terminal muestra a ese agente gesticulando (boca, parpadeo, sonrisa, seriedad, sorpresa, tristeza) cada vez que Claude Code termina de responder. Si activas la voz, además habla un resumen corto de la respuesta con la boca moviéndose.

```
  +-------------------------------------+------------------------+
  |  claude code                        |       .:-=+*##*+=-:.   |
  |                                     |     .=#@@@@@@@@@@@#=.  |
  |  > arregla la prueba que falla      |    :#@@%+:.  .:+%@@#:  |
  |                                     |    =@@#  o    o  #@@=  |
  |  Listo. Corregí el error y las      |    =@@%    __    %@@=  |
  |  pruebas pasan.                     |     +@@*.  \__/ .*@@+  |
  |                                     |      :*@@@%####%@@@*:  |
  |                                     |                        |
  +-------------------------------------+------------------------+
        tu trabajo, como siempre              el panel del avatar

  pie del panel:  ana · voz: on · gasto hoy: $0.012
```

(Es solo una ilustración. La cara real sale de tu foto y se dibuja con color de 24 bits.)

Lo que hace y lo que no:

- Claude sigue siendo el cerebro. El avatar es solo la cara: la llave de Gemini se usa únicamente para generar las imágenes y, si lo activas, la voz.
- Todo corre en tu máquina. No hay servidor del autor, ni cuentas extra, ni GPU.
- El avatar nunca lee la respuesta completa en voz alta: dice un resumen de pocas frases (hasta unos 220 caracteres) sin código, rutas ni tablas.
- Con la voz apagada solo gesticula; la respuesta sigue apareciendo como texto en la terminal.

## Requisitos

- macOS (zsh o cualquier shell). Linux y Windows no están soportados todavía; la voz usa `afplay`, que es de macOS.
- Una terminal con color de 24 bits (iTerm2, Ghostty, kitty, WezTerm, etc.) y un panel de unas 60 a 80 columnas. Menos de 20 columnas por 10 filas se considera demasiado pequeño.
- Para construir el proyecto desde el clon (`npm install` y `npm run build`) y para correr las pruebas necesitas Node.js `^22.12`, `^24` o `>=26`, que es lo que exige el `package.json` de la raíz.
- Una vez construido, el comando `avatar` solo necesita Node.js 20.9 o superior para ejecutarse.
- Una llave de la API de Gemini (se consigue en https://aistudio.google.com/apikey). Una sola llave sirve para imágenes y voz.
- Claude Code instalado, si quieres conectarlo con el panel.

## Instalación

Desde la carpeta del repositorio:

```sh
npm install
npm run build
```

El comando `avatar` lo declara el paquete `packages/cli` (campo `bin` de su `package.json`); el `package.json` de la raíz no declara ninguno, así que `npm link` hay que hacerlo desde ese paquete:

```sh
cd packages/cli
npm link
```

Desde la raíz también funciona, indicando el paquete:

```sh
npm link --workspace @ascii-avatar/cli
```

Con cualquiera de las dos, `avatar help` debe mostrar la ayuda. Ojo: `npm link` escribe en tu instalación global de npm (crea un enlace simbólico `avatar` que apunta a `packages/cli/dist/bin.js`). Si prefieres no tocar nada global, usa el comando directamente:

```sh
node /ruta/al/repo/packages/cli/dist/bin.js help
```

Ten presente que el enlace apunta a la carpeta del repositorio: si la mueves o la borras, hay que volver a correr `npm link` (y `avatar install-hook`, ver más abajo). Después de actualizar el código, corre otra vez `npm run build`.

Los comandos disponibles son:

```
avatar create <nombre> [--foto <ruta>]   Crea un agente a partir de una foto (usa Gemini)
avatar create <nombre> --caras <carpeta> [--foto <ruta>]
                                         Importa tus propias ocho caras PNG (sin Gemini, sin llave, sin costo)
avatar panel [--agente <nombre>] [--cols <n>] [--modo glyphs|halfblock]
                                         Abre el panel (tecla v: voz, q: salir)
avatar voice on|off                      Activa o desactiva la voz
avatar install-hook [--uninstall] [--settings <ruta>]
                                         Conecta (o desconecta) el avatar con Claude Code
avatar help                              Muestra esta ayuda
```

(`avatar hook` también existe, pero lo invoca Claude Code; no se usa a mano.)

## Crear un agente

```sh
avatar create ana --foto ~/Fotos/ana.jpg
```

El nombre del agente va de 1 a 32 caracteres entre `a-z`, `0-9` y guion. Si omites `--foto`, el comando te la pide (acepta PNG, JPG o WebP de hasta 10 MB, con cada lado entre 256 y 8000 px; sirve arrastrar el archivo a la terminal). El flujo es:

1. **Llave de Gemini.** Si no hay una guardada ni definida en `GEMINI_API_KEY`, te la pide sin mostrarla al escribir y la guarda en `~/.ascii-avatar/secrets.json` con permisos 0600 (la carpeta queda en 0700). La llave nunca se guarda dentro de la carpeta del agente ni en el repositorio.
2. **Estimado y confirmación.** Antes de gastar nada muestra el costo estimado de las caras que faltan (unos $0.055 USD por cara, incluida la foto de entrada, y alrededor de $0.44 USD para las ocho), el tope y lo que ya se gastó en ese agente. Solo continúa si respondes `s`, `si` o `sí`.
3. **Vista previa barata.** Genera primero una sola cara, `mouth_open`, y la dibuja en la terminal. Si no se parece a ti o la definición no te convence, responde que no: solo gastaste una imagen (unos $0.055 USD). El agente ya quedó creado con esa foto y no se puede cambiar: para reintentar con otra foto, usa un nombre nuevo (`avatar create ana2 --foto otra.jpg`) o borra la carpeta `~/.ascii-avatar/agents/<nombre>` y empieza de cero. Si corres `avatar create` con el mismo nombre y una foto distinta, el comando se detiene sin preguntar ni gastar y te indica la carpeta.
4. **El resto.** Si apruebas, genera las otras siete caras. Cada una se guarda en disco y se registra su costo apenas termina.
5. **Tope.** Si el gasto de creación de ese agente llegara a $1.60 USD, se detiene y avisa. Lo ya generado queda guardado.

Si algo se interrumpe (falla la red, cerraste la terminal), basta con volver a correr el mismo comando (con la misma foto o sin `--foto`): reutiliza la foto guardada y solo genera las caras que faltan. Nunca se vuelve a pagar por una cara ya hecha.

El tope sí es definitivo: el gasto de creación se acumula por agente, así que si ya llegaste a $1.60 USD, volver a correr `avatar create` te pide confirmar y se detiene en la primera cara por el mismo tope. Las caras que falten las aportas tú con `avatar create <nombre> --caras <carpeta>` (ver [paquete de caras manual](#aportar-un-paquete-de-caras-manual)); ese comando no usa Gemini, así que el tope no le afecta.

Al terminar, si no tenías ningún agente activo, el nuevo queda como agente activo en `~/.ascii-avatar/config.json`.

Todo lo del agente vive en `~/.ascii-avatar/agents/<nombre>/`:

```
~/.ascii-avatar/
  config.json                 voz, límite diario, modo y ancho del panel, agente activo
  secrets.json                tu llave de Gemini (0600)
  ledger.jsonl                registro de gasto
  avatar.sock                 canal local entre el hook y el panel (solo mientras el panel está abierto)
  agents/<nombre>/
    agent.json                nombre, voz, personalidad, fecha, versión de los prompts
    photo.png | .jpg | .webp  la foto original
    faces/<id>.png            las ocho caras
```

Para compartir un agente basta con copiar la carpeta `agents/<nombre>` (no contiene tu llave). Sí contiene la foto original de la persona, así que compártela solo con permiso.

El campo `voice` de `agent.json` es el nombre de la voz de Gemini (por defecto `Kore`); puedes cambiarlo a otra voz disponible.

## Conectar con Claude Code

```sh
avatar install-hook
```

Este comando añade el hook del avatar a `~/.claude/settings.json` (la configuración global de Claude Code), en dos eventos:

- `UserPromptSubmit`: cuando envías un mensaje, la cara pasa a "pensando".
- `Stop`: cuando Claude termina de responder, el panel recibe el texto de la respuesta y la cara reacciona (y habla, si la voz está activa).

Qué cambia exactamente en el archivo:

- Añade una entrada `{"matcher": "*", "hooks": [{"type": "command", "command": "...", "timeout": 5}]}` en `hooks.Stop` y otra en `hooks.UserPromptSubmit`. El comando es `"<ruta de node>" "<ruta del repo>/packages/cli/dist/bin.js" hook --from-ascii-avatar 2>/dev/null || true`, con rutas absolutas.
- Conserva todo lo demás: tus otros hooks, tu modelo, tus permisos. Si el archivo o la carpeta no existen, los crea.
- Reescribe el archivo conservando la sangría que ya tenía (dos espacios si no se puede deducir), así que el formato de algunas líneas, por ejemplo un objeto que tenías en una sola línea, puede cambiar aunque el contenido sea el mismo.
- Antes de modificarlo guarda una copia de respaldo junto al original, con el nombre `settings.json.bak-<fecha y hora UTC>` (por ejemplo `settings.json.bak-20261018T215949601Z`) y te imprime su ruta. Si no cambia nada, no crea copia.
- Es idempotente: correrlo otra vez dice que el hook ya estaba instalado y no duplica nada. El comando guarda la ruta absoluta de `node` y la del repositorio, y sus errores se silencian a propósito (para no estorbar a Claude Code). Por eso, si mueves el repositorio o actualizas o cambias de versión de Node, vuelve a correr `avatar install-hook`: reemplaza la entrada vieja. Si no lo haces, el hook falla sin avisar y el panel simplemente deja de reaccionar.
- Si el JSON de `settings.json` está roto o con una estructura inesperada, se detiene con un mensaje y no escribe nada.

Para quitarlo:

```sh
avatar install-hook --uninstall
```

Quita solo las entradas del avatar (las reconoce por `--from-ascii-avatar`), deja el resto intacto y también hace su copia de respaldo. Con `--settings <ruta>` puedes apuntar a otro archivo (por ejemplo, para probar sobre una copia).

Después de instalar o desinstalar, **reinicia las sesiones de Claude Code que tengas abiertas**; leen la configuración al arrancar.

El hook está diseñado para no estorbar: no escribe nada en la salida (Claude Code sumaría lo que imprima a su contexto), siempre termina con código 0, tarda menos de medio segundo y, si el panel no está abierto, no hace nada.

## Abrir el panel en un split

El panel se abre a mano, en un split o pestaña de tu terminal, mientras trabajas con Claude Code en otro:

```sh
avatar panel
```

Opciones:

- `--agente <nombre>`: usa ese agente en lugar del activo.
- `--cols <n>`: ancho de la cara en columnas, entre 20 y 500 (por defecto 70; nunca pasa del ancho real de la terminal).
- `--modo glyphs|halfblock`: `glyphs` dibuja un carácter de una rampa de densidad por celda; `halfblock` usa medios bloques `▀` con color de frente y de fondo, que da más definición. Por defecto es `halfblock`.

Una sola sesión del panel recibe los mensajes de todas tus sesiones de Claude Code (comparten un canal local en `~/.ascii-avatar/avatar.sock`). Si ya hay un panel abierto, el segundo avisa y no arranca.

Dentro del panel:

- `v` enciende o apaga la voz.
- `q` (o Ctrl-C) sale; la terminal queda restaurada.
- El pie muestra el nombre del agente, el estado de la voz, el contador "gasto hoy" y, durante unos segundos, los avisos.

Si cambias el tamaño de la ventana, el panel se redibuja; si es demasiado pequeña, muestra "Terminal muy pequeña".

## Voz

```sh
avatar voice on
avatar voice off
```

El comando recuerda la última opción en `~/.ascii-avatar/config.json` y, si hay un panel abierto, le avisa al instante. También puedes alternarla con la tecla `v` dentro del panel. Por defecto la voz está apagada.

- Con la voz encendida, cada respuesta se convierte en un resumen corto (se quitan código, rutas y tablas), se sintetiza con Gemini, se reproduce con `afplay` y la boca se mueve según el volumen del audio (cerrada, media, abierta).
- Con la voz apagada, la boca se mueve igual con el texto del resumen, pero no suena nada. La respuesta sigue en texto en tu terminal.
- La voz necesita la llave de Gemini y macOS. Sin ellas el avatar sigue funcionando solo con gestos y lo avisa en el pie.

## Costos y topes

Las tarifas son las de la documentación oficial de Gemini verificadas el 18 de octubre de 2026. Viven en `packages/gemini/src/pricing.ts` y los modelos en `packages/gemini/src/models.ts`, por si Google los cambia.

| Concepto | Cifra |
| --- | --- |
| Modelo de imágenes | `gemini-nano-banana-2.1`, unos $0.055 USD por cara, incluida la foto de entrada (estimado, calibrado con una corrida real: 8 caras costaron $0.42) |
| Un agente completo (8 imágenes) | alrededor de $0.42 a $0.45 USD |
| Meta normal de creación | menos de $0.60 USD por agente |
| Tope duro de creación | $1.60 USD por agente (unos 29 MXN) |
| Voz | unos $0.03 USD por minuto (tarifa conservadora: el registro sobrestima un poco) |
| Límite diario de voz | $0.30 USD (unos 10 minutos de voz), configurable |

Cómo se aplican:

- **Creación.** Se muestra el estimado y se pide confirmación antes de gastar. Antes de cada imagen se comprueba que el gasto acumulado de ese agente más el de la imagen no pase de $1.60 USD; si pasara, se detiene. Cada imagen se registra en `~/.ascii-avatar/ledger.jsonl` en cuanto se cobra. Los costos se calculan con los tokens que reporta la API; si no los reporta, se marcan como "(estimado)".
- **Voz.** Cada síntesis se registra en el mismo archivo. Al llegar al límite diario, el avatar deja de hablar por el resto del día (sigue gesticulando) y muestra "Límite diario de voz alcanzado". El día cuenta en hora local.
- **Contador "gasto hoy".** El pie del panel muestra siempre lo gastado hoy en voz, en dólares con tres decimales.
- **Cambiar el límite diario.** Cierra el panel (`q`), edita `~/.ascii-avatar/config.json` y vuelve a abrir el panel. El panel lee el archivo una sola vez al arrancar, así que un cambio hecho con el panel abierto no se aplica hasta que lo reabras (al pulsar `v` solo se actualiza la voz y se conserva el resto de lo que haya en el archivo):

```json
{
  "activeAgent": "ana",
  "voice": false,
  "dailyLimitUsd": 0.5,
  "mode": "halfblock",
  "cols": 70
}
```

`dailyLimitUsd` es un número en dólares (0 desactiva la voz de hecho). `mode` y `cols` son los valores por defecto del panel; las opciones de `avatar panel` los sobrescriben. Lo mismo vale para los tres: `dailyLimitUsd`, `mode` y `cols` se editan con el panel cerrado y se aplican al reabrirlo. Un archivo ausente o con valores inválidos vuelve a los valores por defecto.

Los precios de un servicio externo cambian. Si ves que el gasto real se desvía de estas cifras, revisa `ledger.jsonl` y el panel de uso de tu cuenta de Google AI Studio.

## Aportar un paquete de caras manual

No tienes que usar Gemini para las imágenes: puedes hacer las tuyas con cualquier herramienta (otro generador, fotos reales, ilustraciones). Es el camino a seguir si Gemini rechaza tu foto, si se alcanzó el tope de creación o si prefieres no pagar.

**Contrato de encuadre.** Las ocho imágenes deben tener la misma cámara, la misma pose, la misma luz, el mismo encuadre y el mismo fondo. Solo cambia la cara. Y todas deben tener exactamente el mismo tamaño en píxeles (por ejemplo 1024 por 1024). Si el encuadre se mueve entre imágenes, el ASCII "tiembla" al cambiar de cara.

**Los ocho nombres exactos** (`FACE_IDS`), uno por archivo PNG:

| Archivo | Qué muestra |
| --- | --- |
| `neutral.png` | cara en reposo, boca cerrada |
| `mouth_mid.png` | boca entreabierta |
| `mouth_open.png` | boca abierta |
| `blink.png` | ojos cerrados (parpadeo) |
| `smile.png` | sonrisa |
| `serious.png` | seria |
| `surprised.png` | sorpresa |
| `sad.png` | tristeza |

Pon los ocho PNG en una carpeta (cada uno con su nombre exacto, `<id>.png`) y corre:

```sh
avatar create ana --caras ~/Imagenes/ana-caras
avatar panel --agente ana
```

Opcionalmente, `--foto <ruta>` guarda una foto base (PNG, JPG o WebP de hasta 10 MB, con cada lado entre 256 y 8000 px); si la omites, la foto base del agente es tu `neutral.png`.

Este comando **no cuesta nada y no necesita llave**: no llama a Gemini, no te pide la llave, no gasta y no escribe nada en el registro de gasto. Es la salida cuando se alcanza el tope de creación o cuando Gemini rechaza tu foto.

Qué comprueba antes de escribir nada (todo o nada: si algo falla, no se crea ni se cambia nada y el mensaje dice qué archivo y por qué):

- Están los ocho archivos `<id>.png`; si faltan, te da la lista exacta de los que faltan.
- Cada uno es realmente un PNG (se mira la cabecera, no la extensión) y pesa 10 MB o menos.
- Los ocho miden exactamente lo mismo, y cada lado está entre 64 y 8000 px.

Si el agente no existe, lo crea; si ya existe, solo reemplaza sus ocho caras y deja `agent.json` y la foto como estaban (con `--foto` sobre un agente existente, la foto se ignora). Si no tenías ningún agente activo, el nuevo queda como activo en `~/.ascii-avatar/config.json`.

Las imágenes quedan en `~/.ascii-avatar/agents/<nombre>/faces/<id>.png`. El campo `promptsVersion` de su `agent.json` vale `0`, que marca un paquete que no vino de los prompts de Gemini.

Para comprobar que tus imágenes no tiemblan antes de usarlas, corre el experimento de abajo con `--faces-dir`.

## Experimento opcional: ver la definición y la estabilidad

El repositorio incluye un experimento desechable que convierte las ocho caras a ASCII en los dos modos y las alterna como lo haría el avatar. Sirve para juzgar a simple vista si la definición y el parecido te convencen, y para medir si las imágenes están alineadas. Se corre desde la raíz del repositorio:

```sh
# Sin costo: con caras que ya tienes (<id>.png en una carpeta)
npx tsx packages/cli/spike/spike.ts --faces-dir ~/.ascii-avatar/agents/ana/faces --cols 70

# Con tu foto y tu llave: genera las ocho caras con Gemini (cuesta dinero)
export GEMINI_API_KEY=...
npx tsx packages/cli/spike/spike.ts --photo ~/Fotos/ana.jpg --out ~/ascii-avatar-spike --cap 0.50
```

Conviene poner `--out` fuera del repositorio (por ejemplo `~/ascii-avatar-spike`) para no mezclar las caras generadas con el código.

Opciones: `--photo <ruta>` y `--out <carpeta>` (para generar), `--faces-dir <carpeta>` (para usar caras existentes, sin API), `--cap <usd>` (tope, por defecto 0.50), `--cols <n>` (por defecto 70) y `--no-play` (solo imprime la tabla, sin reproducir). El experimento lee la llave de `GEMINI_API_KEY`, no de `secrets.json`.

Qué mirar:

- **La tabla de diferencias.** Para cada cara, `frameDiff` (cuánto cambia respecto a `neutral`) y `cornerDrift` (cuánto cambia el fondo en las esquinas). Si `cornerDrift` pasa de 0.02, la fila se marca "el fondo se mueve": el encuadre no se mantuvo y la cara temblará.
- **La reproducción.** Alterna `neutral`, `mouth_mid`, `mouth_open`, parpadeo y sonrisa a 6 cuadros por segundo, en modo `glyphs` y luego en `halfblock`. Ctrl-C para salir. Fíjate en el parecido con la persona, en la definición y en si algo salta de un cuadro a otro.
- Al generar, muestra `mouth_open` y pregunta si se parece a la persona antes de gastar en el resto.

Con esto puedes decidir entre `--modo glyphs` y `--modo halfblock`.

Si las caras generadas te convencen, no pagues dos veces: `avatar create <nombre> --caras ~/ascii-avatar-spike --foto <foto>` las reutiliza como paquete manual (sin Gemini y sin costo). Ojo: el gasto del experimento no se anota en `ledger.jsonl`; el tope `--cap` es lo único que lo limita.

## Modelos y variables de entorno

| Variable | Para qué sirve |
| --- | --- |
| `GEMINI_API_KEY` | Llave de Gemini. Tiene prioridad sobre la guardada en `secrets.json`. |
| `ASCII_AVATAR_HOME` | Carpeta de datos en lugar de `~/.ascii-avatar` (útil para pruebas o para tener entornos separados). |
| `ASCII_AVATAR_IMAGE_MODEL` | Modelo de imágenes. Por defecto `gemini-nano-banana-2.1`. |
| `ASCII_AVATAR_TTS_MODEL` | Modelo de voz. Por defecto `gemini-3.8-flash-tts`. |

Los ids de modelo se pueden cambiar sin tocar el código por si Google retira o renombra alguno. Ten en cuenta que las tarifas están en `pricing.ts` y no se ajustan solas al cambiar de modelo. Si usas `ASCII_AVATAR_HOME`, ponla también en el entorno desde donde Claude Code lanza el hook, porque el hook y el panel deben apuntar a la misma carpeta (comparten el socket).

## Solución de problemas

**El panel dice "Terminal muy pequeña".** La ventana mide menos de 20 columnas o 10 filas. Agranda el split o baja el ancho con `--cols`. Si la cara es más ancha o alta que la ventana, se recorta al centro; agranda el split o usa `--cols` más chico.

**La cara se ve como bloques de color raros o sin color.** Tu terminal no soporta color de 24 bits. Usa una terminal que sí lo soporte (iTerm2, Ghostty, kitty, WezTerm) o prueba `--modo glyphs`.

**"No hay un agente activo".** Crea uno con `avatar create <nombre>` o pasa `--agente <nombre>`. Si dice que faltan caras, vuelve a correr `avatar create <nombre>`.

**"El panel necesita una terminal interactiva".** `avatar panel` debe correr en una terminal real, no con la salida redirigida.

**"ya hay un panel abierto".** Solo puede haber uno por carpeta de datos. Ciérralo con `q` en su ventana.

**"Voz no disponible: falta la llave de Gemini".** No hay llave en `GEMINI_API_KEY` ni en `~/.ascii-avatar/secrets.json` (por ejemplo, si el agente se importó con `--caras`). Corre `avatar create <nombre>` con un agente nuevo para que la guarde, o crea `secrets.json` a mano con `{"geminiApiKey": "..."}` y permisos 0600. Otros avisos de voz no disponible ("falló la síntesis", "no se pudo reproducir el audio") significan que Gemini no respondió o que `afplay` falló; la siguiente respuesta lo vuelve a intentar.

**"Voz bloqueada: no se pudo registrar el gasto".** El panel no pudo escribir en `~/.ascii-avatar/ledger.jsonl` (permisos, disco lleno). Sin ese registro no se puede hacer cumplir el límite, así que la voz se bloquea hasta que reinicies el panel. Arregla el permiso o el espacio y vuelve a abrirlo.

**"Límite diario de voz alcanzado".** Ya se gastó el límite de hoy. Cierra el panel, sube `dailyLimitUsd` en `config.json` y ábrelo de nuevo (el panel solo lee ese valor al arrancar), o espera al día siguiente. Mientras tanto el avatar sigue gesticulando.

**"Gemini rechazó el texto; sin voz esta vez".** El filtro de Gemini no aceptó ese resumen. Pasa de vez en cuando; la siguiente respuesta funciona normal.

**"La llave de Gemini es incorrecta" (error de autenticación al crear).** Si escribiste mal la llave, quedó guardada así. Borra `~/.ascii-avatar/secrets.json` (o edítalo, o define `GEMINI_API_KEY`, que tiene prioridad) y vuelve a correr `avatar create`; te pedirá la llave otra vez. Lo ya generado se conserva.

**Gemini rechazó la foto (al crear).** Llega un mensaje como "Gemini rechazó editar la foto (probable filtro de contenido)". Prueba con otra foto (frontal, bien iluminada, una sola persona) y un nombre de agente nuevo (el agente ya quedó creado con la foto rechazada), o usa el paquete manual descrito arriba con `avatar create <nombre> --caras <carpeta>`; el mensaje te recuerda el comando y los ocho nombres.

**El panel no reacciona a Claude Code.** Revisa, en orden: que corriste `avatar install-hook` (y que lo volviste a correr si moviste el repositorio o cambiaste de versión de Node: el hook guarda la ruta absoluta de `node`, y sus errores no se muestran); que reiniciaste las sesiones de Claude Code después; que el panel está abierto; y que `ASCII_AVATAR_HOME`, si la usas, es la misma en ambos lados. Puedes probar el hook a mano con el panel abierto:

```sh
echo '{"hook_event_name":"Stop","last_assistant_message":"Hecho. Todo funciona bien."}' | node packages/cli/dist/bin.js hook
```

No imprime nada y sale con código 0, pero el panel debe reaccionar.

**Verificar el contrato real del hook de Claude Code.** El avatar espera que el evento `Stop` entregue por stdin un JSON con `hook_event_name: "Stop"` y `last_assistant_message` (el texto del último mensaje del asistente). Para confirmarlo en tu versión de Claude Code:

1. Respalda tu configuración: `cp ~/.claude/settings.json ~/.claude/settings.json.mio-bak`.
2. Crea el archivo antes con permisos restringidos (`touch ~/hook-stdin.json && chmod 600 ~/hook-stdin.json`; guardará el texto de tu respuesta). Añade a mano en `hooks.Stop` una entrada temporal: `{"matcher":"*","hooks":[{"type":"command","command":"cat > ~/hook-stdin.json","timeout":5}]}`.
3. Abre una sesión nueva de Claude Code, haz una pregunta corta y espera la respuesta.
4. Corre `cat ~/hook-stdin.json | python3 -m json.tool` y confirma que existe `last_assistant_message` con el texto de la respuesta y que `hook_event_name` es `"Stop"`.
5. Si no existe, el texto habría que leerlo del último mensaje del asistente en `transcript_path` (un archivo JSONL); eso requeriría ajustar `extractHookMessage` en `packages/cli/src/commands/hook.ts`, junto con su prueba. Abre un issue con la salida del paso 4.
6. Quita la entrada temporal (o restaura el respaldo) y borra `~/hook-stdin.json` (`rm ~/hook-stdin.json`).

## Privacidad

- Todo es local. No hay servidor del autor ni telemetría.
- Tu foto solo sale de tu máquina hacia la API de Gemini, cuando generas las caras. Las caras generadas, la foto original y el registro de gasto se guardan en `~/.ascii-avatar/`. Para la voz, solo viaja a Gemini el resumen corto de la respuesta, no la respuesta completa.
- Tu llave de Gemini vive en `~/.ascii-avatar/secrets.json` (0600) o en tu entorno. Nunca va en el repositorio ni dentro de la carpeta del agente, así que puedes compartir un agente copiando su carpeta sin filtrar la llave.
- El hook solo envía el texto de la respuesta a un socket local de tu carpeta de datos (permiso solo para tu usuario). No hace llamadas de red.

## Desarrollo

El repositorio es un monorepo de npm workspaces en TypeScript estricto (ESM), con pruebas en Vitest:

```
packages/core     fotos y caras a cuadros ASCII, animación, sincronía de boca, resumen hablado, registro de gasto, carpeta del agente
packages/gemini   cliente de Gemini (imágenes y voz), prompts versionados, tarifas y modelos
packages/cli      el comando avatar: create, panel, voice, install-hook, hook
docs/superpowers  especificación de diseño y plan de implementación
```

```sh
npm install
npm run build     # tsc -b
npm test          # vitest run (usa Node ^22.12, ^24 o >=26)
```

Las pruebas no gastan dinero ni tocan tu carpeta real de datos ni tu `~/.claude`. Las pruebas en vivo contra la API real de Gemini están saltadas por defecto: se activan con `RUN_LIVE=1` y una `GEMINI_API_KEY` válida, y **cuestan dinero** (imágenes y voz reales). Úsalas solo cuando quieras confirmar que los ids de modelo y las tarifas siguen vigentes:

```sh
RUN_LIVE=1 GEMINI_API_KEY=... LIVE_PHOTO=~/Fotos/ana.jpg npm test
```

`LIVE_PHOTO` es la ruta de un retrato (JPG o PNG) que las pruebas en vivo envían a Gemini; sin ella fallan.

Cambios de comportamiento: se escribe primero la prueba y se ve fallar. El diseño y las decisiones están en `docs/superpowers/specs/2026-10-18-ascii-avatar-design.md`.

## Licencia

MIT. Consulta el archivo [LICENSE](LICENSE).
