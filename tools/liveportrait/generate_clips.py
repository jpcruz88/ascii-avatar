#!/usr/bin/env python3
"""Genera los clips de movimiento de cabeza de un agente de ascii-avatar con LivePortrait.

Uso:
  python generate_clips.py --liveportrait <repo> --source <neutral.png> --out <carpeta>
                           [--clips nod,tilt_left,...]
  python generate_clips.py --plan     # imprime los ángulos de cada clip (no necesita LivePortrait)

Cómo funciona:
  1. LivePortrait (ya instalado aparte, en <repo>) calcula, para cada cuadro, cómo se vería la
     cabeza girada unos grados (recorte de 512×512 alrededor de la cara).
  2. Se mide el flujo óptico entre el recorte neutro y cada recorte girado (ponderado por el trazo,
     suavizado y desvanecido en el borde del recorte) y se aplica al grabado ORIGINAL a resolución
     completa. Así las líneas siguen nítidas y el lienzo es exactamente el de la cara neutral.
  3. Los cuadros con ángulo 0 (el primero, el último y las pausas) son el original exacto.

Salida: <out>/<clip>/000.png, 001.png… Por stdout solo salen líneas JSON: avance por cuadro en
dos fases, al calcularlo ({"clip":"nod","frame":3,"total":17,"phase":"calc"}) y al escribir su PNG
("phase":"write"), un resumen final ({"done":true,...}) o un error ({"error":"..."}). Todo lo
demás (los registros de LivePortrait) va a stderr.

Convenciones de ángulos (en grados, verificadas con renders de prueba):
  pitch + = cabeza hacia abajo; yaw + = la cara gira hacia la izquierda de la imagen;
  roll + = la cabeza se inclina hacia la derecha de la imagen. «left»/«right» son lados de la
  imagen (pantalla).
"""
import argparse
import json
import math
import os
import sys
import time

CLIP_IDS = ("nod", "tilt_left", "tilt_right", "turn_left", "turn_right", "think")

# Amplitudes por defecto (grados).
DEFAULT_AMP = {
    "nod": 6.0,
    "tilt_left": 6.0,
    "tilt_right": 6.0,
    "turn_left": 9.0,
    "turn_right": 9.0,
    "think_pitch": 4.0,
    "think_yaw": 5.0,
}

# Signo que convierte «abajo/izquierda» del clip en el signo de LivePortrait.
PITCH_DOWN, YAW_LEFT, ROLL_LEFT = 1.0, 1.0, -1.0

# Escala del recorte de LivePortrait alrededor de la cara y lado del recorte.
CROP_SCALE = 2.5
CROP_SIZE = 512
# Desvanecido (px del recorte) en el borde del recorte y suavizado espacial del flujo.
FEATHER = 56
FLOW_SIGMA = 8.0


# --- Definición de los clips (solo biblioteca estándar) -------------------------------------

def ease(t):
    t = min(max(t, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * t)


def segments(keys, n):
    """keys: lista de (cuadro, valor). Interpola con ease-in-out entre claves consecutivas."""
    out = [0.0] * n
    for (f0, v0), (f1, v1) in zip(keys[:-1], keys[1:]):
        for f in range(f0, f1 + 1):
            out[f] = v0 + (v1 - v0) * ease((f - f0) / max(f1 - f0, 1))
    return out


def build_angles(amp=None):
    """Devuelve {clip: [(pitch, yaw, roll), ...]} en grados."""
    amp = amp or DEFAULT_AMP
    clips = {}

    a = amp["nod"]
    p = segments([(0, 0), (5, a), (10, 0), (13, 0.4 * a), (16, 0)], 17)
    clips["nod"] = [(PITCH_DOWN * v, 0.0, 0.0) for v in p]

    for side, s in (("tilt_left", 1), ("tilt_right", -1)):
        r = segments([(0, 0), (6, amp[side]), (7, amp[side]), (13, 0)], 14)
        clips[side] = [(0.0, 0.0, s * ROLL_LEFT * v) for v in r]

    for side, s in (("turn_left", 1), ("turn_right", -1)):
        y = segments([(0, 0), (6, amp[side]), (9, amp[side]), (15, 0)], 16)
        clips[side] = [(0.0, s * YAW_LEFT * v, 0.0) for v in y]

    ap, ay = amp["think_pitch"], amp["think_yaw"]
    t = segments([(0, 0), (7, 1), (10, 1), (17, 0)], 18)
    clips["think"] = [(-PITCH_DOWN * ap * v, YAW_LEFT * ay * v, 0.0) for v in t]

    # -0.0 → 0.0 para que el JSON y las comparaciones sean limpios.
    return {k: [tuple(x + 0.0 for x in a) for a in v] for k, v in clips.items()}


def is_zero(angles):
    return all(abs(x) < 1e-9 for x in angles)


# --- Salida JSON -----------------------------------------------------------------------------

class JsonOut:
    """Reserva el stdout real para las líneas JSON y manda todo lo demás (también lo que escriban
    bibliotecas en C) a stderr."""

    def __init__(self):
        sys.stdout.flush()
        self._f = os.fdopen(os.dup(1), "w", buffering=1)
        os.dup2(2, 1)

    def emit(self, obj):
        self._f.write(json.dumps(obj) + "\n")
        self._f.flush()


# --- LivePortrait + flujo óptico -------------------------------------------------------------

class Generator:
    def __init__(self, repo, source):
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        sys.path.insert(0, repo)
        os.chdir(repo)  # LivePortrait busca sus pesos con rutas relativas al repositorio.
        import cv2
        import numpy as np
        import torch
        from src.config.argument_config import ArgumentConfig
        from src.config.crop_config import CropConfig
        from src.config.inference_config import InferenceConfig
        from src.gradio_pipeline import GradioPipeline
        from src.utils.camera import get_rotation_matrix

        self.cv2, self.np, self.torch = cv2, np, torch
        self.get_rotation_matrix = get_rotation_matrix

        def pick(cls, d):
            return cls(**{k: v for k, v in d.items() if hasattr(cls, k)})

        args = ArgumentConfig()
        pipe = GradioPipeline(
            inference_cfg=pick(InferenceConfig, args.__dict__),
            crop_cfg=pick(CropConfig, args.__dict__),
            args=args,
        )
        pipe.init_retargeting_image(CROP_SCALE, 0, 0, source)
        f_s, x_s, R_s, _, info, _, M_c2o, _, _ = pipe.prepare_retargeting_image(
            source, 0, 0, 0, CROP_SCALE, flag_do_crop=True
        )
        w = pipe.live_portrait_wrapper
        dev = w.device
        self.w = w
        self.dev = dev
        self.f_s, self.x_s, self.R_s = f_s.to(dev), x_s.to(dev), R_s.to(dev)
        self.kp, self.exp, self.sc, self.t = (info[k].to(dev) for k in ("kp", "exp", "scale", "t"))
        self.p0, self.y0, self.r0 = info["pitch"], info["yaw"], info["roll"]

        self.orig = cv2.imread(source, cv2.IMREAD_UNCHANGED)
        if self.orig is None:
            raise RuntimeError(f"No se pudo leer la imagen fuente: {source}")
        self.H, self.W = self.orig.shape[:2]
        self.M = np.asarray(M_c2o, dtype=np.float64)[:2]
        self._prepare_flow()

    def render(self, pitch, yaw, roll):
        """Recorte LivePortrait (BGR, 512×512) con la cabeza girada esos grados."""
        torch, cv2 = self.torch, self.cv2
        with torch.no_grad():
            R_d = self.get_rotation_matrix(self.p0 + pitch, self.y0 + yaw, self.r0 + roll).to(self.dev)
            R_new = (R_d @ self.R_s.permute(0, 2, 1)) @ self.R_s
            x_d = self.sc * (self.kp @ R_new + self.exp) + self.t
            x_d = self.w.stitching(self.x_s, x_d)
            out = self.w.parse_output(self.w.warp_decode(self.f_s, self.x_s, x_d)["out"])[0]
        return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)

    def _prepare_flow(self):
        cv2, np = self.cv2, self.np
        M, W, H, CS = self.M, self.W, self.H, CROP_SIZE
        self.gx, self.gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
        # Máscara del recorte: píxeles cuyo origen cae dentro del lienzo, con rampa suave al borde.
        qx, qy = np.meshgrid(np.arange(CS, dtype=np.float64), np.arange(CS, dtype=np.float64))
        ox = M[0, 0] * qx + M[0, 1] * qy + M[0, 2]
        oy = M[1, 0] * qx + M[1, 1] * qy + M[1, 2]
        inside = ((ox >= 0) & (ox < W) & (oy >= 0) & (oy < H)).astype(np.uint8)
        d_in = cv2.distanceTransform(inside, cv2.DIST_L2, 5)
        border = np.minimum.reduce([qx, qy, CS - 1 - qx, CS - 1 - qy])
        s = np.clip((np.minimum(d_in, border) - 8) / FEATHER, 0, 1)
        self.mask = (s * s * (3 - 2 * s)).astype(np.float32)

        self.dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.dis.setFinestScale(0)
        self.dis.setVariationalRefinementIterations(10)

        self.neutral = self._prep(self.render(0.0, 0.0, 0.0))
        # Confianza: el flujo solo es fiable donde hay trazo (gradiente).
        n = self.neutral.astype(np.float32)
        grad = np.hypot(cv2.Sobel(n, cv2.CV_32F, 1, 0), cv2.Sobel(n, cv2.CV_32F, 0, 1))
        conf = (cv2.GaussianBlur(grad, (0, 0), 2.0) + 1.0) * (self.mask > 0)
        self.conf = conf
        self.conf_s = cv2.GaussianBlur(conf, (0, 0), FLOW_SIGMA) + 1e-6

    def _prep(self, bgr):
        cv2 = self.cv2
        return cv2.GaussianBlur(cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY), (0, 0), 2.0)

    def crop_flow(self, bgr):
        """Flujo hacia atrás (pose → neutro) con convolución normalizada por la confianza."""
        cv2 = self.cv2
        f = self.dis.calc(self._prep(bgr), self.neutral, None)
        f = cv2.GaussianBlur(f * self.conf[..., None], (0, 0), FLOW_SIGMA) / self.conf_s[..., None]
        return f * self.mask[..., None]

    def warp_full(self, flow):
        """Pasa el flujo del recorte al lienzo completo y deforma el grabado original."""
        cv2, np, M = self.cv2, self.np, self.M
        A = M[:, :2]
        fw = cv2.warpAffine(flow, M, (self.W, self.H), flags=cv2.INTER_LINEAR,
                            borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        fx = (A[0, 0] * fw[..., 0] + A[0, 1] * fw[..., 1]).astype(np.float32)
        fy = (A[1, 0] * fw[..., 0] + A[1, 1] * fw[..., 1]).astype(np.float32)
        img = cv2.remap(self.orig, self.gx + fx, self.gy + fy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        return img, float(np.hypot(fx, fy).max())

    def clip(self, name, angles, out_dir, on_frame):
        """Genera un clip completo en out_dir/name/NNN.png. Devuelve un pequeño informe.

        on_frame(fase, cuadro, total) se llama al calcular cada cuadro con LivePortrait
        (fase "calc") y al escribir cada PNG final (fase "write").
        """
        np, cv2 = self.np, self.cv2
        n = len(angles)
        zero = [is_zero(a) for a in angles]
        flows = []
        for i, (p, y, r) in enumerate(angles):
            if zero[i]:
                flows.append(np.zeros((CROP_SIZE, CROP_SIZE, 2), np.float32))
            else:
                flows.append(self.crop_flow(self.render(float(p), float(y), float(r))))
            on_frame("calc", i + 1, n)
        # Suavizado temporal [1 2 1] del flujo; los extremos y los cuadros neutros quedan fijos.
        smooth = [flows[0]]
        for i in range(1, n - 1):
            if zero[i]:
                smooth.append(flows[i])
            else:
                smooth.append(0.25 * flows[i - 1] + 0.5 * flows[i] + 0.25 * flows[i + 1])
        smooth.append(flows[-1])

        d = os.path.join(out_dir, name)
        os.makedirs(d, exist_ok=True)
        max_disp = 0.0
        for i in range(n):
            if zero[i]:
                img = self.orig
            else:
                img, disp = self.warp_full(smooth[i])
                max_disp = max(max_disp, disp)
            if not cv2.imwrite(os.path.join(d, f"{i:03d}.png"), img):
                raise RuntimeError(f"No se pudo escribir {name}/{i:03d}.png")
            on_frame("write", i + 1, n)
        return {"frames": n, "max_disp_px": round(max_disp, 1)}


# --- Entrada ---------------------------------------------------------------------------------

def parse_clips(raw):
    names = []
    for c in (x.strip() for x in raw.split(",")):
        if not c:
            continue
        if c not in CLIP_IDS:
            raise SystemExit(f"Clip desconocido: {c}. Los clips son {', '.join(CLIP_IDS)}.")
        if c not in names:
            names.append(c)
    if not names:
        raise SystemExit("--clips está vacío.")
    return names


def main(argv=None):
    ap = argparse.ArgumentParser(description="Genera clips de movimiento de cabeza con LivePortrait.")
    ap.add_argument("--liveportrait", help="carpeta del repositorio de LivePortrait (con pretrained_weights/)")
    ap.add_argument("--source", help="cara neutral del agente (PNG)")
    ap.add_argument("--out", help="carpeta de salida; se crea <out>/<clip>/NNN.png")
    ap.add_argument("--clips", default=",".join(CLIP_IDS), help="clips separados por comas")
    ap.add_argument("--plan", action="store_true", help="solo imprime los ángulos de cada clip")
    a = ap.parse_args(argv)

    angles = build_angles()
    if a.plan:
        print(json.dumps({k: [list(x) for x in v] for k, v in angles.items()}))
        return 0
    if not (a.liveportrait and a.source and a.out):
        ap.error("faltan --liveportrait, --source o --out")
    clips = parse_clips(a.clips)

    out = JsonOut()
    try:
        repo = os.path.abspath(a.liveportrait)
        source = os.path.abspath(a.source)
        out_dir = os.path.abspath(a.out)
        if not os.path.isdir(os.path.join(repo, "pretrained_weights")):
            raise RuntimeError(f"No hay pretrained_weights en {repo}")
        if not os.path.isfile(source):
            raise RuntimeError(f"No existe la imagen fuente: {source}")
        os.makedirs(out_dir, exist_ok=True)
        t0 = time.time()
        gen = Generator(repo, source)
        report = {}
        for name in clips:
            report[name] = gen.clip(
                name, angles[name], out_dir,
                lambda phase, f, n, name=name: out.emit({"clip": name, "frame": f, "total": n, "phase": phase}),
            )
        out.emit({"done": True, "seconds": round(time.time() - t0, 1), "clips": report})
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as e:  # noqa: BLE001 — el error viaja como JSON al CLI
        out.emit({"error": f"{type(e).__name__}: {e}"})
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
