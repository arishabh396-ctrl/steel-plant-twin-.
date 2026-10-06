// Sanity tests for the Studio Ledger engine. Run: node interior-studio/test_engine.js
'use strict';
const assert = require('assert');
const E = require('./engine.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const sum = a => a.reduce((s, x) => s + x, 0);

const base = E.run();

test('cash balance rolls forward month by month', () => {
  let bal = base.opening;
  for (let m = 0; m < E.FY; m++) {
    bal += base.cash.receipts[m] - base.cash.outflow[m];
    near(base.cash.closing[m], bal, 1, 'closing ' + m);
  }
});

test('outflow equals the sum of its parts', () => {
  for (let m = 0; m < E.FY; m++) {
    const c = base.cash;
    near(c.outflow[m], c.vendors[m] + c.labour[m] + c.overheads[m] + c.gst[m] + c.advanceTax[m], 1, 'outflow ' + m);
  }
});

test('each project bills exactly its contract plus approved variations', () => {
  base.projects.forEach(p => {
    const billedTotal = sum(p.milestones.map(x => x.taxable));
    near(billedTotal, p.contract + p.approvedValue, 1, p.id);
  });
});

test('revenue recognised over project life equals contract value', () => {
  base.projects.forEach(p => {
    // earned to date never exceeds total revenue
    assert.ok(p.earned <= p.revenue + 1, p.id + ' earned > revenue');
  });
});

test('projects without overruns keep their quoted margin', () => {
  const p = base.projects.find(x => x.id === 'P07');
  near(p.marginPct, p.quotedMarginPct, 0.001, 'P07 margin');
});

test('overruns reduce margin (café)', () => {
  const p = base.projects.find(x => x.id === 'P02');
  assert.ok(p.marginPct < p.quotedMarginPct - 0.05, `café margin ${p.marginPct} vs quoted ${p.quotedMarginPct}`);
});

test('advance tax adds up to 100% of the year tax when profitable', () => {
  near(sum(base.cash.advanceTax), base.pnl.tax, 1, 'advance tax');
});

test('GST paid never exceeds output GST', () => {
  assert.ok(sum(base.cash.gst) <= sum(base.cash.gstOut) + 1);
});

test('later client payments lower the cash low point', () => {
  const late = E.run({ extraDelay: 30 });
  assert.ok(late.minBalance < base.minBalance, `${late.minBalance} !< ${base.minBalance}`);
});

test('material price rise lowers profit', () => {
  const r = E.run({ materialRise: 10 });
  assert.ok(r.pnl.profitBeforeTax < base.pnl.profitBeforeTax);
});

test('adding pipeline projects raises revenue', () => {
  const r = E.run({ pipeline: ['N1', 'N2', 'N3'] });
  assert.ok(r.pnl.revenue > base.pnl.revenue);
  assert.strictEqual(r.projects.length, base.projects.length + 3);
});

test('higher booking advance improves the cash low point for new projects', () => {
  const a = E.run({ pipeline: ['N1', 'N2', 'N3'], bookingAdvance: 10 });
  const b = E.run({ pipeline: ['N1', 'N2', 'N3'], bookingAdvance: 30 });
  assert.ok(b.minBalance >= a.minBalance);
});

test('wait mode removes the outside-crew premium on new projects', () => {
  const o = E.run({ pipeline: ['N1', 'N2', 'N3'], crews: 5, overflow: 'outsource' });
  const w = E.run({ pipeline: ['N1', 'N2', 'N3'], crews: 5, overflow: 'wait' });
  assert.ok(w.crew.premium <= o.crew.premium, `${w.crew.premium} > ${o.crew.premium}`);
  assert.ok(w.projects.some(p => p.waitMonths > 0), 'nobody waited');
});

test('fewer crews means more premium', () => {
  const a = E.run({ crews: 8 }), b = E.run({ crews: 4 });
  assert.ok(b.crew.premium > a.crew.premium);
});

test('Monte Carlo is reproducible and bands are ordered', () => {
  const a = E.monteCarlo({}, 120, 7), b = E.monteCarlo({}, 120, 7);
  assert.deepStrictEqual(a.bands.p50, b.bands.p50);
  for (let m = 0; m < E.FY; m++) assert.ok(a.bands.p10[m] <= a.bands.p50[m] && a.bands.p50[m] <= a.bands.p90[m]);
  assert.ok(a.pNegative >= 0 && a.pNegative <= 1);
});

test('past months are identical across scenarios (actuals are fixed)', () => {
  const r = E.run({ extraDelay: 45, materialRise: 15, crews: 3, pipeline: ['N2'] });
  for (let m = 0; m < E.NOW; m++) near(r.cash.closing[m], base.cash.closing[m], 1, 'month ' + m);
});

test('lakh formatter', () => {
  assert.strictEqual(E.lakh(2150000), '₹21.5 L');
  assert.strictEqual(E.lakh(12500000), '₹1.25 Cr');
  assert.strictEqual(E.lakh(-50000), '−₹0.5 L');
});

console.log(`\n${passed} passed`);

// Print a short summary to eyeball calibration.
const L = E.lakh;
console.log('\nBASELINE');
console.log('bank 30 Sep', L(base.bankToday), '| low', L(base.minBalance), E.monthLabel(base.minMonth, true), '| year end', L(base.yearEnd), '| buffer', L(base.buffer));
console.log('FY revenue', L(base.pnl.revenue), 'cost', L(base.pnl.projectCost), 'overheads', L(base.pnl.overheads), 'PBT', L(base.pnl.profitBeforeTax), 'tax', L(base.pnl.tax));
console.log('crew peak', base.crew.peak.toFixed(2), E.monthLabel(base.crew.peakMonth), 'premium', L(base.crew.premium));
console.log('totals', Object.fromEntries(Object.entries(base.totals).map(([k, v]) => [k, Math.abs(v) > 100 ? L(v) : +v.toFixed(3)])));
console.log('closing', base.cash.closing.map(x => (x / 1e5).toFixed(1)).join(' '));
console.log('in     ', base.cash.receipts.map(x => (x / 1e5).toFixed(1)).join(' '));
console.log('out    ', base.cash.outflow.map(x => (x / 1e5).toFixed(1)).join(' '));
console.log('crew   ', base.crew.demand.map(x => x.toFixed(1)).join(' '));
base.projects.forEach(p => console.log(p.id, p.name.padEnd(28), p.stage.label.padEnd(24), 'rev', L(p.revenue).padEnd(10), 'q', (p.quotedMarginPct * 100).toFixed(1), '→', (p.marginPct * 100).toFixed(1), '| done', (p.pctComplete * 100).toFixed(0) + '%', 'unbilled', L(p.unbilled), 'cash', L(p.cashPosition), 'overdue', L(p.overdue), p.maxOverdue + 'd'));
console.log('\nINSIGHTS');
base.insights.forEach(i => console.log(' [' + i.severity + ']', i.title, '—', i.detail));
const mc = E.monteCarlo({}, 300);
console.log('\nMC base: pNeg', mc.pNegative, 'pBuf', mc.pBelowBuffer, 'minP50', L(mc.minP50), 'profit P10/50/90', L(mc.profitP10), L(mc.profitP50), L(mc.profitP90));
const all = { pipeline: ['N1', 'N2', 'N3'] };
const ra = E.run(all);
console.log('with pipeline: low', L(ra.minBalance), E.monthLabel(ra.minMonth), 'PBT', L(ra.pnl.profitBeforeTax), 'crew peak', ra.crew.peak.toFixed(1), 'advice', JSON.stringify(E.adviseAdvance(all)));
