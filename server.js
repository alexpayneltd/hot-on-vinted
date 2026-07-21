import { config } from 'dotenv';
config({ quiet: true }); // load .env if present (ignored on Railway where env vars are set directly)

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { scrapeAll, scrapeSearch } from './scraper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'cache', 'all.json');
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

// In-memory search cache: term → { items, cachedAt }
const searchCache = new Map();
const SEARCH_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const pendingSearches = new Map(); // term → Promise (dedup concurrent requests)

app.use(express.static(path.join(__dirname, 'public')));

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

  // Serve from cache if fresh
  const cached = searchCache.get(term);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL) {
    return res.json({ items: cached.items, term, fromCache: true });
  }

  // Dedup concurrent identical searches
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

scrapeAll();
setInterval(scrapeAll, REFRESH_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`\n🔥 Hot on Vinted → http://localhost:${PORT}`);
  console.log(`   Refreshing every ${REFRESH_INTERVAL_MS / 60000} minutes\n`);
});
