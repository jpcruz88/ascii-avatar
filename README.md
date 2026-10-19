# ascii-avatar

Una cara hecha de caracteres de terminal para tu agente de IA. Subes una foto una sola vez, el sistema genera con Gemini un paquete de ocho caras y ocho poses en estilo grabado y, desde ese momento, un panel lateral de tu terminal muestra a ese agente gesticulando (boca, parpadeo, sonrisa, seriedad, sorpresa, tristeza) cada vez que Claude Code termina de responder. Si activas la voz, además habla un resumen corto de la respuesta con la boca moviéndose.

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

  pie del panel:  ana · voz: on · gasto hoy: $0.22 MXN
```

(Es solo una ilustración. La cara real sale de tu foto y se dibuja en blanco y negro, como un grabado: tinta oscura sobre papel claro.)

Lo que hace y lo que no:

- Claude sigue siendo el cerebro. El avatar es solo la cara: la llave de Gemini se usa únicamente para generar las imágenes y, si lo activas, la voz.
- Todo corre en tu máquina. No hay servidor del autor, ni cuentas extra, ni GPU.
- El avatar nunca lee la respuesta completa en voz alta: dice un resumen de pocas frases (hasta unos 220 caracteres) sin código, rutas ni tablas.
- Con la voz apagada solo gesticula; la respuesta sigue apareciendo como texto en la terminal.
- Si le das poses y clips de movimiento (opcionales), además mira a los lados, ladea la cabeza, asiente entre frases y se queda pensativo mientras esperas (ver [Poses y clips de movimiento](#poses-y-clips-de-movimiento)).

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
avatar create <nombre> [--foto <ruta>] [--estilo grabado|foto] [--sin-poses]
                                         Crea un agente a partir de una foto (usa Gemini). Por defecto,
                                         estilo grabado: 8 caras y 8 poses (16 imágenes); --sin-poses
                                         genera solo las caras; --estilo foto, las 8 caras realistas
avatar create <nombre> --caras <carpeta> [--foto <ruta>] [--poses <carpeta>] [--clips <carpeta>]
                                         Importa tus propias ocho caras PNG y, si quieres, poses y clips
                                         de movimiento (sin Gemini, sin llave, sin costo)
avatar create <nombre> --poses <carpeta> | --clips <carpeta>
                                         Agrega o reemplaza las poses o los clips de un agente que ya
                                         existe, sin tocar sus caras
avatar panel [--agente <nombre>] [--cols <n>] [--modo grabado|glyphs|halfblock]
                                         Abre el panel (tecla v: voz, q: salir)
avatar voice on|off                      Activa o desactiva la voz
avatar voz <nombre> [--voz <Nombre>] [--estilo "<texto>"]
                                         Muestra o cambia la voz y el estilo de voz de un agente
avatar install-hook [--uninstall] [--settings <ruta>]
                                         Conecta (o desconecta) el avatar con Claude Code
avatar exportar-web <nombre> [--out <carpeta>] [--cols <n>]
                                         Exporta el agente para usarlo en una página web
avatar help                              Muestra esta ayuda
```

(`avatar hook` también existe, pero lo invoca Claude Code; no se usa a mano.)

## Crear un agente

```sh
avatar create ana --foto ~/Fotos/ana.jpg
```

El nombre del agente va de 1 a 32 caracteres entre `a-z`, `0-9` y guion. Si omites `--foto`, el comando te la pide (acepta PNG, JPG o WebP de hasta 10 MB, con cada lado entre 256 y 8000 px; sirve arrastrar el archivo a la terminal).

Por defecto el agente sale en **estilo grabado**: un retrato en blanco y negro, de líneas finas de tinta y trama sobre papel blanco, como una lámina del siglo XVIII, que es justo lo que mejor se ve en el modo `grabado` del panel. Se generan 16 imágenes: el grabado base (la cara `neutral`), las otras siete caras y las ocho poses (ver [Poses y clips de movimiento](#poses-y-clips-de-movimiento)). Las caras y las poses no salen de la foto sino de editar el grabado base, así que todas conservan el mismo trazo, encuadre y tamaño. Cuesta alrededor de $17 a $23 MXN en total (cada imagen ronda entre $1.00 y $1.45 MXN); el estimado que se muestra antes de gastar es de unos $19 MXN, un poco por encima de lo que se cobró en la corrida real. El flujo es:

1. **Llave de Gemini.** Si no hay una guardada ni definida en `GEMINI_API_KEY`, te la pide sin mostrarla al escribir y la guarda en `~/.ascii-avatar/secrets.json` con permisos 0600 (la carpeta queda en 0700). La llave nunca se guarda dentro de la carpeta del agente ni en el repositorio.
2. **Estimado y confirmación.** Antes de gastar nada muestra qué falta generar, el costo estimado, el tope y lo que ya se gastó en ese agente, todo en pesos mexicanos (por ejemplo, `Estilo grabado: 1 grabado base + 7 caras + 8 poses (16 imágenes).` y `Estimado: $19.14 MXN (tope $29.44 MXN)`). Solo continúa si respondes `s`, `si` o `sí`.
3. **Vista previa barata.** Genera primero el grabado base, lo guarda como `faces/neutral.png` y lo dibuja en la terminal en modo grabado. Te pregunta «¿Se parece? ¿Seguimos? (s/N)». Si no se parece a ti, responde que no: solo gastaste una imagen (alrededor de $1.25 MXN). El agente ya quedó creado con esa foto y ese estilo, y no se pueden cambiar: para reintentar con otra foto u otro estilo, usa un nombre nuevo (`avatar create ana2 --foto otra.jpg`) o borra la carpeta `~/.ascii-avatar/agents/<nombre>` y empieza de cero. Si corres `avatar create` con el mismo nombre y una foto distinta, el comando se detiene sin preguntar ni gastar y te indica la carpeta.
4. **El resto.** Si apruebas, genera las otras siete caras y luego las ocho poses. Cada imagen se guarda en disco como PNG y se registra su costo apenas termina. Si Gemini entrega una cara o pose de otro tamaño que el grabado base, se ajusta a ese lienzo (centrada, con relleno blanco) y te avisa con su tamaño original; si se ve desalineada, borra ese archivo y vuelve a correr el comando para regenerarla.
5. **Tope.** Antes de cada imagen comprueba el tope de creación del agente ($29.44 MXN, de sobra para las 16). Si se fuera a pasar, se detiene, avisa qué falta y deja guardado lo ya generado.

Al terminar te muestra un resumen y te sugiere `avatar movimientos <nombre>`, que genera en tu equipo y sin costo los seis clips de movimiento de cabeza a partir del grabado base (requiere instalar LivePortrait una vez; ver [Movimientos fluidos](#movimientos-fluidos-opcional-gratis)).

Opciones:

- `--sin-poses`: genera solo las ocho caras (8 imágenes, entre $8.50 y $11.50 MXN; estimado de unos $9.57 MXN). Si después corres `avatar create <nombre>` sin esa opción, genera solo las poses que faltan.
- `--estilo foto`: el flujo realista de antes. Las ocho caras se editan directamente sobre tu foto, con su color y su fondo, y no se generan poses (8 imágenes, entre $8 y $11.50 MXN). Aquí la vista previa es la cara `mouth_open` y la pregunta es «¿Seguimos con las demás caras? (s/N)». Con este estilo `--sin-poses` no tiene sentido: el comando lo rechaza si lo combinas con `--estilo foto`.

El estilo queda anotado en `agent.json` y no se puede cambiar al reanudar: si pides otro estilo para un agente que ya existe, el comando se detiene sin gastar. Los agentes creados antes de que existiera el estilo grabado (o importados con `--caras`) cuentan como `foto`.

Si algo se interrumpe (falla la red, cerraste la terminal), basta con volver a correr el mismo comando (con la misma foto o sin `--foto`): reutiliza la foto guardada y el grabado base, y solo genera las caras y poses que faltan. Nunca se vuelve a pagar por una imagen ya hecha: si el corte dejó a medias el guardado de las poses, primero se restaura la carpeta `poses/` y después se cuenta lo que falta.

El tope sí es definitivo: el gasto de creación se acumula por agente, así que si ya llegaste a $29.44 MXN, volver a correr `avatar create` te pide confirmar y se detiene en la primera imagen por el mismo tope. Las caras que falten las aportas tú con `avatar create <nombre> --caras <carpeta>` (ver [paquete de caras manual](#aportar-un-paquete-de-caras-manual)); ese comando no usa Gemini, así que el tope no le afecta.

Al terminar, si no tenías ningún agente activo, el nuevo queda como agente activo en `~/.ascii-avatar/config.json`.

Todo lo del agente vive en `~/.ascii-avatar/agents/<nombre>/`:

```
~/.ascii-avatar/
  config.json                 voz, límite diario, modo y ancho del panel, agente activo
  secrets.json                tu llave de Gemini (0600)
  ledger.jsonl                registro de gasto
  avatar.sock                 canal local entre el hook y el panel (solo mientras el panel está abierto)
  agents/<nombre>/
    agent.json                nombre, voz, estilo de voz, personalidad, fecha, versión de los prompts, estilo (grabado o foto)
    photo.png | .jpg | .webp  la foto original
    faces/<id>.png            las ocho caras
    poses/<id>.png            poses opcionales (ver «Poses y clips de movimiento»)
    clips/<clip>/000.png …    clips de movimiento opcionales
    .cache/                   cuadros ya convertidos a ASCII, para que el panel abra rápido (se puede borrar)
```

Para compartir un agente basta con copiar la carpeta `agents/<nombre>` (no contiene tu llave). Sí contiene la foto original de la persona, así que compártela solo con permiso.

El campo `voice` de `agent.json` es el nombre de la voz de Gemini (por defecto `Kore`) y el campo opcional `voiceStyle` es el estilo con que habla (ver [Voz y estilo de cada agente](#voz-y-estilo-de-cada-agente)). Lo más cómodo es cambiarlos con `avatar voz`.

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
- `--modo grabado|glyphs|halfblock`: el aspecto de la cara. Por defecto es `grabado`.
  - `grabado` (por defecto): blanco y negro, como los grabados en ASCII. Tinta oscura (`#141414`) sobre papel claro (`#FAFAF7`). Cada carácter se elige por la forma de la tinta de su celda, no solo por lo oscura que es: la celda se mide en una rejilla de 6 × 12 subceldas y se compara con las máscaras de 41 caracteres pensados para dibujo de líneas (`| / \ - _ ( ) [ ] < > . , ' : ;` y unos pocos densos, como `@ B 8 #`, para las zonas oscuras). Así las líneas finas del grabado (el ala y la copa del sombrero, las gafas, el bigote, el cuello de la camisa) salen como líneas y no como ruido. Antes, la imagen se pasa a grises y se estira el contraste por percentiles 1 %-99 % (en dos etapas, por píxel y por subcelda, con un solo rango para las ocho caras, para que no parpadeen al alternarlas) y se afina (x1,25, -20), de modo que lo casi blanco queda en papel. Las caras ya vienen sobre fondo blanco, así que no lleva viñeteado. El panel pinta su propio papel, así que se ve igual en una terminal oscura o clara.
  - `glyphs`: un carácter de una rampa de densidad por celda, con el color de la foto en el frente.
  - `halfblock`: medios bloques `▀` con color de 24 bits de frente y de fondo; a color, con más definición.

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

- Con la voz encendida, cada respuesta se convierte en un resumen corto (se quitan código, rutas y tablas), se sintetiza con Gemini, se reproduce con `afplay` y la boca se mueve según el volumen del audio.
- Con la voz apagada, la boca se mueve igual con el texto del resumen, pero no suena nada. La respuesta sigue en texto en tu terminal.
- Al hablar, el avatar muestra primero la expresión medio segundo y luego mueve la boca. Como `afplay` tarda unas decenas de milisegundos en sonar desde que se lanza, el audio se lanza 80 ms antes (`AUDIO_START_LATENCY_MS`), así el sonido empieza justo cuando la boca se mueve y boca y voz van juntas.

**Cómo se mueve la boca.** La boca tiene cinco aperturas, de 0 (cerrada) a 4 (abierta). Tres son caras del paquete (`neutral`, `mouth_mid`, `mouth_open`) y las otras dos (`mouth_q1` y `mouth_q3`) se sintetizan al abrir el panel mezclando a partes iguales las dos caras vecinas, sin imágenes nuevas ni gasto. Con voz, el volumen se mide cada 20 ms, se compara con el percentil 85 del propio audio (lo muy bajo cuenta como silencio, y una muestra dañada, NaN o infinita, también: no congela la boca); con el 85 las sílabas acentuadas llegan a las aperturas 3 y 4 en vez de quedarse en la 2, se suaviza para que la boca abra rápido (unos 25 ms) y cierre algo más despacio (unos 90 ms), y se pasa a las cinco aperturas con histéresis: la boca recorre los niveles intermedios de uno en uno, no tiembla con cambios mínimos de volumen, un clic suelto apenas la entreabre y, antes de cambiar de dirección, mantiene cada nivel al menos 60 ms. La boca se adelanta unos 60 ms al audio, como cuando alguien habla de verdad. Sin voz, cada sílaba aproximada del texto dibuja un arco que abre y cierra pasando por las aperturas intermedias: la vocal decide cuánto abre (la *a* más que la *e* o la *o*, y estas más que la *i* o la *u*), la sílaba tónica abre más, la boca cierra un momento entre palabras y la puntuación la deja cerrada más tiempo (unos 220 ms una coma y unos 440 ms un fin de frase, lo bastante para que el avatar asienta entre frases si tiene clips; unos puntos suspensivos cuentan como un solo fin de frase, el punto de un número como `3.14`, de un archivo como `mouth.ts` o de una abreviatura como `etc.` seguida de minúscula no es pausa, y ninguna pausa pasa de unos 550 ms). Mientras habla (o reproduce un clip de movimiento), el panel dibuja a 24 cuadros por segundo, con la deriva corregida (cada cuadro se agenda a su hora, así el tiempo de dibujar no se acumula); en reposo baja a unos 12 y solo redibuja cuando cambia la cara o el pie.
- La voz necesita la llave de Gemini y macOS. Sin ellas el avatar sigue funcionando solo con gestos y lo avisa en el pie.

### Voz y estilo de cada agente

Cada agente puede sonar como su personaje: tiene una voz de Gemini (`voice`) y, si quieres, un estilo de habla en texto libre (`voiceStyle`, hasta 300 caracteres) que se envía a Gemini junto con el texto.

```sh
avatar voz luna                                  # muestra la voz y el estilo actuales
avatar voz luna --voz Algenib                    # cambia solo la voz
avatar voz luna --estilo "un hombre mexicano de unos sesenta años, voz grave, cálida y pausada, acento mexicano"
avatar voz luna --voz Algenib --estilo "..."     # cambia las dos cosas
avatar voz luna --estilo ""                      # quita el estilo
```

Sin banderas, `avatar voz <nombre>` solo muestra la configuración. Una bandera desconocida muestra la ayuda y sale con código 1.

Algunas voces de Gemini para empezar (la lista completa está en la documentación de voz de Gemini):

| Voz | Tipo | Carácter |
|---|---|---|
| `Algenib` | masculina | grave, un poco áspera |
| `Algieba` | masculina | grave, suave |
| `Achird` | masculina | cálida, cercana |
| `Alnilam` | masculina | firme |
| `Kore` | femenina | firme (es la voz por defecto) |

**Reinicia el panel para aplicar los cambios.** El panel lee la voz y el estilo del agente una sola vez al abrirse, así que si ya está abierto, ciérralo (`q`) y vuelve a abrirlo con `avatar panel`.

## Costos y topes

Las tarifas son las de la documentación oficial de Gemini verificadas el 18 de octubre de 2026. Viven en `packages/gemini/src/pricing.ts` y los modelos en `packages/gemini/src/models.ts`, por si Google los cambia.

| Concepto | Cifra |
| --- | --- |
| Modelo de imágenes | `gemini-nano-banana-2.1`, entre $1.00 y $1.45 MXN por imagen, incluida la imagen de entrada (corrida real del flujo grabado: 16 imágenes costaron unos $17.74 MXN); el estimado previo usa $1.20 MXN por imagen |
| Un agente completo en estilo grabado (16 imágenes) | entre $17 y $23 MXN (estimado previo: unos $19 MXN) |
| Solo las caras (`--sin-poses` o `--estilo foto`, 8 imágenes) | entre $8 y $11.50 MXN (estimado previo: unos $9.57 MXN) |
| Tope duro de creación | unos $29 MXN por agente |
| Voz | unos $0.55 MXN por minuto (tarifa conservadora: el registro sobrestima un poco) |
| Límite diario de voz | unos $5.50 MXN (unos 10 minutos de voz), configurable |

Todas las cifras están en pesos mexicanos al tipo de cambio por defecto de 18.4 pesos por dólar (`mxnPorUsd`, ver más abajo). **Internamente los montos se registran en dólares (USD)**, porque Gemini cobra en dólares: el registro `ledger.jsonl`, las tarifas de `pricing.ts` y los topes siguen en USD, y los pesos son solo la forma de mostrarlos. Por eso, si cambia el tipo de cambio, cambian las cifras que lees pero no lo que Google te cobra.

Cómo se aplican:

- **Creación.** Se muestra el estimado y se pide confirmación antes de gastar. Antes de cada imagen se comprueba que el gasto acumulado de ese agente más el de la imagen no pase del tope ($29.44 MXN); si pasara, se detiene. Cada imagen se registra en `~/.ascii-avatar/ledger.jsonl` en cuanto se cobra. Los costos se calculan con los tokens que reporta la API; si no los reporta, se marcan como "(estimado)".
- **Voz.** Cada síntesis se registra en el mismo archivo. Al llegar al límite diario, el avatar deja de hablar por el resto del día (sigue gesticulando) y muestra "Límite diario de voz alcanzado" junto con el límite en pesos. El día cuenta en hora local.
- **Contador "gasto hoy".** El pie del panel muestra siempre lo gastado hoy en voz, en pesos con dos decimales (por ejemplo, `gasto hoy: $0.22 MXN`; desde 100 pesos sin decimales).
- **Cambiar el límite diario.** Cierra el panel (`q`), edita `~/.ascii-avatar/config.json` y vuelve a abrir el panel. El panel lee el archivo una sola vez al arrancar, así que un cambio hecho con el panel abierto no se aplica hasta que lo reabras (al pulsar `v` solo se actualiza la voz y se conserva el resto de lo que haya en el archivo):

```json
{
  "activeAgent": "ana",
  "voice": false,
  "dailyLimitUsd": 0.5,
  "mxnPorUsd": 18.4,
  "limiteDiarioMxn": 10,
  "mode": "grabado",
  "cols": 70
}
```

- `limiteDiarioMxn` es el límite diario de voz en pesos mexicanos (0 desactiva la voz de hecho). Es opcional: si está presente y es válido (número finito, no negativo), manda sobre `dailyLimitUsd`; se convierte a dólares con `mxnPorUsd` para compararlo con el registro de gasto.
- `dailyLimitUsd` es el límite diario en dólares. Se conserva por compatibilidad y solo se usa si no hay un `limiteDiarioMxn` válido (por defecto 0.30, unos $5.52 MXN; 0 desactiva la voz de hecho).
- `mxnPorUsd` es el tipo de cambio con el que se muestran los pesos: cuántos pesos vale un dólar (por defecto 18.4). Debe ser un número finito mayor que 0; si no, se usa el valor por defecto. Solo cambia lo que ves, no lo que se registra ni lo que cobra Gemini.
- `mode` y `cols` son los valores por defecto del panel; las opciones de `avatar panel` los sobrescriben.

Todos se editan con el panel cerrado y se aplican al reabrirlo. Un archivo ausente o con valores inválidos vuelve a los valores por defecto.

Los precios de un servicio externo cambian. Si ves que el gasto real se desvía de estas cifras, revisa `ledger.jsonl` y el panel de uso de tu cuenta de Google AI Studio.

## Aportar un paquete de caras manual

No tienes que usar Gemini para las imágenes: puedes hacer las tuyas con cualquier herramienta (otro generador, fotos reales, ilustraciones). Es el camino a seguir si Gemini rechaza tu foto, si se alcanzó el tope de creación o si prefieres no pagar.

**Contrato de encuadre.** Las ocho imágenes deben tener la misma cámara, la misma pose, la misma luz, el mismo encuadre y el mismo fondo. Solo cambia la cara. Y todas deben tener exactamente el mismo tamaño en píxeles (por ejemplo 1024 por 1024). Si el encuadre se mueve entre imágenes, el ASCII "tiembla" al cambiar de cara.

**Los ocho nombres exactos** (`FACE_IDS`), uno por archivo PNG (las aperturas intermedias de la boca no son archivos: el panel las sintetiza mezclando `neutral`, `mouth_mid` y `mouth_open`):

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

Si además tienes poses o clips de movimiento, impórtalos en el mismo comando con `--poses` y `--clips`, o después (ver [Poses y clips de movimiento](#poses-y-clips-de-movimiento)).

## Poses y clips de movimiento

Con solo las ocho caras el avatar parpadea, cambia de expresión y mueve la boca, siempre de frente. Si además le das poses sueltas y clips de movimiento, cobra vida: mira a los lados, ladea la cabeza, asiente entre frases y se queda pensativo mientras esperas. Son opcionales: el paquete de ocho caras sigue siendo obligatorio y no cambia, y si no hay poses ni clips el avatar se comporta exactamente como antes.

**Poses** (`poses/<id>.png`): una imagen suelta por pose, en el mismo lienzo que las caras (mismo tamaño en píxeles, por ejemplo 896 × 1193, misma cámara, luz y fondo). Puedes dar todas o solo algunas:

| Archivo | Qué muestra |
| --- | --- |
| `tilt_left.png`, `tilt_right.png` | cabeza ladeada a la izquierda o a la derecha |
| `nod_up.png`, `nod_down.png` | cabeza un poco arriba o abajo (asintiendo) |
| `turn_left.png`, `turn_right.png` | cabeza girada a un lado |
| `look_left.png`, `look_right.png` | solo la mirada hacia un lado |

**Clips** (`clips/<clip>/000.png`, `001.png`, …): secuencias suaves que empiezan y terminan en la cara neutral, con los cuadros numerados desde `000` sin huecos (al menos dos y como mucho 120, es decir 5 s). Se reproducen a 24 cuadros por segundo. Los clips son `nod` (asentir), `tilt_left`, `tilt_right` (ladear), `turn_left`, `turn_right` (girar) y `think` (pensar).

Si creaste el agente con `avatar create` en estilo grabado (el de por defecto), las ocho poses ya se generaron solas. Si no, o si prefieres las tuyas, se importan sin Gemini y sin costo, junto con las caras o después, sobre un agente que ya existe (sin tocar sus caras ni su `agent.json`):

```sh
avatar create ana --caras ~/Imagenes/ana-caras --poses ~/Imagenes/ana-poses --clips ~/Imagenes/ana-clips
avatar create ana --poses ~/Imagenes/ana-poses     # solo las poses, a un agente existente
avatar create ana --clips ~/Imagenes/ana-clips     # solo los clips
```

La carpeta de `--poses` lleva los `<id>.png`; la de `--clips`, una subcarpeta por clip (`nod/000.png`, `nod/001.png`, `think/000.png`…). Antes de escribir nada se comprueba que cada archivo sea un PNG real (por la cabecera), pese 10 MB o menos y mida exactamente lo mismo que las caras (las que importas en ese momento o las que ya tiene el agente), que los nombres sean conocidos y que la numeración de cada clip vaya de `000.png` en adelante sin huecos. Si algo falla, el mensaje dice qué archivo y por qué, y no se cambia nada. Los archivos ocultos (como `.DS_Store`) y los que no son `.png` se ignoran. Cada importación reemplaza el juego entero de ese tipo: si importas poses, el agente queda exactamente con las poses de la carpeta (lo mismo con los clips). Si una importación se corta a medias, la siguiente deja todo en orden (restaura el juego anterior si hacía falta y borra los temporales). Si vuelves a importar caras de otro tamaño, el comando avisa que las poses y clips que ya tenía el agente no coinciden y que el panel los ignorará hasta que los vuelvas a importar.

**Cómo se mueve.**

- **En reposo**, cada 4 a 9 segundos hace un gesto elegido al azar con pesos: mirar a un lado (la pose `look_*` sostenida de 0,8 a 1,5 s, o un clip `turn_*`), ladear la cabeza (clip `tilt_*`; si no hay clip pero sí la pose `tilt_*`, la sostiene) o, rara vez, asentir (clip `nod`). Nunca repite el mismo gesto dos veces seguidas.
- **Pensando** (cuando envías un mensaje), reproduce el clip `think`, sostiene una pose suave (`look_*` o `turn_*`) y descansa de 2 a 4 s antes de repetir.
- **Hablando**, la boca sigue de frente con sus cinco aperturas. En las pausas de la boca de 350 ms o más entre frases asiente con el clip `nod` (o ladea con `tilt_*`), como mucho una vez cada 3 s. Si el clip no cabe en la pausa, hace un tramo corto de ida y vuelta de sus primeros cuadros, que termina en neutral. Al terminar de hablar, tras los 3 s con la expresión, vuelve al reposo.
- **Interrupciones**: si llega una respuesta o un mensaje a mitad de un gesto, la cabeza no salta a la cara de frente. Un clip vuelve desde su cuadro actual hasta el primero (acelerado si hace falta, en menos de medio segundo, dentro del avance de la expresión, así la boca empieza a su hora) y una pose se suelta siempre por un cuadro de regreso que el panel sintetiza mezclando la pose con `neutral` (no por un clip: poses y clips pueden venir de fuentes distintas y no casar); si llega otra interrupción durante ese regreso, lo termina. Si ya está pensando, un mensaje nuevo no reinicia el clip `think`.
- **Parpadeo**: sigue igual, pero nunca durante un gesto (los cuadros de un clip ya traen sus propios ojos): un parpadeo que caería dentro se hace al terminar el gesto.
- Mientras se ve un clip (y un instante antes de que empiece), el panel dibuja a 24 cuadros por segundo; durante una pose sostenida basta el ritmo de reposo.

Todo esto lo decide el animador de forma determinista (con la fuente de azar inyectada en las pruebas), así que se puede probar sin terminal.

**Arranque y caché.** Convertir 8 caras, 8 poses y 6 clips de 16 cuadros a 150 columnas en modo `grabado` tarda unos 3 s. Por eso el panel guarda los cuadros ya convertidos en `agents/<nombre>/.cache/` (un archivo por modo y ancho, escrito de forma atómica). Cada cuadro se reutiliza mientras no cambien la fecha y el tamaño de sus archivos, el ancho, el modo ni el tono de las caras; con la caché, el mismo agente abre en unos 50 ms. Si cambias un archivo, solo se vuelve a convertir ese cuadro. Una pose o un cuadro de clip dañado o de otro tamaño se descarta (y de un clip con un cuadro malo se descarta el clip entero) sin impedir que el panel abra. Se conservan los 3 archivos de caché más recientes por agente (por ejemplo, si cambias de ancho) y los más viejos se borran solos. Los cuadros comparten los objetos de color, así que la primera carga y la carga desde la caché ocupan lo mismo en memoria (unos 100 MB para 122 cuadros a 150 columnas). Borrar `.cache/` es seguro: se rehace al abrir el panel.

## Movimientos fluidos (opcional, gratis)

`avatar movimientos <nombre>` genera en tu equipo los seis clips de movimiento de cabeza de un agente (`nod`, `tilt_left`, `tilt_right`, `turn_left`, `turn_right`, `think`) a partir de su cara neutral, con [LivePortrait](https://github.com/KlingTeam/LivePortrait). No usa Gemini, no pide llave y no cuesta nada. El movimiento lo calcula LivePortrait, pero lo que se deforma es el grabado original a tamaño completo, así que las líneas siguen nítidas; cada clip empieza y termina exactamente en la cara neutral.

**Instalación (una sola vez).** LivePortrait se instala aparte, no viene en este repositorio. Ocupa unos 630 MB de pesos y 1,2 GB del entorno de Python. Hace falta [uv](https://docs.astral.sh/uv/) (`brew install uv`) y git:

```sh
git clone https://github.com/KlingTeam/LivePortrait ~/LivePortrait
cd ~/LivePortrait
uv venv --python 3.10 venv
source venv/bin/activate
uv pip install --index-strategy unsafe-best-match -r requirements_macOS.txt
uv pip install huggingface_hub==0.25.2
huggingface-cli download KlingTeam/LivePortrait --local-dir pretrained_weights \
  --exclude "*.git*" "README.md" "docs/*" "liveportrait_animals/*"
deactivate
```

**Uso.**

```sh
avatar movimientos ana --liveportrait ~/LivePortrait   # los seis clips
avatar movimientos ana --clips nod,think               # solo esos (los demás se conservan)
```

La carpeta de LivePortrait se toma de `--liveportrait`, si no de la variable `ASCII_AVATAR_LIVEPORTRAIT` y si no de la configuración: tras la primera ejecución correcta se guarda en `config.json` (`liveportraitDir`) y ya no hace falta repetirla. Debe tener `venv/bin/python` y `pretrained_weights/` (también vale una carpeta que tenga `venv/` y el repositorio en `LivePortrait/`). Antes de lanzar nada se comprueba que todo esté en su sitio y, si falta algo, el mensaje dice qué y cómo arreglarlo. El comando necesita el repositorio clonado de ascii-avatar (usa el script `tools/liveportrait/generate_clips.py`, que no viaja en una instalación empaquetada). Al proceso de Python no se le pasan las llaves ni los tokens de tu entorno (`GEMINI_API_KEY` y cualquier `*_API_KEY`, `*_TOKEN` o `*_SECRET`).

En un Mac con Apple Silicon tarda alrededor de 1 minuto para los seis clips (unos 10 s por clip más la carga del modelo). Se muestra el avance cuadro a cuadro, primero mientras LivePortrait calcula y luego mientras se guardan los PNG. Los cuadros se escriben primero en una carpeta temporal y solo al final se importan con la misma validación que `avatar create --clips` y el mismo reemplazo atómico: si algo falla o cancelas con Ctrl-C (o se cierra la terminal), se detiene solo ese proceso, se borra la carpeta temporal y el agente queda como estaba. Con `--clips`, los demás clips del agente se conservan; si alguno estaba dañado o es de otro tamaño, se descarta con un aviso. Reinicia el panel para ver los clips nuevos.

**Licencias.** LivePortrait, sus pesos y los componentes que descarga tienen sus propias licencias, distintas de la MIT de este repositorio. El código de LivePortrait es MIT ([LICENSE](https://github.com/KlingTeam/LivePortrait/blob/main/LICENSE)), pero algunos componentes, como los modelos de detección de caras de [InsightFace](https://github.com/deepinsight/insightface), solo permiten uso no comercial o de investigación. Revísalas antes de usar los clips con fines comerciales.

Los detalles del generador (ángulos, cuadros por clip, salida JSON) están en [`tools/liveportrait/README.md`](tools/liveportrait/README.md).

## Usarlo en una página web

El mismo avatar, con el mismo motor que el panel (parpadeo, gestos, poses, clips y boca), se puede poner en cualquier página con un elemento `<ascii-avatar>`. Sin voz funciona con archivos estáticos (sirve GitHub Pages); la voz es opcional y va por un pequeño servidor tuyo.

**1. Exporta el agente.**

```sh
avatar exportar-web ana                    # crea ./ana-web/
avatar exportar-web ana --out sitio/ana --cols 100
```

La carpeta lleva solo `manifest.json` (nombre, voz, estilo de voz, columnas y filas, colores, lista de cuadros, poses y clips) y `frames.txt` (los cuadros ya convertidos a caracteres en modo grabado, tinta sobre papel). **Nunca lleva la foto original ni tu llave de Gemini.** Sí lleva la cara de la persona dibujada con caracteres, así que publícala solo con su permiso. `--cols` va de 20 a 500 (por defecto 120: la página escala la letra, así que conviene más definición que en el panel). Si la carpeta ya existe, solo se reescribe si es un paquete web anterior; si tiene otras cosas, el comando se detiene. Un agente con unos 120 cuadros (caras, poses y clips) a 120 columnas pesa alrededor de 1.2 MB (unos 100 KB comprimido con gzip, como lo sirven GitHub Pages y casi cualquier servidor).

El repositorio ignora las carpetas `*-web/` para que no subas un agente real por accidente. Una carpeta elegida con `--out` que no termine en `-web` (como `sitio/ana` del ejemplo) **no** queda cubierta: no la subas a un repositorio público si lleva la cara de una persona real.

**2. Ponlo en la página.** Copia junto a tu página el archivo `packages/web/dist/ascii-avatar.js` (se genera con `npm run build`) y la carpeta exportada:

```html
<script type="module" src="ascii-avatar.js"></script>

<ascii-avatar src="ana-web/" style="width: 100%; max-width: 480px"></ascii-avatar>
```

La letra se calcula con el ancho del contenedor y las columnas del paquete (cada celda es alta el doble que ancha, como en la terminal), así que el avatar ocupa el ancho que le des. Se pinta en blanco y negro con los colores del paquete; puedes cambiarlos con las variables CSS `--ascii-avatar-tinta`, `--ascii-avatar-papel` y la fuente con `--ascii-avatar-fuente`. Cuando la pestaña está oculta deja de dibujar.

**3. Hazlo hablar desde JavaScript.**

```js
const avatar = document.querySelector('ascii-avatar');
avatar.pensar();                    // cara de pensar (alias: think())
await avatar.decir('Listo. Las pruebas pasan.');   // resuelve al terminar (alias: say())
avatar.callar();                    // corta lo que esté diciendo (alias: stop())

avatar.addEventListener('listo', (e) => console.log('cargó', e.detail.agente));
avatar.addEventListener('hablando', (e) => console.log('dice', e.detail.texto, 'con voz:', e.detail.voz));
avatar.addEventListener('fin', () => console.log('terminó'));
avatar.addEventListener('aviso', (e) => console.warn(e.detail.mensaje));
```

Igual que en el panel, dice un resumen corto del texto (sin código ni rutas) y elige la expresión por el contenido. Sin voz, la boca se mueve con el texto (boca sintética) y no suena nada.

**4. Voz (opcional): el proxy.** La llave de Gemini nunca debe ir en una página: cualquiera que la abra podría copiarla. Por eso la voz pasa por un servidor pequeño que corre en tu máquina (o en tu servidor) y guarda la llave:

```sh
npm run build
node tools/web-tts-proxy/server.mjs --origin http://localhost:8080 --limite-diario-mxn 2
# Proxy de voz en http://127.0.0.1:8787/tts para http://localhost:8080 · tope diario de la web $2.00 MXN (límite total del día $5.52 MXN)
```

```html
<ascii-avatar src="ana-web/" tts-url="http://localhost:8787/tts"></ascii-avatar>
```

- Lee la llave de `GEMINI_API_KEY` o de `~/.ascii-avatar/secrets.json`; si no hay, responde con un mensaje que dice dónde ponerla. La llave nunca sale hacia la página.
- Escucha en `127.0.0.1` y el puerto 8787 por defecto (`--host`, `--port`, o `TTS_PROXY_HOST`, `TTS_PROXY_PORT`). **Para uso local, déjalo en `127.0.0.1`**: así solo lo alcanzan los programas de tu propia máquina.
- `--origin` (o `TTS_PROXY_ORIGIN`) restringe CORS a esa página: cualquier otro origen recibe 403. **Eso no es un control de acceso.** Solo impide que otras páginas lo usen desde el navegador de un visitante; fuera de un navegador cualquiera puede enviar la cabecera que quiera (por ejemplo `curl -H 'Origin: http://localhost:8080' …`) y la petición pasa y gasta. Lo único que de verdad frena el gasto son los topes diarios.
- Dos topes diarios, los dos en el mismo `~/.ascii-avatar/ledger.jsonl` que el panel: el **límite total del día** de `config.json` (`limiteDiarioMxn` o `dailyLimitUsd`), que comparten panel y página, y un **tope propio de la web**, `--limite-diario-mxn` (o `TTS_PROXY_LIMITE_DIARIO_MXN`), contado solo sobre lo que gastó el proxy (se anota como `<agente>@web`). Sin `--limite-diario-mxn`, el tope de la web es la mitad del límite total, para que las visitas nunca dejen sin voz a tu panel. Ponle uno más bajo si la página es pública. Al llegar a cualquiera de los dos responde «Límite diario de voz alcanzado» (sin montos) y el avatar sigue con la boca sintética.
- Limita el cuerpo (4 KB), el texto (500 caracteres), las peticiones (20 por minuto por dirección IP) y la cola (como mucho 3 síntesis pendientes; más, 429).
- No paga lo que nadie espera: si la página corta la petición (otro `decir`, `callar` o se cierra), el proxy no llama a Gemini o cancela la síntesis en curso. Si Gemini no responde en 25 s, se abandona sin anotar gasto.
- Si no puede anotar un gasto, bloquea la voz hasta que lo reinicies. Nunca escribe la llave ni el texto en su registro, y no reenvía los errores de Gemini.

Si el proxy no responde o se alcanza el límite, el avatar avisa (evento `aviso`) y sigue con la boca sintética. Los navegadores solo dejan sonar audio después de un clic o una tecla del usuario: llama a `decir` desde un gesto (un botón, un formulario).

No hay modo «llave en el navegador del visitante». La documentación de Gemini no garantiza que su API REST acepte llamadas directas desde una página (CORS) y pide expresamente no exponer la llave del lado del cliente y usar un servidor intermedio; sus tokens efímeros son solo para la Live API. El proxy es la única vía.

**GitHub Pages.** Sube `ascii-avatar.js`, tu página y la carpeta exportada al repositorio de Pages; sin el proxy, el avatar gesticula y mueve la boca sin sonido. Dar voz a un sitio público tiene más pasos y riesgos:

- **Contenido mixto.** Una página `https://` no puede llamar a `http://…:8787`: el navegador lo bloquea. El proxy necesita HTTPS, normalmente detrás de un proxy inverso (Caddy, nginx) en un servidor tuyo, con `--origin https://tu-usuario.github.io`.
- **Detrás de un proxy inverso todas las peticiones llegan desde la misma IP** (la del proxy inverso), así que el límite por IP se vuelve un límite global para todos los visitantes. Con `--trust-proxy` (o `TTS_PROXY_TRUST_PROXY=1`) cuenta por el primer salto de `X-Forwarded-For`; actívalo solo si el proxy inverso es el único camino hacia el proxy de voz (si no, cualquiera puede inventar esa cabecera).
- **El gasto es tuyo.** Cualquiera puede llamarlo (el `Origin` no lo impide), así que pon un `--limite-diario-mxn` bajo: las visitas solo podrán gastar eso al día y tu panel conserva su parte del límite.

**Demo.** `examples/web/` es una página con un cuadro de texto para hacerlo hablar, con un agente de muestra sintético (una cara dibujada con figuras, `examples/web/muestra-web/`, que regenera `node examples/web/make-sample.mjs`):

```sh
npm run build
node examples/web/serve.mjs          # http://localhost:8080/examples/web/
```

Para ver tu propio agente, expórtalo en la raíz del repositorio (`avatar exportar-web ana`, queda ignorado por git) y abre `http://localhost:8080/examples/web/?agente=../../ana-web/`. Con voz: levanta el proxy con `--origin http://localhost:8080` y agrega `&tts=http://localhost:8787/tts`.

## Experimento opcional: ver la definición y la estabilidad

El repositorio incluye un experimento desechable que convierte las ocho caras a ASCII en los modos `glyphs` y `halfblock` y las alterna como lo haría el avatar. Sirve para juzgar a simple vista si la definición y el parecido te convencen, y para medir si las imágenes están alineadas. Se corre desde la raíz del repositorio:

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

Con esto puedes comparar `--modo glyphs` y `--modo halfblock`; el modo `grabado` (el de por defecto) se ve con `avatar panel`.

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

**La cara se ve con manchas o con tonos grises raros.** Tu terminal no soporta color de 24 bits (el modo `grabado` también pinta tinta y papel con color de 24 bits). Usa una terminal que sí lo soporte (iTerm2, Ghostty, kitty, WezTerm) o prueba `--modo glyphs`.

**"No hay un agente activo".** Crea uno con `avatar create <nombre>` o pasa `--agente <nombre>`. Si dice que faltan caras, vuelve a correr `avatar create <nombre>`.

**"El panel necesita una terminal interactiva".** `avatar panel` debe correr en una terminal real, no con la salida redirigida.

**"ya hay un panel abierto".** Solo puede haber uno por carpeta de datos. Ciérralo con `q` en su ventana.

**"Voz no disponible: falta la llave de Gemini".** No hay llave en `GEMINI_API_KEY` ni en `~/.ascii-avatar/secrets.json` (por ejemplo, si el agente se importó con `--caras`). Corre `avatar create <nombre>` con un agente nuevo para que la guarde, o crea `secrets.json` a mano con `{"geminiApiKey": "..."}` y permisos 0600. Otros avisos de voz no disponible ("falló la síntesis", "no se pudo reproducir el audio") significan que Gemini no respondió o que `afplay` falló; la siguiente respuesta lo vuelve a intentar.

**"Voz bloqueada: no se pudo registrar el gasto".** El panel no pudo escribir en `~/.ascii-avatar/ledger.jsonl` (permisos, disco lleno). Sin ese registro no se puede hacer cumplir el límite, así que la voz se bloquea hasta que reinicies el panel. Arregla el permiso o el espacio y vuelve a abrirlo.

**"Límite diario de voz alcanzado".** Ya se gastó el límite de hoy (el aviso muestra el límite en pesos). Cierra el panel, sube `limiteDiarioMxn` (o `dailyLimitUsd`) en `config.json` y ábrelo de nuevo (el panel solo lee ese valor al arrancar), o espera al día siguiente. Mientras tanto el avatar sigue gesticulando.

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
packages/cli      el comando avatar: create, panel, voice, install-hook, hook, exportar-web
packages/web      el elemento <ascii-avatar> (se empaqueta en packages/web/dist/ascii-avatar.js)
tools/web-tts-proxy  proxy de voz para la página web
examples/web      demo web con un agente de muestra sintético
docs/superpowers  especificación de diseño y plan de implementación
```

```sh
npm install
npm run build     # tsc -b y el paquete web con esbuild
npm test          # vitest run (usa Node ^22.12, ^24 o >=26)
npm run test:e2e  # prueba de navegador de la demo con Playwright (construye antes)
```

La primera vez, `npm run test:e2e` necesita el navegador de Playwright: `npx playwright install chromium`. El núcleo tiene una entrada para el navegador, `@ascii-avatar/core/browser` (animador, boca, WAV, resumen y expresión, sin Node ni sharp); una prueba recorre su grafo compilado para que siga así.

Las pruebas no gastan dinero ni tocan tu carpeta real de datos ni tu `~/.claude`. Las pruebas en vivo contra la API real de Gemini están saltadas por defecto: se activan con `RUN_LIVE=1` y una `GEMINI_API_KEY` válida, y **cuestan dinero** (imágenes y voz reales). Úsalas solo cuando quieras confirmar que los ids de modelo y las tarifas siguen vigentes:

```sh
RUN_LIVE=1 GEMINI_API_KEY=... LIVE_PHOTO=~/Fotos/ana.jpg npm test
```

`LIVE_PHOTO` es la ruta de un retrato (JPG o PNG) que las pruebas en vivo envían a Gemini; sin ella fallan.

Cambios de comportamiento: se escribe primero la prueba y se ve fallar. El diseño y las decisiones están en `docs/superpowers/specs/2026-10-18-ascii-avatar-design.md`.

## Licencia

MIT. Consulta el archivo [LICENSE](LICENSE).
