import { expect, test } from 'vitest';
import { classifyFailure } from '../../workers/browser-worker/src/executor.ts';
import type { Step } from '@autoqa/contracts';
const assertion: Step = {
  action: 'assertText',
  target: { kind: 'testId', value: 'cart' },
  expected: '1',
};
test('assertion mismatches fail, actions blocked, cancellation skipped', () => {
  const control = new AbortController();
  expect(classifyFailure(assertion, control.signal, new Error('expected 1 received 0'))).toBe(
    'FAILED',
  );
  expect(
    classifyFailure(
      { action: 'click', target: assertion.target },
      control.signal,
      new Error('timeout'),
    ),
  ).toBe('BLOCKED');
  expect(classifyFailure(assertion, control.signal, new Error('strict mode violation'))).toBe(
    'BLOCKED',
  );
  control.abort(new Error('Cancelled'));
  expect(classifyFailure(assertion, control.signal, new Error('closed'))).toBe('SKIPPED');
});
