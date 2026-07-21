(function () {
  if (document.getElementById('hov')) { document.getElementById('hov').remove(); return; }

  const CATS = [
    { l: '✨ All', c: null },
    { l: '👗 Women', c: '1904' },
    { l: '👔 Men', c: '4' },
    { l: '👶 Kids', c: '1231' },
    { l: '🏠 Home', c: '12' },
    { l: '📚 Books', c: '7' },
    { l: '⚽ Sports', c: '206' },
    { l: '💄 Beauty', c: '2050' },
  ];

  let cat = null, search = '', items = [], loading = false;

  const root = document.createElement('div');
  root.id = 'hov';
  root.innerHTML = `<style>
#hov{position:fixed;inset:0;background:#f5f5f5;z-index:2147483647;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a}
#hov-hd{position:sticky;top:0;background:#fff;border-bottom:1px solid #e0e0e0;padding:0 20px;display:flex;align-items:center;gap:12px;height:56px;z-index:1}
.hov-logo{font-size:1.2rem;font-weight:800;white-space:nowrap}
.hov-logo b{color:#ff6b35}
#hov-srch{flex:1;max-width:360px;padding:8px 14px;border:1.5px solid #e0e0e0;border-radius:999px;font-size:.875rem;outline:none;font-family:inherit}
#hov-srch:focus{border-color:#ff6b35}
#hov-x{margin-left:auto;background:none;border:none;font-size:1.5rem;cursor:pointer;color:#757575;line-height:1;padding:0 4px}
#hov-cats{background:#fff;border-bottom:1px solid #e0e0e0;padding:8px 20px;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
#hov-cats::-webkit-scrollbar{display:none}
.hov-cat{padding:6px 14px;border-radius:999px;border:1.5px solid #e0e0e0;background:none;cursor:pointer;font-size:.82rem;font-weight:500;white-space:nowrap;font-family:inherit}
.hov-cat:hover{border-color:#ff6b35;color:#ff6b35}
.hov-cat.on{background:#ff6b35;border-color:#ff6b35;color:#fff}
#hov-st{padding:12px 20px;font-size:.83rem;color:#757575}
#hov-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;padding:0 20px 40px}
.hov-c{background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e0e0e0;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:transform .15s,box-shadow .15s}
.hov-c:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,.1)}
.hov-iw{position:relative;aspect-ratio:3/4;overflow:hidden;background:#f0f0f0}
.hov-img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.hov-c:hover .hov-img{transform:scale(1.04)}
.hov-lk{position:absolute;top:8px;right:8px;background:rgba(255,255,255,.92);border-radius:999px;padding:3px 8px;font-size:.75rem;font-weight:700;color:#e53935}
.hov-bd{padding:10px;flex:1}
.hov-br{font-size:.7rem;font-weight:600;text-transform:uppercase;color:#757575;margin-bottom:2px}
.hov-ti{font-size:.84rem;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.3}
.hov-ft{padding:0 10px 10px;display:flex;justify-content:space-between;align-items:baseline}
.hov-pr{font-weight:700;font-size:.95rem}
.hov-sz{font-size:.72rem;color:#757575}
.hov-sk{background:linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%);background-size:200%;animation:hov-sh 1.2s infinite;border-radius:10px;aspect-ratio:3/4}
@keyframes hov-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
</style>
<div id="hov-hd">
  <span class="hov-logo">🔥 Hot on <b>Vinted</b></span>
  <input id="hov-srch" type="text" placeholder="Search brand, item…">
  <button id="hov-x">×</button>
</div>
<div id="hov-cats"></div>
<div id="hov-st">Loading…</div>
<div id="hov-grid"></div>`;

  document.body.appendChild(root);
  root.querySelector('#hov-x').onclick = () => root.remove();

  let st;
  root.querySelector('#hov-srch').oninput = e => {
    clearTimeout(st);
    st = setTimeout(() => { search = e.target.value.trim(); fetchAll(); }, 500);
  };

  const catsEl = root.querySelector('#hov-cats');
  CATS.forEach(({ l, c }, i) => {
    const btn = document.createElement('button');
    btn.className = 'hov-cat' + (i === 0 ? ' on' : '');
    btn.textContent = l;
    btn.onclick = () => {
      root.querySelectorAll('.hov-cat').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      cat = c; fetchAll();
    };
    catsEl.appendChild(btn);
  });

  async function fetchPage(page) {
    const p = new URLSearchParams({ page, per_page: '96' });
    if (cat) p.append('catalog[]', cat);
    if (search) p.set('search_text', search);
    try {
      const r = await fetch('/api/v2/catalog/items?' + p, { headers: { 'Accept': 'application/json' } });
      return r.ok ? r.json() : null;
    } catch (e) { return null; }
  }

  async function fetchAll() {
    if (loading) return;
    loading = true; items = [];
    const grid = root.querySelector('#hov-grid');
    const status = root.querySelector('#hov-st');
    grid.innerHTML = Array(12).fill('<div class="hov-sk"></div>').join('');
    status.textContent = 'Fetching listings…';

    const first = await fetchPage(1);
    if (!first) {
      status.textContent = 'Could not fetch listings — make sure you are on vinted.co.uk and logged in.';
      grid.innerHTML = ''; loading = false; return;
    }
    const total = Math.min(first.pagination?.total_pages ?? 1, 10);
    items.push(...(first.items ?? []));

    const rest = Array.from({ length: total - 1 }, (_, i) => i + 2);
    for (let b = 0; b < rest.length; b += 4) {
      const results = await Promise.all(rest.slice(b, b + 4).map(p => fetchPage(p)));
      results.forEach(r => r && items.push(...(r.items ?? [])));
      status.textContent = `Fetched ${Math.min(1 + b + 4, total)} of ${total} pages…`;
    }

    const seen = new Set();
    items = items.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
    items.sort((a, b) => b.favourite_count - a.favourite_count);

    const liked = items.filter(i => i.favourite_count > 0);
    status.textContent = liked.length + ' listings with likes · sorted by ❤️';

    grid.innerHTML = liked.map(item => {
      const photo = item.photo?.thumbnails?.find(t => t.type === 'thumb310x430')?.url || item.photo?.url || '';
      const price = item.price ? '£' + parseFloat(item.price.amount).toFixed(2) : '';
      return '<a class="hov-c" href="' + e(item.url) + '" target="_blank" rel="noopener">' +
        '<div class="hov-iw">' +
        (photo ? '<img class="hov-img" src="' + e(photo) + '" loading="lazy" alt="">' : '') +
        '<span class="hov-lk">❤️ ' + item.favourite_count + '</span>' +
        '</div><div class="hov-bd">' +
        (item.brand_title ? '<div class="hov-br">' + e(item.brand_title) + '</div>' : '') +
        '<div class="hov-ti">' + e(item.title || '') + '</div>' +
        '</div><div class="hov-ft"><span class="hov-pr">' + price + '</span>' +
        '<span class="hov-sz">' + e(item.size_title || '') + '</span></div></a>';
    }).join('');
    loading = false;
  }

  function e(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  fetchAll();
})();
