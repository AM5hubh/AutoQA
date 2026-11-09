import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import argon2 from 'argon2';
import { z } from 'zod';
import { db } from '@autoqa/database';
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  const email = z
    .string()
    .email()
    .parse(process.env.PROVISION_EMAIL || (await prompt.question('Email: ')))
    .toLowerCase();
  prompt.close();
  let password = process.env.PROVISION_PASSWORD;
  if (!password) {
    if (!process.stdin.isTTY)
      throw new Error('Set PROVISION_PASSWORD for non-interactive provisioning');
    process.stdout.write('Password (hidden): ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    password = await new Promise<string>((resolve, reject) => {
      let value = '';
      const receive = (data: string) => {
        if (data.includes('\u0003')) {
          process.stdin.off('data', receive);
          reject(new Error('Cancelled'));
          return;
        }
        if (/[\r\n]/.test(data)) {
          process.stdin.off('data', receive);
          resolve(value);
          return;
        }
        if (data === '\u007f' || data === '\b') value = value.slice(0, -1);
        else value += data;
      };
      process.stdin.on('data', receive);
    });
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  }
  z.string().min(12).max(128).parse(password);
  await db.user.create({
    data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) },
  });
  console.log('Account created. Use Resend verification on the sign-in page to verify its email.');
} finally {
  prompt.close();
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  await db.$disconnect();
}
