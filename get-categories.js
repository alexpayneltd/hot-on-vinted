// Extracts subcategory links from each Vinted top-level category landing page.
// Usage: node get-categories.js

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';

puppeteer.use(StealthPlugin());

const TOP_LEVEL = [
  { id: 'women',         label: 'Women',                  url: 'https://www.vinted.co.uk/catalog/1904-women' },
  { id: 'men',           label: 'Men',                    url: 'https://www.vinted.co.uk/catalog/5-mens' },
  { id: 'kids',          label: 'Kids',                   url: 'https://www.vinted.co.uk/catalog/1193-children_new' },
  { id: 'home',          label: 'Home',                   url: 'https://www.vinted.co.uk/catalog/1918-home' },
  { id: 'electronics',   label: 'Electronics',            url: 'https://www.vinted.co.uk/catalog/2994-electronics' },
  { id: 'sports',        label: 'Sports',                 url: 'https://www.vinted.co.uk/catalog/4332-sports' },
  { id: 'entertainment', label: 'Entertainment',          url: 'https://www.vinted.co.uk/catalog/2309-entertainment' },
  { id: 'hobbies',       label: 'Hobbies & Collectables', url: 'https://www.vinted.co.uk/catalog/4824-hobbies_collectables' },
];

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-GB,en;q=0.9' });

console.log('🌐 Establishing session...');
await page.goto('https://www.vinted.co.uk', { waitUntil: 'domcontentloaded', timeout: 30000 });
await sleep(2000);

const tree = [];

for (const cat of TOP_LEVEL) {
  console.log(`\n📂 ${cat.label}`);
  await page.goto(cat.url, { waitUntil: 'networkidle2', timeout: 20000 });
  await sleep(1500);

  // Extract every unique catalog link on the page along with its label
  const links = await page.evaluate((parentUrl) => {
    const seen = new Set();
    return Array.from(document.querySelectorAll('a[href*="catalog"]'))
      .map(a => {
        const href = a.getAttribute('href') || '';
        const match = href.match(/catalog[/=](\d+)/);
        if (!match) return null;
        const id = match[1];
        const label = a.textContent.trim().replace(/\s+/g, ' ');
        if (!label || seen.has(id)) return null;
        seen.add(id);
        return { id, label, href: href.startsWith('http') ? href : 'https://www.vinted.co.uk' + href };
      })
      .filter(Boolean)
      // Exclude the page's own catalog ID (already in the URL we visited)
      .filter(l => !parentUrl.includes(`/${l.id}-`));
  }, cat.url);

  links.forEach(l => console.log(`  ${l.id.padEnd(6)} ${l.label}`));
  tree.push({ ...cat, subcategories: links });
  await sleep(800);
}

fs.writeFileSync('categories-verified.json', JSON.stringify(tree, null, 2));
console.log('\n✅ Saved to categories-verified.json');

await browser.close();
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
