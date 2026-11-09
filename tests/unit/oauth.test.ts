import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import supertest from 'supertest';
import { generateKeyPairSync, sign } from 'node:crypto';
const database=vi.hoisted(()=>({user:{findUnique:vi.fn(),create:vi.fn()},identity:{findUnique:vi.fn(),create:vi.fn()},$executeRaw:vi.fn(),$transaction:vi.fn()}));
vi.mock('@autoqa/database',()=>({db:database}));
vi.mock('../../packages/database/src/runtime.ts',()=>({appOrigin:'http://localhost:3000'}));
import { authRouter, resolveIdentity } from '../../apps/api/src/auth.ts';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'};
beforeEach(()=>{
  vi.resetAllMocks();
  for(const provider of ['GOOGLE','GITHUB']) {vi.stubEnv(`${provider}_CLIENT_ID`,`${provider.toLowerCase()}-client`);vi.stubEnv(`${provider}_CLIENT_SECRET`,'secret');}
  database.$transaction.mockImplementation(fn=>fn(database));
  database.user.findUnique.mockResolvedValue(null);database.identity.findUnique.mockResolvedValue(null);
  database.user.create.mockImplementation(({data})=>({id:'user1',sessionVersion:0,...data}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function client(){const app=express();app.use(express.json());app.use(session({secret:'test-session-secret-at-least-thirty-two',resave:false,saveUninitialized:false}));app.use('/api/auth',authRouter());return supertest.agent(app);}
function idToken(nonce:string,verified=true){
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:'google-client',sub:'google-user',email:'person@example.com',email_verified:verified,nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
  const body=`${header}.${payload}`;return `${body}.${sign('sha256',Buffer.from(body),keys.privateKey).toString('base64url')}`;
}
test.each(['google','github'])('%s OAuth validates state, uses PKCE and creates a verified identity',async provider=>{
  const agent=client();const start=await agent.get(`/api/auth/${provider}/start`);
  const url=new URL(start.headers.location);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:3000/api/auth/${provider}/callback`);
  const fetcher=vi.fn(async(input: string|URL|Request,init?:RequestInit)=>{
    const address=String(input);
    if(address.includes('certs'))return Response.json({keys:[jwk]});
    if(address.endsWith('/user/emails'))return Response.json([{email:'person@example.com',verified:true,primary:true}]);
    if(address.endsWith('/user'))return Response.json({id:123});
    const params=new URLSearchParams(String(init?.body));
    expect(params.get('code_verifier')).toBeTruthy();expect(params.get('code')).toBe('code');
    return Response.json({access_token:'access',token_type:'Bearer',expires_in:300,...(provider==='google'?{id_token:idToken(url.searchParams.get('nonce')!)}:{})});
  });vi.stubGlobal('fetch',fetcher);
  const result=await agent.get(`/api/auth/${provider}/callback?state=${url.searchParams.get('state')}&code=code`);
  expect(result.headers.location).toBe('/');
  expect(database.user.create).toHaveBeenCalledWith({data:expect.objectContaining({email:'person@example.com',emailVerifiedAt:expect.any(Date),identities:{create:{provider,subject:provider==='google'?'google-user':'123'}}})});
  const replay=await agent.get(`/api/auth/${provider}/callback?state=${url.searchParams.get('state')}&code=code`);
  expect(replay.headers.location).toContain('/login?error=');
});
test.each(['wrong-state','cancel'])('OAuth %s cannot create an account',async mode=>{
  const agent=client();const start=await agent.get('/api/auth/github/start');const url=new URL(start.headers.location);
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const result=await agent.get(`/api/auth/github/callback?state=${mode==='wrong-state'?'wrong':url.searchParams.get('state')}&${mode==='cancel'?'error=access_denied':'code=code'}`);
  expect(result.headers.location).toContain('/login?error=');expect(fetcher).not.toHaveBeenCalled();expect(database.user.create).not.toHaveBeenCalled();
});
test('matching emails never silently merge provider accounts',async()=>{
  database.user.findUnique.mockResolvedValue({id:'existing',email:'person@example.com',emailVerifiedAt:new Date()});
  await expect(resolveIdentity('github','123','person@example.com')).rejects.toThrow('Sign in');
  expect(database.identity.create).not.toHaveBeenCalled();
});
test('explicit connection requires the same verified email and cannot steal a linked identity',async()=>{
  database.user.findUnique.mockResolvedValue({id:'existing',email:'person@example.com',emailVerifiedAt:new Date()});
  await resolveIdentity('github','123','person@example.com','existing');
  expect(database.identity.create).toHaveBeenCalledWith({data:{userId:'existing',provider:'github',subject:'123'}});
  await expect(resolveIdentity('google','123','other@example.com','existing')).rejects.toThrow('same verified email');
  database.identity.findUnique.mockResolvedValue({userId:'another',user:{id:'another'}});
  await expect(resolveIdentity('github','123','person@example.com','existing')).rejects.toThrow('already connected');
});
