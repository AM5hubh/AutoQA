import type { Plan } from './types';
export const demoPlan: Plan = {
  title: 'Storefront essentials',
  limitations: ['Desktop and mobile Chromium only. Uses synthetic storefront data.'],
  tests: [
    {
      id: 'cart-count',
      title: 'Adding a shirt updates the cart',
      requirement: 'Adding one product should increase the cart count to one.',
      priority: 'high',
      preconditions: ['A fresh cart'],
      assumptions: [],
      steps: [
        { action: 'navigate', path: '/products' },
        { action: 'click', target: { kind: 'testId', value: 'add-shirt' } },
        { action: 'assertText', target: { kind: 'testId', value: 'cart-count' }, expected: '1' },
      ],
    },
    {
      id: 'required-email',
      title: 'Newsletter requires an email',
      requirement: 'Submitting an empty email should show Email is required.',
      priority: 'medium',
      preconditions: [],
      assumptions: [],
      steps: [
        { action: 'navigate', path: '/signup' },
        { action: 'click', target: { kind: 'role', role: 'button', name: 'Subscribe' } },
        {
          action: 'assertText',
          target: { kind: 'testId', value: 'validation-message' },
          expected: 'Email is required',
        },
      ],
    },
  ],
};
