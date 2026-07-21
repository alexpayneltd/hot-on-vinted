import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// On Mac: set CHROME_PATH in .env to use system Chrome (avoids re-downloading)
// On Railway/Linux: leave unset — puppeteer's bundled Chromium is used automatically
const CHROME_EXEC = process.env.CHROME_PATH || executablePath();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
puppeteer.use(StealthPlugin());

const CACHE_FILE = path.join(__dirname, 'cache', 'all.json');
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);


let scraping = false;

// ── Warm page for fast searches ──────────────────────────────────────────────
let warmBrowser = null;
let warmPage = null;
let warmPageBusy = false;
let warmBrowserTimer = null;
const WARM_IDLE_TTL = 25 * 60 * 1000;

async function getWarmPage() {
  // Reset idle timer
  clearTimeout(warmBrowserTimer);
  warmBrowserTimer = setTimeout(closeWarmBrowser, WARM_IDLE_TTL);

  if (warmPage && !warmPage.isClosed()) return warmPage;

  console.log('🌐 Warming up search browser...');
  if (warmBrowser) await warmBrowser.close().catch(() => {});

  warmBrowser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  warmPage = (await warmBrowser.pages())[0];
  await warmPage.setViewport({ width: 1280, height: 900 });
  await warmPage.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });
  await warmPage.goto('https://www.vinted.co.uk', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2000);
  console.log('🌐 Warm page ready');
  return warmPage;
}

async function closeWarmBrowser() {
  clearTimeout(warmBrowserTimer);
  warmPage = null;
  if (warmBrowser) {
    console.log('🌐 Warm browser closed (idle)');
    await warmBrowser.close().catch(() => {});
    warmBrowser = null;
  }
}

export async function scrapeAll() {
  if (scraping) { console.log('Scrape already in progress, skipping.'); return; }
  scraping = true;
  console.log(`\n[${new Date().toISOString()}] 🔍 Starting scrape...`);

  const globalItems = new Map();

  try {
    const CATALOGS = [
      { label: 'Women',                  id: '1904' },
      { label: 'Men',                    id: '5'    },
      { label: 'Kids',                   id: '1193' },
      { label: 'Home',                   id: '1918' },
      { label: 'Electronics',            id: '2994' },
      { label: 'Sports',                 id: '4332' },
      { label: 'Entertainment',          id: '2309' },
      { label: 'Hobbies & Collectables', id: '4824' },
    ];

    for (const cat of CATALOGS) {
      console.log(`📦 ${cat.label}`);
      try {
        const items = await scrapeWithFreshBrowser(cat.id, 20);
        let added = 0;
        for (const item of items) {
          if (!globalItems.has(item.id)) {
            if (item.favourite_count == null) item.favourite_count = 0;
            globalItems.set(item.id, item);
            added++;
          }
        }
        console.log(`  ✅ ${added} new unique (total: ${globalItems.size})`);
      } catch (err) {
        console.error(`  ⚠️ ${cat.label} failed, skipping: ${err.message}`);
      }
      await sleep(3000);
    }

    // Sort all unique items by likes
    const sorted = [...globalItems.values()]
      .sort((a, b) => b.favourite_count - a.favourite_count)
      .filter(i => i.favourite_count > 0);

    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      items: sorted,
      lastUpdated: new Date().toISOString(),
      total: sorted.length,
    }));

    const top5 = sorted.slice(0, 5).map(i => `${i.favourite_count} ❤️  ${i.title}`);
    console.log(`\n✅ Saved ${sorted.length} liked items from ${globalItems.size} unique. Top 5:\n  ${top5.join('\n  ')}`);

  } catch (err) {
    console.error('Scrape error:', err.message);
  } finally {
    scraping = false;
    console.log(`[${new Date().toISOString()}] Done\n`);
  }
}

async function scrapeWithFreshBrowser(catalogId, pages = 10, searchTerm = null) {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 60000,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });
    await page.goto('https://www.vinted.co.uk', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);

    const items = [];
    for (let p = 1; p <= pages; p++) {
      let url = `https://www.vinted.co.uk/api/v2/catalog/items?page=${p}&per_page=96`;
      if (catalogId) url += `&catalog[]=${catalogId}`;
      if (searchTerm) url += `&search_text=${encodeURIComponent(searchTerm)}`;
      const data = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        return r.ok ? r.json() : null;
      }, url);
      if (!data?.items?.length) break;
      items.push(...data.items);
      await sleep(300);
    }
    return items;
  } finally {
    await browser.close();
  }
}

// Serialise searches so they don't clobber each other on the shared warm page
let searchQueue = Promise.resolve();

export async function scrapeSearch(term, pages = 5) {
  const result = new Promise((resolve, reject) => {
    searchQueue = searchQueue.then(() => _doSearch(term, pages).then(resolve, reject));
  });
  return result;
}

async function _doSearch(term, pages) {
  console.log(`\n[${new Date().toISOString()}] 🔎 Searching: "${term}"`);
  try {
    const page = await getWarmPage();
    const items = [];
    for (let p = 1; p <= pages; p++) {
      const url = `https://www.vinted.co.uk/api/v2/catalog/items?page=${p}&per_page=96&search_text=${encodeURIComponent(term)}`;
      const data = await page.evaluate(async (u) => {
        const r = await fetch(u, { headers: { Accept: 'application/json' } });
        return r.ok ? r.json() : null;
      }, url);
      if (!data?.items?.length) break;
      items.push(...data.items);
      await sleep(150);
    }
    const sorted = items
      .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
      .map(i => { if (i.favourite_count == null) i.favourite_count = 0; return i; })
      .sort((a, b) => b.favourite_count - a.favourite_count);
    console.log(`  ✅ "${term}": ${sorted.length} items, top likes: ${sorted[0]?.favourite_count ?? 0}`);
    return sorted;
  } catch (err) {
    console.error(`Search error for "${term}":`, err.message);
    await closeWarmBrowser(); // force re-warm on next search
    throw err;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
