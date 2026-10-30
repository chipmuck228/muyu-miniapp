#!/usr/bin/env python3
"""生成本地测试用的「完成心愿惊喜」壁纸（程序绘制的占位图）。

输出到 miniprogram/dev-papers/<id>.jpg（原图 1080x1920）和 <id>-thumb.jpg（540x960）。
这个目录在 project.config.json 里被 packOptions 忽略，不会上传；只在本地模拟模式（mock=1）里用。
正式壁纸上传云存储后填进 cloudfunctions/{fetch,wish}/papers.js 的 FILES。

用法：python3 scripts/gen-dev-papers.py   （需要 numpy、Pillow）
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1080, 1920
OUT = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'dev-papers')


# ---------- 基础工具 ----------

def rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255


def vgrad(stops):
    """竖直渐变。stops: [(0..1, '#hex'), ...]"""
    y = np.linspace(0, 1, H)[:, None]
    pos = [s[0] for s in stops]
    cols = [rgb(s[1]) for s in stops]
    out = np.zeros((H, 1, 3), np.float32)
    for c in range(3):
        out[:, 0, c] = np.interp(y[:, 0], pos, [k[c] for k in cols])
    return np.repeat(out, W, axis=1)


def over(img, color, alpha):
    a = np.clip(alpha, 0, 1)[..., None]
    col = rgb(color) if isinstance(color, str) else color
    return img * (1 - a) + col * a


def add(img, color, amount):
    col = rgb(color) if isinstance(color, str) else color
    return img + col * np.clip(amount, 0, None)[..., None]


def grid():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    return x, y


def value_noise(shape, scale, rng):
    """平滑噪声：低分辨率随机场放大 + 模糊"""
    h, w = shape
    sh, sw = max(2, int(h / scale)), max(2, int(w / scale))
    small = rng.random((sh, sw)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    im = im.filter(ImageFilter.GaussianBlur(scale / 4))
    return np.asarray(im, np.float32) / 255


def fbm(shape, scale, rng, octaves=4):
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        out += value_noise(shape, scale, rng) * amp
        tot += amp
        scale /= 2
        amp *= 0.5
    return out / tot


def ridge(rng, base, amp, scale, octaves=5):
    """一条山脊线，返回每一列的 y"""
    x = np.arange(W, dtype=np.float32)
    y = np.full(W, base, np.float32)
    a, s = amp, scale
    for _ in range(octaves):
        ph = rng.random() * 1000
        k = rng.integers(3, 7)
        y += a * (np.sin(x / s + ph) * 0.6 + np.sin(x / (s * 0.37) + ph * k) * 0.4)
        a *= 0.48
        s *= 0.45
    return y


def mountains(img, rng, base, amp, scale, color, mist=0.0, mist_color='#000000'):
    _, yy = grid()
    top = ridge(rng, base, amp, scale)[None, :]
    mask = np.clip((yy - top) / 2.0, 0, 1)
    img = over(img, color, mask)
    if mist > 0:
        # 山脚的雾：从山脊往下逐渐变浓
        depth = np.clip((yy - top) / 260, 0, 1)
        img = over(img, mist_color, mask * depth * mist)
    return img


def glow(img, cx, cy, r, color, strength):
    x, y = grid()
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    return add(img, color, strength * np.exp(-(d / r) ** 2))


def disc(img, cx, cy, r, color, soft=2.0):
    x, y = grid()
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    return over(img, color, np.clip((r - d) / soft, 0, 1))


def grain(img, rng, amount=0.025):
    n = rng.normal(0, amount, (H, W, 1)).astype(np.float32)
    return img + n


def vignette(img, k=0.35):
    x, y = grid()
    d = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    return img * (1 - k * np.clip(d - 0.55, 0, None) ** 1.5)[..., None]


def draw_layer(fn, scale=2):
    """用 PIL 在 2 倍尺寸上画矢量笔触再缩小，得到抗锯齿的 alpha"""
    im = Image.new('L', (W * scale, H * scale), 0)
    fn(ImageDraw.Draw(im), scale)
    im = im.resize((W, H), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255


def smoke(img, rng, x0, y0, length, color, width=3.0, alpha=0.55, drift=1.0):
    """一缕香烟：沿正弦漂移的细线，越往上越宽越淡"""
    def fn(d, s):
        pts = []
        steps = 420
        ph1, ph2 = rng.random() * 6, rng.random() * 6
        for i in range(steps):
            t = i / steps
            y = y0 - t * length
            x = x0 + drift * (math.sin(t * 7 + ph1) * 60 * t + math.sin(t * 17 + ph2) * 18 * t * t)
            pts.append((x, y, t))
        for i in range(steps - 1):
            x1, y1, t = pts[i]
            x2, y2, _ = pts[i + 1]
            v = int(255 * (1 - t) ** 1.4)
            wpx = max(1, int((width + t * 14) * s))
            d.line([(x1 * s, y1 * s), (x2 * s, y2 * s)], fill=v, width=wpx)
    a = draw_layer(fn)
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5)), np.float32) / 255
    return add(img, color, a * alpha)


def save(img, name):
    os.makedirs(OUT, exist_ok=True)
    arr = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    im = Image.fromarray(arr)
    im.save(os.path.join(OUT, name + '.jpg'), quality=84, optimize=True, progressive=True)
    im.resize((W // 2, H // 2), Image.LANCZOS).save(
        os.path.join(OUT, name + '-thumb.jpg'), quality=80, optimize=True, progressive=True
    )
    print('wrote', name)


# ---------- 五档十张：素 / 雅 / 净 / 真 / 极，越往后越繁盛 ----------

def su_1(rng):
    """素 · 一炷香"""
    img = vgrad([(0, '#14100c'), (0.6, '#0e0b08'), (1, '#090706')])
    img = glow(img, W / 2, H * 0.72, 380, rgb('#c88a4a'), 0.10)
    # 香炉
    def censer(d, s):
        cx, cy = W / 2 * s, H * 0.78 * s
        d.ellipse([cx - 130 * s, cy - 40 * s, cx + 130 * s, cy + 90 * s], fill=255)
        d.rectangle([cx - 150 * s, cy - 52 * s, cx + 150 * s, cy - 30 * s], fill=255)
        d.rectangle([cx - 70 * s, cy + 80 * s, cx + 70 * s, cy + 110 * s], fill=255)
    img = over(img, '#2a2119', draw_layer(censer))
    # 香身与火点
    def stick(d, s):
        d.line([(W / 2 * s, H * 0.75 * s), (W / 2 * s, H * 0.48 * s)], fill=255, width=int(5 * s))
    img = over(img, '#5a4632', draw_layer(stick))
    img = glow(img, W / 2, H * 0.48, 16, rgb('#ff7a3a'), 1.4)
    img = glow(img, W / 2, H * 0.48, 80, rgb('#ff8a40'), 0.12)
    img = smoke(img, rng, W / 2, H * 0.475, H * 0.4, rgb('#cfd2d6'), alpha=0.5)
    return vignette(grain(img, rng, 0.018))


def su_2(rng):
    """素 · 一笔圆相"""
    img = vgrad([(0, '#17120d'), (1, '#0b0907')])
    cx, cy, r = W / 2, H * 0.44, 300

    def enso(d, s):
        start = rng.random() * 40 + 100
        n = 360
        for i in range(n):
            t = i / n
            if t > 0.93:
                break
            a1 = math.radians(start + t * 360)
            a2 = math.radians(start + (t + 1 / n) * 360)
            wpx = (34 * math.sin(math.pi * min(1, t * 1.15)) ** 0.7 + 6) * s
            rr = r + math.sin(t * 9) * 6
            d.line(
                [(cx * s + rr * s * math.cos(a1), cy * s + rr * s * math.sin(a1)),
                 (cx * s + rr * s * math.cos(a2), cy * s + rr * s * math.sin(a2))],
                fill=int(255 * (0.75 + 0.25 * (1 - t))), width=int(wpx),
            )
    a = draw_layer(enso)
    # 飞白：笔触里掺一点干擦的空隙
    dry = fbm((H, W), 18, rng, 2)
    a = a * np.clip((dry - 0.25) * 3, 0.35, 1)
    img = over(img, '#d9b77e', a * 0.92)
    # 金箔碎屑
    for _ in range(140):
        x, y = rng.random() * W, rng.random() * H
        img = glow(img, x, y, 1.6 + rng.random() * 2.5, rgb('#e8c98a'), 0.35 * rng.random())
    return vignette(grain(img, rng, 0.02))


def ya_1(rng):
    """雅 · 远山月夜"""
    img = vgrad([(0, '#0b1420'), (0.55, '#152030'), (1, '#0a0e14')])
    img = glow(img, W * 0.7, H * 0.2, 420, rgb('#9fb6d4'), 0.10)
    img = disc(img, W * 0.7, H * 0.2, 70, '#e8ecef')
    img = disc(img, W * 0.7 + 28, H * 0.2 - 12, 66, '#0f1a28', soft=3)  # 新月
    for k, (base, amp, col) in enumerate([
        (H * 0.52, 120, '#1c2a3a'), (H * 0.60, 100, '#16212e'),
        (H * 0.70, 90, '#101823'), (H * 0.80, 70, '#0a1018'),
    ]):
        img = mountains(img, rng, base, amp, 520 - k * 60, col, mist=0.35, mist_color='#2a3a4e')
    return vignette(grain(img, rng, 0.016))


def ya_2(rng):
    """雅 · 雾中竹"""
    img = vgrad([(0, '#121a14'), (0.5, '#1a231b'), (1, '#0b0f0b')])
    mist = fbm((H, W), 260, rng)
    img = add(img, rgb('#6c7d6a'), (mist - 0.45) * 0.25)

    def bamboo(layer_seed, shade, count, w0):
        r = np.random.default_rng(layer_seed)

        def fn(d, s):
            for _ in range(count):
                x = r.random() * W
                lean = (r.random() - 0.5) * 80
                wpx = w0 * (0.7 + r.random() * 0.6)
                y = H + 20
                seg = 180 + r.random() * 80
                while y > -40:
                    y2 = y - seg
                    xa = x + lean * (H - y) / H
                    xb = x + lean * (H - y2) / H
                    d.line([(xa * s, y * s), (xb * s, (y2 + 8) * s)], fill=255, width=int(wpx * s))
                    y = y2
                    # 竹叶：几片细长的尖叶
                    if r.random() < 0.45:
                        for _ in range(r.integers(2, 5)):
                            ang = r.random() * math.pi * 0.8 + math.pi * 0.1
                            if r.random() < 0.5:
                                ang = math.pi - ang
                            L = 70 + r.random() * 70
                            ex, ey = xb + math.cos(ang) * L, y2 + math.sin(ang) * L * 0.5
                            nx, ny = -math.sin(ang) * 9, math.cos(ang) * 9
                            d.polygon([(xb * s, y2 * s), ((xb + ex) / 2 * s + nx * s, (y2 + ey) / 2 * s + ny * s),
                                       (ex * s, ey * s)], fill=255)
        return draw_layer(fn)
    img = over(img, '#3a4a3a', bamboo(7, 0, 9, 16) * 0.45)
    img = over(img, '#26332a', bamboo(8, 0, 6, 22) * 0.7)
    img = over(img, '#0d130e', bamboo(9, 0, 4, 30))
    return vignette(grain(img, rng, 0.018))


def jing_1(rng):
    """净 · 湖光倒影"""
    img = vgrad([(0, '#1b1a24'), (0.38, '#5a4a48'), (0.5, '#c9a27a'), (0.5001, '#8a7060'),
                 (0.7, '#2c2830'), (1, '#121116')])
    img = glow(img, W / 2, H * 0.47, 260, rgb('#ffcf96'), 0.35)
    _, yy = grid()
    sky = np.zeros((H, W, 3), np.float32) + img
    for k, (base, amp, col) in enumerate([(H * 0.40, 90, '#3a3240'), (H * 0.45, 70, '#2a2430')]):
        img = mountains(img, rng, base, amp, 460 - k * 80, col, mist=0.25, mist_color='#8a7468')
    # 倒影：上半部分翻转、压暗、加水波
    horizon = int(H * 0.5)
    top = img[:horizon][::-1]
    n = horizon if horizon < H - horizon else H - horizon
    ref = top[:n].copy()
    ripple = np.sin(np.arange(n)[:, None] * 0.9 + fbm((n, W), 60, rng) * 12) * 0.5 + 0.5
    ref = ref * (0.55 + 0.1 * ripple[..., None])
    img[horizon:horizon + n] = img[horizon:horizon + n] * 0.25 + ref * 0.75
    img[horizon:horizon + 2] = img[horizon:horizon + 2] * 0.7 + rgb('#ffd8a0') * 0.3
    del sky, yy
    return vignette(grain(img, rng, 0.016))


def jing_2(rng):
    """净 · 晨雾山谷"""
    img = vgrad([(0, '#2a2622'), (0.35, '#8c7a66'), (0.55, '#d8bf9c'), (1, '#3a332c')])
    img = glow(img, W * 0.38, H * 0.36, 300, rgb('#fff0d0'), 0.45)
    img = disc(img, W * 0.38, H * 0.36, 52, '#fff4e0', soft=6)
    cols = ['#a08e78', '#86745f', '#6a5a4a', '#4c4036', '#2e2620']
    for k, col in enumerate(cols):
        base = H * (0.44 + k * 0.1)
        img = mountains(img, rng, base, 110 - k * 10, 500 - k * 50, col, mist=0.55, mist_color='#d8c6ac')
    return vignette(grain(img, rng, 0.014), 0.25)


def zhen_1(rng):
    """真 · 云海日出"""
    img = vgrad([(0, '#1a1426'), (0.3, '#6a3a3a'), (0.48, '#f0a060'), (0.56, '#ffd89a'), (1, '#c08a60')])
    img = glow(img, W / 2, H * 0.52, 340, rgb('#ffe0a0'), 0.6)
    img = disc(img, W / 2, H * 0.52, 90, '#fff2d6', soft=8)
    # 远山在后，云海漫过山脚
    img = mountains(img, rng, H * 0.56, 90, 300, '#3a2428', mist=0.0)
    _, yy = grid()
    for k in range(4):
        n = fbm((H, W), 220 - k * 30, rng)
        band = np.clip((yy - H * (0.56 + k * 0.07)) / 90, 0, 1)
        dens = np.clip((n - 0.3 + k * 0.05) * 2.6, 0, 1) * band
        img = over(img, ['#f6d6b0', '#e8bc92', '#d29a74', '#a87458'][k], dens * 0.92)
    img = glow(img, W / 2, H * 0.52, 900, rgb('#ffb070'), 0.08)
    return vignette(grain(img, rng, 0.014), 0.3)


def zhen_2(rng):
    """真 · 银杏落金"""
    img = vgrad([(0, '#16110a'), (0.6, '#1e160c'), (1, '#0c0906')])
    img = glow(img, W * 0.5, H * 0.3, 500, rgb('#c08a30'), 0.12)

    def leaves(seed, count, size, blur):
        r = np.random.default_rng(seed)

        def fn(d, s):
            for _ in range(count):
                cx, cy = r.random() * W, r.random() * H
                sz = size * (0.6 + r.random() * 0.8)
                rot = r.random() * math.pi * 2
                # 扇形叶片 + 叶柄
                pts = []
                for i in range(25):
                    a = -0.9 + 1.8 * i / 24
                    rr = sz * (1 - 0.18 * abs(math.sin(a * 4)) - (0.25 if abs(a) < 0.08 else 0))
                    pts.append((a, rr))
                poly = [(cx, cy)] + [(cx + rr * math.cos(rot + a - math.pi / 2), cy + rr * math.sin(rot + a - math.pi / 2)) for a, rr in pts]
                d.polygon([(x * s, y * s) for x, y in poly], fill=int(170 + r.random() * 85))
                ex, ey = cx + sz * 0.5 * math.cos(rot + math.pi / 2), cy + sz * 0.5 * math.sin(rot + math.pi / 2)
                d.line([(cx * s, cy * s), (ex * s, ey * s)], fill=200, width=int(3 * s))
        a = draw_layer(fn)
        if blur:
            a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 255
        return a
    img = over(img, '#8a6420', leaves(21, 26, 40, 6) * 0.5)
    img = over(img, '#d8a440', leaves(22, 16, 70, 0) * 0.9)
    img = over(img, '#f0c860', leaves(23, 5, 110, 0))
    return vignette(grain(img, rng, 0.018))


def ji_1(rng):
    """极 · 佛光云海"""
    img = vgrad([(0, '#141a2c'), (0.35, '#3c4a6a'), (0.55, '#d8c0a0'), (1, '#e8d8c0')])
    x, y = grid()
    cx, cy = W / 2, H * 0.42
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    # 彩虹光环（佛光）：按半径映射色相，环外渐隐
    hue = np.clip((d - 160) / 220, 0, 1)
    ring = np.exp(-((d - 270) / 110) ** 2)
    spectrum = np.stack([
        0.5 + 0.5 * np.cos(2 * np.pi * (hue + 0.0)),
        0.5 + 0.5 * np.cos(2 * np.pi * (hue + 0.33)),
        0.5 + 0.5 * np.cos(2 * np.pi * (hue + 0.67)),
    ], -1)
    img = img + spectrum * ring[..., None] * 0.35
    img = glow(img, cx, cy, 170, rgb('#fff6e0'), 0.55)
    img = glow(img, cx, cy, 700, rgb('#ffe8c0'), 0.12)
    # 光芒
    ang = np.arctan2(y - cy, x - cx)
    rays = (np.sin(ang * 18) * 0.5 + 0.5) ** 10 * np.exp(-d / 700)
    img = add(img, rgb('#fff0d0'), rays * 0.06)
    img = mountains(img, rng, H * 0.62, 80, 260, '#4a4458', mist=0.0)
    for k in range(4):
        n = fbm((H, W), 240 - k * 30, rng)
        band = np.clip((y - H * (0.62 + k * 0.06)) / 90, 0, 1)
        dens = np.clip((n - 0.3 + k * 0.05) * 2.6, 0, 1) * band
        img = over(img, ['#fbf2e4', '#f0e2cc', '#e2ceb2', '#cdb696'][k], dens * 0.94)
    return vignette(grain(img, rng, 0.012), 0.25)


def ji_2(rng):
    """极 · 星河金莲"""
    img = vgrad([(0, '#05060e'), (0.5, '#0c0f22'), (1, '#120c10')])
    x, y = grid()
    # 斜贯的银河带
    band_d = np.abs((y - H * 0.35) - (x - W / 2) * -0.9) / math.sqrt(1 + 0.81)
    band = np.exp(-(band_d / 230) ** 2)
    neb = fbm((H, W), 160, rng)
    img = add(img, rgb('#c8a0e0'), band * neb * 0.22)
    img = add(img, rgb('#f0d0a0'), band * (neb ** 3) * 0.35)
    # 星点：银河里更密
    stars = rng.random((H, W))
    thresh = 0.9993 - band * 0.0025
    sm = (stars > thresh).astype(np.float32) * rng.random((H, W)).astype(np.float32)
    sm = np.asarray(Image.fromarray((sm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    img = add(img, rgb('#ffffff'), sm * 2.5)
    img = mountains(img, rng, H * 0.74, 80, 380, '#07060c')
    # 金莲：一朵发光的莲花在山前
    cx, cy = W / 2, H * 0.82

    def lotus(d, s):
        for layer, (n, L, wd) in enumerate([(9, 150, 46), (7, 120, 40), (5, 90, 32)]):
            for i in range(n):
                a = math.pi * (0.08 + 0.84 * i / (n - 1))
                tip = (cx - math.cos(a) * L * 1.15, cy - math.sin(a) * L)
                nx, ny = math.sin(a) * wd, -math.cos(a) * wd
                mid = ((cx + tip[0]) / 2, (cy + tip[1]) / 2)
                d.polygon([(cx * s, cy * s), ((mid[0] + nx) * s, (mid[1] + ny) * s), (tip[0] * s, tip[1] * s),
                           ((mid[0] - nx) * s, (mid[1] - ny) * s)], fill=150 + layer * 50)
    a = draw_layer(lotus)
    img = over(img, '#e8b860', a)
    img = glow(img, cx, cy - 60, 220, rgb('#ffcf80'), 0.35)
    img = glow(img, cx, cy - 60, 600, rgb('#ffb060'), 0.08)
    return vignette(grain(img, rng, 0.012), 0.3)


PAPERS = {
    'su-1': su_1, 'su-2': su_2,
    'ya-1': ya_1, 'ya-2': ya_2,
    'jing-1': jing_1, 'jing-2': jing_2,
    'zhen-1': zhen_1, 'zhen-2': zhen_2,
    'ji-1': ji_1, 'ji-2': ji_2,
}

if __name__ == '__main__':
    for i, (name, fn) in enumerate(PAPERS.items()):
        save(fn(np.random.default_rng(1000 + i)), name)
