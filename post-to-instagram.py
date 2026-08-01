#!/usr/bin/env python3
"""
Hot on Vinted — daily Instagram Reel poster
Posts a vertical 9:16 slideshow with text overlays and crossfade transitions.

Usage:
  python3 post-to-instagram.py           # UK, 8 items
  python3 post-to-instagram.py --country fr
  python3 post-to-instagram.py --country de --items 6
"""

import json, os, sys, argparse, requests, time, subprocess, shutil, tempfile
from io import BytesIO
from pathlib import Path
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

# ── Args ──────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--country", choices=["uk", "fr", "de", "nl"], default="uk")
parser.add_argument("--items", type=int, default=6)
parser.add_argument("--preview", action="store_true", help="Save first 2 slides to /tmp and open them — no post")
args = parser.parse_args()
COUNTRY        = args.country
ITEMS_PER_POST = args.items

# ── Config ────────────────────────────────────────────────────────────────────
IG_USERNAME = os.environ.get("IG_USERNAME", "hot.on.vinted")
IG_PASSWORD = os.environ.get("IG_PASSWORD")

BASE_URL  = "https://hotonvinted.com"
API_URL   = {
    "uk": f"{BASE_URL}/api/listings",
    "fr": f"{BASE_URL}/fr/api/listings",
    "de": f"{BASE_URL}/de/api/listings",
    "nl": f"{BASE_URL}/nl/api/listings",
}[COUNTRY]

POSTED_FILE = Path(__file__).parent / f"posted-{COUNTRY}.json"
AUTH_FILE   = Path(__file__).parent / "ig-auth.json"
TMP_DIR     = Path(tempfile.mkdtemp(prefix="vinted_reel_"))
TMP_VIDEO   = TMP_DIR / "reel.mp4"

# ── Slide canvas ──────────────────────────────────────────────────────────────
W, H      = 1080, 1920   # 9:16 standard Reels format
S         = 2             # supersampling scale — render at 2× then downscale
SW, SH    = W * S, H * S  # 2160 × 3840 working canvas
SAFE_TOP  = 450 * S      # safe zone from top crop
SAFE_BOTT = 310 * S      # bottom Instagram UI overlap
BG        = (10, 10, 10)
WHITE     = (255, 255, 255)
ACCENT    = (255, 65, 65)
GRAY      = (210, 210, 210)
DGRAY     = (80, 80, 80)
TEAL      = (9, 181, 174)    # Vinted brand teal

print(f"🌍 Country: {COUNTRY.upper()} | API: {API_URL}")

# ── Posted history ────────────────────────────────────────────────────────────
def load_posted():
    legacy = Path(__file__).parent / "posted.json"
    if not POSTED_FILE.exists() and legacy.exists() and COUNTRY == "uk":
        legacy.rename(POSTED_FILE)
    return set(json.loads(POSTED_FILE.read_text())) if POSTED_FILE.exists() else set()

def save_posted(posted):
    POSTED_FILE.write_text(json.dumps(list(posted)))

# ── Fetch items ───────────────────────────────────────────────────────────────
def get_top_items(posted, count):
    print("📡 Fetching listings...")
    r = requests.get(API_URL, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    print(f"   {len(items)} items available")
    result = [i for i in items if str(i["id"]) not in posted][:count]
    print(f"   {len(result)} unposted items selected")
    return result

# ── Helpers ───────────────────────────────────────────────────────────────────
def price_str(item):
    price = item.get("price", "")
    if isinstance(price, dict):
        sym = "€" if price.get("currency_code") == "EUR" else "£"
        try:
            return f"{sym}{float(price.get('amount', 0)):.2f}"
        except Exception:
            return f"{sym}{price.get('amount', '')}"
    sym = "€" if COUNTRY in ("fr", "de", "nl") else "£"
    try:
        return f"{sym}{float(price):.2f}" if price else ""
    except Exception:
        return f"{sym}{price}" if price else ""

def get_font(size, bold=False):
    # (path, bold_index, regular_index)
    candidates = [
        ("/System/Library/Fonts/Helvetica.ttc",    1, 0),
        ("/System/Library/Fonts/HelveticaNeue.ttc", 4, 0),
        ("/Library/Fonts/Arial Bold.ttf",           0, 0),
        ("/Library/Fonts/Arial.ttf",                0, 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",    0, 0),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",         0, 0),
        ("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", 0, 0),
    ]
    for path, bold_idx, reg_idx in candidates:
        try:
            idx = bold_idx if bold else reg_idx
            return ImageFont.truetype(path, size, index=idx)
        except Exception:
            pass
    return ImageFont.load_default()

def txt(draw, xy, text, font, color=WHITE, shadow=True, stroke_width=0, stroke_fill=(0,0,0)):
    """Draw text with optional drop shadow or stroke outline."""
    if stroke_width:
        draw.text(xy, text, font=font, fill=color, anchor="mm",
                  stroke_width=stroke_width, stroke_fill=stroke_fill)
    elif shadow:
        off = max(2, font.size // 40)
        draw.text((xy[0] + off, xy[1] + off), text, font=font, fill=(0, 0, 0, 180), anchor="mm")
        draw.text(xy, text, font=font, fill=color, anchor="mm")
    else:
        draw.text(xy, text, font=font, fill=color, anchor="mm")

def wrap_text(text, font, max_px, draw, max_lines=2):
    words = text.split()
    lines, current = [], []
    for word in words:
        test = " ".join(current + [word])
        try:
            w = draw.textlength(test, font=font)
        except Exception:
            w = len(test) * (font.size * 0.6)
        if w <= max_px:
            current.append(word)
        else:
            if current:
                lines.append(" ".join(current))
            current = [word]
    if current:
        lines.append(" ".join(current))
    return lines[:max_lines]

# ── Slide builders ────────────────────────────────────────────────────────────
COUNTRY_LABELS = {"uk": "Vinted UK", "fr": "Vinted France", "de": "Vinted DE", "nl": "Vinted NL"}
LOGO_PATH      = Path(__file__).parent / "public" / "logo.png"

def load_logo(px):
    """Load logo, apply circular mask, return RGBA at px × px (2× canvas units)."""
    logo = Image.open(LOGO_PATH).convert("RGBA")
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, logo.size[0], logo.size[1]], fill=255)
    logo.putalpha(mask)
    return logo.resize((px, px), Image.LANCZOS)

def _square_crop(img):
    """Centre-crop PIL image to square."""
    w, h  = img.size
    side  = min(w, h)
    return img.crop(((w-side)//2, (h-side)//2, (w+side)//2, (h+side)//2))

def _gradient_overlay(slide, start_y, end_y, max_alpha=230):
    """Apply a bottom-fade dark gradient (start_y → end_y) on slide."""
    cw, ch = slide.size
    ov   = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d    = ImageDraw.Draw(ov)
    span = end_y - start_y
    for y in range(span):
        a = int(max_alpha * (y / span) ** 0.55)
        d.line([(0, start_y + y), (cw, start_y + y)], fill=(0, 0, 0, a))
    base = slide.convert("RGBA")
    base.alpha_composite(ov)
    return base.convert("RGB")

def make_intro_slide():
    slide = Image.new("RGB", (SW, SH), color=BG)
    draw  = ImageDraw.Draw(slide)

    # Large logo centred in upper half
    logo_px = int(SW * 0.62)   # ~1340px on 2× canvas → 670px in output
    logo    = load_logo(logo_px)
    lx      = (SW - logo_px) // 2
    ly      = int(SH * 0.18)
    slide.paste(logo, (lx, ly), logo)

    # Text below logo
    ty = ly + logo_px + 80
    country_label = COUNTRY_LABELS.get(COUNTRY, "Vinted")
    txt(draw, (SW//2, ty),       country_label,           font=get_font(140, bold=True), color=WHITE,  shadow=False)
    txt(draw, (SW//2, ty + 180), "most liked · right now", font=get_font(88),            color=GRAY,   shadow=False)
    txt(draw, (SW//2, SH - SAFE_BOTT - 60), "hotonvinted.com", font=get_font(64),        color=DGRAY,  shadow=False)

    out = str(TMP_DIR / "slide_00.jpg")
    slide.resize((W, H), Image.LANCZOS).save(out, "JPEG", quality=95)
    return out

def make_product_slide(item, img_bytes, rank):
    raw = Image.open(img_bytes).convert("RGB")
    rw, rh = raw.size

    # ── Full-bleed at 2× canvas: scale to fill SW×SH, center crop ────────────
    scale  = max(SW / rw, SH / rh)
    new_w  = int(rw * scale)
    new_h  = int(rh * scale)
    scaled = raw.resize((new_w, new_h), Image.LANCZOS)
    x0     = (new_w - SW) // 2
    y0     = (new_h - SH) // 2
    slide  = scaled.crop((x0, y0, x0 + SW, y0 + SH))

    # ── Dark gradient over bottom 50% ────────────────────────────────────────
    slide = _gradient_overlay(slide, int(SH * 0.55), SH, max_alpha=235)

    draw = ImageDraw.Draw(slide)

    # ── Title — 1 line, truncated, below action buttons ──────────────────────
    text_y    = int(SH * 0.75)
    title_fnt = get_font(120, bold=True)
    lines     = wrap_text(item.get("title", ""), title_fnt, SW - 200, draw, max_lines=1)
    # Truncate with ellipsis if too long
    if len(lines) == 0:
        lines = [item.get("title", "")[:30] + "…"]
    txt(draw, (SW//2, text_y), lines[0], font=title_fnt,
        color=TEAL, stroke_width=14, stroke_fill=(0, 0, 0))

    # ── Price · likes ─────────────────────────────────────────────────────────
    p     = price_str(item)
    likes = item.get("favourite_count", 0)
    parts = ([p] if p else []) + [f"{likes:,} likes"]
    txt(draw, (SW//2, text_y + 160), "  ·  ".join(parts),
        font=get_font(84, bold=True), color=WHITE, stroke_width=8, stroke_fill=(0, 0, 0))

    # ── Downscale to output size ──────────────────────────────────────────────
    out = str(TMP_DIR / f"slide_{rank:02d}.jpg")
    slide.resize((W, H), Image.LANCZOS).save(out, "JPEG", quality=95)
    return out

def build_slides(items):
    paths = []
    for rank, item in enumerate(items, start=1):
        photos = item.get("photos", [])
        if not photos:
            continue
        url = photos[0].get("full_size_webp") or photos[0].get("full_size") or photos[0].get("url")
        if not url or url.startswith("#"):
            continue
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        path = make_product_slide(item, BytesIO(r.content), rank)
        paths.append(path)
        print(f"   ✅ Slide {rank}: {item['title'][:50]}")
    return paths

# ── Video (ffmpeg concat + xfade) ────────────────────────────────────────────
def create_video(slide_paths, output_path, slide_dur=2.0, fade_dur=0.4):
    n = len(slide_paths)
    if n == 0:
        raise ValueError("No slides")

    # Each input looped for slide_dur + fade_dur (extra content for xfade overlap)
    clip_dur = slide_dur + fade_dur
    inputs   = []
    for p in slide_paths:
        inputs += ["-loop", "1", "-t", str(clip_dur), "-i", p]

    # Scale each input to 1080x1920
    scale_parts = [
        f"[{i}]scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2,fps=30[s{i}]"
        for i in range(n)
    ]

    # Chain xfades: offset_i = i * (slide_dur - fade_dur)
    if n == 1:
        filter_complex = scale_parts[0].replace("[s0]", "[vout]")
    else:
        xfade_parts = []
        prev = "s0"
        for i in range(1, n):
            offset  = round(i * (slide_dur - fade_dur), 2)
            out_tag = f"x{i}" if i < n - 1 else "vout"
            xfade_parts.append(
                f"[{prev}][s{i}]xfade=transition=fade:duration={fade_dur}:offset={offset}[{out_tag}]"
            )
            prev = out_tag
        filter_complex = ";".join(scale_parts + xfade_parts)

    total_dur = (n - 1) * (slide_dur - fade_dur) + slide_dur
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=stereo",   # silent audio track
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", f"{n}:a",       # map the silent audio
        "-t", str(total_dur),
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        str(output_path),
    ]
    print(f"\n🎬 Creating video ({n} slides, ~{total_dur:.0f}s)...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"   ffmpeg stderr:\n{result.stderr[-800:]}")
        raise RuntimeError("ffmpeg failed")
    print(f"   ✅ Video ready: {output_path}")
    return str(output_path)

# ── Caption ───────────────────────────────────────────────────────────────────
def make_caption(items):
    top3 = items[:3]
    more = len(items) - 3

    def line(i):
        return f"✨ {i['title'][:40]} — {price_str(i)} ({i.get('favourite_count', 0):,} likes)"

    if COUNTRY == "fr":
        body = [
            "🔥 Les plus likés sur Vinted France en ce moment", "",
            *[line(i) for i in top3],
            *([ f"(+ {more} autres dans la vidéo)" ] if more > 0 else []), "",
            "Retrouve-les tous sur hotonvinted.com/fr 🔥 (lien en bio)", "",
            "#vinted #vintedfrance #vintedfr #modedurable #secondemain",
            "#chinedressing #hotonvinted #modeethique #prelove #vintedfind",
        ]
    elif COUNTRY == "de":
        body = [
            "🔥 Die beliebtesten Artikel auf Vinted Deutschland", "",
            *[line(i) for i in top3],
            *([ f"(+ {more} weitere im Video)" ] if more > 0 else []), "",
            "Finde sie alle auf hotonvinted.com/de 🔥 (Link in Bio)", "",
            "#vinted #vinteddeutschland #vintedde #secondhand #nachhaltigemode",
            "#hotonvinted #preloved #vintedfund #gebrauchtkauf #nachhaltig",
        ]
    elif COUNTRY == "nl":
        body = [
            "🔥 Meest gelikte items op Vinted Nederland", "",
            *[line(i) for i in top3],
            *([ f"(+ {more} meer in de video)" ] if more > 0 else []), "",
            "Vind ze allemaal op hotonvinted.com/nl 🔥 (link in bio)", "",
            "#vinted #vintednederland #vintedfind #tweedehandse #duurzamefashion",
            "#hotonvinted #preloved #tweedehands #vintedseller #vintedkopen",
        ]
    else:
        body = [
            "🔥 Most liked on Vinted UK right now", "",
            *[line(i) for i in top3],
            *([ f"(+ {more} more in the reel)" ] if more > 0 else []), "",
            "Find them all at hotonvinted.com 🔥 (link in bio)", "",
            "#vinted #vinteduk #secondhand #preloved #sustainablefashion",
            "#thrifted #vintedfind #ukvinted #hotonvinted #vintedseller",
        ]
    return "\n".join(body)

# ── Post via Playwright ───────────────────────────────────────────────────────
def post_to_instagram(video_path, caption):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(storage_state=str(AUTH_FILE)) if AUTH_FILE.exists() else browser.new_context()
        if AUTH_FILE.exists():
            print("   Loaded saved session")

        page = context.new_page()
        page.goto("https://www.instagram.com/", wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # Cookie banner
        for label in ["Allow all cookies", "Allow All Cookies", "Decline optional cookies"]:
            try:
                btn = page.get_by_role("button", name=label)
                if btn.is_visible(timeout=2000):
                    btn.click()
                    time.sleep(1)
                    break
            except Exception:
                pass
        time.sleep(2)

        # Meta ads consent dialog (multi-step)
        for _ in range(3):
            try:
                btn = page.get_by_role("button", name="Get started")
                if btn.is_visible(timeout=2000):
                    print("   Ads dialog: clicking Get started...")
                    btn.click(); time.sleep(2); continue
            except Exception:
                pass
            try:
                option = page.get_by_text("Use for free with ads")
                if option.is_visible(timeout=2000):
                    print("   Ads dialog: selecting 'Use for free with ads'...")
                    option.click(); time.sleep(1)
                    page.get_by_role("button", name="Continue").click(); time.sleep(2); continue
            except Exception:
                pass
            try:
                btn = page.get_by_role("button", name="Continue")
                if btn.is_visible(timeout=2000):
                    print("   Ads dialog: clicking Continue...")
                    btn.click(); time.sleep(2); continue
            except Exception:
                pass
            break

        # Login if needed
        try:
            if "login" in page.url or page.get_by_role("textbox", name="Mobile number, username or").is_visible(timeout=3000):
                print("   Logging in...")
                page.get_by_role("textbox", name="Mobile number, username or").fill(IG_USERNAME)
                page.get_by_role("textbox", name="Password").fill(IG_PASSWORD)
                time.sleep(1)
                page.get_by_role("textbox", name="Password").press("Enter")
                time.sleep(4)
                for btn_name in ["Save info", "Not Now"]:
                    try:
                        page.get_by_role("button", name=btn_name).click(timeout=4000); time.sleep(1)
                    except Exception:
                        pass
                context.storage_state(path=str(AUTH_FILE))
                print("   ✅ Logged in, session saved")
        except Exception:
            pass

        # Open Create dialog
        print("   Opening create dialog...")
        time.sleep(2)
        page.screenshot(path="/tmp/ig-feed.png")
        opened = False
        for selector in ["link:New post Create", "link:New post", "link:Create"]:
            try:
                role, name = selector.split(":")
                el = page.get_by_role(role, name=name)
                if el.is_visible(timeout=3000):
                    el.click(); opened = True; break
            except Exception:
                continue
        if not opened:
            page.locator('[aria-label="New post"]').first.click()
        time.sleep(1)

        # Choose Reel, fall back to Post
        posted_as = "Reel"
        try:
            reel_link = page.get_by_role("link", name="Reel Reel")
            if reel_link.is_visible(timeout=3000):
                reel_link.click()
            else:
                raise Exception("not visible")
        except Exception:
            page.get_by_role("link", name="Post Post").click()
            posted_as = "Post"
        print(f"   Posting as: {posted_as}")
        time.sleep(1.5)

        # Upload video
        print("   Uploading video...")
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Select From Computer").click()
        fc.value.set_files(video_path)
        time.sleep(5)

        # Dismiss any trim / crop dialogs
        for btn_name in ["OK", "Done", "Continue"]:
            try:
                btn = page.get_by_role("button", name=btn_name)
                if btn.is_visible(timeout=2000):
                    btn.click(); time.sleep(1)
            except Exception:
                pass

        # Select "Original" crop to preserve full video dimensions
        print("   Setting crop to Original...")
        try:
            # Open the crop selector
            for crop_btn_label in ["Select crop", "Crop", "Change crop"]:
                try:
                    btn = page.locator(f'[aria-label="{crop_btn_label}"]')
                    if btn.is_visible(timeout=2000):
                        btn.click(); time.sleep(1); break
                except Exception:
                    pass
            # Click "Original"
            for label in ["Original", "original"]:
                try:
                    el = page.get_by_role("button", name=label)
                    if not el.is_visible(timeout=1000):
                        el = page.locator(f'[aria-label="{label}"]')
                    if el.is_visible(timeout=1000):
                        el.click(); time.sleep(1); break
                except Exception:
                    pass
        except Exception:
            pass

        page.get_by_role("button", name="Next").click(); time.sleep(1.5)
        page.get_by_role("button", name="Next").click(); time.sleep(1.5)

        # Caption
        print("   Adding caption...")
        caption_box = page.locator('[aria-label="Write a caption..."]')
        caption_box.click()
        caption_box.fill(caption)
        time.sleep(1)

        # Share
        print("   Sharing...")
        page.get_by_role("button", name="Share").click()
        for success_text in ["Your reel has been shared", "Your post has been shared"]:
            try:
                page.locator(f"text={success_text}").wait_for(timeout=30000)
                print(f"   ✅ {success_text}!")
                break
            except Exception:
                pass
        else:
            print("   ✅ Share clicked (confirm on Instagram)")

        time.sleep(2)
        browser.close()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not IG_PASSWORD:
        print("❌ IG_PASSWORD not set in .env")
        sys.exit(1)

    posted = load_posted()
    items  = get_top_items(posted, ITEMS_PER_POST)

    if not items:
        print("⚠️  No new items to post — all top items already posted.")
        sys.exit(0)

    print(f"\n🖼  Building {len(items) + 1} slides (intro + {len(items)} products)...")
    slide_paths = build_slides(items)
    if len(slide_paths) < 2:
        print("❌ Not enough slides built")
        sys.exit(1)

    if args.preview:
        import shutil as _sh
        for i, p in enumerate(slide_paths[:3]):
            dst = f"/tmp/preview_slide_{i:02d}.jpg"
            _sh.copy(p, dst)
            print(f"   Preview: {dst}")
        os.system("open /tmp/preview_slide_00.jpg /tmp/preview_slide_01.jpg /tmp/preview_slide_02.jpg")
        print("✅ Preview saved — exiting without posting.")
        sys.exit(0)

    video_path = create_video(slide_paths, TMP_VIDEO)
    caption    = make_caption(items)
    print(f"\n📝 Caption preview:\n{caption}\n")

    # Keep a copy of the video for manual upload / inspection
    saved_video = Path(__file__).parent / "last-reel.mp4"
    shutil.copy(video_path, saved_video)
    print(f"   💾 Video saved to {saved_video}")

    post_to_instagram(video_path, caption)

    for item in items:
        posted.add(str(item["id"]))
    save_posted(posted)

    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print(f"\n✅ Done at {datetime.now().strftime('%Y-%m-%d %H:%M')}")

if __name__ == "__main__":
    main()
