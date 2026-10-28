import { rows, one } from "./db.js";
import { token } from "./security.js";
import { schoolPaymentMethods } from "./school-payments.js";
import { smtpConfig } from "./integrations.js";
import { sendEmail, emailErrorCode } from "./email-delivery.js";
import { renderEmail } from "./email-templates.js";
import { emailOrigin } from "./email-urls.js";

export const setupReminderCopy = [
  [
    "A small next step for your school",
    "Your school setup is saved, ready for you to pick up when you have a moment. Completing the next step will help get your team ready for its first school day.",
  ],
  [
    "Pick up where you left off",
    "You don't need to finish everything in one sitting. A few minutes on the next unfinished step can move your school a little closer to being ready.",
  ],
  [
    "Your school setup, at a glance",
    "Here is a quick look at what is ready and what still needs attention. When it suits you, open your portal and continue with the next step below.",
  ],
  [
    "Make a little room for your next school day",
    "Finishing the essentials now can make daily school work easier later. Your current setup checklist is below, so you can choose where to continue.",
  ],
  [
    "One more step towards a ready school",
    "There is no need to start again. The details you have saved are still there, and your portal will guide you through the remaining setup.",
  ],
  [
    "Your setup checklist is waiting for you",
    "If setup slipped behind other work, this is a gentle invitation to return. Start with the next unfinished item and work through the rest at your own pace.",
  ],
  [
    "Help your team get started",
    "A completed setup gives your team the school details, calendar and records it needs to begin. Take a look at the remaining steps when you have a quiet moment.",
  ],
  [
    "A quick check on your school's progress",
    "Your latest checklist is below. Reviewing the next item is a useful way to keep setup moving without having to tackle everything at once.",
  ],
  [
    "Bring your school setup a little closer",
    "The essentials are worth a final look before daily work begins. You can return directly to the next unfinished step using the link below.",
  ],
  [
    "Your school setup is here whenever you're ready",
    "This is the last email in this setup reminder series. Your saved setup remains available in your portal, and you can finish the remaining steps whenever you are ready.",
  ],
];

// Keep these checks aligned with the seven-step dashboard checklist.
export async function schoolSetupProgress(db, schoolId) {
  const state = await one(
    db,
    `SELECT c.*,
    EXISTS(SELECT 1 FROM terms t WHERE t.school_id=c.id AND t.is_current) AS calendar_ready,
    EXISTS(SELECT 1 FROM staff s WHERE s.school_id=c.id AND s.status='ACTIVE') AS staff_ready,
    EXISTS(SELECT 1 FROM classes cl JOIN terms t ON t.school_id=cl.school_id AND t.academic_year_id=cl.academic_year_id
      WHERE cl.school_id=c.id AND t.is_current) AS class_ready,
    EXISTS(SELECT 1 FROM fee_structures f JOIN terms t ON t.id=f.term_id AND t.school_id=f.school_id
      WHERE f.school_id=c.id AND t.is_current) AS fees_ready,
    EXISTS(SELECT 1 FROM students s WHERE s.school_id=c.id AND s.status='ENROLLED') AS enrollment_ready
    FROM schools c WHERE c.id=$1`,
    [schoolId],
  );
  if (!state) throw new Error("School not found for setup reminder.");
  const methods = await schoolPaymentMethods(db, schoolId);
  const steps = [
    [
      "Set school preferences",
      Boolean(state.name && state.currency_code && state.timezone),
      "administration/school",
    ],
    [
      "Set the academic calendar",
      state.calendar_ready,
      "administration/calendar",
    ],
    ["Add your staff", state.staff_ready, "staff"],
    ["Create a class", state.class_ready, "administration/classes"],
    [
      "Setup Payment Method",
      Object.keys(methods).length > 0,
      "administration/integrations",
    ],
    ["Set Fee Structure", state.fees_ready, "finance/fee%20structures"],
    ["Enroll your first student", state.enrollment_ready, "admissions"],
  ].map(([title, done, route]) => ({ title, done, route }));
  return {
    school: state,
    steps,
    next: steps.find((step) => !step.done),
    complete: steps.filter((step) => step.done).length,
  };
}

export function setupReminderMessage(progress, user, number) {
  const [title, intro] = setupReminderCopy[number - 1];
  const nextIndex = progress.steps.findIndex((step) => !step.done);
  return {
    title,
    body: `Hello ${user.name},\n\n${intro}\n\n${progress.school.name}: ${progress.complete} of ${progress.steps.length} setup steps complete.\n\nNext: step ${nextIndex + 1} of ${progress.steps.length} — ${progress.next.title}\n\n${progress.steps.map((step, index) => `${index + 1}. ${step.done ? "[Complete]" : "[To do]"} ${step.title}`).join("\n")}\n\nIf you can, complete this next step when you return to your portal. We will stop these reminders once all setup steps are complete.`,
    link: new URL(
      `/${progress.school.portal_slug}/#${progress.next.route}`,
      emailOrigin(),
    ).href,
  };
}

// One campaign per tenant, irrespective of administrator changes. Only successful
// sends advance it. Scheduling from actual delivery prevents a catch-up burst.
const eligibleSchool = `EXISTS(SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=c.id
  AND sc.status IN ('TRIAL','ACTIVE') AND sc.period_end>now()
  AND sc.closed_at IS NULL AND sc.deletion_requested_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM platform_operators o JOIN users u ON u.id=o.user_id WHERE u.school_id=c.id)`;

export async function deliverSetupReminders(
  db,
  {
    configuration = smtpConfig,
    send = async (smtp, message, user) =>
      sendEmail(smtp, { to: user.email, ...message }),
  } = {},
) {
  // Existing schools begin a fresh two-day wait on their first worker scan.
  await db.query(`INSERT INTO tenant_setup_reminders(school_id)
    SELECT c.id FROM schools c WHERE ${eligibleSchool}
    ON CONFLICT(school_id) DO NOTHING`);
  const smtp = await configuration(db, null);
  if (!smtp) return;
  const candidates = await rows(
    db,
    `SELECT r.school_id FROM tenant_setup_reminders r
    JOIN schools c ON c.id=r.school_id WHERE r.completed_at IS NULL AND r.sent_count<10
    AND r.attempts<5 AND r.next_send_at<=now()
    AND EXISTS(SELECT 1 FROM users u WHERE u.school_id=c.id AND u.role='SUPER_ADMIN'
      AND u.status='ACTIVE' AND u.email_verified)
    AND (r.claimed_until IS NULL OR r.claimed_until<=now()) AND ${eligibleSchool}
    ORDER BY r.next_send_at,r.school_id LIMIT 50`,
  );
  for (const candidate of candidates) {
    const claim = token();
    const campaign = await one(
      db,
      `UPDATE tenant_setup_reminders r
      SET claim_token=$2,claimed_until=now()+interval '5 minutes'
      WHERE r.school_id=$1 AND r.completed_at IS NULL AND r.sent_count<10 AND r.attempts<5
      AND r.next_send_at<=now() AND (r.claimed_until IS NULL OR r.claimed_until<=now())
      AND EXISTS(SELECT 1 FROM schools c WHERE c.id=r.school_id AND ${eligibleSchool}) RETURNING r.*`,
      [candidate.school_id, claim],
    );
    if (!campaign) continue;
    try {
      // Re-read saved progress at delivery, rather than keeping a stale queued checklist.
      const progress = await schoolSetupProgress(db, campaign.school_id);
      if (!progress.next) {
        await db.query(
          `UPDATE tenant_setup_reminders SET completed_at=now(),claim_token=NULL,claimed_until=NULL
          WHERE school_id=$1 AND claim_token=$2`,
          [campaign.school_id, claim],
        );
        continue;
      }
      const user = await one(
        db,
        `SELECT u.* FROM users u JOIN schools c ON c.id=u.school_id
        WHERE u.school_id=$1 AND u.role='SUPER_ADMIN' AND u.status='ACTIVE' AND u.email_verified
        AND ${eligibleSchool} ORDER BY u.id LIMIT 1`,
        [campaign.school_id],
      );
      if (!user) {
        await db.query(
          `UPDATE tenant_setup_reminders SET claim_token=NULL,claimed_until=NULL
          WHERE school_id=$1 AND claim_token=$2`,
          [campaign.school_id, claim],
        );
        continue;
      }
      const values = setupReminderMessage(
        progress,
        user,
        campaign.sent_count + 1,
      );
      const message = await renderEmail(db, "setup_reminder", {
        ...values,
        school_id: campaign.school_id,
        recipient_id: user.id,
        recipient_email: user.email,
      });
      await send(smtp, message, user);
      await db.query(
        `UPDATE tenant_setup_reminders SET sent_count=sent_count+1,last_sent_at=now(),
        next_send_at=now()+interval '2 days',attempts=0,last_error='',claim_token=NULL,claimed_until=NULL
        WHERE school_id=$1 AND claim_token=$2`,
        [campaign.school_id, claim],
      );
    } catch (error) {
      console.error(
        "Setup reminder delivery failed:",
        campaign.school_id,
        emailErrorCode(error),
      );
      await db.query(
        `UPDATE tenant_setup_reminders SET attempts=attempts+1,last_error=$3,
        next_send_at=now()+interval '5 minutes',claim_token=NULL,claimed_until=NULL
        WHERE school_id=$1 AND claim_token=$2`,
        [campaign.school_id, claim, emailErrorCode(error)],
      );
    }
  }
}
