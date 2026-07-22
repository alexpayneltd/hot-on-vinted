#!/usr/bin/env python3
"""
Hot on Vinted — daily Instagram poster
Supports UK, FR, and DE. Usage:
  python post-to-instagram.py           # defaults to UK
  python post-to-instagram.py --country fr
  python post-to-instagram.py --country de
"""

import json
import os
import sys
import argparse
import requests
import time
from pathlib import Path
from datetime import datetime
from PIL import Image
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

# ── Args ──────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--country", choices=["uk", "fr", "de"], default="uk")
args = parser.parse_args()
COUNTRY = args.country

# ── Config ────────────────────────────────────────────────────────────────────
IG_USERNAME = os.environ.get("IG_USERNAME", "hot.on.vinted")
IG_PASSWORD = os.environ.get("IG_PASSWORD")

BASE_URL    = "https://hotonvinted.com"
API_URL     = f"{BASE_URL}/fr/api/listings" if COUNTRY == "fr" else f"{BASE_URL}/de/api/listings" if COUNTRY == "de" else f"{BASE_URL}/api/listings"
POSTED_FILE = Path(__file__).parent / f"posted-{COUNTRY}.json"
AUTH_FILE   = Path(__file__).parent / "ig-auth.json"
TMP_IMG     = Path("/tmp/vinted_post.jpg")

print(f"🌍 Country: {COUNTRY.upper()} | API: {API_URL}")

# ── Posted history ────────────────────────────────────────────────────────────
def load_posted():
    # Migrate legacy posted.json → posted-uk.json on first UK run
    legacy = Path(__file__).parent / "posted.json"
    if not POSTED_FILE.exists() and legacy.exists() and COUNTRY == "uk":
        legacy.rename(POSTED_FILE)
    if POSTED_FILE.exists():
        return set(json.loads(POSTED_FILE.read_text()))
    return set()

def save_posted(posted):
    POSTED_FILE.write_text(json.dumps(list(posted)))

# ── Fetch listings ────────────────────────────────────────────────────────────
def get_top_item(posted):
    print(f"📡 Fetching listings...")
    r = requests.get(API_URL, timeout=30)
    r.raise_for_status()
    items = r.json().get("items", [])
    print(f"   {len(items)} items available")
    for item in items:
        if str(item["id"]) not in posted:
            return item
    return None

# ── Image ─────────────────────────────────────────────────────────────────────
def download_and_prepare_image(item):
    photos = item.get("photos", [])
    if not photos:
        raise ValueError("No photos on item")
    photo   = photos[0]
    img_url = photo.get("full_size_webp") or photo.get("full_size") or photo.get("url")
    if not img_url or img_url.startswith("#"):
        raise ValueError("No usable image URL")

    print(f"   Downloading image...")
    r = requests.get(img_url, timeout=30)
    r.raise_for_status()
    with open(TMP_IMG, "wb") as f:
        f.write(r.content)

    img  = Image.open(TMP_IMG).convert("RGB")
    w, h = img.size
    side = min(w, h)
    img  = img.crop(((w-side)//2, (h-side)//2, (w+side)//2, (h+side)//2))
    if side < 320:
        img = img.resize((320, 320), Image.LANCZOS)
    img.save(TMP_IMG, "JPEG", quality=95)
    print(f"   Image ready: {img.size}")
    return str(TMP_IMG)

# ── Caption ───────────────────────────────────────────────────────────────────
def make_caption(item):
    title = item.get("title", "")
    price = item.get("price", "")
    likes = item.get("favourite_count", 0)

    if isinstance(price, dict):
        currency_code = price.get("currency_code", "")
        symbol        = "€" if currency_code == "EUR" else "£"
        price_str     = f"{symbol}{price.get('amount', '')}"
    else:
        symbol    = "€" if COUNTRY == "fr" else "£"
        price_str = f"{symbol}{price}" if price else ""

    if COUNTRY == "fr":
        lines = [
            f"🔥 {title}",
            "",
            f"{'💰 ' + price_str + '  ' if price_str else ''}❤️ {likes} favoris sur Vinted",
            "",
            "Retrouve-le sur hotonvinted.com/fr 🔥 (lien en bio)",
            "",
            "#vinted #vintedfrance #vintedfr #modedurable #secondemain",
            "#chinedressing #vintedvendeur #hotonvinted #modeethique #prelove",
        ]
    elif COUNTRY == "de":
        lines = [
            f"🔥 {title}",
            "",
            f"{'💰 ' + price_str + '  ' if price_str else ''}❤️ {likes} Favoriten auf Vinted",
            "",
            "Finde es auf hotonvinted.com/de 🔥 (Link in Bio)",
            "",
            "#vinted #vinteddeutschland #vintedde #secondhand #nachhaltigemode",
            "#gebrauchtkauf #vintedverkauf #hotonvinted #vintedfund #preloved",
        ]
    else:
        lines = [
            f"🔥 {title}",
            "",
            f"{'💰 ' + price_str + '  ' if price_str else ''}❤️ {likes} favourites on Vinted",
            "",
            "Find it at hotonvinted.com 🔥 (link in bio)",
            "",
            "#vinted #vinteduk #secondhand #preloved #sustainablefashion",
            "#thrifted #vintedfind #ukvinted #hotonvinted #vintedseller",
        ]
    return "\n".join(lines)

# ── Post via Playwright ───────────────────────────────────────────────────────
def post_to_instagram(img_path, caption):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        if AUTH_FILE.exists():
            context = browser.new_context(storage_state=str(AUTH_FILE))
            print("   Loaded saved session")
        else:
            context = browser.new_context()

        page = context.new_page()
        page.goto("https://www.instagram.com/", wait_until="networkidle", timeout=30000)
        time.sleep(2)

        for cookie_label in ["Allow all cookies", "Allow All Cookies", "Decline optional cookies"]:
            try:
                btn = page.get_by_role("button", name=cookie_label)
                if btn.is_visible(timeout=2000):
                    btn.click()
                    time.sleep(1)
                    break
            except Exception:
                pass

        time.sleep(2)

        if "login" in page.url or page.get_by_role("textbox", name="Mobile number, username or").is_visible(timeout=3000):
            print("   Logging in...")
            username_box = page.get_by_role("textbox", name="Mobile number, username or")
            username_box.wait_for(state="visible", timeout=10000)
            username_box.fill(IG_USERNAME)
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

        print("   Opening create post...")
        page.screenshot(path="/tmp/ig-feed.png")
        for selector in ["link:New post Create", "link:New post", "link:Create"]:
            try:
                role, name = selector.split(":")
                el = page.get_by_role(role, name=name)
                if el.is_visible(timeout=3000):
                    el.click()
                    break
            except Exception:
                continue
        else:
            page.locator('[aria-label="New post"]').first.click()
        time.sleep(1)
        page.get_by_role("link", name="Post Post").click()
        time.sleep(1.5)

        print("   Uploading image...")
        with page.expect_file_chooser() as fc:
            page.get_by_role("button", name="Select From Computer").click()
        fc.value.set_files(img_path)
        time.sleep(2)

        page.get_by_role("button", name="Next").click()
        time.sleep(1.5)
        page.get_by_role("button", name="Next").click()
        time.sleep(1.5)

        print("   Adding caption...")
        caption_box = page.locator('[aria-label="Write a caption..."]')
        caption_box.click()
        caption_box.fill(caption)
        time.sleep(1)

        print("   Sharing...")
        page.get_by_role("button", name="Share").click()

        try:
            page.locator("text=Your post has been shared").wait_for(timeout=30000)
            print("   ✅ Post shared!")
        except Exception:
            print("   ✅ Share clicked (confirm on Instagram)")

        time.sleep(2)
        browser.close()

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    if not IG_PASSWORD:
        print("❌ IG_PASSWORD not set in .env")
        sys.exit(1)

    posted   = load_posted()
    item     = get_top_item(posted)

    if not item:
        print("⚠️  No new items to post — all top items already posted.")
        sys.exit(0)

    print(f"\n📸 Item: {item['title']} (❤️ {item.get('favourite_count', 0)})")
    img_path = download_and_prepare_image(item)
    caption  = make_caption(item)
    print(f"\n📝 Caption preview:\n{caption[:200]}...\n")

    post_to_instagram(img_path, caption)

    posted.add(str(item["id"]))
    save_posted(posted)
    print(f"\n✅ Done at {datetime.now().strftime('%Y-%m-%d %H:%M')}")

if __name__ == "__main__":
    main()
