#!/usr/bin/env python3
"""
Hot on Vinted — daily Instagram Reel poster
Posts a slideshow of the top most-liked items as a Reel.

Usage:
  python post-to-instagram.py           # UK, 8 items
  python post-to-instagram.py --country fr
  python post-to-instagram.py --country de --items 6
"""

import json, os, sys, argparse, requests, time, subprocess, shutil, tempfile
from pathlib import Path
from datetime import datetime
from PIL import Image
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

# ── Args ──────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--country", choices=["uk", "fr", "de", "nl"], default="uk")
parser.add_argument("--items", type=int, default=8)
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
    print(f"📡 Fetching listings...")
    r = requests.get(API_URL, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    print(f"   {len(items)} items available")
    result = [i for i in items if str(i["id"]) not in posted][:count]
    print(f"   {len(result)} unposted items selected")
    return result

# ── Images ────────────────────────────────────────────────────────────────────
def download_images(items):
    paths = []
    for idx, item in enumerate(items):
        photos = item.get("photos", [])
        if not photos:
            continue
        url = photos[0].get("full_size_webp") or photos[0].get("full_size") or photos[0].get("url")
        if not url or url.startswith("#"):
            continue
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        img_path = TMP_DIR / f"img_{idx:02d}.jpg"
        img_path.write_bytes(r.content)

        # Crop to square 1080×1080
        img = Image.open(img_path).convert("RGB")
        w, h = img.size
        side = min(w, h)
        img  = img.crop(((w-side)//2, (h-side)//2, (w+side)//2, (h+side)//2))
        if side != 1080:
            img = img.resize((1080, 1080), Image.LANCZOS)
        img.save(img_path, "JPEG", quality=95)
        paths.append(str(img_path))
        print(f"   ✅ {idx+1}/{len(items)}: {item['title'][:50]}")
    return paths

# ── Video ─────────────────────────────────────────────────────────────────────
def create_video(image_paths, output_path, slide_duration=2.5):
    """Stitch images into a slideshow MP4 via ffmpeg concat."""
    if not image_paths:
        raise ValueError("No images to stitch")

    concat_file = TMP_DIR / "filelist.txt"
    with open(concat_file, "w") as f:
        for p in image_paths:
            f.write(f"file '{p}'\n")
            f.write(f"duration {slide_duration}\n")
        f.write(f"file '{image_paths[-1]}'\n")  # ffmpeg concat requires final entry without duration

    cmd = [
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_file),
        "-vf", "scale=1080:1080,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        str(output_path),
    ]
    print(f"\n🎬 Creating video ({len(image_paths)} slides × {slide_duration}s)...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"   ffmpeg stderr: {result.stderr[-500:]}")
        raise RuntimeError("ffmpeg failed — is ffmpeg installed?")
    print(f"   ✅ Video ready: {output_path}")
    return str(output_path)

# ── Caption ───────────────────────────────────────────────────────────────────
def price_str(item):
    price = item.get("price", "")
    if isinstance(price, dict):
        sym = "€" if price.get("currency_code") == "EUR" else "£"
        return f"{sym}{price.get('amount', '')}"
    sym = "€" if COUNTRY in ("fr", "de", "nl") else "£"
    return f"{sym}{price}" if price else ""

def make_caption(items):
    top3 = items[:3]
    more = len(items) - 3

    if COUNTRY == "fr":
        lines = [
            "🔥 Les plus likés sur Vinted France en ce moment",
            "",
            *[f"✨ {i['title'][:40]} — {price_str(i)} ❤️ {i.get('favourite_count', 0)}" for i in top3],
            *([ f"(+ {more} autres dans la vidéo)" ] if more > 0 else []),
            "",
            "Retrouve-les tous sur hotonvinted.com/fr 🔥 (lien en bio)",
            "",
            "#vinted #vintedfrance #vintedfr #modedurable #secondemain",
            "#chinedressing #hotonvinted #modeethique #prelove #vintedfind",
        ]
    elif COUNTRY == "de":
        lines = [
            "🔥 Die beliebtesten Artikel auf Vinted Deutschland",
            "",
            *[f"✨ {i['title'][:40]} — {price_str(i)} ❤️ {i.get('favourite_count', 0)}" for i in top3],
            *([ f"(+ {more} weitere im Video)" ] if more > 0 else []),
            "",
            "Finde sie alle auf hotonvinted.com/de 🔥 (Link in Bio)",
            "",
            "#vinted #vinteddeutschland #vintedde #secondhand #nachhaltigemode",
            "#hotonvinted #preloved #vintedfund #gebrauchtkauf #nachhaltig",
        ]
    elif COUNTRY == "nl":
        lines = [
            "🔥 Meest gelikte items op Vinted Nederland",
            "",
            *[f"✨ {i['title'][:40]} — {price_str(i)} ❤️ {i.get('favourite_count', 0)}" for i in top3],
            *([ f"(+ {more} meer in de video)" ] if more > 0 else []),
            "",
            "Vind ze allemaal op hotonvinted.com/nl 🔥 (link in bio)",
            "",
            "#vinted #vintednederland #vintedfind #tweedehandse #duurzamefashion",
            "#hotonvinted #preloved #tweedehands #vintedseller #vintedkopen",
        ]
    else:
        lines = [
            "🔥 Most liked on Vinted UK right now",
            "",
            *[f"✨ {i['title'][:40]} — {price_str(i)} ❤️ {i.get('favourite_count', 0)}" for i in top3],
            *([ f"(+ {more} more in the reel)" ] if more > 0 else []),
            "",
            "Find them all at hotonvinted.com 🔥 (link in bio)",
            "",
            "#vinted #vinteduk #secondhand #preloved #sustainablefashion",
            "#thrifted #vintedfind #ukvinted #hotonvinted #vintedseller",
        ]
    return "\n".join(lines)

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
                        page.get_by_role("button", name=btn_name).click(timeout=4000)
                        time.sleep(1)
                    except Exception:
                        pass
                context.storage_state(path=str(AUTH_FILE))
                print("   ✅ Logged in, session saved")
        except Exception:
            pass

        # Open Create dialog
        print("   Opening create dialog...")
        page.screenshot(path="/tmp/ig-feed.png")
        opened = False
        for selector in ["link:New post Create", "link:New post", "link:Create"]:
            try:
                role, name = selector.split(":")
                el = page.get_by_role(role, name=name)
                if el.is_visible(timeout=3000):
                    el.click()
                    opened = True
                    break
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
                raise Exception("Reel link not visible")
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
        time.sleep(5)  # allow video processing

        # Dismiss any OK / trim / crop dialogs
        for btn_name in ["OK", "Done", "Continue"]:
            try:
                btn = page.get_by_role("button", name=btn_name)
                if btn.is_visible(timeout=2000):
                    btn.click()
                    time.sleep(1)
            except Exception:
                pass

        page.get_by_role("button", name="Next").click()
        time.sleep(1.5)
        page.get_by_role("button", name="Next").click()
        time.sleep(1.5)

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

    image_paths = download_images(items)
    if not image_paths:
        print("❌ No images downloaded")
        sys.exit(1)

    video_path = create_video(image_paths, TMP_VIDEO)
    caption    = make_caption(items)
    print(f"\n📝 Caption preview:\n{caption}\n")

    post_to_instagram(video_path, caption)

    for item in items:
        posted.add(str(item["id"]))
    save_posted(posted)

    shutil.rmtree(TMP_DIR, ignore_errors=True)
    print(f"\n✅ Done at {datetime.now().strftime('%Y-%m-%d %H:%M')}")

if __name__ == "__main__":
    main()
