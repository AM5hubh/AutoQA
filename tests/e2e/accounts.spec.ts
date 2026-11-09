import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '@autoqa/database';
import fixture from '../fixtures/plan.json' with { type: 'json' };

const origin=process.env.APP_ORIGIN || 'http://localhost:3000';
async function emailLink(request:APIRequestContext,email:string,subject:string) {
  let id='';
  await expect.poll(async()=>{
    const mailbox=await (await request.get('http://localhost:8025/api/v1/messages')).json();
    id=mailbox.messages.find((m:{ID:string;Subject:string;To:{Address:string}[]})=>m.Subject===subject && m.To.some(t=>t.Address===email))?.ID || '';
    return id;
  },{timeout:15000}).not.toBe('');
  const message=await (await request.get(`http://localhost:8025/api/v1/message/${id}`)).json();
  return (message.Text as string).match(/https?:\/\/\S+#token=[a-f0-9]+/)![0];
}
test.afterAll(async()=>{await db.$disconnect();});
test('public signup, verification, password recovery and session invalidation',async({page,request,playwright})=>{
  const email=`signup-${randomUUID()}@example.test`, password=randomUUID()+'Aa1!';
  await page.goto('/signup');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('email');
  expect((await request.post('/api/auth/login',{headers:{origin},data:{email,password}})).status()).toBe(403);
  const verify=await emailLink(request,email,'Verify your AutoQA email');
  await page.goto(verify);
  await page.getByRole('button',{name:'Verify email',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Email verified');
  const token=new URLSearchParams(new URL(verify).hash.slice(1)).get('token');
  expect((await request.post('/api/auth/verify-email',{headers:{origin},data:{token}})).status()).toBe(422);
  await page.getByRole('link',{name:'Back to sign in'}).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Testing, with a clear view.'})).toBeVisible();
  const old=await playwright.request.newContext({baseURL:origin});
  expect((await old.post('/api/auth/login',{headers:{origin},data:{email,password}})).ok()).toBeTruthy();
  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button',{name:'Send reset link'}).click();
  await expect(page.getByRole('status')).toContainText('email');
  const reset=await emailLink(request,email,'Reset your AutoQA password');
  await page.goto(reset);
  const updated=randomUUID()+'Bb2!';
  await page.getByLabel('New password',{exact:true}).fill(updated);
  await page.getByLabel('Confirm password').fill(updated);
  await page.getByRole('button',{name:'Update password'}).click();
  await expect(page.getByRole('status')).toContainText('Password updated');
  expect((await old.get('/api/auth/me')).status()).toBe(401);
  await old.dispose();
  expect((await request.post('/api/auth/login',{headers:{origin},data:{email,password:updated}})).status()).toBe(200);
  expect((await request.post('/api/auth/login',{headers:{origin},data:{email,password}})).status()).toBe(401);
});

test('user website edits invalidate approval and preserve historical snapshots',async({request})=>{
  const email=`targets-${randomUUID()}@example.test`,password=randomUUID();
  await db.user.create({data:{email,passwordHash:await argon2.hash(password),emailVerifiedAt:new Date()}});
  const login=await (await request.post('/api/auth/login',{headers:{origin},data:{email,password}})).json();
  const headers={origin,'x-csrf-token':login.csrf};
  const project=await (await request.post('/api/projects',{headers,data:{name:'User target',baseUrl:'http://demo-site:4100'}})).json();
  const suite=await (await request.post(`/api/projects/${project.id}/suites`,{headers,data:{plan:fixture,paths:['/products']}})).json();
  expect((await request.post(`/api/suites/${suite.id}/approve`,{headers,data:{revision:1,targetRevision:1}})).status()).toBe(200);
  const run=await db.run.create({data:{suiteId:suite.id,revision:1,snapshot:{baseUrl:project.baseUrl,plan:fixture,targetRevision:1},config:{},status:'COMPLETED',idempotencyKey:randomUUID(),finishedAt:new Date()}});
  const edited=await request.patch(`/api/projects/${project.id}`,{headers,data:{name:'My website',baseUrl:'https://example.com',additionalOrigins:['https://www.example.com'],targetRevision:1}});
  expect(edited.status()).toBe(200);
  const current=await edited.json();
  expect(current.verifiedAt).toBeNull();expect(current.targetRevision).toBe(2);
  expect(current.verificationToken).not.toBe(project.verificationToken);
  const updatedSuite=await (await request.get(`/api/suites/${suite.id}`)).json();
  expect(updatedSuite.approvedRevision).toBeNull();
  expect((await request.post(`/api/projects/${project.id}/generations`,{headers,data:{instructions:'Check the website headline',paths:['/']}})).status()).toBe(409);
  const history=await (await request.get(`/api/runs/${run.id}`)).json();
  expect(history.snapshot.baseUrl).toBe('http://demo-site:4100');
  expect((await request.patch(`/api/projects/${project.id}`,{headers,data:{name:'Stale edit',baseUrl:'https://example.com',targetRevision:1}})).status()).toBe(409);
});
