# School branding and marketer referrals

## Deployment

Apply the schema from this source version before publishing the web app and Railway worker together:

```powershell
npm run supabase:setup
npm run supabase:check
npm run build
```

The schema adds `schools.logo_data`, `saas_settings.referral_percent`, and the `marketers`, `school_referrals` and `referral_commissions` tables. It preserves console staff accounts and includes the new tables in the existing Supabase RLS/revocation protections. Existing tenants and payments are not assigned referral credit retroactively.

Registration and email verification use the existing platform SMTP, email screening, encryption and optional reCAPTCHA configuration. Queued verification delivery retries use the existing worker. Commission creation happens inside payment settlement and does not depend on a scheduled worker run.

## School logos

School administrators upload or remove a logo under Administration > School. Supported uploads are PNG/JPEG, at most 256 KB and 2048 × 2048 pixels. The server validates the file content and dimensions. Logos are stored in the school database record, included in database backups, and shown in that school's login screen, admissions form and signed-in portal for all its roles. Schools without a logo retain the SMPIS branding fallback.

Logos also appear in downloaded invoices, receipts, report cards, academic exports and general PDF reports. Invoice details include a new Download invoice PDF link. Newly downloaded documents use the current logo, including downloads of older report revisions. Previously downloaded files remain unchanged.

## Marketer accounts

The public portal is `/marketers`, also linked from the product website footer. Marketers register and verify their email before signing in. They receive a stable referral code and a `/signup?ref=CODE` link. Opening that link pre-fills the optional referral code on school registration. Codes are normalized to uppercase and validated during registration; invalid or closed-account codes block submission until corrected or removed.

Marketers can see attributed school names, signup dates, paid-subscription indicators, their commission ledger and totals by currency. They can update their name and preferred bank name, account name and account number. Changing sign-in email/password requires the current password, revokes sessions and password-reset tokens, and requires verification of a changed email address.

Closing the referral account requires password confirmation. It stops new referrals and commission accrual; earlier earnings and payment history remain available through read-only portal access. Existing pending commissions remain payable by the owner. Closure does not delete accounting records.

## Owner controls and commission rules

Open Owner > Marketer referrals. The commission rate defaults to **0%** until the owner sets it. Only the full product owner can change this setting or record payouts; delegated console staff cannot.

- Only the referred school's **first approved subscription payment** qualifies. Renewals, trials, rejected payments, sandbox confirmations and payments held for review do not earn commission.
- The rate at settlement is saved with each commission. Later changes do not alter earned amounts. If the rate is zero at the first approval, later renewals do not become eligible.
- Commission is calculated on the actual charged amount and currency, rounded to the nearest minor unit. Currency balances remain separate; no exchange conversion is performed.
- A payment can generate at most one commission. Payment/subscription locks and a unique payment constraint protect repeated callbacks and concurrent approvals.
- For new payment approvals, commission is normally paid three calendar days after successful payment verification and approval. Depending on processing volume, payment may be earlier, including immediately; immediate payment is not guaranteed. Existing earned commissions retain their recorded due dates.
- Marketers must explicitly accept the displayed marketer terms before signup, separately from the privacy policy. The server requires acceptance of the current terms version and records the acceptance timestamp and version. Existing accounts are not backfilled with acceptance they did not give.
- The owner sends funds through their bank outside SMPIS. After transfer, choose Record payment, confirm the actual destination bank details and enter the transfer reference. SMPIS records who confirmed it and when, updates the marketer's history and retains the destination as a permanent payout snapshot. Later bank-profile edits do not rewrite completed transactions.

## Validation

```powershell
npm run test:embedded
```

The isolated regression suite checks branding and referral workflows without contacting payment providers.
