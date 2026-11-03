# Compose the docs images from captured frames/stills.
# Style mirrors the previous docs: light gradient, flat taskbar with icon row + clock.
#
# Usage (needs Python 3.10+ with Pillow and numpy; fonts are the stock Windows ones):
#   python tools/docs/compose.py             # writes tools/docs/.work/build
#   python tools/docs/compose.py --install   # ...then copies the five files into docs/
# Env overrides: BLUEFISH_SHOTS (capture dir), BLUEFISH_BUILD (output dir).
import os, sys, json, math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(BASE))
SHOTS = os.path.abspath(os.environ.get("BLUEFISH_SHOTS") or os.path.join(BASE, ".work", "shots"))
BUILD = os.path.abspath(os.environ.get("BLUEFISH_BUILD") or os.path.join(BASE, ".work", "build"))
DOCS = os.path.join(REPO, "docs")
os.makedirs(BUILD, exist_ok=True)

CJK_B = r"C:\Windows\Fonts\msyhbd.ttc"
CJK = r"C:\Windows\Fonts\msyh.ttc"
UI = r"C:\Windows\Fonts\segoeui.ttf"
UI_B = r"C:\Windows\Fonts\segoeuib.ttf"

L = Image.Resampling.LANCZOS

C_BG1 = (247, 249, 254)
C_BG2 = (226, 234, 246)
C_BAR1 = (229, 236, 247)
C_BAR2 = (238, 242, 250)
C_BAR_EDGE = (196, 206, 229)
C_INK = (42, 67, 123)
C_SUB = (121, 149, 192)
C_CLOCK = (99, 121, 158)
C_BLUE = (67, 112, 226)
C_GREY = (126, 149, 186)
C_FILL = (168, 193, 230)

font_cache = {}


def font(path, size):
    key = (path, size)
    if key not in font_cache:
        font_cache[key] = ImageFont.truetype(path, size)
    return font_cache[key]


def vgrad(w, h, c1, c2):
    t = np.linspace(0, 1, h)[:, None]
    row = np.array(c1, dtype=np.float64)[None, :] * (1 - t) + np.array(c2, dtype=np.float64)[None, :] * t
    arr = np.repeat(row[:, None, :], w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def hgrad(w, h, c1, c2):
    t = np.linspace(0, 1, w)[None, :]
    row = np.array(c1, dtype=np.float64)[:, None] * (1 - t) + np.array(c2, dtype=np.float64)[:, None] * t
    arr = np.repeat(row.T[:, None, :], h, axis=1)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def draw_taskbar(img, S, W, H, top):
    bar = hgrad(W * S, (H - top) * S, C_BAR1, C_BAR2)
    img.paste(bar, (0, top * S))
    d = ImageDraw.Draw(img)
    d.rectangle([0, top * S, W * S, top * S + S], fill=C_BAR_EDGE)
    cy = (top + 20) * S
    sizes = [S] * 4
    icons = [
        ("start", 340 * S, C_BLUE),
        ("search", 380 * S, C_GREY),
        ("view", 420 * S, C_FILL),
        ("widgets", 460 * S, C_GREY),
    ]
    for kind, cx, colour in icons:
        draw_icon(d, kind, cx, cy, S, colour)
    clock = font(UI, 12 * S)
    d.text((W * S - 30 * S, cy), "22:47", font=clock, fill=C_CLOCK, anchor="rm")
    return img


def draw_icon(d, kind, cx, cy, S, colour):
    w = max(1, round(2 * S))
    if kind == "start":
        r = 9 * S
        d.rounded_rectangle([cx - r, cy - r, cx + r, cy + r], radius=2.5 * S, outline=colour, width=w)
        d.line([cx, cy - r, cx, cy + r], fill=colour, width=w)
        d.line([cx - r, cy, cx + r, cy], fill=colour, width=w)
    elif kind == "search":
        rr = 6 * S
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=colour, width=w)
        d.line([cx + 4.2 * S, cy + 4.2 * S, cx + 8.6 * S, cy + 8.6 * S], fill=colour, width=w)
    elif kind == "view":
        pts = [(cx - 9 * S, cy + 6 * S), (cx + 5 * S, cy + 6 * S), (cx + 9 * S, cy - 6 * S), (cx - 5 * S, cy - 6 * S)]
        d.polygon(pts, fill=colour)
    elif kind == "widgets":
        rr = 7 * S
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=colour, width=w)
        r2 = 2.6 * S
        d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=colour)


def render_scene(S, W, H, taskbar_top, title=None, subtitle=None):
    img = vgrad(W * S, H * S, C_BG1, C_BG2)
    draw_taskbar(img, S, W, H, taskbar_top)
    d = ImageDraw.Draw(img)
    if title:
        d.text((30 * S, 24 * S), title, font=font(CJK_B, 26 * S), fill=C_INK, anchor="la")
    if subtitle:
        d.text((31 * S, 64 * S), subtitle, font=font(CJK, 13 * S), fill=C_SUB, anchor="la")
    return img


def make_cursor(px):
    vb = [(2, 2), (2, 20), (7.2, 15.3), (10.5, 22.2), (13.9, 20.5), (10.8, 13.9), (17.8, 13.4)]
    s = px / 24.0
    im = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pts = [(x * s, y * s) for x, y in vb]
    d.polygon(pts, fill=(20, 24, 31, 255), outline=(255, 255, 255, 255), width=max(1, round(1.5 * s)))
    return im


CUR96 = make_cursor(96)
CUR1 = CUR96.resize((24, 24), L)
CUR2 = CUR96.resize((48, 48), L)


def gif_frame_durations(records):
    durs = []
    for i in range(len(records)):
        if i + 1 < len(records):
            ms = records[i + 1]["ts"] - records[i]["ts"]
        else:
            ms = durs[-1] if durs else 65
        durs.append(int(max(30, round(ms / 10.0) * 10)))
    return durs


BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float64)


def ordered_dither(frame, amp=6.0):
    """Fixed 4x4 Bayer offset: breaks gradient bands without random noise, so LZW still compresses."""
    arr = np.asarray(frame.convert("RGB"), dtype=np.float64)
    h, w, _ = arr.shape
    tile = np.tile((BAYER / 16.0 - 0.5) * 2 * amp, (h // 4 + 1, w // 4 + 1))[:h, :w]
    arr = np.clip(arr + tile[:, :, None], 0, 255).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def save_gif(frames, durations, path, colors=None):
    # one adaptive palette so the loop does not shimmer between frames
    colors = colors or int(os.environ.get("GIF_COLORS", "255"))
    mode = os.environ.get("GIF_DITHER", "ordered")  # ordered | floyd | none
    ref = frames[len(frames) // 2].convert("RGB")
    pal = ref.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)
    paletted = []
    for f in frames:
        if mode == "ordered":
            src = ordered_dither(f, float(os.environ.get("GIF_AMP", "4")))
            d = Image.Dither.NONE
        elif mode == "floyd":
            src = f.convert("RGB")
            d = Image.Dither.FLOYDSTEINBERG
        else:
            src = f.convert("RGB")
            d = Image.Dither.NONE
        paletted.append(src.quantize(palette=pal, dither=d))
    paletted[0].save(
        path, save_all=True, append_images=paletted[1:], duration=durations,
        loop=0, optimize=True, disposal=2,
    )
    print("wrote", os.path.basename(path), os.path.getsize(path) // 1024, "KB", len(frames), "frames")


def build_gif(tag, title, subtitle, out_name):
    meta = json.load(open(os.path.join(SHOTS, "frames", tag + ".json")))
    base = render_scene(4, 800, 320, 280, title=title, subtitle=subtitle).resize((800, 320), L)
    frames = []
    for rec in meta["frames"]:
        pet = Image.open(os.path.join(SHOTS, "frames", tag, rec["file"])).convert("RGBA")
        scene = base.copy()
        scene.paste(pet, (0, -100), pet)
        if rec["x"] is not None:
            scene.paste(CUR1, (int(round(rec["x"] - 2)), int(round(rec["y"] - 100 - 2))), CUR1)
        frames.append(scene)
    save_gif(frames, gif_frame_durations(meta["frames"]), os.path.join(BUILD, out_name))


def build_sizes():
    W, H, S = 800, 320, 4
    img = vgrad(W * S, H * S, C_BG1, C_BG2)
    d = ImageDraw.Draw(img)
    d.text((30 * S, 22 * S), "大小 150 – 460 无级", font=font(CJK, 15 * S), fill=C_SUB, anchor="la")
    # the ledge the pets hold on to
    y = 258 * S
    d.rectangle([0, y, W * S, y + round(1.6 * S)], fill=(184, 198, 222))
    shadow = Image.new("RGBA", (W * S, 16 * S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for i in range(16 * S):
        a = int(34 * (1 - i / (16.0 * S)) ** 1.4)
        sd.line([0, i, W * S, i], fill=(112, 136, 172, a))
    img.paste(shadow, (0, y + 1), shadow)
    k = 0.5
    pet_defs = [(150, 63.75), (240, 221.25), (460, 437.25)]
    for s, x0 in pet_defs:
        device = Image.open(os.path.join(SHOTS, "stills", "size%d_0.png" % s)).convert("RGBA")
        # pick the frame with the most open eyes
        best, best_score = None, -1
        for i in range(4):
            cand = Image.open(os.path.join(SHOTS, "stills", "size%d_%d.png" % (s, i))).convert("RGBA")
            arr = np.asarray(cand)
            mask = (arr[:, :, 3] > 200) & (arr[:, :, 0] > 40) & (arr[:, :, 0] < 120) & (arr[:, :, 1] > 140) & (arr[:, :, 1] < 220) & (arr[:, :, 2] > 220)
            score = int(mask.sum())
            if score > best_score:
                best, best_score = cand, score
        device = best
        tw = round(device.width * 2 * k)  # 4x canvas: device px -> 2 px per css px * 2k
        th = round(device.height * 2 * k)
        pet = device.resize((tw, th), L)
        ledge = round(device.height * (0.70 / 0.75) * 2 * k)
        px = round(x0 * S)
        py = y - ledge
        img.paste(pet, (px, py), pet)
        cx = px + tw // 2
        d.text((cx, 286 * S), "%d px" % s, font=font(UI, 14 * S), fill=(104, 127, 164), anchor="mm")
    out = img.resize((W * 2, H * 2), L)
    path = os.path.join(BUILD, "sizes.png")
    out.save(path, optimize=True)
    print("wrote sizes.png", out.size, os.path.getsize(path) // 1024, "KB")


def build_menu():
    W, H, S = 800, 420, 4
    base = render_scene(S, W, H, 380).resize((1600, 840), L)
    d = ImageDraw.Draw(base)
    pet = Image.open(os.path.join(SHOTS, "stills", "pet240_look.png")).convert("RGBA")
    base.paste(pet, (188, 424), pet)
    menu = Image.open(os.path.join(SHOTS, "stills", "menu.png")).convert("RGBA")
    menu = menu.crop(menu.getchannel("A").getbbox())
    mx, my = 860, 740 - menu.height
    base.paste(menu, (mx, my), menu)
    base.paste(CUR2, (mx - 20, my + 4), CUR2)
    path = os.path.join(BUILD, "menu.png")
    base.save(path, optimize=True)
    print("wrote menu.png", base.size, os.path.getsize(path) // 1024, "KB")


def build_console():
    im = Image.open(os.path.join(SHOTS, "stills", "console.png")).convert("RGB")
    path = os.path.join(BUILD, "console.png")
    im.save(path, optimize=True)
    print("wrote console.png", im.size, os.path.getsize(path) // 1024, "KB")


build_gif("hero", "蓝色肥鱼 · 任务栏桌宠", "眼睛跟着光标 / 小手一挪一挪", "hero.gif")
build_gif("moods", "被冷落会闹脾气，摸摸就好", "呆毛蔫下去 → 摸一下又开心", "moods.gif")
build_sizes()
build_menu()
build_console()

if "--install" in sys.argv:
    import shutil
    for name in ("hero.gif", "moods.gif", "sizes.png", "menu.png", "console.png"):
        shutil.copyfile(os.path.join(BUILD, name), os.path.join(DOCS, name))
        print("installed docs/" + name)

