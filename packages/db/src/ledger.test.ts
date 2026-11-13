import { expect, it } from 'vitest';
import { clearing, payable, validateEntry } from './ledger';

it('postEntry rejects unbalanced entries before touching the database', () => {
  expect(() => validateEntry([clearing('debit', 100), payable('merchant', 'credit', 99)])).toThrow(
    'Unbalanced',
  );
  expect(() => validateEntry([clearing('debit', 100), payable('merchant', 'credit', 100)])).not.toThrow();
  expect(() => validateEntry([clearing('debit', 0)])).toThrow();
});
