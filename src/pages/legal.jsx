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
          advertising cookies. Dismissing this notice does not prevent sign-in
          cookies needed for your account.
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
        No application analytics, advertising, or third-party tracking cookies
        are configured. The application does not currently use localStorage or
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
            tools. Use the service only for authorized school purposes and
            within your assigned role. School policies and applicable law also
            govern your use.
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
            Schools may create a separate SMPIS portal with a 14-day Free trial.
            Pro has a USD 100 monthly base price, or USD 1,020 yearly with a 15%
            discount. Payments cover one selected period; this checkout does not
            automatically charge a card for future periods. Operational access
            pauses when the trial ends or a paid subscription expires after any
            configured grace period. The school administrator can still sign in
            to manage billing. Suspension and termination retain school records.
          </p>
          <p>
            Bank transfers require owner approval. Card payments require server
            verification. Sandbox payments do not activate paid access. When
            checkout or bank payment is in NGN, the billing screen shows the
            owner-configured exchange rate and payable amount. Contact the SMPIS
            owner about subscription payments and billing questions.
          </p>
          <h2>Fees and external providers</h2>
          <p>
            Your school sets fees, payment terms, concessions, and refund rules.
            External payment providers have their own terms. A payment is
            credited only after server-side verification; disputed or mismatched
            transactions may need finance review. SMPIS does not store full card
            numbers or card security codes.
          </p>
          <h2>Availability and data management</h2>
          <p>
            Maintenance, outages, and external providers may interrupt access.
            Administrators must arrange appropriate backups and recovery.
            Database and private document backups must be managed separately in
            Supabase.
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
            records it collects and the purposes for using them. The published
            operator contact above handles site-level questions. Ask your school
            about its specific legal basis, retention schedule, and any
            additional privacy notice.
          </p>
          <h2>Information processed</h2>
          <p>
            Depending on your role and the records your school enters,
            information includes account names and email addresses; student and
            guardian contact details; admissions and enrollment; attendance;
            assessment results and reports; school fee invoices and payment
            references; staff employment and HR documents; complaints,
            discipline and survey responses; and security, session and audit
            records. Schools may enter medical or other sensitive information.
            The current system does not collect fingerprint or facial templates.
          </p>
          <h2>Why information is used</h2>
          <p>
            Information supports authorized school operations, learning and
            reporting, staff administration, fee accounting, notifications,
            access control, and investigation of changes or misuse. Schools must
            establish the appropriate legal basis for each use and appropriate
            conditions for sensitive information and children's data. Cookie
            notice acceptance is not blanket permission for these activities.
          </p>
          <h2>Storage and service providers</h2>
          <p>
            The application uses hosted Supabase PostgreSQL and private Supabase
            document storage. Hosting, database and storage providers process
            information needed to provide those services. If configured, the
            school's SMTP provider processes recipient addresses and email
            content, and configured payment providers process payment
            information under their own notices. Paystack handles school fee
            checkout; Stripe, Paystack and Flutterwave support SMPIS
            subscription checkout. Subscription records include the school,
            billing period, payment references and verification status. Twilio
            SMS delivery is not yet implemented. The operator must assess any
            cross-border processing and applicable safeguards with its
            providers.
          </p>
          <h2>Security and access</h2>
          <p>
            Role and school checks restrict access. Passwords are hashed;
            administrator MFA is supported; integration credentials are
            encrypted using a server-held key. Hosted deployments use HTTPS.
            Other record fields are not separately encrypted by application
            code. Authorized administrators and service providers may access
            information as necessary for their duties.
          </p>
          <h2>Retention and your requests</h2>
          <p>
            There is no universal automatic deletion schedule implemented in
            this application. Your school determines retention and must arrange
            deletion, backups and recovery in line with its obligations. Subject
            to applicable law and recordkeeping requirements, contact your
            school or the privacy contact to request access, correction,
            deletion, restriction, or other applicable rights. You may raise a
            concern with the relevant data protection authority; in Nigeria this
            is the{" "}
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
          </p>
          <CookieDetails />
          <h2>Policy updates</h2>
          <p>
            Changes to processing or providers require this notice and cookie
            inventory to be reviewed. The displayed update date reflects the
            policy version or the latest operator-contact update.
          </p>
        </>
      )}
    </main>
  );
}
