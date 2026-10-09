// Use the existing inbox, retry and claim system; each account gets at most
// one reminder per seven-day period, including overlapping worker runs.
export async function queueMfaReminders(db) {
  await db.query(`UPDATE platform_notifications n SET read_at=now()
    FROM users u WHERE n.user_id=u.id AND n.template_key='mfa_reminder'
    AND n.read_at IS NULL AND (u.mfa_enabled OR u.status<>'ACTIVE')`);
  await db.query(`INSERT INTO platform_notifications
    (user_id,school_id,email,title,body,link,dedupe_key,template_key)
    SELECT u.id,u.school_id,u.email,'Protect your SMPIS account',
      'Two-factor authentication adds an authenticator code to your password, helping protect your school records if your password is exposed. Open ' ||
      CASE WHEN u.school_id IS NULL THEN 'Account security' ELSE 'Administration > Security' END ||
      ', enable two-factor authentication and save your recovery codes somewhere safe.',
      CASE WHEN u.school_id IS NULL THEN '/owner#security' ELSE '/' || s.portal_slug || '/?security=mfa#administration' END,
      'mfa-reminder:' || floor(extract(epoch FROM (now()-u.created_at))/604800)::text,
      'mfa_reminder'
    FROM users u LEFT JOIN schools s ON s.id=u.school_id
    WHERE u.status='ACTIVE' AND u.email_verified AND NOT u.mfa_enabled
      AND u.created_at<=now()-interval '7 days'
      AND (u.school_id IS NULL OR EXISTS (
        SELECT 1 FROM school_subscriptions sc WHERE sc.school_id=u.school_id
        AND sc.status IN ('TRIAL','ACTIVE') AND sc.closed_at IS NULL
        AND sc.deletion_requested_at IS NULL AND sc.period_end>now()))
    ON CONFLICT(user_id,dedupe_key) DO NOTHING`);
}
