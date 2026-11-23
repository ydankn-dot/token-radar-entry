// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the
// model's own inputs and the protocol's farm plan, and a model sandbox that recomputes
// every implied value live. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var BASE = DATA.model;
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { base: BASE.base_multiple, up: BASE.growth_up_weight, down: BASE.growth_down_weight, floor: BASE.maturity_floor };
  function sandboxActive() {
    return sandbox.base !== BASE.base_multiple || sandbox.up !== BASE.growth_up_weight || sandbox.down !== BASE.growth_down_weight || sandbox.floor !== BASE.maturity_floor;
  }
  function sandboxModel() {
    return {
      base_multiple: sandbox.base, growth_up_weight: sandbox.up, growth_down_weight: sandbox.down,
      growth_floor: BASE.growth_floor, growth_cap: BASE.growth_cap, maturity_floor: sandbox.floor,
      maturity_range: BASE.maturity_range, maturity_days: BASE.maturity_days, unknown_age_days: BASE.unknown_age_days
    };
  }

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model in one function, radar-2: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. A fall in TVL weighs more than a rise of the same size, and maturity grows
  // with the square root of age, so the oldest protocol cannot win on age alone.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? model.growth_up_weight : model.growth_down_weight;
    var growthMult = 1 + (growth / 100) * weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity));
  }
  function multipliersOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var weight = growth >= 0 ? model.growth_up_weight : model.growth_down_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    return {
      growth: growth,
      growthMult: 1 + (growth / 100) * weight,
      maturityMult: model.maturity_floor + Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range
    };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  // Gas follows the chain the protocol names first, so an Ethereum farm costs more per step than a
  // Solana or Layer 2 one.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 'about $8';
    if (c === 'solana') return 'about $0.05';
    if (c === 'bsc' || c === 'bnb chain' || c === 'binance') return 'about $0.30';
    if (c === 'bitcoin') return 'about $2';
    var cheap = ['arbitrum', 'optimism', 'base', 'zksync', 'polygon', 'avalanche', 'fantom', 'linea', 'scroll', 'blast', 'mantle', 'mode', 'fraxtal'];
    for (var i = 0; i < cheap.length; i++) if (c.indexOf(cheap[i]) >= 0) return 'about $0.50';
    return 'about $2';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('aggregator') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-yield vault on " + chain + ' and keep the shares.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('vault') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('synthetic') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('privacy') >= 0) return 'Deposit $' + capital + ' through ' + name + "'s shielded pool on " + chain + ' and keep the receipt.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var action = actionFor(p, capital, chain);
    var second = p.chains && p.chains.length > 1 ? ' Repeat the position on ' + p.chains[1] + ' so the activity is counted on a second chain.' : ' Make a second, different action in the same app, such as a swap after the deposit.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'nothing to set up', time: '5 minutes' },
      { text: action, cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one more qualifying action in the same week.' + second, cost: gas + ' of gas', time: '10 minutes' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never leave the position empty.', cost: gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from the link it publishes and check the position is counted; never pay a fee to claim, and never trust a link from a chat or a search ad.", cost: 'no fee to check', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and unwind the position if the token launches or the protocol\'s TVL falls by a third; no token is guaranteed.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.watchlistOnly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  // The rows with the sandbox's implied values beside the board's, re-ranked when the
  // sandbox has moved: the sandbox never rewrites board.json, it only re-ranks the view.
  function effectiveRows(list) {
    var active = sandboxActive();
    var model = active ? sandboxModel() : BASE;
    var out = list.map(function (r) {
      var v = active ? impliedOf(r, model) : r.implied_value_usd;
      return { row: r, value: v };
    });
    out.sort(function (a, b) {
      return b.value - a.value || b.row.tvl_usd - a.row.tvl_usd || (a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0);
    });
    out.forEach(function (e, i) { e.rank = i + 1; });
    return out;
  }
  function sortedRows(list) {
    var eff = effectiveRows(list);
    var key = state.sort;
    return eff.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.row.name.toLowerCase(); bv = b.row.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.row.tvl_usd; bv = b.row.tvl_usd; }
      else if (key === 'growth') { av = a.row.change_7d === null ? -Infinity : a.row.change_7d; bv = b.row.change_7d === null ? -Infinity : b.row.change_7d; }
      else if (key === 'age') { av = a.row.age_days === null ? Infinity : a.row.age_days; bv = b.row.age_days === null ? Infinity : b.row.age_days; }
      else { av = a.value; bv = b.value; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { class: 'pill', text: 'Snapshot ' + DATA.as_of }),
        el('span', { class: 'pill', text: 'DefiLlama protocol index' }),
        el('span', { class: 'pill', text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar carries every other protocol the same rule keeps, at any size, so the board holds ' + DATA.board_size + ' pre-token rows. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wl = el('input', { type: 'checkbox', id: 'watchlist', checked: state.watchlistOnly ? 'checked' : null });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'watchlist' }, wl, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].value || 1;
    var tbody = el('tbody');
    list.forEach(function (e) {
      var r = e.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankShown = sandboxActive() ? e.rank : r.rank;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('span', { class: 'rank-badge' + (rankShown <= 3 ? ' top3' : ''), text: String(rankShown) })),
        el('td', null, el('div', { class: 'name' },
          el('div', { class: 'name-top' }, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'watch', text: 'watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((e.value / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(e.value) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: sandboxActive() ? 'Sandbox is live: ranks and values below are recomputed from your sliders. The board file keeps the radar-2 ranking.' : 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function slider(id, label, min, max, step, value, oninput) {
    var out = el('output', { for: id, text: String(value) });
    var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener('input', function () { out.textContent = input.value; oninput(parseFloat(input.value)); render(); });
    return el('div', null, el('label', { for: id }, label, out), input);
  }

  function modelPanel() {
    var m = DATA.model;
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x weight) x (' + m.maturity_floor + ' + sqrt(min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ') x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'Weight is ' + m.growth_up_weight + ' when seven-day growth is up and ' + m.growth_down_weight + ' when it is down: a fall weighs more than a rise of the same size. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'Move a slider and the board re-ranks at once from the same function. The sandbox never changes the board file: it shows how much the ranking depends on each constant.' }),
      el('div', { class: 'sandbox' },
        slider('sb-base', 'Base multiple', 0.1, 0.5, 0.05, sandbox.base, function (v) { sandbox.base = v; }),
        slider('sb-up', 'Growth weight, rising', 0, 0.8, 0.05, sandbox.up, function (v) { sandbox.up = v; }),
        slider('sb-down', 'Growth weight, falling', 0, 1, 0.05, sandbox.down, function (v) { sandbox.down = v; }),
        slider('sb-floor', 'Maturity floor', 0.4, 0.8, 0.05, sandbox.floor, function (v) { sandbox.floor = v; })
      ),
      el('p', { class: 'sandbox-note' },
        sandboxActive() ? 'Sandbox is live. ' : 'Sandbox is at the radar-2 constants. ',
        el('button', { class: 'button', type: 'button', text: 'Reset sandbox', onclick: function () { sandbox.base = BASE.base_multiple; sandbox.up = BASE.growth_up_weight; sandbox.down = BASE.growth_down_weight; sandbox.floor = BASE.maturity_floor; render(); } })
      )
    );
    return panel;
  }

  function asidePanel() {
    var s = DATA.set_aside;
    return el('section', { class: 'panel aside' },
      el('h2', { text: 'What the radar sets aside' }),
      el('p', { class: 'sub', text: 'The snapshot holds ' + s.total + ' pre-token protocols the watchlist rule leaves out, because each is a product of a token that already trades, or a version of another protocol, not a launch of its own. They are not ranked, and they are not worse subjects: the rule is the same at every size.' }),
      el('ul', null,
        el('li', { text: s.exchange + ' exchange product' + (s.exchange === 1 ? '' : 's') + ' (an exchange name, or the CEX category)' }),
        el('li', { text: s.bridge_family + ' bridged, staked or restaked product' + (s.bridge_family === 1 ? '' : 's') }),
        el('li', { text: s.versioned + ' versioned pool' + (s.versioned === 1 ? '' : 's') + ' (a name ending in a version marker)' }),
        el('li', { text: s.wrapped_or_staked + ' wrapped or staked product' + (s.wrapped_or_staked === 1 ? '' : 's') })
      ),
      el('p', { class: 'sub', text: 'Say a protocol records no token, never that it has none: a protocol on the list may still have a token its record does not carry.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var mults = multipliersOf(row, BASE);
    var recomputed = impliedOf(row, BASE);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + (row.watchlist ? ' - on the watchlist' : ' - below the watchlist floor') + (row.listed_at ? ' - listed ' + row.listed_at : '') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: mults.growthMult.toFixed(4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: mults.maturityMult.toFixed(4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number the board carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // The top-movers panel: the board's biggest seven-day gainers and losers, with the
  // implied value each move carries. The numbers come from data.js, computed by main.ts
  // from the snapshot's own change_7d figures, so the panel and the board agree; a
  // mover's share is its slice of the board's total implied value, and selecting a
  // mover opens the same detail view as selecting its row.
  function moverRow(m, up) {
    return el('li', null,
      el('button', { type: 'button', class: 'mover', onclick: function () { openDetail(m.slug); } },
        el('span', { class: 'mover-rank', text: '#' + m.rank }),
        el('span', { class: 'mover-name' },
          el('b', { text: m.name }),
          m.watchlist ? el('span', { class: 'watch', text: 'watchlist' }) : null,
          el('span', { class: 'sub', text: m.share_pct.toFixed(2) + '% of the board\u2019s implied value' })
        ),
        el('span', { class: 'num ' + (up ? 'pos' : 'neg'), text: fmtPct(m.change_7d) }),
        el('span', { class: 'num', text: fmtUsd(m.implied_value_usd) })
      )
    );
  }
  function moverList(title, note, movers, up) {
    return el('div', { class: 'movers-col' },
      el('h3', { text: title }),
      el('p', { class: 'sub', text: note }),
      el('ul', { class: 'movers' }, movers.map(function (m) { return moverRow(m, up); }))
    );
  }
  function moversPanel() {
    var mv = DATA.movers;
    if (!mv || (!mv.gainers.length && !mv.losers.length)) {
      return el('section', { class: 'panel movers-panel' },
        el('h2', { text: 'Top movers' }),
        el('p', { class: 'sub', text: 'No board row reports a seven-day change, so there is nothing to rank by move.' })
      );
    }
    return el('section', { class: 'panel movers-panel' },
      el('h2', { text: 'Top movers: the biggest seven-day moves' }),
      el('p', { class: 'sub', text: 'Five gainers and five losers by seven-day TVL change, each with the implied value the model gives it. A move is the snapshot\u2019s own figure; the implied value is the model\u2019s claim, not a price. Select a mover for its model and farm plan.' }),
      el('div', { class: 'movers-grid' },
        moverList('Biggest gainers', 'The five pre-token protocols whose TVL rose most in seven days.', mv.gainers, true),
        moverList('Biggest losers', 'The five pre-token protocols whose TVL fell most in seven days.', mv.losers, false)
      )
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(moversPanel());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(asidePanel());
    shell.appendChild(el('p', { class: 'note', text: 'Implied value is this radar\u2019s own claim from the snapshot\u2019s figures. It does not predict whether or when a token is issued, and a farm plan is not financial advice: a protocol may never issue a token, and farming can lose money.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('hashchange', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; state.tab = 'pre-token'; state.selected = null;
    readHash();
    render();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
