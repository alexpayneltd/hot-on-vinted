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
  const lang = domain === 'vinted.fr' ? 'fr-FR,fr;q=0.9' : domain === 'vinted.de' ? 'de-DE,de;q=0.9' : domain === 'vinted.nl' ? 'nl-NL,nl;q=0.9' : 'en-GB,en;q=0.9';
  await page.setExtraHTTPHeaders({ 'Accept-Language': lang });

  const { getToken } = await setupAuthCapture(page, domain);

  const needsAuth = domain === 'vinted.nl' || domain === 'vinted.de';
  const waitUntil = needsAuth ? 'networkidle2' : 'domcontentloaded';
  await page.goto(`https://www.${domain}`, { waitUntil, timeout: 60000 });
  await sleep(needsAuth ? 3000 : 2000);

  let authToken = null;
  if (needsAuth) {
    // Navigate to a real search page — this triggers vinted's JS auth flow
    // and CDP can capture the Bearer token from those authenticated requests
    console.log(`   🔍 Warming auth via search page (${domain})...`);
    await page.goto(`https://www.${domain}/catalog?search_text=nike&order=newest_first`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);
    authToken = await getToken();
    if (authToken) console.log(`   🔑 Warm auth token captured (${domain})`);
    else console.log(`   ⚠️ No auth token captured (${domain}) — proceeding without`);
  } else {
    authToken = await getToken();
    if (authToken) console.log(`   🔑 Warm auth token captured (${domain})`);
  }

  warmSessions.set(domain, { browser, page, timer, authToken });
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

// ── Auth token helper (NL + DE require Bearer token for search; UK/FR use cookies) ──
async function setupAuthCapture(page, domain) {
  const needsAuth = domain === 'vinted.nl' || domain === 'vinted.de';
  if (!needsAuth) return { getToken: () => null };
  let capturedToken = null;
  // Use CDP to passively observe requests — does NOT disrupt the session
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      const auth = request.headers?.Authorization || request.headers?.authorization;
      if (auth?.startsWith('Bearer ') && !capturedToken) {
        capturedToken = auth;
        console.log(`   🔑 Token intercepted via CDP (${domain})`);
      }
    });
  } catch (e) {
    console.log(`   ⚠️ CDP setup failed (${domain}): ${e.message}`);
  }
  const getToken = async () => {
    if (capturedToken) return capturedToken;
    // Check cookies for auth token
    try {
      const cookies = await page.cookies();
      const tokenCookie = cookies.find(c =>
        c.name === 'access_token' || c.name === 'anon_token' ||
        (c.name.toLowerCase().includes('token') && c.value.length > 20)
      );
      if (tokenCookie) {
        console.log(`   🍪 Token from cookie: ${tokenCookie.name}`);
        capturedToken = `Bearer ${tokenCookie.value}`;
        return capturedToken;
      }
    } catch {}
    // Fallback: extract from page JS state
    capturedToken = await page.evaluate(() => {
      try {
        const str = JSON.stringify(window.__NUXT__ || window.__STORE_STATE__ || window.__INITIAL_STATE__ || {});
        const m = str.match(/"(?:token|access_token|apiToken)":"([A-Za-z0-9_\-\.]{20,})"/);
        if (m) return `Bearer ${m[1]}`;
      } catch {}
      for (const s of document.querySelectorAll('script:not([src])')) {
        const m = s.textContent.match(/"token"\s*:\s*"([A-Za-z0-9_\-\.]{20,})"/);
        if (m) return `Bearer ${m[1]}`;
      }
      return null;
    }).catch(() => null);
    return capturedToken;
  };
  return { getToken };
}

// ── Per-domain scrape locks ───────────────────────────────────────────────────
const scrapingDomains = new Set();

// ── Per-domain search queues ──────────────────────────────────────────────────
const searchQueues = new Map(); // domain → Promise

// ── Main catalog scrape (single browser for all catalogs) ────────────────────
export async function scrapeAll(domain = 'vinted.co.uk', cacheFile = path.join(CACHE_DIR, 'all.json')) {
  if (scrapingDomains.has(domain)) { console.log(`Scrape already in progress (${domain}), skipping.`); return; }
  scrapingDomains.add(domain);
  console.log(`\n[${new Date().toISOString()}] 🔍 Starting scrape (${domain})...`);

  const globalItems = new Map();

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

  const lang = domain === 'vinted.fr' ? 'fr-FR,fr;q=0.9' : domain === 'vinted.de' ? 'de-DE,de;q=0.9' : domain === 'vinted.nl' ? 'nl-NL,nl;q=0.9' : 'en-GB,en;q=0.9';
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 60000,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });

    const { getToken } = await setupAuthCapture(page, domain);

    const waitUntil = domain === 'vinted.nl' ? 'networkidle2' : 'domcontentloaded';
    await page.goto(`https://www.${domain}`, { waitUntil, timeout: 60000 });
    await sleep(domain === 'vinted.nl' ? 4000 : 2500);
    const authToken = await getToken();
    if (authToken) console.log(`   🔑 Auth token captured (${domain})`);

    for (const cat of CATALOGS) {
      console.log(`📦 ${cat.label} (${domain})`);
      try {
        const items = [];
        for (let p = 1; p <= 20; p++) {
          const url = `https://www.${domain}/api/v2/catalog/items?page=${p}&per_page=96&catalog[]=${cat.id}`;
          const result = await page.evaluate(async (u, token) => {
            const headers = { Accept: 'application/json' };
            if (token) headers['Authorization'] = token;
            const r = await fetch(u, { headers });
            const text = await r.text();
            return { status: r.status, ok: r.ok, text };
          }, url, authToken);
          if (!result.ok) { console.log(`   ⚠️ API ${result.status} (${domain}) p${p}: ${result.text.slice(0, 150)}`); break; }
          let data; try { data = JSON.parse(result.text); } catch { break; }
          if (!data?.items?.length) break;
          items.push(...data.items);
          await sleep(300);
        }
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
      await sleep(2000);
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
    await browser.close().catch(() => {});
    scrapingDomains.delete(domain);
    console.log(`[${new Date().toISOString()}] Done (${domain})\n`);
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
    const authToken = warmSessions.get(domain)?.authToken || null;
    const items = [];
    for (let p = 1; p <= pages; p++) {
      const url = `https://www.${domain}/api/v2/catalog/items?page=${p}&per_page=96&search_text=${encodeURIComponent(term)}`;
      const data = await page.evaluate(async (u, token) => {
        const headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = token;
        const r = await fetch(u, { headers });
        return r.ok ? r.json() : null;
      }, url, authToken);
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

// ── Brand items — shared browser across all brands per country ────────────────
export async function scrapeAllBrands(brands, domain = 'vinted.co.uk', cacheDir, fs, path) {
  const lang = domain === 'vinted.fr' ? 'fr-FR,fr;q=0.9' : domain === 'vinted.de' ? 'de-DE,de;q=0.9' : domain === 'vinted.nl' ? 'nl-NL,nl;q=0.9' : 'en-GB,en;q=0.9';
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_EXEC,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    protocolTimeout: 60000,
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setExtraHTTPHeaders({ 'Accept-Language': lang });

    const { getToken } = await setupAuthCapture(page, domain);

    const needsAuth = domain === 'vinted.nl' || domain === 'vinted.de';
    const waitUntil = needsAuth ? 'networkidle2' : 'domcontentloaded';
    await page.goto(`https://www.${domain}`, { waitUntil, timeout: 60000 });
    await sleep(needsAuth ? 3000 : 2500);

    let authToken = null;
    if (needsAuth) {
      // Navigate to a real search page — this triggers vinted's JS auth flow so
      // CDP can capture the Bearer token from the page's own authenticated requests
      console.log(`   🔍 Warming auth via search page (${domain})...`);
      await page.goto(`https://www.${domain}/catalog?search_text=nike&order=newest_first`, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(4000);
      authToken = await getToken();
      if (authToken) console.log(`   🔑 Auth token captured (${domain})`);
      else console.log(`   ⚠️ No auth token captured (${domain}) — proceeding without`);
    } else {
      authToken = await getToken();
      if (authToken) console.log(`   🔑 Auth token captured (${domain})`);
    }

    const results = {};
    for (const brand of brands) {
      const items = [];
      try {
        for (let p = 1; p <= 5; p++) {
          const url = `https://www.${domain}/api/v2/catalog/items?page=${p}&per_page=96&search_text=${encodeURIComponent(brand.query)}`;
          const result = await page.evaluate(async (u, token) => {
            const headers = { Accept: 'application/json' };
            if (token) headers['Authorization'] = token;
            const r = await fetch(u, { headers });
            const text = await r.text();
            return { status: r.status, ok: r.ok, text };
          }, url, authToken);
          if (!result.ok) { console.log(`   ⚠️ API ${result.status} (${domain}) ${brand.name} p${p}: ${result.text.slice(0, 100)}`); break; }
          let data; try { data = JSON.parse(result.text); } catch { break; }
          if (!data?.items?.length) break;
          items.push(...data.items);
          await sleep(300);
        }
        const sorted = items
          .filter((v, i, a) => a.findIndex(x => x.id === v.id) === i)
          .map(i => { if (i.favourite_count == null) i.favourite_count = 0; return i; })
          .sort((a, b) => b.favourite_count - a.favourite_count);
        const cacheFile = path.join(cacheDir, `${brand.slug}.json`);
        fs.writeFileSync(cacheFile, JSON.stringify({ items: sorted, lastUpdated: new Date().toISOString() }));
        console.log(`  ✅ ${brand.name} (${domain.replace('vinted.', '')}): ${sorted.length} items`);
        results[brand.slug] = sorted;
      } catch (err) {
        console.error(`  ⚠️ ${brand.name} (${domain}) failed: ${err.message}`);
      }
      await sleep(1500);
    }
    return results;
  } finally {
    await browser.close();
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
