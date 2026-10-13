import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { chromium } from '@playwright/test';
import { openTestDatabase } from '../tests/database.js';
import { createApp } from '../server/app.js';
import { insert } from '../server/db.js';
import { digest, hashPassword, localClock } from '../server/security.js';
import { generateInvoice, recordPayment } from '../server/services.js';

process.env.SMPIS_TEST_EMBEDDED='true';
process.env.REQUIRE_MFA='false';
process.env.INTEGRATION_ENCRYPTION_KEY=randomBytes(32).toString('hex');
const dry=process.argv.includes('--dry-run');
const directory=path.resolve('docs/marketing-video-v2');
await mkdir(directory+'/recordings',{recursive:true});
await mkdir(directory+'/review',{recursive:true});
const db=await openTestDatabase();
const app=await createApp(db);
const school=await insert(db,'schools',{name:'Greenfield Academy',short_code:'GFA',portal_slug:'school-gfa'});
const academicYear=await insert(db,'academic_years',{school_id:school.id,name:'2026 / 2027',start_date:'2026-09-01',end_date:'2027-07-31'});
const term=await insert(db,'terms',{school_id:school.id,academic_year_id:academicYear.id,name:'First Term',start_date:'2026-09-01',end_date:'2026-12-18',is_current:true});
async function account(name,email,role){return insert(db,'users',{school_id:school.id,name,email,role,password_hash:hashPassword('Demo-password-2026!'),email_verified:true});}
const admin=await account('School Administrator','admin@greenfield.example','SUPER_ADMIN');
await insert(db,'platform_operators',{user_id:admin.id});
const teacher=await account('Grace Adeyemi','grace@greenfield.example','TEACHER');
const parent=await account('Ada Obi','ada@example.test','PARENT');
const classes=[];
for(const name of ['Primary 3','Primary 4','Primary 5','JSS 1'])classes.push(await insert(db,'classes',{school_id:school.id,academic_year_id:academicYear.id,name,capacity:30,teacher_user_id:teacher.id}));
for(const cls of classes)await insert(db,'fee_structures',{school_id:school.id,class_id:cls.id,term_id:term.id,fee_category:'TUITION',amount_cents:12000000});
const names=[['Amara','Obi'],['Chidi','Obi'],['Kemi','Adeleke'],['Daniel','Okafor'],['Zara','Bello'],['Tomi','Adeyemi'],['Emeka','Nwosu'],['Sade','Ajayi'],['Ife','Ojo'],['Maya','Eze'],['David','Akin'],['Ella','Udoh']];
const students=[],invoices=[];
for(let i=0;i<names.length;i++){
 const student=await insert(db,'students',{school_id:school.id,student_number:`GFA-${String(i+1).padStart(4,'0')}`,first_name:names[i][0],last_name:names[i][1],gender:i%2?'MALE':'FEMALE',date_of_birth:'2016-04-12',guardian_name:i<2?'Ada Obi':'Demo Guardian',guardian_phone:'+2348000000000',guardian_email:i<2?'ada@example.test':'guardian@example.test',parent_user_id:i<2?parent.id:null,status:'ENROLLED',class_id:classes[i<8?0:i<10?1:2].id});
 students.push(student);
 await insert(db,'student_enrollment',{school_id:school.id,student_id:student.id,class_id:student.class_id,enrollment_date:'2026-09-01',status:'ACTIVE'});
 const invoice=await generateInvoice(db,admin,{student_id:student.id,term_id:term.id,due_date:'2026-11-01'});invoices.push(invoice);
 const paid=i<2?6000000:i%3?12000000:0;
 if(paid)await recordPayment(db,admin,{invoice_id:invoice.id,amount_cents:paid,payment_method:'BANK_TRANSFER',reference_number:`DEMO-${i+1}`,idempotency_key:`demo-payment-${i+1}`});
 for(let d=1;d<=4;d++)await insert(db,'student_attendance',{school_id:school.id,student_id:student.id,class_id:student.class_id,attendance_date:`2026-10-0${d}`,status:'PRESENT',recorded_by:teacher.id});
}
for(const [index,name] of ['Mathematics','English','Basic Science'].entries()){
 const subject=await insert(db,'subjects',{school_id:school.id,name,code:['MAT','ENG','SCI'][index]});
 const assignment=await insert(db,'class_subjects',{school_id:school.id,class_id:classes[0].id,subject_id:subject.id,teacher_user_id:teacher.id});
 const assessment=await insert(db,'assessments',{school_id:school.id,class_subject_id:assignment.id,term_id:term.id,name:`${name} Term Assessment`,type:'CA',max_score:100,weight_percent:100,assessment_date:'2026-10-01',created_by:teacher.id});
 for(let i=0;i<8;i++)await insert(db,'student_scores',{school_id:school.id,assessment_id:assessment.id,student_id:students[i].id,score:74+(i*3+index*4)%22,entered_by:teacher.id});
}
app.use('/promo-assets',express.static(path.resolve('docs/marketing-video/assets')));
app.get('/promo-logo.png',(req,res)=>res.sendFile(path.resolve('src/assets/smpis-logo.png')));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{width:1920px;height:1080px;margin:0;overflow:hidden;font-family:Arial,sans-serif;background:#0e3829;color:#153d2d}.shell{position:relative;width:1920px;height:1080px;background:radial-gradient(ellipse at 90% 0%,#d5e6bb,#f8faf2 65%)}.brand{position:absolute;top:29px;left:83px;width:304px;height:93px;object-fit:contain;z-index:20;border-radius:9px;box-shadow:0 5px 18px #25462a12}.heading{position:absolute;left:441px;top:34px;width:1270px;z-index:12}.eyebrow{font-size:15px;letter-spacing:3px;color:#527552;font-weight:bold;margin-bottom:9px}.title{font-size:49px;font-weight:750;letter-spacing:-1px;line-height:1.12}.window{position:absolute;top:152px;left:90px;width:1740px;height:835px;border:7px solid #204b35;border-radius:19px;overflow:hidden;box-shadow:0 20px 50px #21422d2b;opacity:0;transform:translateY(20px);transition:opacity .2s,transform .28s}.window.active{opacity:1;transform:none}.browserbar{height:33px;background:#214b35;display:flex;align-items:center;gap:8px;padding-left:15px;color:#bed2ac;font-size:12px;letter-spacing:1px}.dot{width:8px;height:8px;border-radius:50%;background:#b6ce9b}.browserbar .address{margin:auto;font-size:13px;letter-spacing:.7px;padding-right:65px}iframe{display:block;border:0;width:1726px;height:788px;background:white}.footer{position:absolute;bottom:35px;left:96px;right:96px;display:flex;justify-content:space-between;align-items:center;color:#567951;font-size:17px}.footer b{background:#d8ecad;color:#254d33;padding:13px 24px;border-radius:30px;font-size:22px}.pointer{position:absolute;left:0;top:0;width:43px;height:53px;z-index:100;pointer-events:none;filter:drop-shadow(0 3px 4px #0006);transform:translate(1800px,970px);transition:transform .5s cubic-bezier(.3,.05,.2,1);opacity:0}.pointer.active{opacity:1}.pointer svg{width:100%;height:100%}.click-ring{position:absolute;width:70px;height:70px;border:4px solid #ffcf49;border-radius:50%;pointer-events:none;z-index:99;opacity:0}.click-ring.pulse{animation:pulse .38s ease-out}.target{position:absolute;border:3px solid #e8b62b;border-radius:9px;box-shadow:0 0 0 5px #ffdb5930;pointer-events:none;z-index:98;opacity:0;transition:opacity .12s}.target.on{opacity:1}.hero{position:absolute;inset:0;background:#133e2b;z-index:30;display:none;color:#fff9e9}.hero.active{display:block}.photo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:photo 7s ease-out both}.shade{position:absolute;inset:0;background:linear-gradient(90deg,#103623f2 0%,#103623be 43%,#10362320 86%)}.hero .hero-logo{position:absolute;left:90px;top:60px;width:385px;height:auto;object-fit:contain;border-radius:10px;box-shadow:0 9px 35px #0002}.hero-copy{position:absolute;left:105px;top:305px;max-width:1100px}.hero-kicker{font-weight:bold;font-size:20px;letter-spacing:4px;color:#d7efb6;animation:rise .35s .08s both}.hero h1{font-size:119px;line-height:1.02;letter-spacing:-4px;margin:20px 0 25px;animation:rise .38s .12s both}.hero .sub{font-size:34px;color:#e3efce;animation:rise .35s .22s both}.hero .cta{margin-top:28px;display:inline-block;background:#ffda54;color:#173d28;padding:23px 37px;font-size:43px;font-weight:bold;border-radius:13px;animation:bounceIn .45s .27s both}.hero .small{font-size:20px;color:#d4e3c7;margin-top:22px;animation:rise .35s .34s both}.hero .badge{position:absolute;right:94px;top:71px;font-size:20px;font-weight:bold;color:#183c29;padding:16px 26px;border-radius:30px;background:#d4ecaa;animation:rise .3s both}.strip{position:absolute;left:104px;bottom:88px;display:flex;gap:15px}.strip span{background:#f7fae520;border:1px solid #e9f1cf55;padding:12px 25px;border-radius:30px;font-size:24px;animation:rise .35s both}.strip span:nth-child(2){animation-delay:.12s}.strip span:nth-child(3){animation-delay:.24s}.progress{position:absolute;left:0;bottom:0;height:7px;background:#ffd54e;width:0;z-index:120}.confetti{position:absolute;width:13px;height:25px;background:#fddb53;top:-50px;opacity:.75;animation:fall 3s linear infinite}.hero.ending .hero-copy{top:252px}.hero.ending h1{font-size:113px}.hero.ending .trial{color:#ffdf60}
@keyframes pulse{0%{transform:scale(.25);opacity:1}100%{transform:scale(1.2);opacity:0}}@keyframes rise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}@keyframes bounceIn{0%{opacity:0;transform:scale(.88)}75%{opacity:1;transform:scale(1.025)}100%{transform:scale(1)}}@keyframes photo{from{transform:scale(1.025)}to{transform:scale(1.09)}}@keyframes fall{to{transform:translateY(1150px) rotate(550deg)}}
</style><div class="shell"><img class="brand" src="/promo-logo.png"><div class="heading"><div class="eyebrow" id="eyebrow">ONE CONNECTED WORKSPACE</div><div class="title" id="title">Your whole school. One clear view.</div></div><div class="window" id="window"><div class="browserbar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span class="address">smpis.digital · Your school portal</span></div><iframe id="portal" src="/school-gfa/#dashboard"></iframe></div><div class="footer"><span>Actual portal · Fictional demonstration school</span><b>30-day free trial &nbsp; → &nbsp; smpis.digital</b></div><div class="target" id="target"></div><div class="click-ring" id="ring"></div><div class="pointer" id="pointer"><svg viewBox="0 0 43 53"><path d="M4 3L4 42L15 32L23 49L31 45L23 28L38 27Z" fill="#163d2c" stroke="#fffbed" stroke-width="3.5" stroke-linejoin="round"/></svg></div><div class="hero active" id="hero"><img class="photo" src="/promo-assets/school-cinematic.png"><div class="shade"></div><img class="hero-logo" src="/promo-logo.png"><div class="badge">smpis.digital</div><div class="hero-copy" id="hero-copy"><div class="hero-kicker">A HAPPIER WAY TO RUN YOUR SCHOOL</div><h1>Less admin.<br>More possibility.</h1><div class="sub">Meet your school’s connected workspace.</div></div><div class="strip"><span>People</span><span>Progress</span><span>Payments</span></div></div><div class="progress" id="progress"></div></div><script>
window.movePointer=(x,y)=>{document.getElementById('pointer').style.transform='translate('+x+'px,'+y+'px)'};
window.highlight=(box)=>{const e=document.getElementById('target');e.style.left=(box.x-5)+'px';e.style.top=(box.y-5)+'px';e.style.width=(box.width+10)+'px';e.style.height=(box.height+10)+'px';e.classList.add('on');setTimeout(()=>e.classList.remove('on'),500)};
window.clickPulse=(x,y)=>{const r=document.getElementById('ring');r.style.left=(x-35)+'px';r.style.top=(y-35)+'px';r.classList.remove('pulse');void r.offsetWidth;r.classList.add('pulse')};
window.product=(kicker,title)=>{document.getElementById('hero').classList.remove('active');document.getElementById('window').classList.add('active');document.getElementById('pointer').classList.add('active');document.getElementById('eyebrow').textContent=kicker;const t=document.getElementById('title');t.textContent=title;t.animate([{opacity:0,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:250,fill:'both'})};
window.endCard=()=>{document.getElementById('pointer').classList.remove('active');document.getElementById('hero-copy').innerHTML='<div class="hero-kicker">YOUR NEXT SCHOOL DAY STARTS HERE</div><h1>Start your<br><span class="trial">30-day free trial.</span></h1><div class="sub">No card required. All core modules.</div><div class="cta">smpis.digital/signup &nbsp; ↗</div><div class="small">Access pauses after the trial. Upgrade to continue.</div>';const hero=document.getElementById('hero');hero.classList.add('active','ending');for(let i=0;i<14;i++){const p=document.createElement('i');p.className='confetti';p.style.left=(1100+(i*53)%780)+'px';p.style.animationDelay=(i*.13)+'s';p.style.background=i%2?'#cfeb9c':'#ffdb55';hero.appendChild(p)}};
window.begin=()=>{window.started=performance.now();document.getElementById('progress').animate([{width:'0px'},{width:'1920px'}],{duration:60000,fill:'forwards',easing:'linear'});document.querySelectorAll('.hero-copy>*').forEach(e=>{e.style.animation='none';void e.offsetWidth;e.style.animation=''});};
</script></html>`;
await writeFile(directory+'/stage-source.html',html);
app.get('/promo',(req,res)=>res.type('html').send(html));
app.use(express.static('dist'));
app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:dry?undefined:{dir:directory+'/recordings',size:{width:1920,height:1080}}});
async function setSession(user){const token=randomBytes(20).toString('hex');await insert(db,'sessions',{user_id:user.id,token_hash:digest(token),csrf:token,mfa_verified:true,expires_at:new Date(Date.now()+3600000)});await context.addCookies([{name:'smpis_session',value:token,domain:'127.0.0.1',path:'/',secure:false,httpOnly:true,sameSite:'Lax'}]);return token;}
let csrf=await setSession(admin);
const setting=await context.request.patch(origin+'/api/v1/admin/integrations/manual',{headers:{'x-csrf-token':csrf},data:{enabled:true,bank_name:'Example Bank',account_name:'Greenfield Academy',account_number:'0000000000',instructions:'Use the student name and invoice number in the transfer narration.'}});
if(!setting.ok())throw Error(await setting.text());
const page=await context.newPage();
page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const cues=[];let start;
const iframe=()=>page.frameLocator('#portal');
const button=name=>iframe().getByRole('button',{name,exact:true});
const menu=name=>iframe().locator('nav').getByRole('button',{name,exact:true});
async function pointer(locator,click=false){await locator.waitFor({state:'visible'});await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();if(!box)throw Error('Missing bounding box');const x=box.x+box.width*.55,y=box.y+box.height*.55;await page.evaluate(([x,y])=>window.movePointer(x,y),[x,y]);await page.mouse.move(x,y,{steps:12});await page.waitForTimeout(dry?20:480);if(click){await page.evaluate(([x,y,b])=>{window.clickPulse(x,y);window.highlight(b)},[x,y,box]);cues.push({type:'click',time:dry?0:(performance.now()-start)/1000});await locator.click();}}
async function caption(kicker,title){await page.evaluate(([k,t])=>window.product(k,t),[kicker,title]);cues.push({type:'whoosh',time:dry?0:(performance.now()-start)/1000});}
async function at(time,fn){if(!dry){const remaining=time*1000-(performance.now()-start);if(remaining>0)await page.waitForTimeout(remaining);}await fn();if(!dry && (performance.now()-start)/1000>time+2.5)console.log('Timing note at '+time+'s');}
async function preview(name){if(dry)await page.screenshot({path:directory+`/review/${name}.png`});}
try{
 await page.goto(origin+'/promo');await iframe().locator('nav').waitFor();await page.evaluate(()=>document.getElementById('hero').style.pointerEvents='none');
 const cookies=iframe().getByRole('button',{name:'Accept required cookies',exact:true});await cookies.waitFor({state:'visible',timeout:5000}).catch(()=>{});if(await cookies.isVisible()){await cookies.click();await cookies.waitFor({state:'hidden'});}
 await page.waitForTimeout(350);
 await page.screenshot({path:directory+'/review/intro.png'});
 start=performance.now();await page.evaluate(()=>window.begin());
 await at(3,async()=>{await caption('YOUR SCHOOL, CONNECTED','Your whole school. One clear view.');await pointer(iframe().getByText('Enrolled students',{exact:true}).first());});
 await at(5,async()=>{await pointer(iframe().getByText('Fees collected',{exact:true}).first());await preview('dashboard');});
 await at(7,async()=>{await pointer(menu('Administration'));});
 await at(9,async()=>{await caption('CLASSES & TEACHERS','Build a school that works together.');await pointer(menu('Administration'),true);await pointer(button('Classes'),true);});
 await at(11.5,async()=>{await pointer(button('Edit class').first(),true);});
 await at(13,async()=>{await pointer(iframe().getByLabel('Class teacher'));await preview('classes');});
 await at(14.5,async()=>{await pointer(iframe().locator('dialog').getByRole('button',{name:'Save',exact:true}),true);});
 await at(16,async()=>{await caption('FEES, WITHOUT THE GUESSWORK','Clear bills. Clear balances.');await pointer(menu('Finance'),true);});
 await at(18,async()=>{await pointer(button('Fee Structures'),true);await pointer(button('Set fee'),true);});
 await at(20,async()=>{const dialog=iframe().locator('dialog');await pointer(dialog.getByLabel('Class',{exact:false}));await dialog.getByLabel('Class',{exact:false}).selectOption(String(classes[0].id));await pointer(dialog.getByLabel('Fee category'));await dialog.getByLabel('Fee category').selectOption('TUITION');await pointer(dialog.getByLabel('Amount (NGN)'));await dialog.getByLabel('Amount (NGN)').fill('120000');await preview('fees');});
 await at(22.5,async()=>{await pointer(iframe().locator('dialog').getByRole('button',{name:'Save',exact:true}),true);});
 await at(24,async()=>{await caption('MAKE EVERY SCHOOL DAY COUNT','Attendance, just a few clicks away.');await pointer(menu('Attendance'),true);});
 await at(26,async()=>{await pointer(iframe().getByLabel('Attendance class'));await iframe().getByLabel('Attendance class').selectOption(String(classes[0].id));await pointer(button('All present'),true);});
 await at(28.5,async()=>{await pointer(button('Save attendance'),true);cues.push({type:'success',time:dry?0:(performance.now()-start)/1000});await preview('attendance');});
 await at(31,async()=>{await caption('FOLLOW PROGRESS. FOCUS SUPPORT.','See how your learners are doing.');await pointer(menu('Academics'),true);});
 await at(33,async()=>{await pointer(button('Gradebook'),true);});
 await at(34.5,async()=>{await pointer(iframe().getByLabel('Gradebook class'));await iframe().getByLabel('Gradebook class').selectOption(String(classes[0].id));});
 await at(36,async()=>{await pointer(iframe().getByText('Overall average',{exact:true}));await preview('gradebook');});
 await at(38,async()=>{await pointer(menu('Overview'),true);});
 await at(39,async()=>{await caption('FAMILIES, BETTER CONNECTED','One parent login. Every linked child.');csrf=await setSession(parent);await page.evaluate(()=>document.getElementById('portal').src='/school-gfa/?demo=parent#students');await iframe().getByRole('heading',{name:'My children',exact:true}).waitFor();});
 await at(41,async()=>{await pointer(iframe().getByRole('button',{name:/View profile/}).first(),true);await preview('family');});
 await at(43,async()=>{await pointer(iframe().locator('dialog button').first(),true);await pointer(menu('Finance'),true);});
 await at(45,async()=>{await pointer(iframe().getByRole('button',{name:/View invoice/}).first());await preview('parent-finance');});
 await at(47,async()=>{await caption('PARENT PAYMENTS, SIMPLIFIED','Choose a bill. Choose a payment method.');await pointer(button('Make a fee payment'),true);});
 await at(49,async()=>{const dialog=iframe().locator('dialog');await pointer(dialog.getByLabel('Invoice',{exact:false}));await dialog.getByLabel('Invoice',{exact:false}).selectOption(String(invoices[0].id));await pointer(dialog.getByLabel('Payment amount'));await dialog.getByLabel('Payment amount').fill('60000');});
 await at(51,async()=>{await pointer(iframe().getByLabel('Bank transfer reference'));await iframe().getByLabel('Bank transfer reference').fill('DEMO-AMARA-001');await preview('payment');});
 await at(53,async()=>{await page.evaluate(()=>window.endCard());cues.push({type:'whoosh',time:dry?0:(performance.now()-start)/1000});cues.push({type:'success',time:dry?0:(performance.now()-start)/1000+.15});});
 await at(56,async()=>{await page.screenshot({path:directory+'/SMPIS-60s-Trial-Poster.png'});});
 await at(60,async()=>{});
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(directory+'/sound-cues.json',JSON.stringify(cues,null,2));
 if(!dry){const video=page.video();await page.close();await video.saveAs(directory+'/recordings/product-navigation.webm');}
 console.log(dry?'Demo navigation and layouts checked.':'Recorded 60-second animated navigation.');
}catch(e){await page.screenshot({path:directory+'/review/capture-error.png'});console.log((await page.locator('body').innerText()).slice(0,900));throw e;}
finally{await context.close();await browser.close();await new Promise(r=>server.close(r));await db.close();}
