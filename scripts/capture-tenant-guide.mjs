import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { openTestDatabase } from '../tests/database.js';
import { createApp } from '../server/app.js';
import { insert } from '../server/db.js';
import { hashPassword, digest } from '../server/security.js';
process.env.SMPIS_TEST_EMBEDDED = 'true';
process.env.REQUIRE_MFA = 'false';
process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
const out = 'docs/tenant-guide/images';
await mkdir(out, { recursive: true });
const db = await openTestDatabase();
const app = await createApp(db);
const school = await insert(db,'schools',{name:'Greenfield Academy',short_code:'GFA',portal_slug:'school-gfa'});
const year = await insert(db,'academic_years',{school_id:school.id,name:'2026 / 2027',start_date:'2026-09-01',end_date:'2027-07-31'});
const term = await insert(db,'terms',{school_id:school.id,academic_year_id:year.id,name:'First Term',start_date:'2026-09-01',end_date:'2026-12-18',is_current:true});
const password = 'Example-password-2026!';
async function user(name,email,role) { return insert(db,'users',{school_id:school.id,name,email,role,password_hash:hashPassword(password),email_verified:true}); }
const admin = await user('School Administrator','admin@greenfield.example','SUPER_ADMIN');
await insert(db,'platform_operators',{user_id:admin.id});
const teacher = await user('Grace Adeyemi','grace@greenfield.example','TEACHER');
const parent = await user('Ada Obi','ada@example.test','PARENT');
const cls = await insert(db,'classes',{school_id:school.id,academic_year_id:year.id,name:'Primary 3',capacity:30,teacher_user_id:teacher.id});
app.use(express.static('dist'));
app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
const server = app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
async function session(u) {
 const token=randomBytes(20).toString('hex');
 await insert(db,'sessions',{user_id:u.id,token_hash:digest(token),csrf:token,mfa_verified:true,expires_at:new Date(Date.now()+3600000)});
 await page.context().addCookies([{name:'smpis_session',value:token,domain:'127.0.0.1',path:'/',secure:false,httpOnly:true,sameSite:'Lax'}]);
 const check=await page.request.get(origin+'/api/v1/me'); if(!check.ok()) throw Error('Demo session: '+await check.text());
 return token;
}
async function request(route,body,method='POST') {
 const response=await page.request.fetch(origin+'/api/v1'+route,{method,headers:{'x-csrf-token':csrf},data:body});
 if(!response.ok()) throw Error(route+': '+await response.text());
 return (await response.json()).data;
}
async function shot(name,locator=page) { await page.waitForTimeout(350); await locator.screenshot({path:`${out}/${name}.png`}); console.log('Captured '+name); }
async function nav(hash) { await page.goto(origin+'/school-gfa/#'+hash); await page.reload(); try {await page.locator('nav').waitFor({timeout:10000});} catch(e){console.log((await page.locator('body').innerText()).slice(0,3000)); throw e;} await page.waitForTimeout(450); }
async function button(name) {await page.getByRole('button',{name,exact:true}).click();}
async function close(){await page.locator('dialog button').first().click();}
let csrf;
try {
 await page.goto(origin+'/school-gfa/');
 const cookies=page.getByRole('button',{name:'Accept required cookies',exact:true}); if(await cookies.isVisible()) await cookies.click();
 await shot('01-login');
 csrf=await session(admin);
 await nav('administration'); await shot('02-school');
 await button('Calendar'); await shot('03-calendar');
 await button('Classes'); await button('New class');
 await page.getByLabel('Class name').fill('Primary 4'); await page.getByLabel('Academic year').last().selectOption(String(year.id));
 await shot('04-class',page.locator('dialog')); await close();
 await button('Users'); await button('Create account');
 await page.getByLabel('Full name').fill('Grace Adeyemi'); await page.getByLabel('Email address').fill('grace@greenfield.example'); await page.getByLabel('Role',{exact:false}).selectOption('TEACHER');
 await shot('05-teacher',page.locator('dialog')); await close();
 await button('Classes'); await page.getByRole('button',{name:'Edit class',exact:true}).first().click(); await shot('06-assign-teacher',page.locator('dialog')); await close();
 await nav('finance'); await button('Fee Structures'); await button('Set fee');
 await page.getByLabel('Class',{exact:false}).last().selectOption(String(cls.id)); await page.getByLabel('Fee category').selectOption('TUITION'); await page.getByLabel('Amount (NGN)').fill('120000');
 await shot('07-fees',page.locator('dialog')); await button('Save'); await page.locator('dialog').waitFor({state:'hidden'});
 await nav('administration'); await button('Integrations');
 const manual=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Manual fee payments',exact:true})});
 await manual.getByLabel('Bank name').fill('Example Bank'); await manual.getByLabel('Account name').fill('Greenfield Academy'); await manual.getByLabel('Account number').fill('0000000000'); await manual.getByLabel('Transfer instructions').fill('Use the student name and invoice number as your transfer narration.'); await manual.getByLabel('Enable this integration').check();
 await shot('08-bank',manual); await manual.getByRole('button',{name:'Save',exact:true}).click();
 const paystack=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Paystack',exact:true})}); await shot('09-gateway',paystack);
 const smtp=page.locator('.panel').filter({has:page.getByRole('heading',{name:'SMTP email',exact:true})}); await shot('10-email',smtp);
 await request('/admin/integrations/paystack',{enabled:true,public_key:'pk_test_demo_guide',secret_key:'sk_test_demo_guide',live_enabled:false},'PATCH');
 await nav('admissions'); await button('New application');
 await page.getByLabel('First name',{exact:false}).fill('Amara'); await page.getByLabel('Last name',{exact:false}).fill('Obi'); await page.getByLabel('Gender').selectOption('FEMALE'); await page.getByLabel('Date of birth').fill('2018-04-12'); await page.getByLabel('Applying for class').selectOption(String(cls.id)); await page.getByLabel('Parent / guardian name').fill('Ada Obi'); await page.getByLabel('Guardian phone').fill('+2348000000000'); await page.getByLabel('Guardian email').fill('ada@example.test');
 await shot('11-application',page.locator('dialog')); await button('Create application'); await page.locator('dialog').waitFor({state:'hidden'}); await shot('12-pipeline');
 const applications=await request('/admissions/applications',undefined,'GET'); const admission=applications[0];
 for(const stage of ['REVIEWED','ASSESSMENT_SCHEDULED','DECISION_PENDING','OFFERED','FEES_PENDING']) await request(`/admissions/applications/${admission.id}/stage`,{stage,notes:''},'PATCH');
 await nav('administration'); await button('Users'); await button('Create account'); await page.getByLabel('Full name').fill('Ada Obi'); await page.getByLabel('Email address').fill('ada@example.test'); await page.getByLabel('Role',{exact:false}).selectOption('PARENT'); await shot('13-parent-account',page.locator('dialog')); await close(); await shot('14-users');
 await nav('students'); await page.getByRole('button',{name:/View profile/}).first().click(); await button('Edit profile'); await page.getByLabel('Linked parent account ID').fill(String(parent.id)); await shot('15-link-child',page.locator('dialog')); await button('Save');
 await nav('finance'); await button('Generate invoice'); await page.getByLabel('Student',{exact:false}).last().selectOption(String(admission.student_id)); await shot('16-invoice',page.locator('dialog')); await page.locator('dialog').getByRole('button',{name:'Generate invoice',exact:true}).click(); await page.locator('dialog').waitFor({state:'hidden'});
 const invoices=await request(`/finance/invoices?term_id=${term.id}`,undefined,'GET'); const invoice=invoices[0];
 csrf=await session(parent); await nav('students'); await shot('17-my-children');
 await nav('finance'); await shot('18-parent-finance'); await button('Make a fee payment'); await page.locator('dialog').getByLabel('School payment method').selectOption('paystack'); await page.locator('dialog').getByLabel('Invoice',{exact:false}).selectOption(String(invoice.id)); await page.getByLabel('Payment amount').fill('120000'); await shot('19-online-payment',page.locator('dialog')); await page.locator('dialog').getByLabel('School payment method').selectOption('manual'); await page.locator('dialog').getByLabel('Invoice',{exact:false}).selectOption(String(invoice.id)); await page.getByLabel('Payment amount').fill('120000'); await page.getByLabel('Bank transfer reference').fill('GFA-AMARA-001'); await shot('19-parent-transfer',page.locator('dialog')); await button('Submit transfer for confirmation'); await page.locator('dialog').waitFor({state:'hidden'}); await shot('20-pending');
 csrf=await session(admin); await nav('finance'); await button('Confirm bank receipt'); await shot('21-confirm',page.locator('dialog')); await button('Confirm funds received'); await page.locator('dialog').waitFor({state:'hidden'});
 await nav('admissions'); await button('Enroll'); await shot('22-enroll',page.locator('dialog')); await button('Enroll student'); await page.locator('dialog').waitFor({state:'hidden'});
 csrf=await session(parent); await nav('finance'); await page.getByRole('button',{name:/View invoice/}).first().click(); await shot('23-receipt',page.locator('dialog'));
 if(errors.length) throw Error(errors.join('\n'));
} finally { await browser.close(); await new Promise(r=>server.close(r)); await db.close(); }
