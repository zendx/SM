import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

const output = path.resolve('docs/SMPIS-School-Proposal-Henry-Shedrack.pdf');
const doc = new PDFDocument({ size: 'A4', margins: { top: 48, left: 48, right: 48, bottom: 20 }, info: {
  Title: 'SMPIS | A Connected Approach to School Management',
  Author: 'Henry Shedrack, Product Owner',
  Subject: 'School management product introduction and pilot proposal',
}});
const stream = fs.createWriteStream(output);
doc.pipe(stream);
const green = '#134E3B', ink = '#20352E', muted = '#53655E';
const width = 499;
function text(value, x, y, size=11, color=ink, font='Helvetica', options={}) {
  doc.font(font).fontSize(size).fillColor(color).text(value,x,y,{width,lineGap:4,...options});
}
function header(n) {
  doc.rect(0,0,595.28,12).fill(green);
  doc.image(path.resolve('src/assets/smpis-logo.png'),48,27,{width:190});
  text('SCHOOL MANAGEMENT',345,40,9,muted,'Helvetica',{width:202,align:'right'});
  doc.moveTo(48,775).lineTo(547,775).strokeColor('#DCE5DF').stroke();
  text('Henry Shedrack  |  Product Owner',48,788,9,muted);
  text(String(n)+' / 2',495,788,9,muted,'Helvetica',{width:52,align:'right'});
}
function section(title,body,y) {
  text(title,48,y,13,green,'Helvetica-Bold');
  text(body,48,y+23,10.5);
}
header(1);
text('Less time chasing records.\nMore time leading your school.',48,97,29,green,'Helvetica-Bold',{lineGap:5});
text('One connected view of learners, finances and daily operations.',48,185,13,muted);
text('A practical proposal for school proprietors, principals and administrators',48,229,10,muted);
section('The challenge schools face',
  'Admissions in paper files. Fee balances in spreadsheets. Parent enquiries across messaging groups. Results assembled by hand. When information is spread across separate systems, staff repeat work, leaders wait for updates and families struggle to find answers.',278);
section('Bring the work together with SMPIS',
  'SMPIS connects core school workflows so the people responsible can access the records they need. Follow a learner from application and enrollment through attendance, assessments, fees and published report cards.',389);
const rows = [
  ['Admissions and enrollment','Track applications, offers, required fees and enrollment progress.'],
  ['Fees and payments','Manage fee structures, invoices, payment records and receipts.'],
  ['Academic results','Record weighted scores, review results and publish report cards.'],
  ['Family access','Give linked parents access to their children\'s published information.'],
];
let y=492;
for (const [title,body] of rows) {
  doc.roundedRect(48,y,499,53,5).fill('#F0F5F1');
  text(title,61,y+9,11,green,'Helvetica-Bold',{width:470});
  text(body,61,y+28,10,ink,'Helvetica',{width:470,lineGap:0});
  y+=62;
}
doc.addPage(); header(2);
text('Connected workflows.\nClearer decisions.',48,94,27,green,'Helvetica-Bold');
text('The value comes from how the work fits together.',48,170,12,muted);
section('Follow the learner, from application to report card',
  'Track an application through admission and enrollment. Record attendance and assessment scores. Review and finalize term results, then publish reports for linked families. Each stage gives staff a clearer record to follow.',211);
section('Make fee administration easier to follow',
  'Keep invoices, online payments, confirmed bank transfers and receipts connected. Finance teams can trace balances and payment history, while parents can review the relevant records through their portal.',309);
section('Give each person the access their role needs',
  'School administrators, teachers, finance staff, parents and students use access suited to their responsibilities. Dashboards and reports help leadership review school information; complaints, discipline, facilities and asset records support operational follow-up.',407);
doc.roundedRect(48,518,499,116,7).fill(green);
text('Start with a focused pilot',64,534,17,'#FFFFFF','Helvetica-Bold',{width:465});
text('Choose one class or one workflow. Agree what success looks like, prepare the essential records and guide the responsible staff through it. Review time spent reconciling fees, preparing report cards or answering routine parent enquiries before expanding.',64,564,10.5,'#FFFFFF','Helvetica',{width:465});
text('See how SMPIS fits your school',48,657,17,green,'Helvetica-Bold');
text('Arrange a demonstration and discuss a pilot with Henry Shedrack, Product Owner.',48,686,11);
doc.font('Helvetica-Bold').fontSize(11).fillColor(green).text('Explore SMPIS at smpis.digital',48,723,{link:'https://smpis.digital',underline:true});
text('Scope: exam administration covers scheduling, score entry and report cards. Online exam questions and computer-based testing are not included.',48,743,8,muted,'Helvetica',{lineGap:1});
doc.end();
await new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject);});
console.log(output);

