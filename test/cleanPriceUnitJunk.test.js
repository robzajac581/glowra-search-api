const test = require('node:test');
const assert = require('node:assert');

const { classify, numbersIn, numbersAccountedFor } = require('../scripts/cleanPriceUnitJunk');

// Procedures has no PriceMin/PriceMax (those are DraftProcedures only), so live
// rows are cross-checked against AverageCost alone.
function procRow(priceUnit, averageCost = null, extra = {}) {
  return { ID: 1, ProcedureName: 'Botox', PriceUnit: priceUnit, AverageCost: averageCost, PriceMin: null, PriceMax: null, ...extra };
}

test('numbersIn pulls every number out of a junk unit', () => {
  assert.deepStrictEqual(numbersIn('/650'), [650]);
  assert.deepStrictEqual(numbersIn('/6.25'), [6.25]);
  assert.deepStrictEqual(numbersIn('/2 vials'), [2]);
  assert.deepStrictEqual(numbersIn('/10-30 vials'), [10, 30]);
  assert.deepStrictEqual(numbersIn('/6-session pkg'), [6]);
  assert.deepStrictEqual(numbersIn('/session'), []);
});

test('the five units GLO-69 added are kept untouched', () => {
  for (const unit of ['/procedure', '/package', '/cycle', '/thread', '/graft']) {
    const verdict = classify(procRow(unit, 500));
    assert.strictEqual(verdict.action, 'keep', `${unit} should be kept, got ${verdict.action}`);
    assert.strictEqual(verdict.newValue, unit);
  }
});

test('canonical units are kept', () => {
  for (const unit of ['/unit', '/session', '/injection', '/area', '/treatment', '/syringe', '/vial']) {
    assert.strictEqual(classify(procRow(unit, 12)).action, 'keep');
  }
});

test('aliases are rewritten to canonical, not nulled', () => {
  assert.deepStrictEqual(
    { ...classify(procRow('/sessions', 100)) },
    { action: 'rewrite', newValue: '/session', note: 'alias -> /session' }
  );
  assert.strictEqual(classify(procRow('/PKG', 100)).newValue, '/package');
});

test('a price leak whose number matches AverageCost is safe to null', () => {
  const verdict = classify(procRow('/650', 650));
  assert.strictEqual(verdict.action, 'null');
  assert.strictEqual(verdict.newValue, null);
});

test('a price leak whose number is unaccounted for is held for review', () => {
  // Nulling this would destroy the only copy of 650.
  assert.strictEqual(classify(procRow('/650', null)).action, 'review');
  assert.strictEqual(classify(procRow('/650', 900)).action, 'review');
});

test('decimal prices match within a cent (DECIMAL(10,2) rounding)', () => {
  assert.strictEqual(classify(procRow('/6.25', 6.25)).action, 'null');
  assert.strictEqual(classify(procRow('/6.25', 6.26)).action, 'review');
});

test('multi-number junk needs every number accounted for', () => {
  assert.strictEqual(numbersAccountedFor('/10-30 vials', procRow('/10-30 vials', 10)), false);
  assert.strictEqual(
    numbersAccountedFor('/10-30 vials', { AverageCost: 10, PriceMin: 30, PriceMax: null }),
    true
  );
});

test('junk with no number at all is safe to null', () => {
  // Nothing numeric to lose.
  assert.strictEqual(classify(procRow('/banana', null)).action, 'null');
  assert.strictEqual(classify(procRow('/banana', null)).note, 'unrecognised unit');
});

test('DraftProcedures rows can match on PriceMin/PriceMax too', () => {
  const draftRow = { ID: 7, ProcedureName: 'Filler', PriceUnit: '/950', AverageCost: null, PriceMin: 950, PriceMax: 1200 };
  assert.strictEqual(classify(draftRow).action, 'null');
});

test('classify never proposes storing a non-canonical value', () => {
  const { getValidPriceUnits } = require('../utils/priceUnitNormalizer');
  const canonical = getValidPriceUnits();
  const inputs = ['/650', '/950', '/3150', '/1095', '/6.25', '/2 vials', '/6-session pkg',
                  '/10-30 vials', '/sessions', '/procedure', '/graft', '/banana', '/unit'];
  for (const input of inputs) {
    const { newValue } = classify(procRow(input, 650));
    if (newValue === null) continue;
    assert.ok(
      canonical.includes(newValue),
      `classify would store non-canonical value ${JSON.stringify(newValue)} for input ${input}`
    );
  }
});
