# ascii-avatar: diseño

Fecha: 2026-10-18. Estado: borrador para aprobación.
Nombre del proyecto: provisional (`ascii-avatar`), por decidir.

## 1. Intención y por qué

Dar a un agente de IA una cara propia, hecha de caracteres ASCII muy definidos, que gesticule y hable. La cara sale de una foto que la persona sube una sola vez; ese agente conserva esa cara siempre. Cada agente tiene su propia foto y su propia personalidad visual.

El proyecto es un **repositorio abierto** que cualquiera descarga, instala y personaliza con sus propias llaves y sus propios agentes. No hay servicio alojado, ni servidor del autor, ni se guardan fotos de nadie.

Inspiración visual: las imágenes de https://spider.cloud/ (sección "Use the whole web like a dataset"). Nota de investigación: esas imágenes **no son ASCII real**. Son grabados `.webp` usados como máscara CSS con una capa de grano. Lo que se quiere imitar es la sensación de definición alta; aquí se logra con ASCII de verdad, con muchas columnas, color y caracteres de densidad fina.

Investigación previa (resumen): no se encontró un proyecto que junte foto → ASCII definido → voz y gestos → agente de IA. Hay piezas sueltas reutilizables (convertidores de imagen a ASCII en canvas, librerías de lip-sync como TalkingHead y wawa-lipsync, plataformas de avatar realista que requieren GPU y servidor).

## 2. Objetivos, no objetivos y anti-objetivos

### Objetivos (V1)
- El usuario escribe en Claude Code como siempre; un panel lateral de su terminal muestra la cara del agente reaccionando a cada respuesta.
- El avatar gesticula (boca, parpadeo, expresiones) y, si está activado, habla con voz.
- Un interruptor de voz: encendida o apagada. Apagada = solo gestos; la respuesta sigue en texto en la terminal.
- Creación guiada del agente desde la terminal: pide la foto y la llave de Gemini, genera el paquete de caras, muestra el costo antes y respeta un tope.
- Una sola llave de Gemini para imágenes y voz.
- Integración con la sesión de Claude Code que ya esté corriendo, sin modificar cómo funciona esa sesión.
- Repositorio descargable y personalizable por cualquiera, con licencia MIT.

### No objetivos (V1, pero previstos para después)
- Entrada por micrófono. En V1 el usuario escribe.
- Versión web (componente `<ascii-avatar>`). El diseño del núcleo debe permitirla, pero no se construye en V1.
- Otros proveedores de imagen, voz o cerebro (OpenAI, Anthropic API, ElevenLabs, voz local Kokoro…). El diseño deja la interfaz de adaptadores lista, pero V1 trae solo Gemini.
- Generar video realista o usar GPU.
- Compartir/exportar agentes completos entre personas (el formato del archivo del agente debe ser portable, pero no hay galería ni mercado).

### Anti-objetivos (fallaría aunque "funcione")
- Que el usuario gaste más del tope sin enterarse.
- Que el avatar lea en voz alta código, rutas, tablas o respuestas largas completas.
- Que el ASCII "tiemble" al cambiar de cuadro porque las imágenes no están alineadas.
- Que instalarlo exija tocar a mano la configuración de Claude Code o entender sockets y hooks.
- Que dependa de un servidor del autor, de GPU o de cuentas extra.
- Que se vea como un convertidor genérico de imagen a ASCII, sin la definición de referencia.

## 3. Restricciones

- **Presupuesto por agente:** el usuario fijó 30 a 40 MXN. Con el dólar a ~18.4 MXN (16-oct-2026) son ~$1.63 a ~$2.17 USD. **Tope duro por defecto: $1.60 USD** (~29 MXN), configurable. **Meta normal: menos de $0.60 USD** (~11 MXN).
- **Costo de Gemini** (documentación oficial, 2026-10-18): `gemini-2.5-flash-image` fue retirado el 2-oct-2026; el modelo vigente es `gemini-nano-banana-2.1`, ~$0.0336 USD por imagen de 1K (~$0.0168 por lotes), más ~$1.50 por millón de tokens de entrada. 8 imágenes ≈ $0.30 USD. Voz: el audio de salida cuesta ~$20 por millón de tokens a 25 tokens por segundo (~$0.03 por minuto). Los ids de modelo y las tarifas viven en configuración, no en el código.
- **Local y sin servidor propio.** Todo corre en la máquina del usuario.
- **Terminal objetivo:** la del usuario (macOS, zsh; iTerm presente). Debe usar color de 24 bits. Habrá que definir un mínimo soportado para otras terminales.
- **El repo es abierto:** ningún secreto en el código; la llave de Gemini vive en el equipo del usuario, nunca en el repo ni en el paquete del agente.

## 4. Decisiones del usuario (tal como las decidió)

- Proyecto = repositorio abierto, instalable en terminal; integrable en web con sus propios agentes (web: fase posterior).
- Cada agente tiene su propia foto; se sube una vez y queda fija.
- Panel lateral en la terminal (opción A de las maquetas): trabajo a la izquierda, cara a la derecha.
- Varias fotos generadas con IA (unas 10 a 12) con distintas expresiones, para que de ahí salgan los gestos.
- El propio sistema pide la foto y la llave de Gemini y genera las imágenes; los prompts deben elegirse con cuidado para gastar poco.
- Presupuesto máximo 30 a 40 MXN por agente.
- Una sola llave de Gemini para todo en la primera versión.
- Debe integrarse sin problemas con el agente de Claude que esté corriendo.
- En V1: el usuario escribe; el agente responde con gestos y, opcionalmente, voz. Se puede desactivar la voz y queda solo gestos + texto.
- Quiere probarlo primero en su terminal.

## 5. Decisiones tomadas por mí (el usuario las confirmó o no las ha revisado en detalle)

Las marco como **llamadas mías** para que se revisen.

- **TypeScript en todo**, por correr igual en Node (terminal) y navegador (web futura).
- **Monorepo con npm workspaces** (corrección: antes decía pnpm; Node 25+ ya no trae corepack y así no se exige otra herramienta) y paquetes: `core` (foto/paquete → cuadros ASCII, sincronía de boca), `cli` (terminal: crear agente, mostrar panel, interruptor de voz), `adapters` (Gemini en V1; interfaz abierta), y `web` (reservado para después).
- **Render en terminal:** ANSI con color de 24 bits y caracteres de medio bloque/braille para la definición.
- **Licencia MIT.**
- **Pruebas** con Vitest (y Playwright cuando exista la web), siguiendo el TDD del usuario.
- **Atlas de cuadros precalculados:** al crear el agente, las imágenes se convierten a ASCII una sola vez; en ejecución solo se cambia de cuadro al ritmo de la voz. No hay GPU ni deformación en vivo.
- **Sincronía de boca:** con fonemas/visemas si el proveedor los entrega; si no, por volumen del audio.
- **Integración con Claude Code por hook:** un hook (por ejemplo al terminar cada respuesta) envía el texto a un proceso del avatar. El avatar corre aparte, en el panel lateral, y escucha por un canal local (socket). Instalación con un comando que añade el hook a la configuración de Claude Code. Hay que **confirmar con la documentación de Claude Code** qué eventos y datos exactos entrega cada hook.
- **Claude es el cerebro; el avatar solo la cara.** En la integración con Claude Code, la llave de Gemini solo se usa para imágenes y voz.
- **Qué se dice en voz alta:** nunca la respuesta completa. Un resumen corto hablable generado a partir de la respuesta. Reglas exactas por definir en el plan (qué se omite: código, rutas, tablas).
- **Expresión según contenido:** contenta, seria, sorprendida, triste, neutra; parpadeo mientras espera. El método para decidirla (reglas simples o una llamada pequeña al modelo) queda al constructor, con la restricción de costo.

## 6. Paquete de caras (el corazón del diseño)

Cada agente guarda en su carpeta un paquete de imágenes, todas con **la misma cámara, pose, luz y encuadre**; solo cambia la cara. Si el encuadre se mueve, el ASCII tiembla.

**Corrección para V1:** como la boca va por volumen (3 niveles), el paquete de V1 son **8 imágenes**: `neutral` (boca cerrada), `mouth_mid`, `mouth_open`, `blink`, `smile`, `serious`, `surprised`, `sad`. Las bocas `o/e/f/m` quedan para cuando haya fonemas. Lo de abajo es el contenido completo previsto a largo plazo.

Contenido sugerido (unas 10 a 12 imágenes; ajustable al medir):
- 1 neutral
- 5 o 6 bocas: cerrada, abierta, redonda "o", ancha "e", labio-diente "f", labios apretados "m"
- 1 ojos cerrados (parpadeo)
- 3 o 4 expresiones: sonrisa, seria, sorpresa, triste

Dos orígenes del paquete:
- **a) Manual (obligatorio):** el usuario aporta imágenes ya hechas con ese contrato de encuadre.
- **b) Generado (comodidad):** un comando las genera con Gemini a partir de la foto base, usando prompts versionados en el repo, uno por boca/expresión, siempre con "mismo encuadre, solo cambia la cara".

Las imágenes se pueden mezclar por zonas (boca y ojos) con puntos de la cara para suavizar el cambio; es una mejora opcional, no un requisito de V1.

### Control de costo
- Prompts probados y versionados en el repo.
- Resolución baja (512 px debería bastar para ASCII; medirlo).
- Vista previa barata primero: generar una sola boca (abierta) y mostrar su ASCII; solo si el usuario aprueba se genera el resto.
- Estimado de costo mostrado antes de gastar; confirmación explícita.
- Tope duro configurable (por defecto $1.60 USD). Si se alcanza, se detiene y avisa.
- Tope de reintentos y caché: nunca se regenera lo ya hecho.
- Hipótesis por probar: generar varias caras en una "hoja" y recortarlas ahorra más, pero puede perder consistencia.

## 7. Archivo del agente

Cada agente es una carpeta portable con: foto base, paquete de caras, archivo de configuración (corrección: el atlas ASCII no se guarda; se calcula al iniciar el panel según su ancho) (nombre, voz elegida, prompt/personalidad, opciones de voz). **La llave de Gemini nunca va en esta carpeta.** El formato debe permitir que alguien comparta su agente copiando la carpeta.

## 8. Riesgos

1. **Consistencia de las imágenes generadas** (rostro idéntico entre cuadros). Mitigación: contrato de encuadre, prompts cuidados, alineación posterior con puntos de la cara.
2. **Que el ASCII a baja resolución pierda el parecido.** Se necesita medir con fotos reales.
3. **Cambios de cuadro que se ven bruscos.** Mitigación: mezcla por zonas, transición corta.
4. **Variación entre terminales** (color, fuentes, anchura de caracteres).
5. **Hooks de Claude Code:** limitaciones en eventos disponibles y en el momento en que entregan el texto.
6. **Precios y modelos de Gemini cambian.** Estimar siempre en vivo y no fijar cifras en el código.

## 9. Experimento previo recomendado (desechable)

Antes del plan completo, un experimento rápido: tomar un paquete de unas 10 fotos (hechas a mano o con Gemini), convertirlas a ASCII en la terminal y alternarlas al ritmo de una voz. Objetivo: confirmar que la definición se acerca a la referencia y que los cambios de cuadro no tiemblan. No se conserva; lo aprendido vuelve al diseño.

## 9 bis. Resoluciones tras la revisión del constructor

Decididas por el usuario:
- **Panel lateral manual en V1.** El usuario abre el split y corre `avatar panel`. Funciona en cualquier terminal. Abrir el panel automáticamente en iTerm o tmux queda para después.
- **Gasto en uso.** Contador de gasto visible siempre en el panel, más aviso al llegar a un límite diario. Límite diario por defecto: **$0.30 USD** (~5 MXN), configurable.

Llamadas mías (el usuario puede cambiarlas):
- **Resumen hablado:** en V1 se hace con reglas locales sin llamar a un modelo: se quita código, rutas y tablas y se toman las primeras frases hasta un largo máximo. Una llamada pequeña a Gemini texto queda como opción posterior. Así el costo de uso es solo la voz.
- **Agente y sesiones:** el hook se instala en la configuración global de Claude Code. Hay un agente activo por defecto, con posibilidad de cambiarlo por proyecto. Varias sesiones de Claude Code comparten un solo canal local y un solo panel activo.
- **El experimento (sección 9) es el primer paso del plan y una puerta de decisión.** Si Gemini no mantiene el rostro entre imágenes, la ruta manual (a) pasa a ser la principal. El juicio final del parecido y la definición lo hace el usuario viendo el resultado; el plan debe incluir medidas objetivas auxiliares (por ejemplo, diferencia entre cuadros alineados).
- **Tamaño del panel:** se asume un panel de unas 60 a 80 columnas; la definición se logra con medios bloques/braille y color. El ancho es configurable.
- **Sincronía de boca en V1:** por volumen del audio, con tres niveles (cerrada, media, abierta), y una heurística simple de vocales sobre el texto si resulta útil. Fonemas reales quedan para cuando el proveedor los entregue.
- **Sistemas operativos:** macOS primero; Linux como segundo objetivo; Windows después.
- **Interruptor de voz:** comando `avatar voice on|off` que recuerda la última opción, más una tecla en el panel.

## 10. Qué queda al constructor

- Estructura exacta de paquetes y nombres.
- Algoritmo de conversión a ASCII (mapa de caracteres, bordes, color) y cuántas columnas por defecto.
- Cómo se detecta la cara y se alinean los cuadros.
- Formato del canal local entre el hook y el panel, y de la configuración.
- Cómo se decide la expresión y qué se resume para la voz.
- Manejo de errores, reconexión y cierre del panel.
- Mínimo de terminales soportadas.

## 11. Criterio de éxito de V1

Con una foto del usuario, en una sola sesión de terminal: se crea un agente dentro del tope de gasto; al escribir en Claude Code, el panel lateral muestra la cara reaccionando a cada respuesta; con voz encendida habla un resumen corto con la boca moviéndose; con voz apagada solo gesticula y el texto sigue en la terminal; el ASCII tiene una definición comparable a las imágenes de referencia.
