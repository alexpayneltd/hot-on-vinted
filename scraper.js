import 'dotenv/config';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CHROME_EXEC = process.env.CHROME_PATH || executablePath();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
puppeteer.use(StealthPlugin());

const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const WARM_IDLE_TTL = 25 * 60 * 1000;

// ── Per-domain warm pages ─────────────────────────────────────────────────────
const warmSessions = new Map(); // domain → { browser, page, timer }

async function getWarmPage(domain = 'vinted.co.uk') {
  const session = warmSessions.get(domain) || {};
  if (session.timer) clearTimeout(session.timer);
  const timer = setTimeout(() => closeWarmBrowser(domain), WARM_IDLE_TTL);

  if (session.page && !session.page.isClosed()) {
    warmSessions.set(domain, { ...session, timer });
    return session.page;
  }

  console.log(`🌐 Warming up search browser (${domain})...`);
  if (session.browser) await session.browser.close().catch(() => {});

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1280, height: 900 });
  const lang = domain === 'vinted.fr' ? 'fr-FR,fr;q=0.9' : domain === 'vinted.de' ? 'de-DE,de;q=0.9' : 'en-GB,en;q=0.9';
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
  await page.goto(`https://www.${domain}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2000);

  warmSessions.set(domain, { browser, page, timer });
  console.log(`🌐 Warm page ready (${domain})`);
  return page;
}

async function closeWarmBrowser(domain = 'vinted.co.uk') {
  const session = warmSessions.get(domain);
  if (session) {
    if (session.timer) clearTimeout(session.timer);
    if (session.browser) {
      console.log(`🌐 Warm browser closed (idle) (${domain})`);
      await session.browser.close().catch(() => {});
    }
    warmSessions.delete(domain);
  }
}

// ── Per-domain scrape locks ───────────────────────────────────────────────────
const scrapingDomains = new Set();

// ── Per-domain search queues ──────────────────────────────────────────────────
const searchQueues = new Map(); // domain → Promise

// ── Main catalog scrape ───────────────────────────────────────────────────────
export async function scrapeAll(domain = 'vinted.co.uk', cacheFile = path.join(CACHE_DIR, 'all.json')) {
  if (scrapingDomains.has(domain)) { console.log(`Scrape already in progress (${domain}), skipping.`); return; }
  scrapingDomains.add(domain);
  console.log(`\n[${new Date().toISOString()}] 🔍 Starting scrape (${domain})...`);

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
      console.log(`📦 ${cat.label} (${domain})`);
      try {
        const items = await scrapeWithFreshBrowser(cat.id, 20, null, domain);
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

    const sorted = [...globalItems.values()]
      .sort((a, b) => b.favourite_count - a.favourite_count)
      .filter(i => i.favourite_count > 0);

    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ items: sorted, lastUpdated: new Date().toISOString(), total: sorted.length }));

    const top5 = sorted.slice(0, 5).map(i => `${i.favourite_count} ❤️  ${i.title}`);
    console.log(`\n✅ (${domain}) Saved ${sorted.length} items. Top 5:\n  ${top5.join('\n  ')}`);

  } catch (err) {
    console.error(`Scrape error (${domain}):`, err.message);
  } finally {
    scrapingDomains.delete(domain);
    console.log(`[${new Date().toISOString()}] Done (${domain})\n`);
  }
}

// ── Fresh browser scrape (catalog or search) ──────────────────────────────────
async function scrapeWithFreshBrowser(catalogId, pages = 10, searchTerm = null, domain = 'vinted.co.uk') {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 60000,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const lang = domain === 'vinted.fr' ? 'fr-FR,fr;q=0.9' : domain === 'vinted.de' ? 'de-DE,de;q=0.9' : 'en-GB,en;q=0.9';
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });
    await page.goto(`https://www.${domain}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);

    const items = [];
    for (let p = 1; p <= pages; p++) {
      let url = `https://www.${domain}/api/v2/catalog/items?page=${p}&per_page=96`;
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

// ── Search (warm browser, serialised per domain) ──────────────────────────────
export async function scrapeSearch(term, pages = 5, domain = 'vinted.co.uk') {
  if (!searchQueues.has(domain)) searchQueues.set(domain, Promise.resolve());
  const result = new Promise((resolve, reject) => {
    const next = searchQueues.get(domain).then(() => _doSearch(term, pages, domain).then(resolve, reject));
    searchQueues.set(domain, next);
  });
  return result;
}

async function _doSearch(term, pages, domain) {
  console.log(`\n[${new Date().toISOString()}] 🔎 Searching "${term}" on ${domain}`);
  try {
    const page = await getWarmPage(domain);
    const items = [];
    for (let p = 1; p <= pages; p++) {
      const url = `https://www.${domain}/api/v2/catalog/items?page=${p}&per_page=96&search_text=${encodeURIComponent(term)}`;
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
    console.log(`  ✅ "${term}" (${domain}): ${sorted.length} items, top likes: ${sorted[0]?.favourite_count ?? 0}`);
    return sorted;
  } catch (err) {
    console.error(`Search error for "${term}" on ${domain}:`, err.message);
    await closeWarmBrowser(domain);
    throw err;
  }
}

// ── Brand items (fresh browser) ───────────────────────────────────────────────
export async function scrapeBrandItems(query, pages = 5, domain = 'vinted.co.uk') {
  const items = await scrapeWithFreshBrowser(null, pages, query, domain);
  return items
    .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
    .map(i => { if (i.favourite_count == null) i.favourite_count = 0; return i; })
    .sort((a, b) => b.favourite_count - a.favourite_count);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
