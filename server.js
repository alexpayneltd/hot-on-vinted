import { config } from 'dotenv';
config({ quiet: true }); // load .env if present (ignored on Railway where env vars are set directly)

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { scrapeAll, scrapeSearch, scrapeBrandItems } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'cache', 'all.json');
const BRAND_CACHE_DIR = path.join(__dirname, 'cache', 'brands');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

if (!fs.existsSync(BRAND_CACHE_DIR)) fs.mkdirSync(BRAND_CACHE_DIR, { recursive: true });

// ── Brand config ───────────────────────────────────────────────────────────────
const BRANDS = [
  { slug: 'nike',        query: 'Nike',        name: 'Nike' },
  { slug: 'zara',        query: 'Zara',        name: 'Zara' },
  { slug: 'lululemon',   query: 'Lululemon',   name: 'Lululemon' },
  { slug: 'north-face',  query: 'North Face',  name: 'North Face' },
  { slug: 'asos',        query: 'ASOS',        name: 'ASOS' },
  { slug: 'hm',          query: 'H&M',         name: 'H&M' },
  { slug: 'adidas',      query: 'Adidas',      name: 'Adidas' },
  { slug: 'vintage',     query: 'Vintage',     name: 'Vintage' },
  { slug: 'levis',       query: "Levi's",      name: "Levi's" },
  { slug: 'topshop',     query: 'Topshop',     name: 'Topshop' },
  { slug: 'new-balance', query: 'New Balance', name: 'New Balance' },
  { slug: 'gymshark',    query: 'Gymshark',    name: 'Gymshark' },
];

// In-memory search cache: term → { items, cachedAt }
const searchCache = new Map();
const SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const pendingSearches = new Map(); // term → Promise (dedup concurrent requests)

// ── Server-side card rendering ─────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cardHTML(item) {
  const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
  const price = item.price ? `£${parseFloat(item.price.amount).toFixed(2)}` : '';
  const totalPrice = item.total_item_price ? `£${parseFloat(item.total_item_price.amount).toFixed(2)} inc. fees` : '';
  const pills = [item.size_title, item.status].filter(Boolean).map(p => `<span class="pill">${esc(p)}</span>`).join('');
  return `<a class="card" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">
    <div class="card-img-wrap">
      ${photo ? `<img class="card-img" src="${esc(photo)}" alt="${esc(item.title || '')}" loading="lazy">` : ''}
      <span class="like-badge">❤️ ${item.favourite_count}</span>
    </div>
    <div class="card-body">
      ${item.brand_title ? `<div class="card-brand">${esc(item.brand_title)}</div>` : ''}
      <div class="card-title">${esc(item.title || '')}</div>
      ${pills ? `<div class="card-meta">${pills}</div>` : ''}
    </div>
    <div class="card-footer">
      <span class="price">${price}</span>
      <span class="total-price">${totalPrice}</span>
    </div>
  </a>`;
}

// ── Brand page HTML template ───────────────────────────────────────────────────
function brandPageHTML(brand, items) {
  const chipsHTML = BRANDS.map(b =>
    `<a href="/${b.slug}" class="chip${b.slug === brand.slug ? ' active' : ''}">${esc(b.name)}</a>`
  ).join('\n        ');

  const mobileChipsHTML = BRANDS.map(b =>
    `<a href="/${b.slug}" class="chip">${esc(b.name)}</a>`
  ).join('\n    ');

  const gridHTML = items.length
    ? items.slice(0, 96).map(cardHTML).join('\n')
    : `<div class="empty"><h2>🤷</h2><p>No listings found right now — check back soon.</p></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Most liked ${esc(brand.name)} on Vinted UK | Hot on Vinted</title>
  <meta name="description" content="Browse the most liked ${esc(brand.name)} listings on Vinted UK right now, sorted by popularity. Find the best ${esc(brand.name)} deals on Vinted.">
  <link rel="canonical" href="https://hotonvinted.com/${brand.slug}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://hotonvinted.com/${brand.slug}">
  <meta property="og:title" content="Most liked ${esc(brand.name)} on Vinted UK | Hot on Vinted">
  <meta property="og:description" content="Browse the most liked ${esc(brand.name)} listings on Vinted UK right now, sorted by popularity.">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>

<header>
  <div class="header-inner">
    <a class="logo" href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> UK</span>
    </a>
    <div class="chips-header">
      <div class="chips">
        ${chipsHTML}
      </div>
    </div>
    <button class="burger-btn" id="burger-btn" aria-label="Browse brands">☰</button>
  </div>
  <div class="chips-mobile" id="chips-mobile">
    ${mobileChipsHTML}
  </div>
</header>

<div class="page-heading">
  <h1>Most liked ${esc(brand.name)} on Vinted UK</h1>
  <p>The most favourited ${esc(brand.name)} listings right now, updated every 30 minutes.</p>
</div>

<main class="grid-wrap">
  <div class="grid">
    ${gridHTML}
  </div>
</main>

<div class="footer-brands">
  <h3>Browse other brands</h3>
  <div class="chips">
    ${BRANDS.filter(b => b.slug !== brand.slug).map(b => `<a href="/${b.slug}" class="chip">${esc(b.name)}</a>`).join('\n    ')}
  </div>
</div>

<footer>
  <span>🔥 Hot on Vinted — not affiliated with Vinted UAB</span>
  <a href="/privacy" style="color:inherit;text-decoration:underline;">Privacy Policy</a>
</footer>

<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) {
      chipsMobile.classList.remove('open');
    }
  });
</script>
</body>
</html>`;
}

// ── Brand cache scraping ───────────────────────────────────────────────────────
async function scrapeAndCacheAllBrands() {
  console.log('\n🏷️  Starting brand cache scrape...');
  for (const brand of BRANDS) {
    const cacheFile = path.join(BRAND_CACHE_DIR, `${brand.slug}.json`);
    try {
      const items = await scrapeBrandItems(brand.query);
      fs.writeFileSync(cacheFile, JSON.stringify({ items, lastUpdated: new Date().toISOString() }));
      console.log(`  ✅ ${brand.name}: ${items.length} items`);
    } catch (err) {
      console.error(`  ⚠️ ${brand.name} failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log('🏷️  Brand cache complete\n');
}

// ── Static + API routes ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

app.get('/sitemap.xml', (req, res) => {
  const urls = [
    'https://hotonvinted.com/',
    ...BRANDS.map(b => `https://hotonvinted.com/${b.slug}`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u}</loc><changefreq>hourly</changefreq></url>`).join('\n')}
</urlset>`;
  res.set('Content-Type', 'application/xml').send(xml);
});

app.get('/api/listings', (req, res) => {
  if (!fs.existsSync(CACHE_FILE)) {
    return res.json({ items: [], lastUpdated: null, loading: true, message: 'Loading — check back in a minute.' });
  }
  try {
    res.json(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
  } catch {
    res.status(500).json({ error: 'Cache read error' });
  }
});

app.get('/api/search', async (req, res) => {
  const term = (req.query.q || '').trim().toLowerCase().slice(0, 100);
  if (!term) return res.json({ items: [], term });

  const cached = searchCache.get(term);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL) {
    return res.json({ items: cached.items, term, fromCache: true });
  }

  if (pendingSearches.has(term)) {
    try {
      const items = await pendingSearches.get(term);
      return res.json({ items, term });
    } catch {
      return res.status(500).json({ error: 'Search failed' });
    }
  }

  const promise = scrapeSearch(term);
  pendingSearches.set(term, promise);

  try {
    const items = await promise;
    searchCache.set(term, { items, cachedAt: Date.now() });
    res.json({ items, term });
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Search failed' });
  } finally {
    pendingSearches.delete(term);
  }
});

app.get('/api/status', (req, res) => {
  if (!fs.existsSync(CACHE_FILE)) return res.json({ cached: false });
  const { lastUpdated, total } = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  res.json({ cached: true, lastUpdated, total });
});

// ── Brand pages (SSR) ─────────────────────────────────────────────────────────
for (const brand of BRANDS) {
  app.get(`/${brand.slug}`, (req, res) => {
    const cacheFile = path.join(BRAND_CACHE_DIR, `${brand.slug}.json`);
    let items = [];
    if (fs.existsSync(cacheFile)) {
      try { items = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).items || []; } catch {}
    }
    res.send(brandPageHTML(brand, items));
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────
scrapeAll().then(() => scrapeAndCacheAllBrands());
setInterval(() => scrapeAll().then(() => scrapeAndCacheAllBrands()), REFRESH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`\n🔥 Hot on Vinted → http://localhost:${PORT}`);
  console.log(`   Refreshing every ${REFRESH_INTERVAL_MS / 60000} minutes\n`);
});
