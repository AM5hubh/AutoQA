import { expect, test } from 'vitest';
import { destination, isPublicIPv4 } from '../../infra/egress.ts';
test.each([
  '127.0.0.1',
  '10.0.1.5',
  '169.254.169.254',
  '172.16.4.5',
  '192.168.0.1',
  '100.64.1.1',
  '0.0.0.0',
  '224.1.2.3',
  '198.18.1.1',
  '::1',
  '::ffff:127.0.0.1',
  '203.0.113.1',
])('rejects private/reserved destination %s', (address) =>
  expect(isPublicIPv4(address)).toBe(false),
);
test('public IPv4 is not categorically blocked', () => expect(isPublicIPv4('8.8.8.8')).toBe(true));
test('rejects origins before making a DNS query', async () => {
  await expect(
    destination('unapproved.invalid', 443, 'https:', ['https://approved.test']),
  ).rejects.toThrow('Origin denied');
});
