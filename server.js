import { config } from 'dotenv';
config({ quiet: true });

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { scrapeAll, scrapeSearch, scrapeBrandItems } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// ── Cache paths ────────────────────────────────────────────────────────────────
const CACHE = {
  uk: {
    all:    path.join(__dirname, 'cache', 'all.json'),
    brands: path.join(__dirname, 'cache', 'brands'),
  },
  fr: {
    all:    path.join(__dirname, 'cache', 'fr', 'all.json'),
    brands: path.join(__dirname, 'cache', 'fr', 'brands'),
  },
  de: {
    all:    path.join(__dirname, 'cache', 'de', 'all.json'),
    brands: path.join(__dirname, 'cache', 'de', 'brands'),
  },
};
for (const c of Object.values(CACHE)) {
  if (!fs.existsSync(c.brands)) fs.mkdirSync(c.brands, { recursive: true });
}

// ── Brand configs ──────────────────────────────────────────────────────────────
const UK_BRANDS = [
  { slug: 'most-liked-nike-vinted-uk',        oldSlug: 'nike',        query: 'Nike',        name: 'Nike' },
  { slug: 'most-liked-zara-vinted-uk',        oldSlug: 'zara',        query: 'Zara',        name: 'Zara' },
  { slug: 'most-liked-lululemon-vinted-uk',   oldSlug: 'lululemon',   query: 'Lululemon',   name: 'Lululemon' },
  { slug: 'most-liked-north-face-vinted-uk',  oldSlug: 'north-face',  query: 'North Face',  name: 'North Face' },
  { slug: 'most-liked-asos-vinted-uk',        oldSlug: 'asos',        query: 'ASOS',        name: 'ASOS' },
  { slug: 'most-liked-hm-vinted-uk',          oldSlug: 'hm',          query: 'H&M',         name: 'H&M' },
  { slug: 'most-liked-adidas-vinted-uk',      oldSlug: 'adidas',      query: 'Adidas',      name: 'Adidas' },
  { slug: 'most-liked-vintage-vinted-uk',     oldSlug: 'vintage',     query: 'Vintage',     name: 'Vintage' },
  { slug: 'most-liked-levis-vinted-uk',       oldSlug: 'levis',       query: "Levi's",      name: "Levi's" },
  { slug: 'most-liked-topshop-vinted-uk',     oldSlug: 'topshop',     query: 'Topshop',     name: 'Topshop' },
  { slug: 'most-liked-new-balance-vinted-uk', oldSlug: 'new-balance', query: 'New Balance', name: 'New Balance' },
  { slug: 'most-liked-gymshark-vinted-uk',    oldSlug: 'gymshark',    query: 'Gymshark',    name: 'Gymshark' },
];

const FR_BRANDS = [
  { slug: 'most-liked-nike-vinted-fr',        query: 'Nike',        name: 'Nike' },
  { slug: 'most-liked-zara-vinted-fr',        query: 'Zara',        name: 'Zara' },
  { slug: 'most-liked-hm-vinted-fr',          query: 'H&M',         name: 'H&M' },
  { slug: 'most-liked-adidas-vinted-fr',      query: 'Adidas',      name: 'Adidas' },
  { slug: 'most-liked-levis-vinted-fr',       query: "Levi's",      name: "Levi's" },
  { slug: 'most-liked-lacoste-vinted-fr',     query: 'Lacoste',     name: 'Lacoste' },
  { slug: 'most-liked-sezane-vinted-fr',      query: 'Sézane',      name: 'Sézane' },
  { slug: 'most-liked-maje-vinted-fr',        query: 'Maje',        name: 'Maje' },
  { slug: 'most-liked-vintage-vinted-fr',     query: 'Vintage',     name: 'Vintage' },
  { slug: 'most-liked-new-balance-vinted-fr', query: 'New Balance', name: 'New Balance' },
  { slug: 'most-liked-north-face-vinted-fr',  query: 'North Face',  name: 'North Face' },
  { slug: 'most-liked-lululemon-vinted-fr',   query: 'Lululemon',   name: 'Lululemon' },
];

const DE_BRANDS = [
  { slug: 'most-liked-nike-vinted-de',          query: 'Nike',           name: 'Nike' },
  { slug: 'most-liked-adidas-vinted-de',        query: 'Adidas',         name: 'Adidas' },
  { slug: 'most-liked-zara-vinted-de',          query: 'Zara',           name: 'Zara' },
  { slug: 'most-liked-hm-vinted-de',            query: 'H&M',            name: 'H&M' },
  { slug: 'most-liked-levis-vinted-de',         query: "Levi's",         name: "Levi's" },
  { slug: 'most-liked-puma-vinted-de',          query: 'Puma',           name: 'Puma' },
  { slug: 'most-liked-hugo-boss-vinted-de',     query: 'Hugo Boss',      name: 'Hugo Boss' },
  { slug: 'most-liked-vintage-vinted-de',       query: 'Vintage',        name: 'Vintage' },
  { slug: 'most-liked-new-balance-vinted-de',   query: 'New Balance',    name: 'New Balance' },
  { slug: 'most-liked-tommy-hilfiger-vinted-de',query: 'Tommy Hilfiger', name: 'Tommy Hilfiger' },
  { slug: 'most-liked-jack-jones-vinted-de',    query: 'Jack & Jones',   name: 'Jack & Jones' },
  { slug: 'most-liked-s-oliver-vinted-de',      query: 's.Oliver',       name: 's.Oliver' },
];

// ── In-memory search caches (per country) ─────────────────────────────────────
const searchCaches    = { uk: new Map(), fr: new Map(), de: new Map() };
const pendingSearches = { uk: new Map(), fr: new Map(), de: new Map() };
const SEARCH_CACHE_TTL = 30 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cardHTML(item, currency = '£') {
  const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
  const price = item.price ? `${currency}${parseFloat(item.price.amount).toFixed(2)}` : '';
  const totalPrice = item.total_item_price ? `${currency}${parseFloat(item.total_item_price.amount).toFixed(2)} inc. fees` : '';
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

function countrySwitcher(active) {
  const flag = active === 'fr' ? '🇫🇷' : active === 'de' ? '🇩🇪' : '🇬🇧';
  return `<div class="country-switcher">
      <button class="country-current" id="country-btn" aria-label="Select country">${flag}</button>
      <div class="country-dropdown" id="country-dropdown">
        <a href="/uk" class="country-option${active === 'uk' ? ' active' : ''}">🇬🇧 United Kingdom</a>
        <a href="/fr" class="country-option${active === 'fr' ? ' active' : ''}">🇫🇷 France</a>
        <a href="/de" class="country-option${active === 'de' ? ' active' : ''}">🇩🇪 Deutschland</a>
      </div>
    </div>`;
}

// ── UK brand page HTML ─────────────────────────────────────────────────────────
function ukBrandPageHTML(brand, items) {
  const chipsHTML = UK_BRANDS.map(b =>
    `<a href="/${b.slug}" class="chip${b.slug === brand.slug ? ' active' : ''}">${esc(b.name)}</a>`
  ).join('\n        ');
  const mobileChipsHTML = UK_BRANDS.map(b =>
    `<a href="/${b.slug}" class="chip">${esc(b.name)}</a>`
  ).join('\n    ');
  const gridHTML = items.length
    ? items.slice(0, 96).map(i => cardHTML(i, '£')).join('\n')
    : `<div class="empty"><h2>🤷</h2><p>No listings found right now — check back soon.</p></div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Most liked ${brand.name} on Vinted UK`,
    description: `The most favourited ${brand.name} listings on Vinted UK right now, sorted by popularity.`,
    url: `https://hotonvinted.com/${brand.slug}`,
    itemListElement: items.slice(0, 20).map((item, i) => {
      const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
      const price = item.price ? parseFloat(item.price.amount).toFixed(2) : null;
      return {
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'Product', name: item.title || '', url: item.url || '',
          ...(photo ? { image: photo } : {}),
          ...(price ? { offers: { '@type': 'Offer', price, priceCurrency: 'GBP', availability: 'https://schema.org/InStock' } } : {}),
        },
      };
    }),
  };

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
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header>
  <div class="header-inner">
    <a class="logo" href="/uk" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> UK</span>
    </a>
    <div class="chips-header">
      <div class="chips">
        ${chipsHTML}
      </div>
    </div>
    ${countrySwitcher('uk')}
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
  <div class="grid">${gridHTML}</div>
</main>
<footer>
  <span>🔥 Hot on Vinted — not affiliated with Vinted UAB</span>
  <a href="/privacy" style="color:inherit;text-decoration:underline;">Privacy Policy</a>
</footer>
<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) chipsMobile.classList.remove('open');
  });
  const countryBtn = document.getElementById('country-btn');
  const countryDropdown = document.getElementById('country-dropdown');
  countryBtn.addEventListener('click', e => { e.stopPropagation(); countryDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => countryDropdown.classList.remove('open'));
</script>
</body>
</html>`;
}

// ── France homepage HTML ───────────────────────────────────────────────────────
function frHomeHTML() {
  const chipsHTML = FR_BRANDS.map(b =>
    `<a href="/fr/${b.slug}" class="chip" data-q="${esc(b.query)}">${esc(b.name)}</a>`
  ).join('\n        ');

  const mobileOrder = ['Nike','Zara','H&M','Maje',"Levi's",'Adidas','Vintage','Sézane','Lacoste','Lululemon','North Face','New Balance'];
  const mobileChipsHTML = mobileOrder.map(name => {
    const b = FR_BRANDS.find(x => x.name === name);
    return b ? `<a href="/fr/${b.slug}" class="chip" data-q="${esc(b.query)}">${esc(b.name)}</a>` : '';
  }).filter(Boolean).join('\n    ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hot on Vinted France — Les articles les plus likés</title>
  <meta name="description" content="Découvrez les articles les plus likés sur Vinted France, triés par popularité. Recherchez une marque pour trouver ses articles les plus aimés.">
  <link rel="canonical" href="https://hotonvinted.com/fr">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://hotonvinted.com/fr">
  <meta property="og:title" content="Hot on Vinted France — Les articles les plus likés">
  <meta property="og:description" content="Découvrez les articles les plus likés sur Vinted France, triés par popularité.">
  <meta property="og:site_name" content="Hot on Vinted">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <div class="header-inner">
    <a class="logo" href="/fr" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> FR</span>
    </a>
    <div class="chips-header">
      <div class="chips" id="chips">
        ${chipsHTML}
      </div>
    </div>
    ${countrySwitcher('fr')}
    <button class="burger-btn" id="burger-btn" aria-label="Parcourir les marques">☰</button>
  </div>
  <div class="chips-mobile" id="chips-mobile">
    ${mobileChipsHTML}
  </div>
</header>

<div class="search-section">
  <div class="search-wrap">
    <span class="search-icon">🔍</span>
    <input type="text" id="search-input" placeholder="Rechercher une marque, article ou catégorie…" autocomplete="off">
  </div>
</div>

<div class="status-bar">
  <span class="status-text" id="status-text">Chargement…</span>
</div>

<main class="grid-wrap">
  <div class="grid" id="grid"></div>
</main>
<div class="grid-wrap" style="margin-top:0">
  <div class="grid" id="grid2"></div>
</div>

<footer>
  <span>🔥 Hot on Vinted — non affilié à Vinted UAB</span>
  <span style="display:flex;gap:16px;align-items:center;">
    <a href="/privacy" style="color:inherit;text-decoration:underline;">Politique de confidentialité</a>
    <span id="footer-updated"></span>
  </span>
</footer>

<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  chipsMobile.addEventListener('click', e => {
    if (e.target.classList.contains('chip')) chipsMobile.classList.remove('open');
  });
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) chipsMobile.classList.remove('open');
  });

  let homeItems = [];
  let currentTerm = '';
  let searchTimer;
  let activeSearch = null;

  async function loadListings() {
    const grid = document.getElementById('grid');
    const grid2 = document.getElementById('grid2');
    const status = document.getElementById('status-text');
    if (currentTerm) return;
    if (!homeItems.length) {
      grid.innerHTML = Array(20).fill('<div class="skeleton"></div>').join('');
      grid2.innerHTML = '';
    }
    try {
      const res = await fetch('/fr/api/listings');
      const data = await res.json();
      if (data.loading) {
        status.innerHTML = '';
        grid.innerHTML = '<div class="empty"><h2>⏳</h2><p>' + data.message + '</p></div>';
        setTimeout(loadListings, 30000);
        return;
      }
      homeItems = data.items || [];
      if (data.lastUpdated) {
        const d = new Date(data.lastUpdated);
        document.getElementById('footer-updated').textContent = 'Mis à jour : ' + d.toLocaleTimeString('fr-FR');
      }
      renderHome();
    } catch {
      status.innerHTML = 'Erreur de chargement.';
      grid.innerHTML = '<div class="empty"><h2>😬</h2><p>Impossible de charger les annonces.</p></div>';
    }
  }

  function renderHome() {
    const status = document.getElementById('status-text');
    status.innerHTML = 'Une sélection des articles les <strong>plus likés</strong> sur Vinted France — 🔍 recherchez une marque pour en trouver plus';
    if (!homeItems.length) {
      document.getElementById('grid').innerHTML = '<div class="empty"><h2>🤷</h2><p>Aucune annonce pour l\\'instant.</p></div>';
      document.getElementById('grid2').innerHTML = '';
      return;
    }
    document.getElementById('grid').innerHTML = homeItems.slice(0, 100).map(cardHTML).join('');
    document.getElementById('grid2').innerHTML = '';
  }

  function setActiveChip(q) {
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.q === q));
  }

  function handleChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.q) return;
    e.preventDefault();
    const q = chip.dataset.q;
    document.getElementById('search-input').value = q;
    clearTimeout(searchTimer);
    currentTerm = q;
    setActiveChip(q);
    runSearch(q);
  }
  document.getElementById('chips').addEventListener('click', handleChipClick);
  document.getElementById('chips-mobile').addEventListener('click', handleChipClick);

  async function runSearch(term) {
    const status = document.getElementById('status-text');
    const grid = document.getElementById('grid');
    const grid2 = document.getElementById('grid2');
    if (activeSearch) activeSearch.abort();
    const ctrl = new AbortController();
    activeSearch = ctrl;
    status.innerHTML = '🔍 Recherche des articles <strong>' + esc(term) + '</strong> les plus likés sur Vinted…';
    grid.innerHTML = Array(20).fill('<div class="skeleton"></div>').join('');
    grid2.innerHTML = '';
    try {
      const res = await fetch('/fr/api/search?q=' + encodeURIComponent(term), { signal: ctrl.signal });
      const data = await res.json();
      if (ctrl.signal.aborted) return;
      const items = data.items || [];
      status.innerHTML = items.length
        ? '<strong>' + items.length + '</strong> résultats pour <strong>' + esc(term) + '</strong> — triés par les plus likés'
        : 'Aucun résultat pour <strong>' + esc(term) + '</strong>. Essayez une autre marque.';
      grid.innerHTML = items.slice(0, 100).map(cardHTML).join('');
      grid2.innerHTML = items.slice(100).map(cardHTML).join('');
    } catch (err) {
      if (err.name === 'AbortError') return;
      status.innerHTML = 'Recherche échouée — réessayez dans un instant.';
      grid.innerHTML = '<div class="empty"><h2>😬</h2><p>Recherche échouée.</p></div>';
    } finally {
      if (activeSearch === ctrl) activeSearch = null;
    }
  }

  function clearSearch() {
    currentTerm = '';
    if (activeSearch) { activeSearch.abort(); activeSearch = null; }
    setActiveChip(null);
    renderHome();
  }

  function cardHTML(item) {
    const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
    const price = item.price ? '€' + parseFloat(item.price.amount).toFixed(2) : '';
    const totalPrice = item.total_item_price ? '€' + parseFloat(item.total_item_price.amount).toFixed(2) + ' frais inclus' : '';
    const pills = [item.size_title, item.status].filter(Boolean).map(p => '<span class="pill">' + esc(p) + '</span>').join('');
    return '<a class="card" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">'
      + '<div class="card-img-wrap">'
      + (photo ? '<img class="card-img" src="' + esc(photo) + '" alt="' + esc(item.title || '') + '" loading="lazy">' : '')
      + '<span class="like-badge">❤️ ' + item.favourite_count + '</span>'
      + '</div><div class="card-body">'
      + (item.brand_title ? '<div class="card-brand">' + esc(item.brand_title) + '</div>' : '')
      + '<div class="card-title">' + esc(item.title || '') + '</div>'
      + (pills ? '<div class="card-meta">' + pills + '</div>' : '')
      + '</div><div class="card-footer">'
      + '<span class="price">' + price + '</span>'
      + '<span class="total-price">' + totalPrice + '</span>'
      + '</div></a>';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    setActiveChip(null);
    if (!val) { clearSearch(); return; }
    searchTimer = setTimeout(() => { currentTerm = val; runSearch(currentTerm); }, 600);
  });

  loadListings();
  setInterval(() => { if (!currentTerm) loadListings(); }, 5 * 60 * 1000);

  const countryBtn = document.getElementById('country-btn');
  const countryDropdown = document.getElementById('country-dropdown');
  countryBtn.addEventListener('click', e => { e.stopPropagation(); countryDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => countryDropdown.classList.remove('open'));
</script>
</body>
</html>`;
}

// ── France brand page HTML ─────────────────────────────────────────────────────
function frBrandPageHTML(brand, items) {
  const chipsHTML = FR_BRANDS.map(b =>
    `<a href="/fr/${b.slug}" class="chip${b.slug === brand.slug ? ' active' : ''}">${esc(b.name)}</a>`
  ).join('\n        ');
  const mobileChipsHTML = FR_BRANDS.map(b =>
    `<a href="/fr/${b.slug}" class="chip">${esc(b.name)}</a>`
  ).join('\n    ');
  const gridHTML = items.length
    ? items.slice(0, 96).map(i => cardHTML(i, '€')).join('\n')
    : `<div class="empty"><h2>🤷</h2><p>Aucune annonce pour l'instant — revenez bientôt.</p></div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${brand.name} les plus likés sur Vinted France`,
    description: `Les annonces ${brand.name} les plus likées sur Vinted France, triées par popularité.`,
    url: `https://hotonvinted.com/fr/${brand.slug}`,
    itemListElement: items.slice(0, 20).map((item, i) => {
      const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
      const price = item.price ? parseFloat(item.price.amount).toFixed(2) : null;
      return {
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'Product', name: item.title || '', url: item.url || '',
          ...(photo ? { image: photo } : {}),
          ...(price ? { offers: { '@type': 'Offer', price, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } } : {}),
        },
      };
    }),
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(brand.name)} les plus likés sur Vinted France | Hot on Vinted</title>
  <meta name="description" content="Découvrez les annonces ${esc(brand.name)} les plus likées sur Vinted France, triées par popularité.">
  <link rel="canonical" href="https://hotonvinted.com/fr/${brand.slug}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://hotonvinted.com/fr/${brand.slug}">
  <meta property="og:title" content="${esc(brand.name)} les plus likés sur Vinted France | Hot on Vinted">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header>
  <div class="header-inner">
    <a class="logo" href="/fr" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> FR</span>
    </a>
    <div class="chips-header">
      <div class="chips">
        ${chipsHTML}
      </div>
    </div>
    ${countrySwitcher('fr')}
    <button class="burger-btn" id="burger-btn" aria-label="Parcourir les marques">☰</button>
  </div>
  <div class="chips-mobile" id="chips-mobile">
    ${mobileChipsHTML}
  </div>
</header>
<div class="page-heading">
  <h1>${esc(brand.name)} les plus likés sur Vinted France</h1>
  <p>Les annonces ${esc(brand.name)} les plus likées, mises à jour toutes les 30 minutes.</p>
</div>
<main class="grid-wrap">
  <div class="grid">${gridHTML}</div>
</main>
<footer>
  <span>🔥 Hot on Vinted — non affilié à Vinted UAB</span>
  <a href="/privacy" style="color:inherit;text-decoration:underline;">Politique de confidentialité</a>
</footer>
<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) chipsMobile.classList.remove('open');
  });
  const countryBtn = document.getElementById('country-btn');
  const countryDropdown = document.getElementById('country-dropdown');
  countryBtn.addEventListener('click', e => { e.stopPropagation(); countryDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => countryDropdown.classList.remove('open'));
</script>
</body>
</html>`;
}

// ── Germany homepage HTML ──────────────────────────────────────────────────────
function deHomeHTML() {
  const chipsHTML = DE_BRANDS.map(b =>
    `<a href="/de/${b.slug}" class="chip" data-q="${esc(b.query)}">${esc(b.name)}</a>`
  ).join('\n        ');

  const mobileOrder = ['H&M','Nike','Zara','Puma',"Levi's",'Adidas','Vintage','s.Oliver','Hugo Boss','New Balance','Jack & Jones','Tommy Hilfiger'];
  const mobileChipsHTML = mobileOrder.map(name => {
    const b = DE_BRANDS.find(x => x.name === name);
    return b ? `<a href="/de/${b.slug}" class="chip" data-q="${esc(b.query)}">${esc(b.name)}</a>` : '';
  }).filter(Boolean).join('\n    ');

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hot on Vinted Deutschland — Die beliebtesten Artikel</title>
  <meta name="description" content="Entdecke die beliebtesten Artikel auf Vinted Deutschland, sortiert nach Popularität. Suche nach einer Marke, um ihre meistgemochten Artikel zu finden.">
  <link rel="canonical" href="https://hotonvinted.com/de">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://hotonvinted.com/de">
  <meta property="og:title" content="Hot on Vinted Deutschland — Die beliebtesten Artikel">
  <meta property="og:description" content="Entdecke die beliebtesten Artikel auf Vinted Deutschland, sortiert nach Popularität.">
  <meta property="og:site_name" content="Hot on Vinted">
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
<header>
  <div class="header-inner">
    <a class="logo" href="/de" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> DE</span>
    </a>
    <div class="chips-header">
      <div class="chips" id="chips">
        ${chipsHTML}
      </div>
    </div>
    ${countrySwitcher('de')}
    <button class="burger-btn" id="burger-btn" aria-label="Marken durchsuchen">☰</button>
  </div>
  <div class="chips-mobile" id="chips-mobile">
    ${mobileChipsHTML}
  </div>
</header>

<div class="search-section">
  <div class="search-wrap">
    <span class="search-icon">🔍</span>
    <input type="text" id="search-input" placeholder="Marke, Artikel oder Kategorie suchen…" autocomplete="off">
  </div>
</div>

<div class="status-bar">
  <span class="status-text" id="status-text">Laden…</span>
</div>

<main class="grid-wrap">
  <div class="grid" id="grid"></div>
</main>
<div class="grid-wrap" style="margin-top:0">
  <div class="grid" id="grid2"></div>
</div>

<footer>
  <span>🔥 Hot on Vinted — nicht verbunden mit Vinted UAB</span>
  <span style="display:flex;gap:16px;align-items:center;">
    <a href="/privacy" style="color:inherit;text-decoration:underline;">Datenschutz</a>
    <span id="footer-updated"></span>
  </span>
</footer>

<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  chipsMobile.addEventListener('click', e => {
    if (e.target.classList.contains('chip')) chipsMobile.classList.remove('open');
  });
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) chipsMobile.classList.remove('open');
  });
  const countryBtn = document.getElementById('country-btn');
  const countryDropdown = document.getElementById('country-dropdown');
  countryBtn.addEventListener('click', e => { e.stopPropagation(); countryDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => countryDropdown.classList.remove('open'));

  let homeItems = [];
  let currentTerm = '';
  let searchTimer;
  let activeSearch = null;

  async function loadListings() {
    const grid = document.getElementById('grid');
    const grid2 = document.getElementById('grid2');
    const status = document.getElementById('status-text');
    if (currentTerm) return;
    if (!homeItems.length) {
      grid.innerHTML = Array(20).fill('<div class="skeleton"></div>').join('');
      grid2.innerHTML = '';
    }
    try {
      const res = await fetch('/de/api/listings');
      const data = await res.json();
      if (data.loading) {
        status.innerHTML = '';
        grid.innerHTML = '<div class="empty"><h2>⏳</h2><p>' + data.message + '</p></div>';
        setTimeout(loadListings, 30000);
        return;
      }
      homeItems = data.items || [];
      if (data.lastUpdated) {
        const d = new Date(data.lastUpdated);
        document.getElementById('footer-updated').textContent = 'Aktualisiert: ' + d.toLocaleTimeString('de-DE');
      }
      renderHome();
    } catch {
      status.innerHTML = 'Fehler beim Laden.';
      grid.innerHTML = '<div class="empty"><h2>😬</h2><p>Artikel konnten nicht geladen werden.</p></div>';
    }
  }

  function renderHome() {
    const status = document.getElementById('status-text');
    status.innerHTML = 'Eine Auswahl der <strong>beliebtesten</strong> Artikel auf Vinted Deutschland — 🔍 suche nach einer Marke für mehr';
    if (!homeItems.length) {
      document.getElementById('grid').innerHTML = '<div class="empty"><h2>🤷</h2><p>Noch keine Artikel.</p></div>';
      document.getElementById('grid2').innerHTML = '';
      return;
    }
    document.getElementById('grid').innerHTML = homeItems.slice(0, 100).map(cardHTML).join('');
    document.getElementById('grid2').innerHTML = '';
  }

  function setActiveChip(q) {
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.q === q));
  }

  function handleChipClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.q) return;
    e.preventDefault();
    const q = chip.dataset.q;
    document.getElementById('search-input').value = q;
    clearTimeout(searchTimer);
    currentTerm = q;
    setActiveChip(q);
    runSearch(q);
  }
  document.getElementById('chips').addEventListener('click', handleChipClick);
  document.getElementById('chips-mobile').addEventListener('click', handleChipClick);

  async function runSearch(term) {
    const status = document.getElementById('status-text');
    const grid = document.getElementById('grid');
    const grid2 = document.getElementById('grid2');
    if (activeSearch) activeSearch.abort();
    const ctrl = new AbortController();
    activeSearch = ctrl;
    status.innerHTML = '🔍 Suche nach den beliebtesten <strong>' + esc(term) + '</strong>-Artikeln auf Vinted…';
    grid.innerHTML = Array(20).fill('<div class="skeleton"></div>').join('');
    grid2.innerHTML = '';
    try {
      const res = await fetch('/de/api/search?q=' + encodeURIComponent(term), { signal: ctrl.signal });
      const data = await res.json();
      if (ctrl.signal.aborted) return;
      const items = data.items || [];
      status.innerHTML = items.length
        ? '<strong>' + items.length + '</strong> Ergebnisse für <strong>' + esc(term) + '</strong> — sortiert nach beliebtesten'
        : 'Keine Ergebnisse für <strong>' + esc(term) + '</strong>. Versuche eine andere Marke.';
      grid.innerHTML = items.slice(0, 100).map(cardHTML).join('');
      grid2.innerHTML = items.slice(100).map(cardHTML).join('');
    } catch (err) {
      if (err.name === 'AbortError') return;
      status.innerHTML = 'Suche fehlgeschlagen — bitte erneut versuchen.';
      grid.innerHTML = '<div class="empty"><h2>😬</h2><p>Suche fehlgeschlagen.</p></div>';
    } finally {
      if (activeSearch === ctrl) activeSearch = null;
    }
  }

  function clearSearch() {
    currentTerm = '';
    if (activeSearch) { activeSearch.abort(); activeSearch = null; }
    setActiveChip(null);
    renderHome();
  }

  function cardHTML(item) {
    const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
    const price = item.price ? '€' + parseFloat(item.price.amount).toFixed(2) : '';
    const totalPrice = item.total_item_price ? '€' + parseFloat(item.total_item_price.amount).toFixed(2) + ' inkl. Gebühren' : '';
    const pills = [item.size_title, item.status].filter(Boolean).map(p => '<span class="pill">' + esc(p) + '</span>').join('');
    return '<a class="card" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">'
      + '<div class="card-img-wrap">'
      + (photo ? '<img class="card-img" src="' + esc(photo) + '" alt="' + esc(item.title || '') + '" loading="lazy">' : '')
      + '<span class="like-badge">❤️ ' + item.favourite_count + '</span>'
      + '</div><div class="card-body">'
      + (item.brand_title ? '<div class="card-brand">' + esc(item.brand_title) + '</div>' : '')
      + '<div class="card-title">' + esc(item.title || '') + '</div>'
      + (pills ? '<div class="card-meta">' + pills + '</div>' : '')
      + '</div><div class="card-footer">'
      + '<span class="price">' + price + '</span>'
      + '<span class="total-price">' + totalPrice + '</span>'
      + '</div></a>';
  }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    const val = e.target.value.trim();
    setActiveChip(null);
    if (!val) { clearSearch(); return; }
    searchTimer = setTimeout(() => { currentTerm = val; runSearch(currentTerm); }, 600);
  });

  loadListings();
  setInterval(() => { if (!currentTerm) loadListings(); }, 5 * 60 * 1000);
</script>
</body>
</html>`;
}

// ── Germany brand page HTML ────────────────────────────────────────────────────
function deBrandPageHTML(brand, items) {
  const chipsHTML = DE_BRANDS.map(b =>
    `<a href="/de/${b.slug}" class="chip${b.slug === brand.slug ? ' active' : ''}">${esc(b.name)}</a>`
  ).join('\n        ');
  const mobileChipsHTML = DE_BRANDS.map(b =>
    `<a href="/de/${b.slug}" class="chip">${esc(b.name)}</a>`
  ).join('\n    ');
  const gridHTML = items.length
    ? items.slice(0, 96).map(i => cardHTML(i, '€')).join('\n')
    : `<div class="empty"><h2>🤷</h2><p>Gerade keine Artikel — schau bald wieder vorbei.</p></div>`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${brand.name} beliebteste Artikel auf Vinted Deutschland`,
    description: `Die beliebtesten ${brand.name}-Artikel auf Vinted Deutschland, sortiert nach Popularität.`,
    url: `https://hotonvinted.com/de/${brand.slug}`,
    itemListElement: items.slice(0, 20).map((item, i) => {
      const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
      const price = item.price ? parseFloat(item.price.amount).toFixed(2) : null;
      return {
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'Product', name: item.title || '', url: item.url || '',
          ...(photo ? { image: photo } : {}),
          ...(price ? { offers: { '@type': 'Offer', price, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } } : {}),
        },
      };
    }),
  };

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(brand.name)} beliebteste Artikel auf Vinted Deutschland | Hot on Vinted</title>
  <meta name="description" content="Entdecke die beliebtesten ${esc(brand.name)}-Artikel auf Vinted Deutschland, sortiert nach Popularität.">
  <link rel="canonical" href="https://hotonvinted.com/de/${brand.slug}">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://hotonvinted.com/de/${brand.slug}">
  <meta property="og:title" content="${esc(brand.name)} beliebteste Artikel auf Vinted Deutschland | Hot on Vinted">
  <link rel="stylesheet" href="/styles.css">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<header>
  <div class="header-inner">
    <a class="logo" href="/de" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <img src="/logo.png" alt="Hot on Vinted" style="height:40px;width:40px;border-radius:50%;object-fit:cover;flex-shrink:0;">
      <span style="font-size:1.2rem;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a;">Hot on <span style="color:#09b1ba;">Vinted</span> DE</span>
    </a>
    <div class="chips-header">
      <div class="chips">
        ${chipsHTML}
      </div>
    </div>
    ${countrySwitcher('de')}
    <button class="burger-btn" id="burger-btn" aria-label="Marken durchsuchen">☰</button>
  </div>
  <div class="chips-mobile" id="chips-mobile">
    ${mobileChipsHTML}
  </div>
</header>
<div class="page-heading">
  <h1>${esc(brand.name)} beliebteste Artikel auf Vinted Deutschland</h1>
  <p>Die beliebtesten ${esc(brand.name)}-Artikel, alle 30 Minuten aktualisiert.</p>
</div>
<main class="grid-wrap">
  <div class="grid">${gridHTML}</div>
</main>
<footer>
  <span>🔥 Hot on Vinted — nicht verbunden mit Vinted UAB</span>
  <a href="/privacy" style="color:inherit;text-decoration:underline;">Datenschutz</a>
</footer>
<script>
  const burgerBtn = document.getElementById('burger-btn');
  const chipsMobile = document.getElementById('chips-mobile');
  burgerBtn.addEventListener('click', () => chipsMobile.classList.toggle('open'));
  document.addEventListener('click', e => {
    if (!burgerBtn.contains(e.target) && !chipsMobile.contains(e.target)) chipsMobile.classList.remove('open');
  });
  const countryBtn = document.getElementById('country-btn');
  const countryDropdown = document.getElementById('country-dropdown');
  countryBtn.addEventListener('click', e => { e.stopPropagation(); countryDropdown.classList.toggle('open'); });
  document.addEventListener('click', () => countryDropdown.classList.remove('open'));
</script>
</body>
</html>`;
}

// ── Brand cache scraping ───────────────────────────────────────────────────────
async function scrapeAndCacheAllBrands(country = 'uk') {
  const brands   = country === 'fr' ? FR_BRANDS : country === 'de' ? DE_BRANDS : UK_BRANDS;
  const domain   = country === 'fr' ? 'vinted.fr' : country === 'de' ? 'vinted.de' : 'vinted.co.uk';
  const cacheDir = CACHE[country].brands;
  console.log(`\n🏷️  Brand cache scrape (${country.toUpperCase()})...`);
  for (const brand of brands) {
    const cacheFile = path.join(cacheDir, `${brand.slug}.json`);
    try {
      const items = await scrapeBrandItems(brand.query, 5, domain);
      fs.writeFileSync(cacheFile, JSON.stringify({ items, lastUpdated: new Date().toISOString() }));
      console.log(`  ✅ ${brand.name} (${country}): ${items.length} items`);
    } catch (err) {
      console.error(`  ⚠️ ${brand.name} (${country}) failed: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`🏷️  Brand cache complete (${country.toUpperCase()})\n`);
}

// ── Root: geo-detect and dispatch ─────────────────────────────────────────────
app.get('/', (req, res) => {
  const cfCountry = req.headers['cf-ipcountry'];
  if (cfCountry === 'FR') return res.redirect(302, '/fr');
  if (cfCountry === 'DE') return res.redirect(302, '/de');
  const primaryLang = (req.headers['accept-language'] || '').split(',')[0].toLowerCase().trim();
  if (primaryLang.startsWith('fr')) return res.redirect(302, '/fr');
  if (primaryLang.startsWith('de')) return res.redirect(302, '/de');
  res.redirect(302, '/uk');
});

// ── UK homepage ────────────────────────────────────────────────────────────────
app.get('/uk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Static + shared routes ─────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

// ── Sitemap (UK + FR) ──────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const now = new Date().toISOString().split('T')[0];
  const readLastmod = (f) => {
    if (!fs.existsSync(f)) return now;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')).lastUpdated?.split('T')[0] || now; } catch { return now; }
  };
  const urlEntries = [
    { loc: 'https://hotonvinted.com/uk', lastmod: now },
    { loc: 'https://hotonvinted.com/fr', lastmod: now },
    ...UK_BRANDS.map(b => ({ loc: `https://hotonvinted.com/${b.slug}`,    lastmod: readLastmod(path.join(CACHE.uk.brands, `${b.slug}.json`)) })),
    ...FR_BRANDS.map(b => ({ loc: `https://hotonvinted.com/fr/${b.slug}`, lastmod: readLastmod(path.join(CACHE.fr.brands, `${b.slug}.json`)) })),
    ...DE_BRANDS.map(b => ({ loc: `https://hotonvinted.com/de/${b.slug}`, lastmod: readLastmod(path.join(CACHE.de.brands, `${b.slug}.json`)) })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.map(u => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><changefreq>hourly</changefreq></url>`).join('\n')}
</urlset>`;
  res.set('Content-Type', 'application/xml').send(xml);
});

// ── UK API ─────────────────────────────────────────────────────────────────────
app.get('/api/listings', (req, res) => {
  if (!fs.existsSync(CACHE.uk.all)) return res.json({ items: [], lastUpdated: null, loading: true, message: 'Loading — check back in a minute.' });
  try { res.json(JSON.parse(fs.readFileSync(CACHE.uk.all, 'utf8'))); } catch { res.status(500).json({ error: 'Cache read error' }); }
});

app.get('/api/search', async (req, res) => {
  const term = (req.query.q || '').trim().toLowerCase().slice(0, 100);
  if (!term) return res.json({ items: [], term });
  const cached = searchCaches.uk.get(term);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL) return res.json({ items: cached.items, term, fromCache: true });
  if (pendingSearches.uk.has(term)) {
    try { return res.json({ items: await pendingSearches.uk.get(term), term }); } catch { return res.status(500).json({ error: 'Search failed' }); }
  }
  const promise = scrapeSearch(term, 5, 'vinted.co.uk');
  pendingSearches.uk.set(term, promise);
  try {
    const items = await promise;
    searchCaches.uk.set(term, { items, cachedAt: Date.now() });
    res.json({ items, term });
  } catch { res.status(500).json({ error: 'Search failed' }); }
  finally { pendingSearches.uk.delete(term); }
});

app.get('/api/status', (req, res) => {
  if (!fs.existsSync(CACHE.uk.all)) return res.json({ cached: false });
  const { lastUpdated, total } = JSON.parse(fs.readFileSync(CACHE.uk.all, 'utf8'));
  res.json({ cached: true, lastUpdated, total });
});

// ── UK brand pages ─────────────────────────────────────────────────────────────
for (const brand of UK_BRANDS) {
  if (brand.oldSlug) app.get(`/${brand.oldSlug}`, (req, res) => res.redirect(301, `/${brand.slug}`));
  app.get(`/${brand.slug}`, (req, res) => {
    const cacheFile = path.join(CACHE.uk.brands, `${brand.slug}.json`);
    let items = [];
    if (fs.existsSync(cacheFile)) { try { items = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).items || []; } catch {} }
    res.send(ukBrandPageHTML(brand, items));
  });
}

// ── Germany homepage ───────────────────────────────────────────────────────────
app.get('/de', (req, res) => res.send(deHomeHTML()));

// ── Germany API ────────────────────────────────────────────────────────────────
app.get('/de/api/listings', (req, res) => {
  if (!fs.existsSync(CACHE.de.all)) return res.json({ items: [], lastUpdated: null, loading: true, message: 'Wird geladen — komm in einer Minute wieder.' });
  try { res.json(JSON.parse(fs.readFileSync(CACHE.de.all, 'utf8'))); } catch { res.status(500).json({ error: 'Cache read error' }); }
});

app.get('/de/api/search', async (req, res) => {
  const term = (req.query.q || '').trim().toLowerCase().slice(0, 100);
  if (!term) return res.json({ items: [], term });
  const cached = searchCaches.de.get(term);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL) return res.json({ items: cached.items, term, fromCache: true });
  if (pendingSearches.de.has(term)) {
    try { return res.json({ items: await pendingSearches.de.get(term), term }); } catch { return res.status(500).json({ error: 'Search failed' }); }
  }
  const promise = scrapeSearch(term, 5, 'vinted.de');
  pendingSearches.de.set(term, promise);
  try {
    const items = await promise;
    searchCaches.de.set(term, { items, cachedAt: Date.now() });
    res.json({ items, term });
  } catch { res.status(500).json({ error: 'Search failed' }); }
  finally { pendingSearches.de.delete(term); }
});

app.get('/de/api/status', (req, res) => {
  if (!fs.existsSync(CACHE.de.all)) return res.json({ cached: false });
  const { lastUpdated, total } = JSON.parse(fs.readFileSync(CACHE.de.all, 'utf8'));
  res.json({ cached: true, lastUpdated, total });
});

// ── Germany brand pages ────────────────────────────────────────────────────────
for (const brand of DE_BRANDS) {
  app.get(`/de/${brand.slug}`, (req, res) => {
    const cacheFile = path.join(CACHE.de.brands, `${brand.slug}.json`);
    let items = [];
    if (fs.existsSync(cacheFile)) { try { items = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).items || []; } catch {} }
    res.send(deBrandPageHTML(brand, items));
  });
}

// ── France homepage ────────────────────────────────────────────────────────────
app.get('/fr', (req, res) => res.send(frHomeHTML()));

// ── France API ─────────────────────────────────────────────────────────────────
app.get('/fr/api/listings', (req, res) => {
  if (!fs.existsSync(CACHE.fr.all)) return res.json({ items: [], lastUpdated: null, loading: true, message: 'Chargement — revenez dans une minute.' });
  try { res.json(JSON.parse(fs.readFileSync(CACHE.fr.all, 'utf8'))); } catch { res.status(500).json({ error: 'Cache read error' }); }
});

app.get('/fr/api/search', async (req, res) => {
  const term = (req.query.q || '').trim().toLowerCase().slice(0, 100);
  if (!term) return res.json({ items: [], term });
  const cached = searchCaches.fr.get(term);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL) return res.json({ items: cached.items, term, fromCache: true });
  if (pendingSearches.fr.has(term)) {
    try { return res.json({ items: await pendingSearches.fr.get(term), term }); } catch { return res.status(500).json({ error: 'Search failed' }); }
  }
  const promise = scrapeSearch(term, 5, 'vinted.fr');
  pendingSearches.fr.set(term, promise);
  try {
    const items = await promise;
    searchCaches.fr.set(term, { items, cachedAt: Date.now() });
    res.json({ items, term });
  } catch { res.status(500).json({ error: 'Search failed' }); }
  finally { pendingSearches.fr.delete(term); }
});

app.get('/fr/api/status', (req, res) => {
  if (!fs.existsSync(CACHE.fr.all)) return res.json({ cached: false });
  const { lastUpdated, total } = JSON.parse(fs.readFileSync(CACHE.fr.all, 'utf8'));
  res.json({ cached: true, lastUpdated, total });
});

// ── France brand pages ─────────────────────────────────────────────────────────
for (const brand of FR_BRANDS) {
  app.get(`/fr/${brand.slug}`, (req, res) => {
    const cacheFile = path.join(CACHE.fr.brands, `${brand.slug}.json`);
    let items = [];
    if (fs.existsSync(cacheFile)) { try { items = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).items || []; } catch {} }
    res.send(frBrandPageHTML(brand, items));
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────
async function startScraping() {
  await scrapeAll('vinted.co.uk', CACHE.uk.all);
  await scrapeAndCacheAllBrands('uk');
  await scrapeAll('vinted.fr', CACHE.fr.all);
  await scrapeAndCacheAllBrands('fr');
  await scrapeAll('vinted.de', CACHE.de.all);
  await scrapeAndCacheAllBrands('de');
}

startScraping();
setInterval(startScraping, REFRESH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`\n🔥 Hot on Vinted → http://localhost:${PORT}`);
  console.log(`   Refreshing every ${REFRESH_INTERVAL_MS / 60000} minutes\n`);
});
