"""Rebuild the printable guide while preserving the existing screenshot chapters.

Run from the repository root. Print the resulting HTML using Chrome/Edge at A4,
with background graphics enabled and browser headers/footers disabled.
"""
from pathlib import Path
from html import escape
import re

path = Path('docs/tenant-guide/SMPIS-School-Starter-Guide.html')
source = path.read_text(encoding='utf-8')
sections = re.findall(r'<section\b.*?</section>', source, re.S)
chapters = {}
for section in sections:
    match = re.search(r'id="chapter-(\d+)"', section)
    if match:
        chapters[int(match[1])] = section
assert len(chapters) == 22, 'Expected all 22 original screenshot walkthroughs'
head = source[:source.index('<body>')]
head = re.sub(r'<style id="guide-update">.*?</style>', '', head, flags=re.S)
head = head.replace('</head>', '''<style id="guide-update">
.text-page h2{font-size:27px}.text-page dl{margin:12px 0}.text-page dt{font-size:12px;margin-top:12px}.text-page dd{font-size:12px;line-height:1.55;margin:3px 0 0}.text-page table{width:100%;border-collapse:collapse;font-size:11px;margin:16px 0}.text-page th,.text-page td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #dce4d7}.text-page th{background:#edf3e6}.text-page .tip{margin-top:16px}.contents a{font-size:12px;padding:9px 0}.page{overflow:visible}a{color:#386446}.flow{display:flex;gap:10px;margin:25px 0}.flow div{flex:1;background:#edf3e6;padding:16px 12px;border-radius:6px}.flow b{display:block;font-size:20px}.intro{font-size:13px}
</style></head>''')
pages = []
def page(id, group, title, route, intro='', body='', tip=''):
    content = f'<section class="page text-page" id="{id}"><div class="kicker">{escape(group)}</div><h2>{escape(title)}</h2>'
    if route: content += f'<div class="route">{escape(route)}</div>'
    if intro: content += f'<p class="intro">{intro}</p>'
    content += body
    if tip: content += f'<div class="tip">{tip}</div>'
    pages.append(content + '</section>')
def dl(items):
    return '<dl>' + ''.join(f'<dt>{escape(a)}</dt><dd>{b}</dd>' for a,b in items) + '</dl>'
def ol(items):
    return '<ol>' + ''.join(f'<li>{x}</li>' for x in items) + '</ol>'
def old(n):
    section = re.sub(r'<div class="footer">.*?</div>', '', chapters[n], flags=re.S)
    section = re.sub(r'<div class="kicker">.*?</div>', '<div class="kicker">SCREENSHOT WALKTHROUGH</div>', section, count=1, flags=re.S)
    pages.append(section)

cover = next(s for s in sections if 'class="page cover"' in s)
cover = re.sub(r'<div class="footer">.*?</div>', '', cover, flags=re.S)
cover = re.sub(r'<h1>.*?</h1>', '<h1>Your school.<br>Your setup.<br><em>Step by step.</em></h1>', cover, flags=re.S)
cover = re.sub(r'<p class="lead">.*?</p>', '<p class="lead">Set up your school, prepare admissions, organise exams and results, then manage fees and everyday school work.</p>', cover, flags=re.S)
cover = re.sub(r'<div class="cover-flow">.*?</div>', '<div class="cover-flow">Admissions &amp; school setup → Academics → Finance → Daily operations</div>', cover, flags=re.S)
pages.append(cover)
page('start', 'START HERE', 'Your first actions after signup', 'School portal → sign in as your school administrator',
     'Work through the three phases below. Use the school portal link in your welcome email. Menu visibility depends on your role and subscription; an absent button may require your school administrator.',
     '<div class="flow"><div><b>01</b>Admissions<br>&amp; school setup</div><div><b>02</b>Academics<br>&amp; examinations</div><div><b>03</b>Finance<br>&amp; enrollment</div></div>' + ol([
         'Verify your email and complete any required two-step verification. Confirm that you are in the correct school portal.',
         '<b>Prepare Admissions first:</b> configure the school, calendar, classes, staff accounts and integrations. These setup screens are under <b>Administration</b> in the current portal. Then use <b>Admissions</b> for learner applications.',
         '<b>Next, Academics:</b> add subjects, assign subject teachers, confirm grading rules and plan assessments. Prepare now; enter marks and generate reports once learners are enrolled and exams have been marked.',
         '<b>Then, Finance:</b> set class fees, generate invoices, confirm payment or approved waiver, and return to Admissions to complete enrollment.',
         'Use the remaining menus for attendance, curriculum, staff, communication, school operations and ongoing reporting.'
     ]), 'School settings, users and integrations are found in <b>Administration</b>. <b>Admissions</b> is the application pipeline. Follow the exact menu routes printed on each page.')
toc_index = len(pages)
pages.append('CONTENTS')
page('admissions-map', '01 · ADMISSIONS & SCHOOL SETUP', 'Prepare the school before applications', 'Administration → School, Calendar, Users, Classes, Integrations',
     'Start here immediately after creating your tenant account. This is the foundation for Admissions, Academics and Finance.',
     ol(['<b>School:</b> save your school name, currency, timezone and operational settings.',
         '<b>Calendar:</b> create the academic year, create its terms, then mark the intended term current.',
         '<b>Users:</b> create individual accounts for teachers, admissions officers, finance officers and school leaders. Select each person’s correct role.',
         '<b>Classes:</b> create classes for the correct academic year, set capacities and assign class teachers after their accounts exist.',
         '<b>Integrations:</b> prepare account email delivery and the school payment methods you intend to offer.',
         '<b>Admissions:</b> create learner applications and review them through the pipeline. Stop at Fees Pending until Finance is ready.'
     ]), 'A teacher login, a class-teacher assignment and a subject-teacher assignment are separate records. Complete the first two here and the subject assignment in Academics → Setup.')
page('administration-menus', '01 · MENU REFERENCE', 'Administration: every submenu', 'Administration', body=dl([
    ('School', 'School name, boarding status, transport availability, currency, timezone, attendance thresholds and staff attendance times. Save these before entering operational records.'),
    ('Classes', 'Create or edit a class, its capacity, academic year and class teacher. Choose the correct year so the class appears with its terms.'),
    ('Calendar', 'Create academic years and terms, enter their dates and select the current term. Check the top-bar term before billing or recording results.'),
    ('Users', 'Create logins and choose roles such as Teacher, Admissions Officer, Finance Officer, Principal, Vice Principal or Parent. Manage status and account access here. Staff records alone do not create login access.'),
    ('Permissions', 'Review which actions each role can perform. Use this when someone cannot see a menu or button.'),
    ('Audit trail', 'Review who changed a record, when they changed it and the recorded changes. Use it to investigate discrepancies.'),
    ('Security', 'Configure two-step verification and recovery access for your account.'),
    ('Integrations', 'Configure school payment methods and email delivery. Details follow in this section.'),
    ('Site settings', 'Manage the school site settings available to the school administrator, including presentation and branding options shown in the portal.')
]))
old(0); old(1); old(2)
old(4); old(3); old(5)
page('roles', '01 · USERS & RESPONSIBILITIES', 'Give each person the right role', 'Administration → Users → Create account', body=dl([
    ('Full name, Email address and Initial password', 'Enter the actual user’s name and a unique working email. Use an initial password of at least 12 characters. Check the account creation and email delivery result separately.'),
    ('Super Admin', 'The school tenant administrator handles school setup, user access, integrations and term entry controls. This is separate from the platform owner console.'),
    ('Teacher', 'Records marks for explicitly assigned subjects and works with permitted learners. A class-teacher assignment alone does not grant grading access to every subject.'),
    ('Admissions Officer', 'Processes applications and learner admission records. This role does not replace the school administrator for integrations or account setup.'),
    ('Finance Officer', 'Manages permitted invoices, payments and fee records. Give finance work to a finance account rather than sharing an administrator login.'),
    ('Principal and Vice Principal', 'Manage academic setup and report preparation within their permissions. Publishing and administrator-only actions depend on role.'),
    ('Proprietor', 'Reviews available school summaries. This role does not currently have score-entry permission.'),
    ('Parent and Student', 'Receive access to their linked records and published results. Link accounts to the intended learners; a matching name alone does not create access.')
]), tip='Create each teacher, admissions officer and finance officer as a separate user. Check the Permissions submenu if their available actions differ from the examples.')
page('integration-map', '01 · INTEGRATIONS', 'What each integration does', 'Administration → Integrations', body=dl([
    ('Manual fee payments', 'Publishes bank name, account name, account number and transfer instructions. Parents submit a transfer reference; school finance checks actual funds before crediting an invoice.'),
    ('Paystack', 'Uses the school merchant public key and secret key for online school fee checkout. Enable live payments only after testing the configured school account.'),
    ('Flutterwave', 'Uses the school public key, secret key and webhook secret to collect and verify online school fees.'),
    ('Stripe', 'Uses the school secret key for Stripe Checkout. Configure and test the account shown in the school integration panel.'),
    ('PayPal', 'Uses the school client ID and client secret for PayPal payments in a supported school currency.'),
    ('SMTP email', 'Configures the school sender and email server for account invitations and other supported messages. Check hostname, port, credentials and sender, then verify delivery.'),
    ('Twilio', 'Stores SMS credentials and sender information. The current application does not yet provide SMS delivery; saving credentials does not send messages.')
]), tip='The Enable integration switch controls availability. Test mode confirms the setup without crediting live invoices. Leave a saved secret blank when the form says a blank value keeps the existing credential.')
old(7); old(8); old(9)
page('admissions-menus', '01 · ADMISSIONS', 'Understand the application pipeline', 'Admissions → New application / Application pipeline', body=dl([
    ('New application', 'Captures learner names, gender, date of birth, intended class and guardian details. The intended class must already exist.'),
    ('Application pipeline and stage filter', 'Shows each applicant, guardian, class, stage and next action. Filter by stage to find work waiting on the admissions office.'),
    ('Submitted → Reviewed', 'Register the application, inspect its information and record the review notes requested by the action.'),
    ('Assessment Scheduled → Decision Pending', 'Arrange the applicant’s admission assessment and record the decision process. This admission screening is separate from a term exam in Academics.'),
    ('Offered → Fees Pending', 'Issue the place offer and prepare the learner for billing. Finance must confirm the required invoice is paid or waived before enrollment.'),
    ('Enrolled / Rejected', 'Enrolled is the completed admission outcome; manage that learner under Students. Rejected records an unsuccessful application.'),
    ('Enroll', 'At Fees Pending, review the term and class, then confirm Enroll student after fee and capacity checks pass.')
]), tip='Start applications now, then continue to Academics and Finance setup. Return to the enrollment walkthrough in the Finance section after the invoice has been settled or waived.')
old(10); old(11)

page('academics-map', '02 · ACADEMICS', 'Academics: every submenu', 'Academics → select the correct term', body=dl([
    ('Setup', 'Create subjects, assign each class subject to a teacher, configure grading rules and control score-entry closure. Academic managers perform setup; teachers use their assigned subjects.'),
    ('Assessments', 'Create exams, tests, continuous assessments, assignments, practicals or projects. Filter by class and subject; use Grade / enter scores to record marks.'),
    ('Records', 'Check historical class rosters, amend membership or elective subjects with a reason, set a class grading policy and schedule the exam timetable. Available to academic managers.'),
    ('Gradebook', 'Review class and subject totals, grades and completion. Use the Grade buttons above the summary to open assessment score entry directly.'),
    ('Report cards', 'Generate class drafts, review student reports and comments, finalize approved results and publish them to families. Reopen a batch for authorized corrections.'),
    ('Analytics', 'Review available performance summaries and academic support alerts. Investigate missing scores and trends before making decisions about a learner.')
]), tip='The selected term determines the class year, assessments and results you see. If a class or exam appears missing, check the term, class filter and subject assignment first.')
page('academic-setup', '02 · PREPARE ACADEMICS', 'Subjects, assignments and grading policy', 'Academics → Setup', body=ol([
    '<b>Create subjects:</b> enter the subject details shown in Setup. Where offered, select a class and active teacher while creating the subject.',
    '<b>Create teaching assignments:</b> connect each class and subject to the teacher who will enter marks. Repeat for every class/subject combination; check the saved assignments.',
    '<b>Set the grading scale:</b> enter each grade letter, minimum percentage and points. Thresholds must be unique and the lowest threshold must include 0.',
    '<b>Set the pass mark:</b> choose the percentage used for pass/below-pass outcomes. Enable ranking and GPA only if your school uses them.',
    '<b>Review academic support thresholds:</b> set the decline, repeated failure, attendance and curriculum lag values used by school alerts.',
    '<b>Check Records:</b> select the class to verify the term roster and elective subjects. Use Class grading policy if that class needs an approved policy different from the school default.'
]), tip='A teacher sees only their assigned subjects. If the teacher cannot create or grade an exam, an academic manager should check the subject assignment before recreating the exam.')
page('exam-create', '02 · SET EXAMS', 'Create an exam that can be graded', 'Academics → Assessments → New assessment', body=ol([
    'Choose the term in the top bar, then open Assessments and click <b>New assessment</b>.',
    'Select the <b>Class</b> and its assigned <b>Subject</b>. If no subject is available, create the teaching assignment in Setup first.',
    'Enter an <b>Assessment name</b>, for example “Mathematics final exam”, and select <b>Assessment type: EXAM</b>.',
    'Enter <b>Maximum score</b>: the number of marks on the paper. A paper marked out of 60 uses 60 here.',
    'Enter <b>Term weight (%)</b>: its contribution to the subject’s term result. For example, CA 40% and exam 60% total 100%. Maximum score and term weight are separate values.',
    'Choose an <b>Assessment date</b> within the term dates, then click <b>Save assessment</b>. Check the class, subject, maximum and weight in the list.',
    'Repeat for other assessments. Total subject weight may not exceed 100%; it must equal 100% before reports can be generated.'
]), tip='<b>Example:</b> a learner scores 45/60 on an exam weighted 60%. The exam contributes (45 ÷ 60) × 60 = 45 percentage points to the term result. CA of 32/40 weighted 40% adds 32 points, giving 77%.')
page('exam-timetable', '02 · SCHEDULE EXAMS', 'Put exams on the timetable', 'Academics → Records → Exam timetable → Schedule exam', body=ol([
    'An academic manager selects the correct term and opens <b>Records</b>.',
    'Click <b>Schedule exam</b>. Choose the class and subject, exam date, start time, end time, room and invigilator shown in the form.',
    'Check the time range and date, then save. Resolve any overlapping class, room or invigilator booking before retrying.',
    'Review the saved row in <b>Exam timetable</b>. Use <b>Reschedule</b> to change an existing booking.',
    'Also create the score-bearing exam under <b>Assessments → New assessment → EXAM</b>. The timetable booking schedules the sitting; the assessment holds the maximum score, term weight and marks.'
]), tip='Before exam day, confirm that every planned sitting has the correct class, subject, invigilator and room, and that the corresponding assessment exists for grading.')
page('grading', '02 · GRADE STUDENTS', 'Enter marks safely, one exam at a time', 'Academics → Assessments → Grade / enter scores', body=ol([
    'Select the correct <b>term, class and subject</b>. Locate the exam by name. Teachers must be assigned to that subject.',
    'Click <b>Grade / enter scores</b>. You can also open <b>Gradebook</b> and use the exam’s <b>Grade</b> button above the summary.',
    'Check the exam name, maximum score and student list. Enter each learner’s raw mark, from 0 to the exam maximum. The grade preview uses the applicable grading policy.',
    'Use <b>0</b> for a real zero mark. Leave a learner blank if their mark has not been recorded. A blank does not count as zero and leaves results incomplete.',
    'Review the entered count and any validation message. Out-of-range marks block saving. Click <b>Save scores</b>; only changed students are submitted.',
    'Reopen score entry to verify the saved marks. Continue later for remaining learners. You may save partial marking before all subject weights total 100%.',
    'If you close with changes, choose whether to discard them. Save before leaving the page; unsaved changes are not automatically saved.'
]), tip='The term end date alone no longer closes grading. Score entry stays open until explicitly closed by the administrator, or until the class report batch is finalized.')
page('grading-help', '02 · GRADING TROUBLESHOOTING', 'Resolve a blocked grading task', 'Academics → Assessments / Records / Setup', body=dl([
    ('Exam or class missing', 'Check the top-bar term and class/subject filters. An academic manager should confirm the class belongs to the selected academic year and the subject is assigned to the teacher.'),
    ('Student missing or no students listed', 'Have an academic manager open Records for the class and term. Check roster membership, excluded learners and selected elective subjects. Amend the roster with a reason when appropriate.'),
    ('This subject is not assigned to you', 'An academic manager must correct the teaching assignment in Setup. A class-teacher assignment does not substitute for the subject assignment.'),
    ('Term closed for score entry', 'The school administrator opens Setup → Term entry controls. Reopen entry or set Temporarily unlock until to today or a later date, supply a reason and save. The temporary unlock expires after its selected date.'),
    ('Results are finalized', 'An authorized academic leader opens Report cards → Reopen batch and records a reason. A closed term must also be unlocked separately.'),
    ('Save button unavailable', 'Check that a score has changed, every entered value is valid, students exist in the roster and the assessment is unlocked. Wait if a save is in progress.'),
    ('Gradebook says Incomplete', 'Check all required subject marks and assessment weights. Previously saved marks can exist while the combined result remains incomplete.')
]))
page('reports-create', '02 · GENERATE REPORT CARDS', 'From completed marks to draft reports', 'Academics → Report cards → Generate reports', body=ol([
    '<b>Check the roster:</b> all intended learners and subjects must be correct for this class and term. Correct membership in Records before generating.',
    '<b>Check assessments:</b> each required subject must have assessment weights totaling exactly 100%.',
    '<b>Check marks:</b> enter every required assessment score for the students taking that subject. Resolve Incomplete results in Gradebook.',
    'An authorized user clicks <b>Generate reports</b>, chooses the <b>Class</b>, then clicks <b>Generate drafts</b>. If validation fails, correct the reported missing marks or weights and retry.',
    'Under <b>Student report cards</b>, click <b>View report</b>. Review subject totals, grades, pass outcomes, overall average and any enabled GPA or ranking.',
    'While the report is a draft, enter the <b>Teacher comment</b> and the authorized leader’s <b>Principal comment</b>, then click <b>Save comments</b>.',
    'If marks change after drafts were generated, regenerate the class drafts before final review so the report snapshot reflects the corrected marks.'
]), tip='Draft generation does not publish results to parents. Review the report content before moving the class batch to finalized status.')
page('reports-publish', '02 · APPROVE & PUBLISH', 'Finalize, publish, download and correct', 'Academics → Report cards → Class report batches', body=dl([
    ('Finalize results', 'After checking drafts and comments, an authorized academic leader finalizes the class batch. Finalization protects the result snapshot and blocks score changes.'),
    ('Publish reports', 'A user with publishing permission publishes the finalized batch. Linked parent/student accounts can then see their published academic results.'),
    ('Download PDF', 'Open a student’s View report and click Download PDF. Families open Academic results for their linked published reports and use the same download action.'),
    ('Reopen batch', 'For a correction, an authorized user selects Reopen batch and supplies a reason. Reopening a published batch withdraws it from family accounts until the revision is finalized and published again.'),
    ('Correct and regenerate', 'Unlock the term as well if it was explicitly closed. Correct marks or roster details, regenerate drafts, review comments and totals, then finalize and publish again.'),
    ('Archived revisions', 'Where available, use Report version in the report detail to inspect older report revisions. Archived reports are read-only.'),
    ('Close score entry', 'After marking and publication are complete, the administrator may use Setup → Term entry controls to close further entry. This is an explicit school action, independent of the term end date.')
]), tip='Teachers enter assigned-subject marks. Principals and other authorized academic leaders manage report approval according to their permissions. A missing action should be checked against Administration → Permissions.')

page('finance-map', '03 · FINANCE', 'Finance: every submenu and action', 'Finance → select the correct term', body=dl([
    ('Invoices', 'Lists learner bills and balances. Filter Unpaid, Partial, Paid, Overdue or Waived. View invoice shows charges and payment history; use its invoice PDF and receipt links.'),
    ('Fee structures', 'Sets the class/term price list. Select Class and Term, then Set fee for each category and amount. Saving a fee structure does not itself generate all learner invoices.'),
    ('Concessions', 'Records approved learner discounts or concessions. Check how the concession appears on the learner’s invoice before asking the parent to pay.'),
    ('Generate invoice / Batch invoices', 'Creates a learner bill or class bills from the relevant fees. Check the selected term, due date, line items and any batch result errors.'),
    ('Record a payment', 'Lets authorized finance staff record a received payment against the correct invoice, amount and reference. Check actual receipt before posting.'),
    ('Installment plan / Waive invoice', 'Where offered, record planned payment dates or an authorized waiver with its required explanation. A promise or planned installment is not a received payment.'),
    ('School payment tracking / Online payment tracking', 'Shows payment references, amounts, mode and verification status. Use Check payment for supported pending online transactions; finance confirms manual bank receipts.'),
    ('Make a fee payment / Pay school fees', 'The parent payment flow: choose the linked child’s invoice, enabled school method and amount, then follow checkout or transfer instructions.')
]))
page('finance-order', '03 · BILLING & ENROLLMENT', 'Complete the first learner’s journey', 'Finance → Admissions → Students', body=ol([
    'Set each class fee category for the correct term under <b>Finance → Fee structures</b>.',
    'Create any required parent login under <b>Administration → Users</b> and link the learner’s record to that account where available.',
    'Generate the learner’s invoice, review its charges and confirm the school payment method is enabled.',
    'Have the parent pay the intended invoice. Online payments must be verified; manual transfers must be checked against the school bank receipt.',
    'Review the invoice’s balance and payment history. For admission, the required paid/waived check must pass; a partial payment may still leave enrollment blocked.',
    'Return to <b>Admissions</b>, find the application at <b>Fees Pending</b> and complete <b>Enroll → Enroll student</b> after the capacity and fee checks pass.',
    'Confirm the learner in <b>Students</b>, check the parent link and verify the learner appears in the correct class/term roster before grading.'
]), tip='School fee payments are separate from the school’s SMPIS subscription. Use Finance for learner fees and Subscription for the school’s service plan.')
old(6)
for n in range(12,22): old(n)

page('daily-menus', '04 · OTHER SCHOOL MENUS', 'Learners, attendance and teaching', 'Use these after the school foundations are ready', body=dl([
    ('Dashboard', 'Review the role-specific school overview, summaries and actions that need attention. Check the selected term before comparing totals.'),
    ('Students / My learners / My children', 'Find learner records, open profiles and review details permitted by your role. Authorized staff edit profiles and parent links; families see linked children.'),
    ('Attendance', 'Choose the class and date, record learner attendance and review available attendance records. Record attendance consistently for meaningful reports and alerts.'),
    ('Curriculum → Topics', 'Create and organise the teaching plan for assigned subjects, including the topic sequence and planned teaching periods. Use the available import action when preparing many topics.'),
    ('Curriculum → Coverage', 'Review completed and outstanding teaching across classes and subjects. Record coverage with the taught date and a reason for noncompletion where required.'),
    ('Staff & attendance', 'Manage the permitted staff records and staff attendance views. A personnel record and a user login have different purposes; use Administration → Users for account access.'),
    ('Reports', 'Download permitted school reports such as learner registers, attendance, finance, staff and academic/curriculum summaries. This report library is separate from Academics → Report cards.'),
    ('Message parents', 'Allows the school administrator to prepare messages to the intended parent recipients. Check recipient scope and delivery results before assuming the message was received.')
]))
page('operations-menus', '04 · OTHER SCHOOL MENUS', 'School experience and people', 'School experience / People & HR', body=dl([
    ('School experience → Discipline', 'Create and follow discipline cases, record actions and inspect case history. Repeated incidents can inform follow-up.'),
    ('School experience → Complaints', 'Register complaints, assign responsibility and track the response through the available workflow. Families see the actions allowed for their own records.'),
    ('School experience → Surveys', 'Collect and review parent satisfaction responses and the summaries your role permits.'),
    ('School experience → Policy', 'The administrator configures workflow rules used by school experience cases.'),
    ('People & HR → Leave', 'Submit or review staff leave requests and manage the available approval actions.'),
    ('People & HR → Profiles', 'Maintain staff employment and HR profile information.'),
    ('People & HR → Vacancies / Applicants', 'Record open positions and track candidates through recruitment stages, interviews and hiring.'),
    ('People & HR → Reviews', 'Record and review staff performance assessments.'),
    ('People & HR → Calendar', 'Review the HR calendar for relevant staffing and leave planning.')
]), tip='Operational menus and their submenus vary by role. Staff without HR management permission may see Leave only.')
page('remaining-menus', '04 · OTHER SCHOOL MENUS', 'Facilities, insight and account help', 'Other sidebar menus', body=dl([
    ('Facilities & assets → Maintenance', 'Log repair issues, assign responsibility and follow case progress and recorded costs.'),
    ('Facilities & assets → Facilities', 'Maintain the school’s facility records used by operations staff.'),
    ('Facilities & assets → Assets', 'Record equipment and assets, condition and responsible persons.'),
    ('Intelligence', 'Review available school insights and evaluations. Check the underlying records and data completeness when interpreting an insight.'),
    ('Alerts', 'Review permitted issues requiring action, such as attendance, finance, academic or operational follow-up. Open the relevant record and resolve the underlying issue.'),
    ('Subscription', 'Review the tenant’s SMPIS plan and renewal/payment options. This pays for the school account’s service access, separately from parent school fees.'),
    ('Support', 'The school administrator requests help with the tenant portal. Include the affected menu and record reference so support can investigate.'),
    ('Account menu / Security', 'Manage the account options shown for your login, including available security and communication preferences. Sign out when finished on a shared device.'),
    ('SaaS business', 'Platform-operator workspace, visible only to authorized platform operators. A school administrator uses their tenant menus for ordinary school setup.')
]))
page('export-help', '04 · SCHOOL REPORTS', 'Choose the right report and export', 'Reports / Academics → Report cards', body=ol([
    'For an individual learner’s term result, use <b>Academics → Report cards → View report → Download PDF</b>. Generate, finalize and publish first when sharing through family accounts.',
    'For school registers and operational summaries, open <b>Reports</b> and choose an available report type. Apply its term, date or other filters before downloading.',
    'For academic summaries by class, subject or teacher, use <b>Export academic reports</b> where shown. Choose CSV, Excel or PDF and the required grouping.',
    'For curriculum exports, use the curriculum report option available to your role.',
    'Check the downloaded period, class and totals before distributing. Student registers use current records; attendance reports use the selected dates; finance reports use invoice due dates.'
]), tip='A report may contain personal learner information. Download and share only the records needed for the intended school task, using the access your role provides.')
page('checklist', 'READY TO USE', 'Check the whole workflow once', 'Use one class, one teacher and one family first', body=ol([
    '<b>School setup:</b> school details, calendar, current term, classes and capacities are correct; staff accounts and roles work.',
    '<b>Admissions:</b> a complete learner application reaches Fees Pending; guardian details and intended class are correct.',
    '<b>Academics:</b> subjects and teacher assignments exist; grading rules are approved; the exam assessment and any timetable booking are correct.',
    '<b>Finance:</b> class fees produce the expected invoice; a live received payment or approved waiver is reflected correctly; the receipt is available.',
    '<b>Enrollment:</b> complete enrollment, confirm the learner’s class and parent link, and check the term roster.',
    '<b>Grading:</b> save a mark, reopen it and confirm persistence; verify that a real zero is distinct from an unrecorded mark.',
    '<b>Reports:</b> complete all required scores and 100% subject weights, generate drafts, review comments, finalize and publish. Confirm the linked family can download the PDF.',
    '<b>Daily work:</b> show each staff role its attendance, curriculum, finance or operations tasks. Close score entry explicitly when marking is finished.'
]), tip='If something is blocked, check the term, role, class/subject assignment and roster first. For finalized reports or an explicitly closed term, follow the correction process in this guide.')

contents = [
    ('start', 'Start here: your first actions'), ('admissions-map', '01 Admissions & school setup'),
    ('administration-menus', 'Administration submenu reference'), ('roles', 'Staff accounts and roles'),
    ('integration-map', 'Integration reference'), ('admissions-menus', 'Admissions pipeline'),
    ('academics-map', '02 Academics submenu reference'), ('academic-setup', 'Subjects and grading policy'),
    ('exam-create', 'Create and schedule exams'), ('grading', 'Grade students and resolve blocks'),
    ('reports-create', 'Generate, approve and publish reports'), ('finance-map', '03 Finance submenu reference'),
    ('finance-order', 'Billing, parent payments and enrollment'), ('daily-menus', '04 Other menus and daily work'),
    ('export-help', 'Download school reports'), ('checklist', 'Final readiness checklist')]
page_numbers = {}
for i, section in enumerate(pages,1):
    match = re.search(r'<section[^>]*id="([^"]+)"', section)
    if match: page_numbers[match[1]] = i
pages[toc_index] = '<section class="page text-page contents" id="contents"><div class="kicker">CONTENTS</div><h2>Find your next step</h2>' + ''.join(f'<a href="#{id}"><span>{escape(label)}</span><b>{page_numbers[id]}</b></a>' for id,label in contents) + '</section>'
total = len(pages)
for i, section in enumerate(pages,1):
    footer = f'<div class="footer"><span>SMPIS · School Starter Guide · October 2026</span><span>{i} / {total}</span></div>'
    pages[i-1] = section.replace('</section>', footer + '</section>')
path.write_text(head + '<body>' + '\n'.join(pages) + '</body></html>', encoding='utf-8')
print(f'Updated {path}: {total} pages, all 22 screenshot walkthroughs retained.')
