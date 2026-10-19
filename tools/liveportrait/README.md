# tools/liveportrait

`generate_clips.py` genera los seis clips de movimiento de cabeza de un agente (`nod`,
`tilt_left`, `tilt_right`, `turn_left`, `turn_right`, `think`) a partir de su cara neutral, usando
[LivePortrait](https://github.com/KlingTeam/LivePortrait) instalado aparte. Normalmente no se
llama a mano: lo lanza `avatar movimientos <nombre>`.

Este script es nuestro (licencia MIT, como el resto del repositorio). LivePortrait **no** se copia
aquí: se clona e instala por separado (ver la sección «Movimientos fluidos» del README principal).

## Uso directo

```sh
<carpeta-de-LivePortrait>/venv/bin/python tools/liveportrait/generate_clips.py \
  --liveportrait <repo-de-LivePortrait> \
  --source ~/.ascii-avatar/agents/<nombre>/faces/neutral.png \
  --out /tmp/clips \
  --clips nod,think          # opcional; por defecto, los seis
```

Escribe `<out>/<clip>/000.png`, `001.png`… con el mismo lienzo que la cara neutral. Por stdout
solo salen líneas JSON:

- avance, una por cuadro: `{"clip": "nod", "frame": 3, "total": 17}`
- resumen al final: `{"done": true, "seconds": 41.2, "clips": {"nod": {"frames": 17, "max_disp_px": 17.8}}}`
- o un error: `{"error": "RuntimeError: ..."}` (y código de salida distinto de 0)

Los registros de LivePortrait van a stderr. `--plan` imprime los ángulos de cada clip sin cargar
LivePortrait (solo biblioteca estándar; lo usan las pruebas).

## Cómo funciona

1. LivePortrait calcula cómo se vería la cabeza girada unos grados en un recorte de 512×512.
2. Se mide el flujo óptico (DIS) entre el recorte neutro y el girado, ponderado por el trazo,
   suavizado en el espacio y en el tiempo y desvanecido en el borde del recorte.
3. Ese flujo se aplica al grabado **original** a resolución completa, así las líneas siguen nítidas.
   Los cuadros con ángulo 0 (primero, último y pausas) son el original exacto.

| Clip | Cuadros | Movimiento |
| --- | --- | --- |
| `nod` | 17 | baja 6° y vuelve, con un segundo asentimiento de 2.4° |
| `tilt_left` / `tilt_right` | 14 | inclina 6° hacia ese lado de la pantalla |
| `turn_left` / `turn_right` | 16 | gira 9° y sostiene 3 cuadros |
| `think` | 18 | mira 4° hacia arriba y 5° de lado |

Requiere `PYTORCH_ENABLE_MPS_FALLBACK=1` en Apple Silicon (el script lo pone si falta).
