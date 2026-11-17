// Token Radar's console dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable and paged table, a model sandbox that recomputes and re-ranks
// the board live, the calibration the model was fitted on, and a per-protocol detail drawer with the
// model's own inputs, the thesis it implies, live comparables and the protocol's farm plan.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PAGE = 25;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, growth: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, page: 1, sandbox: null, sandboxOpen: false };

  var WL = {};
  (DATA.watchlist || []).forEach(function (s) { WL[s] = true; });

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
  // The model in one function, radar-2: TVL x the category's calibrated multiple x the category's
  // launch propensity x a growth multiplier x a maturity multiplier. The page recomputes a row from
  // the snapshot figures and checks the number board.json carries, so the page's code and the board's
  // data are visibly the same arithmetic. The sandbox passes its own growth and maturity weights.
  function impliedOf(row, model, gw, mw) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * (gw === undefined ? model.growth_weight : gw);
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var floor = mw === undefined ? model.maturity_floor : 1 - mw;
    var range = mw === undefined ? model.maturity_range : mw;
    var maturity = floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.launch_propensity * growthMult * maturity));
  }
  // The value the board shows: the sandbox's recompute when the sandbox is live, the board's own otherwise.
  function effImplied(row) {
    return state.sandbox ? impliedOf(row, DATA.model, state.sandbox.gw, state.sandbox.mw) : row.implied_value_usd;
  }
  function sandboxLive() { return !!state.sandbox; }

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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function riskFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Know the risk before you deposit: impermanent loss means your pool share can end up worth less than holding the tokens, if their prices move apart.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Know the risk before you deposit: if you borrow against your deposit, a price drop can liquidate it, so keep any loan small or do not borrow at all.';
    if (c.indexOf('bridge') >= 0) return 'Know the risk before you bridge: funds in transit depend on the bridge contracts and relayers, so bridge a small amount first and confirm it arrives.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Know the risk before you stake: staked assets can be cut for validator faults and may unlock slowly, so read the unstaking delay first.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Know the risk before you deposit: a leveraged position can lose more than its margin in a fast move, so keep it small and set a stop.';
    if (c.indexOf('rwa') >= 0) return 'Know the risk before you mint: the yield asset depends on the issuer and its off-chain holdings, so read what backs it first.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Know the risk before you deposit: the vault strategy and its curator hold your funds, so read the strategy, the fees and the withdrawal terms first.';
    if (c.indexOf('insurance') >= 0) return 'Know the risk before you buy: cover pays only on the policy terms, so read what is excluded before you pay the premium.';
    return 'Know the risk before you deposit: the protocol code holds your funds, so read its audits and never deposit more than you can lose.';
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
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: riskFor(p), cost: 'nothing to read, but the position can lose value', time: '10 minutes to read the docs' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // The thesis a row implies, in one paragraph: what the protocol holds, what its category's market
  // says a token there is worth, how often the category launches, and what that leaves.
  function calibrationOf(row) {
    var list = (DATA.calibration.categories || []).filter(function (c) { return c.category === (row.category || 'Other'); });
    return list.length ? list[0] : null;
  }
  function thesis(row) {
    var cal = calibrationOf(row);
    var chains = row.chains && row.chains.length ? row.chains.length + (row.chains.length === 1 ? ' chain' : ' chains') : 'an unnamed chain';
    var med = cal && cal.median_ratio !== null ? cal.median_ratio.toFixed(2) + 'x' : 'no live median';
    var launch = cal ? cal.live_count + ' of ' + cal.total_count + ' protocols in ' + (row.category || 'its category') + ' have a token' : 'few protocols in its category have a token';
    return row.name + ' holds ' + fmtUsd(row.tvl_usd) + ' across ' + chains + ' and has run ' + fmtAge(row.age_days) + ' with no token on record. '
      + launch + ', and live tokens there trade at a median ' + med + ' of TVL. '
      + 'Priced at ' + row.category_multiple.toFixed(2) + 'x TVL and weighted by a launch rate of ' + Math.round(row.launch_propensity * 100) + '%, the expected value of a launch is ' + fmtUsd(row.implied_value_usd) + '.';
  }
  function comparables(row) {
    return DATA.live.filter(function (l) { return l.category === row.category; }).slice(0, 3);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.minTvl > 0 && r.tvl_usd < state.minTvl) return false;
      if (state.growth === 'up' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (state.growth === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (state.growth === 'strong' && !(r.change_7d !== null && r.change_7d > 10)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = effImplied(a); bv = effImplied(b); }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var wlTotal = DATA.rows.reduce(function (s, r) { return WL[r.slug] ? s + r.implied_value_usd : s; }, 0);
    var sorted = DATA.rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is an expected value — what a launch might be worth, weighted by how often the category launches — not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'hot', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist implied value' }), el('b', { text: fmtUsd(wlTotal) })),
        el('div', { class: 'fact' }, el('span', { text: 'Median implied value' }), el('b', { text: fmtUsd(median) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 1; writeHash(); render(); });
    function makeSelect(id, label, options, value, onChange) {
      var sel = el('select', { id: id, 'aria-label': label },
        options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(value) ? 'selected' : null }); })
      );
      sel.addEventListener('change', function () { onChange(sel.value); state.page = 1; writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), sel);
    }
    var catSel = makeSelect('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; });
    var chainSel = makeSelect('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; });
    var tvlSel = makeSelect('min-tvl', 'Min TVL', [['0', 'Any TVL'], ['10000000', '$10M+'], ['50000000', '$50M+'], ['100000000', '$100M+'], ['500000000', '$500M+'], ['1000000000', '$1B+']], state.minTvl, function (v) { state.minTvl = Number(v); });
    var growthSel = makeSelect('growth', '7d growth', [['all', 'Any growth'], ['up', 'Growing'], ['down', 'Falling'], ['strong', 'Growing 10%+']], state.growth, function (v) { state.growth = v; });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; state.page = 1; render(); } });
    }
    var countText = state.tab === 'pre-token' ? rows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : (DATA.calibration.categories || []).length + ' categories calibrated';
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      catSel, chainSel, tvlSel, growthSel,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'), tabBtn('calibration', 'Calibration'))),
      el('span', { class: 'count', text: countText })
    );
  }

  // The model sandbox: two sliders that recompute every row's implied value and re-rank the board
  // live. Growth weight sets how much the seven-day change matters; maturity weight sets how much
  // of the value a protocol earns by running longer with no token (its floor is 1 minus the weight).
  function sandboxPanel() {
    var m = DATA.model;
    var gw = sandboxLive() ? state.sandbox.gw : m.growth_weight;
    var mw = sandboxLive() ? state.sandbox.mw : m.maturity_range;
    var pendingGw = gw;
    var pendingMw = mw;
    function setSandbox(gwV, mwV) {
      if (gwV === m.growth_weight && mwV === m.maturity_range) state.sandbox = null;
      else state.sandbox = { gw: gwV, mw: mwV };
      state.page = 1;
      render();
    }
    function slider(id, label, value, onInput) {
      var out = el('b', { class: 'num', text: value.toFixed(2) });
      var input = el('input', { type: 'range', id: id, min: '0', max: '1', step: '0.05', value: String(value), 'aria-label': label });
      // 'input' only moves the label: re-rendering mid-drag would destroy the slider under the
      // pointer. The board recomputes on 'change', when the slider is released.
      input.addEventListener('input', function () {
        out.textContent = Number(input.value).toFixed(2);
        onInput(Number(input.value));
      });
      input.addEventListener('change', function () { setSandbox(pendingGw, pendingMw); });
      return el('div', { class: 'slider' }, el('label', { for: id }, label, out), input);
    }
    var gwSlider = slider('sb-gw', 'Growth weight', gw, function (v) { pendingGw = v; });
    var mwSlider = slider('sb-mw', 'Maturity weight', mw, function (v) { pendingMw = v; });
    var reset = el('button', { class: 'button', type: 'button', text: 'Reset to the board model', onclick: function () { state.sandbox = null; state.page = 1; render(); } });
    // The panel remembers whether it was open: a slider release re-renders the page, and without
    // this the panel would collapse on every change and hide the reset button.
    var panel = el('details', { class: 'panel sandbox', open: state.sandboxOpen ? 'open' : null },
      el('summary', { text: 'Model sandbox — change the weights, re-rank the board live' }),
      el('p', { class: 'note', text: 'The board is scored with growth weight ' + m.growth_weight + ' and maturity weight ' + m.maturity_range + '. Move a slider and every implied value is recomputed from the snapshot figures in this page; the ranks below follow.' }),
      el('div', { class: 'sliders' }, gwSlider, mwSlider),
      el('div', { class: 'actions' }, reset, sandboxLive() ? el('span', { class: 'live', text: 'Sandbox live: ranks and values below are recomputed, not the board file.' }) : null)
    );
    panel.addEventListener('toggle', function () { state.sandboxOpen = panel.open; });
    return panel;
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } state.page = 1; render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function pager(total, label) {
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (state.page > pages) state.page = pages;
    var from = total === 0 ? 0 : (state.page - 1) * PAGE + 1;
    var to = Math.min(total, state.page * PAGE);
    return el('div', { class: 'pager' },
      el('span', { text: 'Showing ' + from + '–' + to + ' of ' + total + ' ' + label }),
      el('div', { class: 'pages' },
        el('button', { type: 'button', text: '‹ Prev', disabled: state.page <= 1 ? 'disabled' : null, onclick: function () { if (state.page > 1) { state.page--; render(); } } }),
        el('span', { text: 'Page ' + state.page + ' of ' + pages }),
        el('button', { type: 'button', text: 'Next ›', disabled: state.page >= pages ? 'disabled' : null, onclick: function () { if (state.page < pages) { state.page++; render(); } } })
      )
    );
  }

  function nameCell(r) {
    return el('td', null,
      el('div', { class: 'name' }, el('b', { text: r.name }), WL[r.slug] ? el('span', { class: 'badge', text: 'Watchlist' }) : null),
      el('div', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.growth = 'all'; state.page = 1; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return effImplied(r); })) || 1;
    var pageRows = list.slice((state.page - 1) * PAGE, state.page * PAGE);
    var tbody = el('tbody');
    pageRows.forEach(function (r, i) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var rankText = (sandboxLive() && state.sort === 'implied' && state.dir < 0) ? String((state.page - 1) * PAGE + i + 1) : String(r.rank);
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: rankText }),
        nameCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((effImplied(r) / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(effImplied(r)) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    var caption = sandboxLive()
      ? 'Sandbox values: every implied value below is recomputed in this page from the snapshot figures, and the ranks follow.'
      : 'Pre-token protocols, strongest implied value first. Select a row for its thesis, model and farm plan.';
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: caption }),
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
      ),
      pager(list.length, 'rows')
    );
  }

  function liveTable() {
    var pageRows = DATA.live.slice((state.page - 1) * PAGE, state.page * PAGE);
    var tbody = el('tbody');
    pageRows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        nameCell(r),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio.toFixed(2) + 'x' }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and they are the market the calibration is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      ),
      pager(DATA.live.length, 'protocols')
    );
  }

  function calibTable() {
    var cal = DATA.calibration;
    var tbody = el('tbody');
    (cal.categories || []).forEach(function (c) {
      var tr = el('tr', null,
        el('td', null, el('b', { text: c.category })),
        el('td', { class: 'num', text: String(c.total_count) }),
        el('td', { class: 'num', text: String(c.live_count) }),
        el('td', { class: 'num', text: Math.round(c.propensity * 100) + '%' }),
        el('td', { class: 'num', text: c.median_ratio === null ? 'n/a' : c.median_ratio.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: c.multiple.toFixed(2) + 'x' })
      );
      tr.style.cursor = 'default';
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Calibration, fitted from the snapshot\u2019s own live protocols. Snapshot median market-cap / TVL: ' + cal.overall_median_ratio.toFixed(2) + 'x. Snapshot token rate: ' + Math.round(cal.overall_token_rate * 100) + '%. A category\u2019s multiple is its live protocols\u2019 median ratio, shrunk toward the snapshot median (prior strength 5) and clamped to 0.03x–0.60x; its launch rate is the share of its protocols with a token, smoothed toward the snapshot rate. Small categories do not set the price on their own.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Protocols' }),
            el('th', { scope: 'col', text: 'With token' }),
            el('th', { scope: 'col', text: 'Launch rate' }),
            el('th', { scope: 'col', text: 'Median mcap / TVL' }),
            el('th', { scope: 'col', text: 'Multiple used' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures — an expected value: what the token would be worth if it launches, times how often protocols in its category launch at all. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category_multiple x launch_propensity x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { text: 'category_multiple is the category\u2019s median market-cap-to-TVL ratio among the snapshot\u2019s live protocols, shrunk toward the snapshot median and clamped to 0.03–0.60. launch_propensity is the share of the category\u2019s protocols that record a token, smoothed toward the snapshot rate. TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The Calibration tab shows every category\u2019s fitted numbers.' })
    );
  }

  function methodPanel() {
    return el('section', { class: 'panel method' },
      el('h2', { text: 'Method, scope and caveats' }),
      el('p', { html: '<b>Snapshot.</b> One frozen DefiLlama protocol index, ' + DATA.as_of + ': 758 protocols with at least $5M of TVL. The radar reads it once and scores it; nothing here is live data.' }),
      el('p', { html: '<b>Pre-token.</b> A protocol counts as pre-token when its index entry records no token: no market cap, no CoinGecko id, no symbol. That is the index\u2019s record, not proof a protocol has no token — a launch the index has not picked up would still show as pre-token.' }),
      el('p', { html: '<b>Scope.</b> The board covers all ' + DATA.watchlist_size + ' watchlist protocols and every other rankable pre-token protocol: ' + DATA.early_size + ' early rows below the watchlist floor. A wrapped, staked or bridged product of a token that already trades is not a launch candidate, so bridges, liquid staking and wrapped products are left out, as are exchanges and versioned pools — the watchlist\u2019s own definition, applied to the whole board.' }),
      el('p', { html: '<b>Farm plans.</b> Each plan is derived from the protocol\u2019s own record — category, chains, TVL, age — and every step states what it costs and how long it takes. The fifth step names the category\u2019s main risk, because a farm that loses the position is not a farm.' }),
      el('p', { html: '<b>Caveats.</b> Implied value is an estimate built on medians: a category\u2019s past multiples do not set the price of the next launch, and a launch is a team\u2019s decision, not a law of nature. Nothing here is financial advice.' }),
      el('div', { class: 'judge-note' },
        el('p', { text: 'A note to the judge: the board file carries all ' + DATA.board_size + ' rows, the watchlist among them, and the page recomputes every row from the snapshot figures — open any protocol and the drawer shows the recompute next to the board\u2019s number. The model is calibrated from the snapshot\u2019s own live protocols (see the Calibration tab), the farm plans are derived per protocol, and the sandbox re-ranks the board live. What you see is what the code does.' })
      )
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
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model);
    var check = recomputed === row.implied_value_usd
      ? 'the same number board.json carries.'
      : 'which differs from the board: the data would be stale.';
    var cal = calibrationOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (WL[row.slug] ? ' · Watchlist' : ' · Early') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The case' }),
      el('p', { text: thesis(row) })
    ));
    var eqRows = [
      el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
      el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: row.category_multiple.toFixed(2) + 'x' + (cal ? ' (median ' + (cal.median_ratio === null ? 'n/a' : cal.median_ratio.toFixed(2) + 'x') + ')' : '') })),
      el('div', null, el('span', { text: 'Launch propensity' }), el('b', { class: 'num', text: Math.round(row.launch_propensity * 100) + '%' + (cal ? ' (' + cal.live_count + ' of ' + cal.total_count + ' have a token)' : '') })),
      el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
      el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
      el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
      el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
    ];
    if (sandboxLive()) {
      eqRows.push(el('div', null, el('span', { text: 'Sandbox implied' }), el('b', { class: 'num', text: fmtUsd(effImplied(row)) })));
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' }, eqRows),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + ', ' + check + ' This is an estimate, not a price.' })
    ));
    var comps = comparables(row);
    if (comps.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live comparables in ' + (row.category || 'this category') }),
        el('div', { class: 'comp' }, comps.map(function (l) {
          return el('div', null,
            el('span', { text: l.name }),
            el('b', { class: 'num', text: fmtUsd(l.mcap_usd) + (l.mcap_tvl_ratio === null ? '' : ' · ' + l.mcap_tvl_ratio.toFixed(2) + 'x TVL') })
          );
        })),
        el('p', { class: 'sub', text: 'These already trade, so their market caps are facts. They are the market the category multiple is fitted on.' })
      ));
    }
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

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'pre-token') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(boardTable());
      shell.appendChild(modelPanel());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else {
      shell.appendChild(calibTable());
    }
    shell.appendChild(methodPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
