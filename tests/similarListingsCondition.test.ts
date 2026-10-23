import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { similarityScore } from '../data/similarListings';
import { conditionApplies } from '../data/sellRules';
import type { Listing } from '../types';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8').replace(/\r\n/g, '\n');

const mk = (over: Partial<Listing>) => ({ id: 'a', price: 100, city: 'Hargeisa', category: 'phones', subcategory: 'Samsung', condition: 'used', status: 'available', ...over }) as Listing;

test('products: a matching condition still adds the 10-point bonus', () => {
  const p = mk({});
  assert.equal(similarityScore(p, mk({ id: 'b', condition: 'used' })) - similarityScore(p, mk({ id: 'c', condition: 'new' })), 10);
});

test('condition-free listings (both read "used" in memory) get no condition bonus', () => {
  const rent = (id: string, condition: Listing['condition']) => mk({ id, category: 'property', subcategory: 'House for Rent', condition });
  assert.equal(conditionApplies('property', 'House for Rent'), false);
  assert.equal(similarityScore(rent('a', 'used'), rent('b', 'used')), similarityScore(rent('a', 'used'), rent('c', 'new')));
});

test('bulk review hides the condition where none applies, on mobile and web', () => {
  assert.match(read('app/business/bulk-upload.tsx'), /conditionApplies\(item\.categoryId\) \? item\.condition : null/);
  assert.match(read('web/src/app/business/bulk-upload/page.tsx'), /conditionApplies\(r\.categoryId\) \? r\.condition : null/);
  assert.match(read('lib/bulkUpload.ts'), /!condition && conditionApplies\(/);
});
