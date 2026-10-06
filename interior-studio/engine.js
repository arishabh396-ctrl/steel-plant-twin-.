/*
 * Studio Ledger engine: project profit, cash flow and what-if simulation
 * for an interior design studio. Pure functions, no DOM. Runs in the
 * browser (window.StudioEngine) and in Node (module.exports) for tests.
 *
 * Time model
 *   Month index 0 = April 2026 (start of FY 2026-27), 11 = March 2027.
 *   Day index = month * 30 + day-of-month (a 30-day month keeps the maths simple).
 *   Books are closed to 30 Sep 2026: months < NOW are actuals, NOW onwards is forecast.
 *
 * All money is in rupees, excluding GST unless a field says otherwise.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StudioEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LAKH = 1e5;
  function L(x) { return Math.round(x * LAKH); }

  var GST_RATE = 0.18;          // interior works and design services
  var TDS_RATE = 0.02;          // deducted by company clients (sec 194C)
  var TAX_RATE = 0.312;         // LLP: 30% + 4% cess
  var CREW_RATE = L(6);         // carpentry/civil/finish work one crew delivers per month
  var OUTSOURCE_PREMIUM = 0.20; // outside crews cost 20% more on labour
  var PAYMENT_TERMS = 15;       // invoice due in 15 days
  var RETENTION = 0.05;         // held back on RA-billed projects until 3 months after handover
  var VENDOR_CREDIT_MONTHS = 1; // material suppliers paid the following month
  var NOW = 6;                  // October 2026 = first forecast month
  var TODAY = NOW * 30;         // day index of 1 Oct 2026
  var FY = 12;
  var T0 = -6, T1 = 24;         // engine window in months
  var SPAN = T1 - T0;
  var ADVANCE_TAX = [{ m: 2, cum: 0.15 }, { m: 5, cum: 0.45 }, { m: 8, cum: 0.75 }, { m: 11, cum: 1.0 }];

  var CATS = [
    { key: 'joinery',    label: 'Carpentry & joinery',       material: 0.65, crew: true,  curve: 'mid' },
    { key: 'civil',      label: 'Civil, flooring & ceiling', material: 0.60, crew: true,  curve: 'front' },
    { key: 'electrical', label: 'Electrical & lighting',     material: 0.70, crew: false, curve: 'flat' },
    { key: 'finishes',   label: 'Paint & finishes',          material: 0.55, crew: true,  curve: 'back' },
    { key: 'furniture',  label: 'Loose furniture & décor',   material: 1.00, crew: false, curve: 'back' },
    { key: 'site',       label: 'Site supervision & misc.',  material: 0.20, crew: false, curve: 'flat' }
  ];

  var MILESTONES = [
    { key: 'booking',  label: 'Booking advance',  pct: 10 },
    { key: 'design',   label: 'Design sign-off',  pct: 15 },
    { key: 'material', label: 'Material advance', pct: 35 },
    { key: 'mid',      label: 'Mid-execution',    pct: 25 },
    { key: 'handover', label: 'Handover',         pct: 15 }
  ];

  var STUDIO = {
    name: 'Plumb Line Interiors',
    city: 'Pune',
    entity: 'LLP',
    openingBank: L(44),
    overheads: [
      { label: 'Design team salaries (7)', monthly: L(6.2) },
      { label: 'Studio rent, Baner',       monthly: L(1.4) },
      { label: 'Software, travel, samples', monthly: L(0.9) }
    ],
    hire: { label: 'Site supervisor', monthly: L(0.65), fromMonth: NOW + 1 },
    crews: 6
  };

  function b(j, c, e, f, fu, s) {
    return { joinery: L(j), civil: L(c), electrical: L(e), finishes: L(f), furniture: L(fu), site: L(s) };
  }

  // Sample portfolio. Clients and studio are fictional.
  var PROJECTS = [
    { id: 'P01', name: 'Baner 3BHK', client: 'Kulkarni residence', clientKind: 'individual', type: 'Residential',
      sqft: 1650, start: -3, design: 1, exec: 4, delay: 8, markup: 0.22, designFee: L(2.9),
      budget: b(9.2, 2.6, 2.0, 1.8, 3.4, 1.2), overrun: { joinery: 1.05, furniture: 1.03 },
      variations: [{ desc: 'Study unit added', value: L(1.1), cost: L(0.8), month: 0, approved: true }],
      finish: { name: 'White oak veneer', swatch: 'oak' } },
    { id: 'P02', name: 'Koregaon Park café', client: 'Kaapi Theory Café', clientKind: 'company', type: 'Hospitality',
      sqft: 2200, start: -1, design: 1, exec: 3, delay: 38, markup: 0.20, designFee: L(3.6),
      budget: b(12, 8.5, 6.2, 3.4, 7.8, 2.0), overrun: { civil: 1.17, electrical: 1.13, joinery: 1.04 },
      variations: [
        { desc: 'Extra bar-back lighting and dimmers', value: 0, cost: L(1.15), month: 2, approved: false },
        { desc: 'Counter top redone after layout change', value: 0, cost: L(0.7), month: 2, approved: false }
      ],
      finish: { name: 'Terrazzo, grey chips', swatch: 'terrazzo' } },
    { id: 'P03', name: 'Lonavala villa', client: 'Shah residence', clientKind: 'individual', type: 'Villa',
      sqft: 4800, start: 0, design: 2, exec: 7, delay: 18, markup: 0.20, designFee: L(8.6),
      budget: b(31, 14, 9.5, 7.5, 18, 4.5), overrun: { joinery: 1.11, finishes: 1.04 },
      variations: [{ desc: 'Pool deck pergola', value: L(3.2), cost: L(2.5), month: 6, approved: true }],
      finish: { name: 'Teak, oiled', swatch: 'teak' } },
    { id: 'P04', billing: 'ra', name: 'Hinjewadi office', client: 'Northbeam Analytics', clientKind: 'company', type: 'Office',
      sqft: 6000, start: 1, design: 1, exec: 5, delay: 62, markup: 0.15, designFee: L(7.2),
      budget: b(22, 26, 21, 8, 14, 4), overrun: { civil: 1.03 },
      variations: [],
      finish: { name: 'Fluted acoustic panel', swatch: 'fluted' } },
    { id: 'P05', name: 'Aundh dental clinic', client: 'Aundh Dental Studio', clientKind: 'company', type: 'Healthcare',
      sqft: 1100, start: 3, design: 1, exec: 2, delay: 32, markup: 0.22, designFee: L(2.0),
      budget: b(5.5, 4.2, 3.6, 1.6, 2.4, 0.9), overrun: { electrical: 1.08 },
      variations: [],
      finish: { name: 'Statuario marble', swatch: 'marble' } },
    { id: 'P06', name: 'Kalyani Nagar 4BHK', client: 'Mehta residence', clientKind: 'individual', type: 'Residential',
      sqft: 2900, start: 3, design: 2, exec: 5, delay: 12, markup: 0.20, designFee: L(5.2),
      budget: b(17, 6, 4.4, 4.2, 9, 2.4), overrun: { finishes: 1.16, joinery: 1.02 },
      variations: [
        { desc: 'Imported wallpaper, master bedroom', value: L(2.4), cost: L(1.9), month: 7, approved: true },
        { desc: 'Cove ceiling not in the quote', value: 0, cost: L(0.6), month: 6, approved: false }
      ],
      finish: { name: 'Sage lacquer', swatch: 'sage' } },
    { id: 'P07', name: 'Viman Nagar boutique', client: 'Ira Handloom', clientKind: 'company', type: 'Retail',
      sqft: 900, start: 4, design: 1, exec: 3, delay: 14, markup: 0.24, designFee: L(1.6),
      budget: b(6.5, 2.4, 2.6, 1.4, 2.0, 0.8), overrun: {},
      variations: [],
      finish: { name: 'Natural cane weave', swatch: 'cane' } },
    { id: 'P08', name: 'Wakad 2BHK', client: 'Rao residence', clientKind: 'individual', type: 'Residential',
      sqft: 1050, start: 4, design: 1, exec: 3, delay: 5, markup: 0.22, designFee: L(1.6),
      budget: b(5.8, 1.4, 1.1, 1.0, 2.2, 0.6), overrun: { joinery: 0.97 },
      variations: [],
      finish: { name: 'Linen laminate', swatch: 'linen' } },
    { id: 'P09', billing: 'ra', name: 'Bavdhan rooftop restaurant', client: 'Skyline Terrace Kitchen', clientKind: 'company', type: 'Hospitality',
      sqft: 3400, start: 5, design: 2, exec: 4, delay: 30, markup: 0.20, designFee: L(6.0),
      budget: b(18, 16, 11, 5, 12, 3), overrun: {},
      variations: [],
      finish: { name: 'Kota stone', swatch: 'kota' } },
    { id: 'P10', name: 'Pashan bungalow', client: 'Deshpande residence', clientKind: 'individual', type: 'Villa',
      sqft: 3600, start: 7, design: 2, exec: 5, delay: 15, markup: 0.20, designFee: L(6.5),
      budget: b(22, 12, 6.5, 5.5, 11, 3), overrun: {},
      variations: [],
      finish: { name: 'Brushed brass inlay', swatch: 'brass' } },
    { id: 'P11', billing: 'ra', name: 'Magarpatta co-working', client: 'Loftline Cowork', clientKind: 'company', type: 'Office',
      sqft: 8000, start: 8, design: 1, exec: 4, delay: 42, markup: 0.15, designFee: L(8.0),
      budget: b(26, 30, 24, 9, 22, 5), overrun: {},
      variations: [],
      finish: { name: 'Micro-concrete', swatch: 'concrete' } },
    { id: 'P12', name: 'Sus Road 3BHK', client: 'Iyer residence', clientKind: 'individual', type: 'Residential',
      sqft: 1500, start: 9, design: 1, exec: 3, delay: 10, markup: 0.22, designFee: L(2.7),
      budget: b(8.4, 2.2, 1.8, 1.6, 3.0, 1.0), overrun: {},
      variations: [],
      finish: { name: 'Jaali screen, MDF', swatch: 'jaali' } }
  ];

  // Cost per sq ft and category split for new projects in the what-if planner.
  var TEMPLATES = {
    residential: { label: 'Apartment', type: 'Residential', cps: 1350, markup: 0.21, fee: 180, clientKind: 'individual', delay: 12,
      split: { joinery: 0.44, civil: 0.13, electrical: 0.10, finishes: 0.09, furniture: 0.18, site: 0.06 }, swatch: 'oak' },
    villa:       { label: 'Villa or bungalow', type: 'Villa', cps: 1700, markup: 0.20, fee: 180, clientKind: 'individual', delay: 15,
      split: { joinery: 0.37, civil: 0.17, electrical: 0.11, finishes: 0.09, furniture: 0.21, site: 0.05 }, swatch: 'teak' },
    cafe:        { label: 'Café or restaurant', type: 'Hospitality', cps: 1900, markup: 0.20, fee: 170, clientKind: 'company', delay: 30,
      split: { joinery: 0.30, civil: 0.22, electrical: 0.16, finishes: 0.08, furniture: 0.19, site: 0.05 }, swatch: 'terrazzo' },
    office:      { label: 'Office', type: 'Office', billing: 'ra', cps: 1550, markup: 0.15, fee: 120, clientKind: 'company', delay: 40,
      split: { joinery: 0.23, civil: 0.27, electrical: 0.21, finishes: 0.08, furniture: 0.17, site: 0.04 }, swatch: 'fluted' },
    clinic:      { label: 'Clinic', type: 'Healthcare', cps: 1650, markup: 0.22, fee: 180, clientKind: 'company', delay: 30,
      split: { joinery: 0.30, civil: 0.23, electrical: 0.20, finishes: 0.09, furniture: 0.13, site: 0.05 }, swatch: 'marble' },
    retail:      { label: 'Shop or boutique', type: 'Retail', cps: 1700, markup: 0.24, fee: 170, clientKind: 'company', delay: 15,
      split: { joinery: 0.41, civil: 0.15, electrical: 0.17, finishes: 0.09, furniture: 0.13, site: 0.05 }, swatch: 'cane' }
  };

  var PIPELINE = [
    { id: 'N1', name: 'Baner penthouse', client: 'Prospect: Joshi family', template: 'villa', sqft: 3800, start: 8 },
    { id: 'N2', name: 'Kothrud bakery-café', client: 'Prospect: Crumb & Co.', template: 'cafe', sqft: 1400, start: 7 },
    { id: 'N3', name: 'Pimpri clinics, 2 sites', client: 'Prospect: CarePoint Clinics', template: 'clinic', sqft: 2400, start: 9 }
  ];

  var DEFAULT_SCENARIO = {
    pipeline: [],          // ids from PIPELINE
    custom: [],            // [{template, sqft, start}]
    extraDelay: 0,         // extra days every client takes to pay (future receipts)
    materialRise: 0,       // % change in material prices from October
    bookingAdvance: 10,    // % booking advance asked on new projects
    crews: STUDIO.crews,   // in-house carpentry/civil crews
    overflow: 'outsource', // 'outsource' | 'wait'
    hire: false,           // add a site supervisor from November
    risk: 'medium'         // uncertainty level for the Monte Carlo
  };

  var RISK = { low: 0.5, medium: 1, high: 1.6 };

  /* ---------- helpers ---------- */

  function monthLabel(m, withYear) {
    var abs = 2026 * 12 + 3 + m;
    var names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var y = Math.floor(abs / 12), n = names[abs % 12];
    return withYear ? n + ' ' + String(y).slice(2) : n;
  }

  function zeros() { var a = new Array(SPAN); for (var i = 0; i < SPAN; i++) a[i] = 0; return a; }
  function ix(m) { return m - T0; }
  function inWindow(m) { return m >= T0 && m < T1; }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function curveWeights(n, kind) {
    var w = [], i, t, s = 0;
    for (i = 0; i < n; i++) {
      t = (i + 0.5) / n;
      if (kind === 'front') w.push(Math.pow(1 - t, 1.5) + 0.15);
      else if (kind === 'mid') w.push(Math.sin(Math.PI * t) + 0.15);
      else if (kind === 'back') w.push(Math.pow(t, 1.5) + 0.15);
      else w.push(1);
    }
    for (i = 0; i < n; i++) s += w[i];
    return w.map(function (x) { return x / s; });
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function expo(rng, mean) { return -Math.log(1 - rng()) * mean; }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    var pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function normalizeScenario(s) {
    var out = clone(DEFAULT_SCENARIO);
    if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && s[k] !== undefined) out[k] = clone(s[k]);
    out.crews = Math.max(1, Math.round(out.crews));
    out.bookingAdvance = Math.min(60, Math.max(0, out.bookingAdvance));
    return out;
  }

  function monthlyOverhead(m, sc) {
    var base = 0;
    STUDIO.overheads.forEach(function (o) { base += o.monthly; });
    if (sc.hire && m >= STUDIO.hire.fromMonth) base += STUDIO.hire.monthly;
    return base;
  }

  function milestonePlan(advance) {
    // Booking advance is set by the scenario; the rest keeps its proportions.
    if (advance === 10) return MILESTONES.map(function (x) { return { key: x.key, label: x.label, pct: x.pct }; });
    var rest = 100 - advance;
    return MILESTONES.map(function (x) {
      return { key: x.key, label: x.label, pct: x.key === 'booking' ? advance : x.pct * rest / 90 };
    });
  }

  function fromTemplate(id, name, client, tplKey, sqft, start, advance) {
    var t = TEMPLATES[tplKey];
    var cost = t.cps * sqft;
    var budget = {};
    CATS.forEach(function (c) { budget[c.key] = Math.round(cost * t.split[c.key]); });
    var design = sqft >= 3000 ? 2 : 1;
    var exec = Math.min(7, Math.max(2, Math.ceil(sqft / 1000) + 1));
    return {
      id: id, name: name, client: client, clientKind: t.clientKind, type: t.type, sqft: sqft,
      start: start, design: design, exec: exec, delay: t.delay, markup: t.markup,
      designFee: Math.round(t.fee * sqft), budget: budget, overrun: {}, variations: [],
      finish: { name: t.label, swatch: t.swatch }, isNew: true, milestonePct: advance, billing: t.billing || 'milestone'
    };
  }

  /* ---------- scenario assembly ---------- */

  function assemble(sc) {
    var list = PROJECTS.map(clone);
    sc.pipeline.forEach(function (pid) {
      var p = PIPELINE.filter(function (x) { return x.id === pid; })[0];
      if (p) list.push(fromTemplate(p.id, p.name, p.client, p.template, p.sqft, p.start, sc.bookingAdvance));
    });
    sc.custom.forEach(function (c, i) {
      var t = TEMPLATES[c.template];
      if (!t) return;
      list.push(fromTemplate('C' + (i + 1), 'New ' + t.label.toLowerCase(), 'What-if project', c.template,
        Math.max(300, Math.round(c.sqft)), Math.max(NOW, Math.round(c.start)), sc.bookingAdvance));
    });
    return list;
  }

  function perturb(list, rng, risk) {
    list.forEach(function (p) {
      p.shock = {
        cost: 1 + risk * (0.005 + 0.045 * gauss(rng)),
        delayMean: 10 * risk
      };
      if (p.start >= NOW && rng() < 0.18 * risk) p.start += 1;
    });
  }

  // Monthly carpentry/civil/finish work a project needs, in rupees, for crew loading.
  function crewWork(p, start) {
    var arr = zeros();
    var e0 = start + p.design;
    CATS.forEach(function (c) {
      if (!c.crew) return;
      var w = curveWeights(p.exec, c.curve);
      for (var i = 0; i < p.exec; i++) {
        var m = e0 + i;
        if (inWindow(m)) arr[ix(m)] += p.budget[c.key] * w[i];
      }
    });
    return arr;
  }

  function schedule(list, sc) {
    var load = zeros();
    var cap = sc.crews * CREW_RATE;
    list.forEach(function (p) { p.plannedStart = p.start; p.waitMonths = 0; });
    var fixed = list.filter(function (p) { return sc.overflow !== 'wait' || p.start < NOW; });
    var movable = list.filter(function (p) { return sc.overflow === 'wait' && p.start >= NOW; })
      .sort(function (a, b) { return a.start - b.start; });
    fixed.forEach(function (p) { var w = crewWork(p, p.start); for (var i = 0; i < SPAN; i++) load[i] += w[i]; });
    movable.forEach(function (p) {
      var best = 0, bestOver = Infinity;
      for (var k = 0; k <= 6; k++) {
        var w = crewWork(p, p.start + k), over = 0;
        for (var i = 0; i < SPAN; i++) if (w[i] > 0) over += Math.max(0, load[i] + w[i] - cap) - Math.max(0, load[i] - cap);
        if (over < 1) { best = k; bestOver = 0; break; }
        if (over < bestOver - 1) { bestOver = over; best = k; }
      }
      p.start += best;
      p.waitMonths = best;
      var ww = crewWork(p, p.start);
      for (var j = 0; j < SPAN; j++) load[j] += ww[j];
    });
    return { load: load, cap: cap };
  }

  /* ---------- per-project computation ---------- */

  function computeProject(p, sc, rng) {
    var risk = RISK[sc.risk] || 1;
    var s = p.start, dEnd = s + p.design, e0 = dEnd, e1 = e0 + p.exec;
    var started = p.plannedStart < NOW;
    var rise = sc.materialRise / 100;

    var r = {
      def: p,
      cost: zeros(), material: zeros(), labour: zeros(), crewLabour: zeros(), crewWork: zeros(),
      execCost: zeros(), execPlan: zeros(), varCost: zeros(), premium: zeros(),
      catCost: {}, revenue: zeros(), invoices: []
    };

    CATS.forEach(function (c) {
      var arr = zeros();
      var w = curveWeights(p.exec, c.curve);
      var over = started ? (p.overrun[c.key] || 1) : 1;
      for (var i = 0; i < p.exec; i++) {
        var m = e0 + i;
        if (!inWindow(m)) continue;
        var plan = p.budget[c.key] * w[i];
        var v = plan * over;
        if (m >= NOW) {
          v *= 1 + rise * c.material;
          if (p.shock) v *= p.shock.cost;
        }
        arr[ix(m)] = v;
        r.material[ix(m)] += v * c.material;
        r.labour[ix(m)] += v * (1 - c.material);
        if (c.crew) { r.crewLabour[ix(m)] += v * (1 - c.material); r.crewWork[ix(m)] += plan; }
        r.execCost[ix(m)] += v;
        r.execPlan[ix(m)] += plan;
      }
      r.catCost[c.key] = arr;
    });

    p.variations.forEach(function (v) {
      var m = v.month;
      if (!inWindow(m)) return;
      r.varCost[ix(m)] += v.cost;
      r.material[ix(m)] += v.cost * 0.7;
      r.labour[ix(m)] += v.cost * 0.3;
      if (v.approved && v.value > 0) {
        r.invoices.push({ key: 'variation', label: 'Variation: ' + v.desc, taxable: v.value, day: m * 30 + 20 });
        r.revenue[ix(m)] += v.value;
      }
    });

    // Revenue on percentage-of-completion: execution value follows execution cost,
    // design fee is spread evenly across the design months.
    var execValue = sum(CATS.map(function (c) { return p.budget[c.key]; })) * (1 + p.markup);
    var execTotal = sum(r.execCost);
    for (var i = 0; i < SPAN; i++) {
      if (execTotal > 0) r.revenue[i] += execValue * r.execCost[i] / execTotal;
    }
    for (var d = 0; d < p.design; d++) if (inWindow(s + d)) r.revenue[ix(s + d)] += p.designFee / p.design;

    // Billing. Homes and small shops pay stage-wise milestones; offices and large
    // restaurants pay a mobilisation advance, monthly running-account (RA) bills on
    // work done, and release a 5% retention three months after handover.
    var contract = execValue + p.designFee;
    if (p.billing === 'ra') {
      var adv = p.isNew ? p.milestonePct : 10;
      var raShare = 1 - adv / 100 - RETENTION;
      var planTotal = sum(r.execPlan); // RA bills follow measured (planned) progress
      r.invoices.push({ key: 'design', label: 'Design fee', taxable: p.designFee, day: (dEnd - 1) * 30 + 25 });
      if (adv > 0) r.invoices.push({ key: 'mobilisation', label: 'Mobilisation advance', pct: adv, taxable: execValue * adv / 100, day: e0 * 30 + 5 });
      for (var q = 0; q < p.exec; q++) {
        var mq = e0 + q;
        if (!inWindow(mq) || planTotal <= 0) continue;
        r.invoices.push({ key: 'ra', label: 'RA bill ' + (q + 1) + ' (' + monthLabel(mq) + ' work)',
          taxable: execValue * raShare * r.execPlan[ix(mq)] / planTotal, day: (mq + 1) * 30 + 10 });
      }
      r.invoices.push({ key: 'retention', label: 'Retention release', pct: RETENTION * 100, taxable: execValue * RETENTION, day: (e1 + 2) * 30 + 15 });
    } else {
      var plan = p.isNew ? milestonePlan(p.milestonePct) : MILESTONES;
      var midM = e0 + Math.floor(p.exec / 2);
      var dayOf = {
        booking: s * 30 + 2,
        design: (dEnd - 1) * 30 + 25,
        material: e0 * 30 + 5,
        mid: midM * 30 + 15,
        handover: (e1 - 1) * 30 + 28
      };
      plan.forEach(function (ms) {
        if (ms.pct <= 0) return;
        r.invoices.push({ key: ms.key, label: ms.label, pct: ms.pct, taxable: contract * ms.pct / 100, day: dayOf[ms.key] });
      });
    }
    r.invoices.sort(function (a, b) { return a.day - b.day; });

    r.invoices.forEach(function (inv) {
      var rd = inv.day + p.delay;
      if (rd >= TODAY) {
        rd += sc.extraDelay;
        if (rng) rd += expo(rng, p.shock.delayMean) - 0.6 * p.shock.delayMean;
        rd = Math.max(rd, TODAY, inv.day);
      }
      inv.receiptDay = Math.round(rd);
      inv.gross = inv.taxable * (1 + GST_RATE);
      inv.tds = p.clientKind === 'company' ? inv.taxable * TDS_RATE : 0;
      inv.cashIn = inv.gross - inv.tds;
      inv.dueDay = inv.day + PAYMENT_TERMS;
    });

    r.execValue = execValue;
    r.contract = contract;
    r.schedule = { start: s, designEnd: dEnd, execStart: e0, execEnd: e1 };
    return r;
  }

  /* ---------- whole studio run ---------- */

  var baseTaxCache = null;

  function run(scenario, opts) {
    opts = opts || {};
    var sc = normalizeScenario(scenario);
    var rng = opts.rng || null;
    var risk = RISK[sc.risk] || 1;
    var list = assemble(sc);
    if (rng) perturb(list, rng, risk);
    var sched = schedule(list, sc);
    var results = list.map(function (p) { return computeProject(p, sc, rng); });

    // Crew loading and the outside-crew premium.
    var demand = zeros();
    results.forEach(function (r) { for (var i = 0; i < SPAN; i++) demand[i] += r.crewWork[i]; });
    var cap = sched.cap;
    var premiumTotal = 0;
    results.forEach(function (r) {
      for (var i = 0; i < SPAN; i++) {
        var m = i + T0;
        if (m < NOW || demand[i] <= cap) continue;
        var frac = (demand[i] - cap) / demand[i];
        var prem = r.crewLabour[i] * frac * OUTSOURCE_PREMIUM;
        r.premium[i] += prem;
        r.labour[i] += prem;
        premiumTotal += prem;
      }
      for (var j = 0; j < SPAN; j++) r.cost[j] = r.execCost[j] + r.varCost[j] + r.premium[j];
    });

    // P&L for the financial year (percentage-of-completion revenue).
    var pnl = { revenue: 0, projectCost: 0, overheads: 0 };
    for (var m = 0; m < FY; m++) {
      results.forEach(function (r) { pnl.revenue += r.revenue[ix(m)]; pnl.projectCost += r.cost[ix(m)]; });
      pnl.overheads += monthlyOverhead(m, sc);
    }
    pnl.grossMargin = pnl.revenue - pnl.projectCost;
    pnl.profitBeforeTax = pnl.grossMargin - pnl.overheads;
    pnl.tax = Math.max(0, pnl.profitBeforeTax) * TAX_RATE;
    pnl.profitAfterTax = pnl.profitBeforeTax - pnl.tax;

    if (opts.pnlOnly) return { pnl: pnl };
    if (baseTaxCache === null) baseTaxCache = run(DEFAULT_SCENARIO, { pnlOnly: true }).pnl.tax;

    // Cash flow.
    var cash = {
      receipts: zeros(), vendors: zeros(), labour: zeros(), overheads: zeros(),
      gst: zeros(), advanceTax: zeros(), outflow: zeros(), net: zeros(), closing: zeros(),
      gstOut: zeros(), gstItc: zeros(), tdsDeducted: zeros()
    };
    results.forEach(function (r) {
      r.invoices.forEach(function (inv) {
        var mi = Math.floor(inv.day / 30), mr = Math.floor(inv.receiptDay / 30);
        if (inWindow(mi)) cash.gstOut[ix(mi)] += inv.taxable * GST_RATE;
        if (inWindow(mr)) { cash.receipts[ix(mr)] += inv.cashIn; cash.tdsDeducted[ix(mr)] += inv.tds; }
      });
      for (var i = 0; i < SPAN; i++) {
        var mat = r.material[i];
        cash.gstItc[i] += mat * GST_RATE;
        if (i + VENDOR_CREDIT_MONTHS < SPAN) cash.vendors[i + VENDOR_CREDIT_MONTHS] += mat * (1 + GST_RATE);
        cash.labour[i] += r.labour[i];
      }
    });
    var carry = 0;
    for (var g = 0; g < SPAN; g++) {
      var net = cash.gstOut[g] - cash.gstItc[g] + carry;
      if (net > 0) { if (g + 1 < SPAN) cash.gst[g + 1] += net; carry = 0; } else carry = net;
    }
    var paidTax = 0;
    ADVANCE_TAX.forEach(function (a) {
      var tax = a.m < NOW ? baseTaxCache : pnl.tax;
      var due = Math.max(0, a.cum * tax - paidTax);
      cash.advanceTax[ix(a.m)] = due;
      paidTax += due;
    });
    var bal = STUDIO.openingBank;
    for (m = 0; m < FY; m++) {
      var k = ix(m);
      cash.overheads[k] = monthlyOverhead(m, sc);
      cash.outflow[k] = cash.vendors[k] + cash.labour[k] + cash.overheads[k] + cash.gst[k] + cash.advanceTax[k];
      cash.net[k] = cash.receipts[k] - cash.outflow[k];
      bal += cash.net[k];
      cash.closing[k] = bal;
    }

    var fyIdx = []; for (m = 0; m < FY; m++) fyIdx.push(ix(m));
    function fy(arr) { return fyIdx.map(function (i) { return arr[i]; }); }
    var fyCash = {};
    Object.keys(cash).forEach(function (key) { fyCash[key] = fy(cash[key]); });

    var forecastClosing = fyCash.closing.slice(NOW - 1); // from 30 Sep onwards
    var minBal = Infinity, minMonth = NOW;
    for (m = NOW; m < FY; m++) if (fyCash.closing[m] < minBal) { minBal = fyCash.closing[m]; minMonth = m; }

    var buffer = 2 * monthlyOverhead(NOW, sc);
    var crewFY = fy(demand).map(function (x) { return x / CREW_RATE; });
    var peakCrew = 0, peakCrewMonth = NOW;
    for (m = NOW; m < FY; m++) if (crewFY[m] > peakCrew) { peakCrew = crewFY[m]; peakCrewMonth = m; }

    var projects = results.map(function (r) { return summarizeProject(r, sc); });

    var out = {
      scenario: sc,
      projects: projects,
      cash: fyCash,
      opening: STUDIO.openingBank,
      pnl: pnl,
      minBalance: minBal,
      minMonth: minMonth,
      buffer: buffer,
      bankToday: fyCash.closing[NOW - 1],
      yearEnd: fyCash.closing[FY - 1],
      forecastClosing: forecastClosing,
      crew: { demand: crewFY, capacity: sc.crews, peak: peakCrew, peakMonth: peakCrewMonth, premium: premiumTotal },
      gstNext: { amount: fyCash.gst[NOW], month: NOW, day: 20 },
      tdsReceivableFY: sum(fyCash.tdsDeducted.slice(0, NOW)),
      tdsReceivableYear: sum(fyCash.tdsDeducted),
      baseTax: baseTaxCache
    };
    out.totals = totals(out);
    if (!opts.lite) out.insights = insights(out);
    return out;
  }

  function stageOf(p, sch, r) {
    var m = NOW;
    if (sch.start > m) return { key: 'signed', label: 'Starts ' + monthLabel(sch.start) };
    if (m < sch.designEnd) return { key: 'design', label: 'Design' };
    if (m < sch.execEnd - 1) return { key: 'site', label: 'On site' };
    if (m === sch.execEnd - 1) return { key: 'snag', label: 'Snagging' };
    var pending = r.invoices.some(function (inv) { return inv.receiptDay >= TODAY; });
    return pending ? { key: 'dues', label: 'Dues open' } : { key: 'closed', label: 'Closed' };
  }

  function summarizeProject(r, sc) {
    var p = r.def, sch = r.schedule;
    var before = function (arr) { var s = 0; for (var i = 0; i < ix(NOW); i++) s += arr[i]; return s; };
    var quotedCost = sum(CATS.map(function (c) { return p.budget[c.key]; }));
    var approvedValue = p.variations.reduce(function (a, v) { return a + (v.approved ? v.value : 0); }, 0);
    var revenue = r.contract + approvedValue;
    var eac = sum(r.cost);
    var costToDate = before(r.cost);
    var execToDate = before(r.execCost), execTotal = sum(r.execCost);
    var earned = before(r.revenue);
    var billed = 0, received = 0, outstanding = 0, overdue = 0, maxOverdue = 0;
    var milestones = r.invoices.map(function (inv) {
      var status;
      if (inv.receiptDay < TODAY) status = 'received';
      else if (inv.day < TODAY) status = TODAY > inv.dueDay ? 'overdue' : 'awaiting';
      else status = 'upcoming';
      if (inv.day < TODAY) billed += inv.taxable;
      if (status === 'received') received += inv.taxable;
      var od = status === 'overdue' ? TODAY - inv.dueDay : 0;
      if (status === 'overdue' || status === 'awaiting') outstanding += inv.cashIn;
      if (status === 'overdue') { overdue += inv.cashIn; maxOverdue = Math.max(maxOverdue, od); }
      return {
        label: inv.label, pct: inv.pct, taxable: inv.taxable, cashIn: inv.cashIn, tds: inv.tds,
        invoiceMonth: Math.floor(inv.day / 30), receiptMonth: Math.floor(inv.receiptDay / 30),
        status: status, overdueDays: od
      };
    });
    // Paid to vendors by 30 Sep: labour as incurred, material one month later.
    var paid = 0;
    for (var i = 0; i < ix(NOW); i++) {
      paid += r.labour[i];
      if (i < ix(NOW) - VENDOR_CREDIT_MONTHS) paid += r.material[i];
    }
    var cats = CATS.map(function (c) {
      var arr = r.catCost[c.key];
      var spent = before(arr), forecast = sum(arr), budget = p.budget[c.key];
      return { key: c.key, label: c.label, budget: budget, spent: spent, forecast: forecast,
        variance: forecast - budget, variancePct: budget ? forecast / budget - 1 : 0 };
    });
    var unapproved = p.variations.filter(function (v) { return !v.approved; });
    var margin = revenue - eac;
    var marginPct = revenue ? margin / revenue : 0;
    var quotedMarginPct = (r.contract - quotedCost) / r.contract;
    var health = marginPct < 0.10 ? 'critical' : marginPct < 0.15 ? 'warning' : 'good';
    var stage = stageOf(p, sch, r);
    return {
      id: p.id, name: p.name, client: p.client, clientKind: p.clientKind, type: p.type, sqft: p.sqft,
      billing: p.billing || 'milestone',
      finish: p.finish, isNew: !!p.isNew, waitMonths: p.waitMonths || 0,
      schedule: sch, stage: stage, delay: p.delay,
      contract: r.contract, designFee: p.designFee, execValue: r.execValue, approvedValue: approvedValue,
      revenue: revenue, quotedCost: quotedCost, eac: eac, costToDate: costToDate,
      margin: margin, marginPct: marginPct, quotedMarginPct: quotedMarginPct, health: health,
      pctComplete: execTotal ? execToDate / execTotal : 0,
      earned: earned, billed: billed, unbilled: earned - billed,
      received: received, paid: paid, cashPosition: received - paid,
      outstanding: outstanding, overdue: overdue, maxOverdue: maxOverdue,
      milestones: milestones, cats: cats,
      variations: p.variations, unapprovedCost: unapproved.reduce(function (a, v) { return a + v.cost; }, 0),
      premium: sum(r.premium),
      active: stage.key !== 'closed'
    };
  }

  function totals(res) {
    var t = { workInHand: 0, projectedMargin: 0, projectedRevenue: 0, outstanding: 0, overdue: 0, unbilled: 0,
      unapproved: 0, activeCount: 0, quotedMargin: 0 };
    res.projects.forEach(function (p) {
      if (p.active) { t.activeCount++; t.workInHand += p.revenue - p.billed; }
      t.projectedMargin += p.margin;
      t.projectedRevenue += p.revenue;
      t.quotedMargin += p.contract - p.quotedCost;
      t.outstanding += p.outstanding;
      t.overdue += p.overdue;
      if (p.unbilled > 0) t.unbilled += p.unbilled;
      t.unapproved += p.unapprovedCost;
    });
    t.projectedMarginPct = t.projectedRevenue ? t.projectedMargin / t.projectedRevenue : 0;
    return t;
  }

  /* ---------- plain-language findings ---------- */

  function lakh(x) {
    var v = Math.abs(x) / LAKH, sign = x < 0 ? '−' : '';
    if (v >= 100) return sign + '₹' + Number((v / 100).toFixed(2)) + ' Cr';
    return sign + '₹' + Number(v.toFixed(v >= 10 ? 1 : 2)) + ' L';
  }
  function pct(x) { return Math.round(x * 100) + '%'; }

  function insights(res) {
    var list = [];
    res.projects.forEach(function (p) {
      var drop = p.quotedMarginPct - p.marginPct;
      if (drop > 0.03 && !p.isNew) {
        var worst = p.cats.slice().sort(function (a, b) { return b.variance - a.variance; })[0];
        var why = worst && worst.variancePct > 0.02 ? worst.label.toLowerCase() + ' is running ' + pct(worst.variancePct) + ' over the quote' : 'costs are above the quote';
        if (p.unapprovedCost > 0) why += ', and ' + lakh(p.unapprovedCost) + ' of extras were never billed';
        list.push({ severity: p.marginPct < 0.10 ? 'critical' : 'warning', project: p.id, kind: 'margin',
          title: p.name + ': margin down from ' + pct(p.quotedMarginPct) + ' to ' + pct(p.marginPct),
          detail: 'Because ' + why + '.', value: drop * p.revenue });
      }
      if (p.unbilled > L(2) && p.active && p.pctComplete > 0) {
        list.push({ severity: 'warning', project: p.id, kind: 'unbilled',
          title: 'Bill ' + p.client + ': ' + lakh(p.unbilled) + ' of work done but not invoiced',
          detail: p.name + ' is ' + pct(p.pctComplete) + ' complete but billing is behind. Raise the next ' +
            (p.billing === 'ra' ? 'RA bill' : 'milestone invoice') + ' now instead of waiting for month-end.', value: p.unbilled });
      }
      if (p.overdue > 0) {
        list.push({ severity: p.maxOverdue > 30 ? 'critical' : 'warning', project: p.id, kind: 'overdue',
          title: p.client + ' owes ' + lakh(p.overdue) + ', ' + p.maxOverdue + ' days overdue',
          detail: 'Usually pays ' + p.delay + ' days after the invoice. Follow up before the next material order.', value: p.overdue });
      }
      if (p.cashPosition < -L(2) && p.active) {
        list.push({ severity: 'warning', project: p.id, kind: 'funding',
          title: p.name + ' is running on other projects\' money',
          detail: 'Paid to vendors ' + lakh(p.paid) + ', received from client ' + lakh(p.received) + '. Gap: ' + lakh(-p.cashPosition) + '.', value: -p.cashPosition });
      }
    });
    if (res.totals.unapproved > 0) {
      list.push({ severity: 'warning', kind: 'variations',
        title: lakh(res.totals.unapproved) + ' of extra work given away free',
        detail: 'Changes done at site without a signed variation. Get client sign-off before doing extras.', value: res.totals.unapproved });
    }
    if (res.minBalance < res.buffer) {
      list.push({ severity: res.minBalance < 0 ? 'critical' : 'warning', kind: 'cash',
        title: 'Cash dips to ' + lakh(res.minBalance) + ' in ' + monthLabel(res.minMonth, true),
        detail: 'Below the safety buffer of ' + lakh(res.buffer) + ' (two months of overheads).', value: res.buffer - res.minBalance });
    }
    if (res.crew.peak > res.crew.capacity + 0.05) {
      list.push({ severity: 'warning', kind: 'crew',
        title: 'Crews overbooked in ' + monthLabel(res.crew.peakMonth, true),
        detail: 'Work needs ' + res.crew.peak.toFixed(1) + ' crews against ' + res.crew.capacity + ' in-house. Outside crews add ' + lakh(res.crew.premium) + '.', value: res.crew.premium });
    }
    var rank = { critical: 0, warning: 1, good: 2 };
    list.sort(function (a, b) { return rank[a.severity] - rank[b.severity] || b.value - a.value; });
    return list;
  }

  /* ---------- Monte Carlo ---------- */

  function monteCarlo(scenario, n, seed) {
    n = n || 300;
    var rng = mulberry32(seed || 20261006);
    var closings = [], mins = [], profits = [];
    for (var k = 0; k < n; k++) {
      var r = run(scenario, { rng: rng, lite: true });
      closings.push(r.cash.closing);
      mins.push(r.minBalance);
      profits.push(r.pnl.profitBeforeTax);
    }
    var bands = { p10: [], p50: [], p90: [] };
    for (var m = 0; m < FY; m++) {
      var col = closings.map(function (c) { return c[m]; }).sort(function (a, b) { return a - b; });
      bands.p10.push(percentile(col, 0.1));
      bands.p50.push(percentile(col, 0.5));
      bands.p90.push(percentile(col, 0.9));
    }
    var sc = normalizeScenario(scenario);
    var buffer = 2 * monthlyOverhead(NOW, sc);
    var sMins = mins.slice().sort(function (a, b) { return a - b; });
    var sProf = profits.slice().sort(function (a, b) { return a - b; });
    return {
      runs: n, bands: bands, buffer: buffer,
      pNegative: mins.filter(function (x) { return x < 0; }).length / n,
      pBelowBuffer: mins.filter(function (x) { return x < buffer; }).length / n,
      minP10: percentile(sMins, 0.1), minP50: percentile(sMins, 0.5),
      profitP10: percentile(sProf, 0.1), profitP50: percentile(sProf, 0.5), profitP90: percentile(sProf, 0.9)
    };
  }

  // Smallest booking advance on new projects that keeps forecast cash above the buffer.
  function adviseAdvance(scenario) {
    var sc = normalizeScenario(scenario);
    if (!sc.pipeline.length && !sc.custom.length) return null;
    var now = run(sc, { lite: true });
    if (now.minBalance >= now.buffer) return { ok: true, pct: sc.bookingAdvance, minBalance: now.minBalance };
    for (var a = sc.bookingAdvance + 5; a <= 50; a += 5) {
      var s2 = clone(sc); s2.bookingAdvance = a;
      var r = run(s2, { lite: true });
      if (r.minBalance >= r.buffer) return { ok: false, pct: a, minBalance: r.minBalance };
    }
    return { ok: false, pct: null };
  }

  return {
    NOW: NOW, FY: FY, LAKH: LAKH, GST_RATE: GST_RATE, TDS_RATE: TDS_RATE, TAX_RATE: TAX_RATE,
    CREW_RATE: CREW_RATE, OUTSOURCE_PREMIUM: OUTSOURCE_PREMIUM, PAYMENT_TERMS: PAYMENT_TERMS,
    CATS: CATS, MILESTONES: MILESTONES, STUDIO: STUDIO, PROJECTS: PROJECTS, PIPELINE: PIPELINE,
    TEMPLATES: TEMPLATES, DEFAULT_SCENARIO: DEFAULT_SCENARIO, ADVANCE_TAX: ADVANCE_TAX,
    monthLabel: monthLabel, run: run, monteCarlo: monteCarlo, adviseAdvance: adviseAdvance,
    fromTemplate: fromTemplate, lakh: lakh
  };
});
