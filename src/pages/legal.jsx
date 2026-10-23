import {
  MARKETER_TERMS,
  MARKETER_TERMS_VERSION,
} from "../../shared/marketer-terms";
import React, { useState } from "react";
import { useData } from "../hooks";
import { Button, Loading } from "../components";
export const COOKIE_PREFERENCE = "smpis_cookie_preferences";
const preferenceValue = "essential-v1";
export function CookieNotice() {
  const accepted = () =>
    document.cookie
      .split(";")
      .some((v) => v.trim() === `${COOKIE_PREFERENCE}=${preferenceValue}`);
  const [visible, setVisible] = useState(() => !accepted());
  React.useEffect(() => {
    const open = () => setVisible(true);
    window.addEventListener("smpis-cookie-settings", open);
    return () => window.removeEventListener("smpis-cookie-settings", open);
  }, []);
  function save() {
    document.cookie = `${COOKIE_PREFERENCE}=${preferenceValue}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setVisible(false);
  }
  function dismiss() {
    document.cookie = `${COOKIE_PREFERENCE}=; Path=/; Max-Age=0; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    setVisible(false);
  }
  if (!visible) return null;
  return (
    <aside className="cookie-notice" aria-label="Cookie notice">
      <div>
        <strong>Cookies on SMPIS</strong>
        <p>
          We use a required sign-in cookie and, if you accept, a cookie
          remembering this notice. We do not use application analytics or
          advertising cookies. Protected forms may use Google reCAPTCHA for
          abuse prevention when enabled. Dismissing this notice does not prevent
          sign-in cookies needed for your account.
        </p>
        <a href="/cookies">See exact cookie details</a>
      </div>
      <div className="toolbar">
        <Button onClick={save}>Accept required cookies</Button>
        <Button secondary onClick={dismiss}>
          Dismiss without saving
        </Button>
      </div>
    </aside>
  );
}
export function LegalFooter() {
  return (
    <footer className="legal-footer">
      <a href="mailto:info@smpis.digital">info@smpis.digital</a>
      <a href="/terms">Terms and conditions</a>
      <a href="/privacy">Privacy policy</a>
      <a href="/cookies">Cookies</a>
      <button
        className="text-button"
        onClick={() => window.dispatchEvent(new Event("smpis-cookie-settings"))}
      >
        Cookie settings
      </button>
    </footer>
  );
}
function CookieDetails() {
  return (
    <section id="cookies">
      <h2>Cookies and browser storage</h2>
      <p>
        These are the cookies set by SMPIS application code. Both are
        first-party, use Path=/, and have no Domain attribute, so they are
        scoped to the current host.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Purpose and content</th>
              <th>Duration</th>
              <th>Protection</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>smpis_session</code>
              </td>
              <td>
                Required after sign-in. An opaque random session token links
                your browser to your server-side account session. It contains no
                password or biometric template.
              </td>
              <td>
                8 hours; removed on sign-out. Server-side sessions also expire.
              </td>
              <td>
                HttpOnly; SameSite=Strict; Secure when NODE_ENV=production. Not
                readable by application JavaScript.
              </td>
            </tr>
            <tr>
              <td>
                <code>smpis_cookie_preferences</code>
              </td>
              <td>
                Preference cookie created only when you press Accept required
                cookies. Stores <code>essential-v1</code> to remember acceptance
                of this notice version. Not required to sign in.
              </td>
              <td>365 days. Dismiss without saving removes it.</td>
              <td>
                SameSite=Lax; Secure on HTTPS; readable by JavaScript to display
                the notice.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No application analytics or advertising cookies are configured. When
        enabled, Google reCAPTCHA on protected forms may use cookies and process
        browser/device signals to prevent abuse; Google's privacy policy and
        terms apply. The application does not currently use localStorage or
        sessionStorage. Hosting features, deployment protection, or external
        payment pages may use their own cookies under their providers' notices;
        these are outside this application's cookie inventory.
      </p>
      <p>
        You can reopen Cookie settings in the footer or clear cookies in your
        browser. Blocking the session cookie prevents sign-in. Deleting the
        preference cookie makes the notice appear again. Cookie acceptance does
        not provide consent for unrelated school record processing or accept the
        Terms on your behalf.
      </p>
    </section>
  );
}
export function LegalPage({ type }) {
  const q = useData("/legal/config", null);
  const title =
    type === "terms"
      ? "Terms and conditions"
      : type === "cookies"
        ? "Cookie policy"
        : "Privacy policy";
  return (
    <main className="legal-page">
      <a href="/">Back to SMPIS</a>
      <h1>{title}</h1>
      {q.loading ? (
        <Loading />
      ) : q.error ? (
        <p role="alert">Unable to load operator details: {q.error}</p>
      ) : (
        <>
          <p>
            Last updated: {q.data.updated}. Operator:{" "}
            <strong>
              {q.data.organization ||
                "Not yet configured by the super administrator"}
            </strong>
            .
          </p>
          <p>
            Privacy contact:{" "}
            {q.data.contact ? (
              <a href={`mailto:${q.data.contact}`}>{q.data.contact}</a>
            ) : (
              "Not yet configured. Contact your school administrator."
            )}
          </p>
          {(!q.data.organization || !q.data.contact) && (
            <p className="notice">
              Operator details are incomplete. The super administrator must
              publish them in Administration &gt; Site settings.
            </p>
          )}
        </>
      )}
      {type === "terms" ? (
        <>
          <h2>Use of the service</h2>
          <p>
            SMPIS provides school administration, student and staff records,
            attendance, academic reporting, school fees, and communication
            tools. Use the service only for authorized school or
            referral-program purposes and within your assigned role. School
            policies and applicable law also govern your use.
          </p>
          <p>
            Product owner: Henry Shedrack. The legal service operator and
            privacy contact are identified above. These terms cover school
            administrators, authorized school users and referral marketers, as
            applicable to their accounts.
          </p>
          <h2>Accounts and responsibilities</h2>
          <p>
            Keep account credentials and recovery codes private. Do not share
            accounts, access another school's records, bypass safeguards, upload
            malicious material, or submit information you are not authorized to
            provide. Report unauthorized access and inaccurate records to your
            school. School administrators manage account access and may suspend
            misuse.
          </p>
          <h2>School records and decisions</h2>
          <p>
            The school is responsible for the accuracy of its records, lawful
            processing, permissions, retention, and decisions concerning
            learners and staff. Reports and alerts support human review.
            Historical model tools do not authorize automated decisions about
            students. Parents and guardians should submit only information they
            are authorized to provide.
          </p>
          <h2>School subscriptions</h2>
          <p>
            Schools may create a separate SMPIS portal with a 30-day Free trial.
            Pro pricing and the selected monthly or yearly billing period are
            shown on the pricing and billing screens. The final payable amount
            and currency are shown before checkout. Payments cover one selected
            period. Operational access pauses when the trial ends or a paid
            subscription expires after any configured grace period. The school
            administrator can still sign in to manage billing. Suspension and
            termination retain school records.
          </p>
          <p>
            Bank transfers require owner approval. Card payments require server
            verification. Sandbox payments do not activate paid access. When
            checkout or bank payment is in NGN, the billing screen shows the
            owner-configured exchange rate and payable amount. Contact the SMPIS
            owner about subscription payments and billing questions.
          </p>
          <h2>Automatic card renewal</h2>
          <p>
            Card renewal authorization is checked by default at subscription
            checkout. Leave it checked to authorize automatic renewal at the
            amount and currency shown at checkout, monthly or yearly according
            to your selected billing period. Uncheck it before paying to make a
            one-time payment. Automatic renewal is enabled only after a
            successful, server-verified live payment provides a reusable card
            authorization. Existing payments and bank transfers do not enroll
            you in automatic renewal.
          </p>
          <p>
            Renewal is attempted when your paid subscription expires. Confirmed
            failures may be retried every 12 hours during the configured grace
            period shown in Subscription. Failed or unconfirmed payments prompt
            service notifications, and your provider may require additional
            authentication. Only verified payment extends access. The authorized
            amount and currency remain unchanged by later price or exchange-rate
            changes until a later authorized checkout replaces them.
          </p>
          <p>
            You can turn off automatic renewal in Subscription without ending
            your current paid access. A payment already submitted may still
            complete. Turning renewal off does not refund payments or delete
            your school account.
          </p>
          <h2>Fees and external providers</h2>
          <p>
            Your school sets fees, payment terms, concessions, and refund rules.
            External payment providers have their own terms. A payment is
            credited only after server-side verification; disputed or mismatched
            transactions may need finance review. SMPIS does not store full card
            numbers or card security codes.
          </p>
          <h2>School branding and uploaded content</h2>
          <p>
            Schools retain rights to their records and branding. Upload only
            material you are authorized to use, including school names and
            logos. You permit SMPIS and its service providers to process and
            display that material to operate your portal, generate receipts,
            invoices and reports, and send school emails. School names and logos
            can appear on public portal pages and public email-image URLs; do
            not upload confidential information as a logo. This permission does
            not transfer ownership of school records or authorize unrelated
            advertising.
          </p>
          <h2>Communications and support</h2>
          <p>
            Account, security, billing and support messages are service
            communications. School administrators control communications to
            their authorized users. Promotional email and phone choices are
            separate and optional. Email delivery depends on providers and
            recipient settings, so check your portal for important updates;
            provider acceptance does not guarantee inbox delivery. Do not
            include passwords, card security codes or unnecessary sensitive
            student information in support tickets.
          </p>
          <h2>Referral marketer program</h2>
          <p>
            Marketers must acknowledge the following program terms before
            signup. The separately recorded marketer terms version is{" "}
            {MARKETER_TERMS_VERSION}.
          </p>
          {MARKETER_TERMS.map((term) => (
            <section key={term.title}>
              <h3>{term.title}</h3>
              <p>{term.body}</p>
            </section>
          ))}
          <p>
            Share referral codes truthfully. Do not impersonate SMPIS or a
            school, make unauthorized promises, use unsolicited or unlawful
            promotions, or manipulate referrals. SMPIS may investigate suspected
            abuse and restrict affected accounts. Marketers remain responsible
            for applicable tax and banking obligations; closing the program or
            an account does not remove valid commissions already earned.
          </p>
          <h2>Account closure, refunds and retained records</h2>
          <p>
            Turning off renewal prevents future renewal attempts but does not
            automatically refund a completed subscription. Contact the operator
            with the payment reference for billing or refund requests;
            school-fee refunds are handled by the school. Any mandatory consumer
            rights remain unaffected. A school closure request suspends
            operations immediately, retains administrator Support access for
            three calendar months, and then blocks school sign-in. Closure does
            not automatically erase school, payment or audit records. Arrange
            exports and any lawful deletion request with your school and the
            operator before closure. SMPIS may restrict access for misuse,
            security incidents or legal requirements, subject to applicable law.
          </p>
          <h2>Availability and data management</h2>
          <p>
            Maintenance, outages, and external providers may interrupt access.
            Administrators must arrange appropriate backups and recovery.
            Recovery must cover both database records and private documents. The
            operator manages the platform backup and recovery process.
          </p>
          <h2>Privacy, changes, and contact</h2>
          <p>
            Read the <a href="/privacy">Privacy policy</a> and{" "}
            <a href="/cookies">Cookie policy</a>. Material changes will be
            published here. Contact the operator or your school for access,
            payment, or service concerns. These terms do not limit rights or
            remedies that applicable law does not permit the operator to
            exclude.
          </p>
        </>
      ) : type === "cookies" ? (
        <CookieDetails />
      ) : (
        <>
          <h2>Who handles your information</h2>
          <p>
            The school operating your workspace is responsible for the school
            records it collects and the purposes for using them; SMPIS processes
            those records to provide the service on the school's instructions.
            SMPIS also determines the purposes of its own platform account
            administration, subscription billing, referral program, security and
            optional marketing. The published operator contact above handles
            site-level questions. Ask your school about its specific legal
            basis, retention schedule, and any additional privacy notice.
          </p>
          <h2>Legal bases and sources</h2>
          <p>
            Information comes from you, your school and authorized users,
            payment-provider verification, and service/security activity. For
            its own platform processing, SMPIS relies on the applicable basis:
            performing the account or subscription contract, legitimate
            interests in secure and reliable service subject to your rights,
            legal recordkeeping obligations, and consent for optional
            promotions. Schools must determine and explain their own lawful
            bases, including any additional conditions for children's and
            sensitive information. Where a field is required to create or secure
            an account or process a payment, not providing it may prevent that
            action; optional promotional consent is not a condition of access.
          </p>
          <h2>Information processed</h2>
          <p>
            Depending on your role and the records your school enters,
            information includes account names, email addresses, registration
            phone numbers, privacy-policy acknowledgments and promotional
            communication preferences; student and guardian contact details;
            admissions and enrollment; attendance; assessment results and
            reports; school fee invoices and payment references; staff
            employment and HR documents; complaints, discipline and survey
            responses; and security, session and audit records. Schools may
            enter medical or other sensitive information. The current system
            does not collect fingerprint or facial templates.
          </p>
          <h2>Why information is used</h2>
          <p>
            Referral marketers provide account details and a preferred bank
            name, account name and account number. SMPIS records referred school
            signups, earned commissions and payout confirmations so the marketer
            and product owner can track the referral relationship and payments.
            Closing a referral account stops new referrals and earnings;
            existing commission and payment records are retained for accounting
            and reconciliation.
          </p>
          <p>
            Information supports authorized school operations, learning and
            reporting, staff administration, fee accounting, notifications,
            access control, and investigation of changes or misuse. Schools must
            establish the appropriate legal basis for each use and appropriate
            conditions for sensitive information and children's data. Cookie
            notice acceptance is not blanket permission for these activities.
          </p>
          <h2>Email, phone numbers and promotional communications</h2>
          <p>
            SMPIS uses your account email address for verification, password
            recovery, welcome emails and a scheduled portal tour, security and
            MFA reminders, subscription updates, support replies and other
            account or service notifications. We collect the administrator phone
            number at school registration for contact and support. These service
            purposes are separate from promotional use; declining marketing does
            not prevent signup or essential account communications.
          </p>
          <p>
            If you separately opt in, we use your email address to send SMPIS
            promotional newsletters, offers and product news. Promotional use of
            your phone number requires its own optional choice, separate from
            email consent. Where that channel is available, it may be used for
            promotional text or phone messages. Automated SMS delivery is not
            currently implemented. Providing a phone number, reading this policy
            or creating an account does not by itself subscribe you to
            promotions. Your choices apply to your own contact details, not to
            student, guardian or staff records held by your school.
          </p>
          <p>
            Both promotional choices are unchecked by default. You can change
            them or withdraw consent in Communication preferences in your SMPIS
            inbox. Promotional emails include an unsubscribe link that works
            without signing in; it stops promotional email while leaving your
            separate phone choice unchanged. You can also contact the published
            privacy contact about your choices. Declining or withdrawing consent
            does not affect your account access. Queued promotional emails are
            checked against your current email preference before delivery.
          </p>
          <p>
            We record the privacy-policy version and acknowledgment time at
            signup, along with your separate promotional choices and subsequent
            preference changes. Authorized platform staff can view these choices
            and export opted-in contact lists for the selected channel. Email
            delivery providers process recipient addresses and message content
            to deliver our emails; any phone-message provider used must also be
            assessed for the relevant processing. Consent records may be
            retained to document your choices and honour withdrawals, subject to
            applicable recordkeeping requirements. A required privacy
            acknowledgment records that you have read this policy; it does not
            grant promotional consent.
          </p>
          <h2>School names, logos and public visibility</h2>
          <p>
            Uploaded school branding appears in the school's portal, generated
            documents and school-related emails. School names and logos may be
            available on public portal or admissions pages and public HTTPS
            image URLs so email clients can display them without signing in.
            Logo URLs expose the branding image, not private school records.
            Schools should upload only an authorized logo and no personal or
            confidential records. Email clients may fetch these images through
            their own proxies.
          </p>
          <h2>Registration screening and abuse prevention</h2>
          <p>
            When configured, StopReg receives the registration email address to
            screen disposable, blocked or suspicious addresses. A screening
            decision can prevent signup; contact support if you believe it is
            incorrect. When enabled, Google reCAPTCHA processes
            form-verification tokens and browser or device signals for abuse
            prevention. These services have their own privacy notices. We also
            process session and audit information to investigate unauthorized
            access.
          </p>
          <h2>Storage and service providers</h2>
          <p>
            The application uses hosted Supabase PostgreSQL and private Supabase
            document storage. Hosting, database and storage providers process
            information needed to provide those services. Vercel hosts the web
            application and Railway runs background jobs in the current
            deployment. Brevo delivers transactional emails over HTTPS or SMTP,
            processing recipient addresses, message content and delivery
            results; school-related emails may contain the school name and logo.
            Authorized platform support staff can access support tickets and
            replies for their assigned duties. Configured payment providers
            process payment information under their own notices. Paystack
            handles school fee checkout; Stripe, Paystack and Flutterwave
            support SMPIS subscription checkout. Subscription records include
            the school, billing period, payment references and verification
            status. Twilio SMS delivery is not yet implemented. The operator
            must assess any cross-border processing and applicable safeguards
            with its providers. Hosting, storage, email, screening and payment
            services may process data outside Nigeria. Where applicable,
            transfers require an appropriate legal basis and safeguards under
            the Nigeria Data Protection Act 2023, such as adequate protection or
            contractual safeguards. Ask the privacy contact for the providers
            and safeguards relevant to your account; no particular hosting
            country is guaranteed by this notice.
          </p>
          <h2>Subscription payments and renewal records</h2>
          <p>
            Payment providers process your card details. SMPIS does not store
            full card numbers or card security codes. When the renewal
            authorization remains checked at checkout and a verified live
            payment supplies a reusable method, SMPIS stores encrypted provider
            tokens or authorization references, the associated customer details
            and email address, card brand and last four digits where available,
            authorized amount, currency and billing cycle. We also record the
            authorizing administrator, authorization and revocation times,
            payment references, renewal attempts and verification results.
          </p>
          <p>
            These records support recurring charges, billing support, payment
            reconciliation, security and an audit of your renewal choices.
            Renewal authorization is checked by default; you can uncheck it
            before checkout or turn renewal off later in Subscription. Disabling
            renewal stops future attempts but does not erase payment and audit
            records or cancel a payment already submitted. Renewal issue notices
            are service communications and do not depend on promotional consent.
          </p>
          <h2>Security and access</h2>
          <p>
            Role and school checks restrict access. Passwords are hashed; MFA is
            required for privileged accounts and available to other users;
            integration credentials are encrypted using a server-held key.
            Hosted deployments use HTTPS. Other record fields are not separately
            encrypted by application code. Authorized administrators and service
            providers may access information as necessary for their duties.
          </p>
          <h2>Retention and your requests</h2>
          <p>
            A school account deletion request suspends operations immediately,
            retains administrator Support access for three calendar months, and
            then blocks school sign-in. This closure retains school records,
            payment history, audit records and email addresses; it does not
            automatically erase them. Your school determines retention and must
            arrange deletion, backups and recovery in line with its obligations.
            Platform billing, referral, consent and security records are kept as
            needed for the relevant service, accounting, disputes, legal
            requirements and honouring preferences; there is no automatic
            universal erasure period. Backup copies may remain until their
            retention cycle ends, with access restricted. Ask the privacy
            contact for the applicable retention criteria and deletion process.
            Subject to applicable law and recordkeeping requirements, contact
            your school or the privacy contact to request access, correction,
            deletion, restriction, portability, objection to processing,
            withdrawal of consent where consent is the basis, and human review
            of significant automated decisions, where applicable. These rights
            are subject to lawful exceptions and identity verification.
            Withdrawing consent does not invalidate earlier lawful processing.
            We will handle requests within applicable legal time limits and
            explain any lawful refusal or required retention. You can complain
            directly to a regulator without first obtaining our approval. You
            may raise a concern with the relevant data protection authority; in
            Nigeria this is the{" "}
            <a href="https://ndpc.gov.ng/" target="_blank" rel="noreferrer">
              Nigeria Data Protection Commission
            </a>
            .
          </p>
          <h2>Children and sensitive information</h2>
          <p>
            Schools must limit collection to necessary information, restrict
            access, and involve parents or guardians where required. Do not
            upload unnecessary sensitive records. Contact your school if
            information has been collected without appropriate authorization.
            Where consent is required for a child or someone lacking capacity,
            the school must obtain the necessary parent or guardian
            authorization and apply required safeguards. Learners should
            exercise their rights through an appropriate guardian or their
            school where necessary.
          </p>
          <CookieDetails />
          <h2>Security incidents and disclosures</h2>
          <p>
            No system can guarantee absolute security. Report suspected exposure
            promptly to your school and the published privacy contact. SMPIS
            will investigate and cooperate with affected schools on required
            regulator and individual notifications under applicable law.
            Information may also be disclosed where legally required or
            necessary to handle legal claims, with appropriate limits.
          </p>
          <h2>Policy updates</h2>
          <p>
            Changes to processing or providers require this notice and cookie
            inventory to be reviewed. The displayed update date reflects the
            policy text version; operator-contact changes are recorded
            separately. Material changes will be published here and communicated
            through appropriate service channels where required. A policy update
            does not automatically renew optional marketing consent.
          </p>
        </>
      )}
    </main>
  );
}
