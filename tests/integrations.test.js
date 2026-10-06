import { test as standaloneTest } from "node:test";
import { openTestDatabase } from "./database.js";
import nodemailer from "nodemailer";
import { runJobs } from "../server/jobs.js";
import { test } from './database.js';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase, insert, one } from '../server/db.js';
import { createApp } from '../server/app.js';
import { digest } from '../server/security.js';
import { integrationConfig, smtpConfig } from '../server/integrations.js';
import { paystackConfig } from '../server/paystack.js';

test('integration credentials enforce role, tenant isolation, encryption, redaction, retention and deletion', async (t) => {
  process.env.REQUIRE_MFA = 'false';
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  const db = await openTestDatabase();
  const app = await createApp(db);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  async function client(school, role, name) {
    const user = await insert(db, 'users', { school_id: school.id, role, name, email: `${name}@test.school`, password_hash: 'unused' });
    await insert(db, 'sessions', { user_id: user.id, token_hash: digest(name), csrf: name, mfa_verified: true, expires_at: new Date(Date.now()+60000) });
    return async (path, body, csrf = name) => {
      const r = await fetch(base+path, { method: body ? 'PATCH' : 'GET', headers: { Cookie: `smpis_session=${name}`, 'Content-Type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, text: await r.text() };
    };
  }
  try {
    const a = await insert(db, 'schools', { name:'A', short_code:'A' });
    const b = await insert(db, 'schools', { name:'B', short_code:'B' });
    const admin = await client(a, 'SUPER_ADMIN', 'admin');
    const other = await client(b, 'SUPER_ADMIN', 'other');
    const teacher = await client(a, 'TEACHER', 'teacher');
    assert.equal((await teacher('/admin/integrations')).status, 403);
    const config = { enabled:true, secret_key:'sk_test_private-secret', public_key:'pk_test_public' };
    assert.equal((await admin('/admin/integrations/paystack', config, 'wrong')).status,403);
    const saved = await admin('/admin/integrations/paystack', config);
    assert.equal(saved.status,200,saved.text); assert.ok(!saved.text.includes(config.secret_key));
    const record = await one(db,'SELECT * FROM school_integrations WHERE school_id=$1',[a.id]);
    assert.ok(!record.encrypted_config.includes(config.secret_key));
    assert.ok(!(await one(db,"SELECT new_value::text AS value FROM audit_logs WHERE entity_type='school_integrations'")).value.includes(config.secret_key));
    assert.equal((await paystackConfig(a.id,db)).key,config.secret_key);
    assert.equal(JSON.parse((await other('/admin/integrations')).text).data.paystack.enabled,false);
    assert.equal((await admin('/admin/integrations/paystack',{ ...config,secret_key:'' })).status,200);
    assert.equal((await integrationConfig(db,a.id,'paystack')).secret_key,config.secret_key);
    assert.equal((await admin('/admin/integrations/paystack',{enabled:false,clear_secrets:['secret_key']})).status,200);
    assert.equal(await paystackConfig(a.id,db),null);
    assert.equal((await integrationConfig(db,a.id,'paystack')).secret_key,'');
    assert.equal((await admin('/admin/integrations/smtp',{enabled:true,host:'smtp.example.com',port:587,username:'mail',password:'private-smtp',from:'sender@example.com'})).status,200);
    assert.equal((await smtpConfig(db,a.id)).transport.auth.pass,'private-smtp');
    assert.equal((await other('/admin/integrations/smtp',{enabled:true,host:'smtp.other.example',port:465,secure:true,username:'other-mail',password:'other-private',from:'other@example.com'})).status,200);
    const deliveries=[];
    t.mock.method(nodemailer,'createTransport', transport => ({sendMail:async message => {deliveries.push({transport,message});}}));
    await insert(db,'notifications',{school_id:a.id,email:'parent-a@example.com',title:'A notice',body:'For A',dedupe_key:'test-a'});
    await insert(db,'notifications',{school_id:b.id,email:'parent-b@example.com',title:'B notice',body:'For B',dedupe_key:'test-b'});
    await runJobs(db);
    assert.equal(deliveries.length,2);
    assert.equal(deliveries.find(d=>d.message.to==='parent-a@example.com').transport.auth.pass,'private-smtp');
    assert.equal(deliveries.find(d=>d.message.to==='parent-b@example.com').transport.auth.pass,'other-private');
    const appUrl = process.env.APP_URL;
    process.env.APP_URL='https://school.example.com';
    try {
      const reset = await fetch(base+'/auth/password-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@test.school'})});
      assert.equal(reset.status,200,await reset.text());
      assert.equal(deliveries.at(-1).transport.auth.pass,'private-smtp');
      assert.equal(deliveries.at(-1).message.from,'sender@example.com');
    } finally {if(appUrl===undefined)delete process.env.APP_URL;else process.env.APP_URL=appUrl;}

    assert.equal((await admin('/admin/integrations/twilio',{enabled:true})).status,422);
    const key = process.env.INTEGRATION_ENCRYPTION_KEY;
    process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    await assert.rejects(integrationConfig(db,a.id,'smtp'), /decrypted/);
    process.env.INTEGRATION_ENCRYPTION_KEY = key;
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); }
});

standaloneTest('runtime refuses local database and document fallbacks', async () => {
  const {createDocumentStorage} = await import('../server/document-storage.js');
  const saved = {...process.env};
  try {
    for(const k of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_STORAGE_BUCKET']) delete process.env[k];
    await assert.rejects(openDatabase(), /DATABASE_URL/);
    assert.throws(() => createDocumentStorage(), /Configure SUPABASE/);
  } finally { Object.assign(process.env,saved); }
});
