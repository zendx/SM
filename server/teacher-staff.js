import { SCHOOL_ROLE_LABELS } from "../shared/school-roles.js";

// Keep the account's login as the attendance identity. Existing staff profiles
// and their employment details are preserved; concurrent calls cannot duplicate them.
export async function ensureTeacherStaff(db, schoolId = null) {
  return ensureStaffForRoles(db, schoolId, ["TEACHER"]);
}

export async function ensureSchoolStaff(db, schoolId = null) {
  const roles = Object.keys(SCHOOL_ROLE_LABELS).filter(
    (role) =>
      !["SUPER_ADMIN", "PROPRIETOR", "PARENT", "STUDENT"].includes(role),
  );
  return ensureStaffForRoles(db, schoolId, roles);
}

async function ensureStaffForRoles(db, schoolId, roles) {
  await db.query(
    `INSERT INTO staff(school_id,user_id,staff_number,first_name,last_name,department,position,hire_date,status)
     SELECT u.school_id,u.id,'STF-' || u.role || '-' || u.id,
       split_part(trim(u.name),' ',1),
       trim(substr(trim(u.name),length(split_part(trim(u.name),' ',1))+1)),
       CASE WHEN u.role='TEACHER' THEN 'Teaching' ELSE 'Administration' END,
       CASE WHEN u.role='TEACHER' THEN 'Teacher' ELSE initcap(replace(u.role,'_',' ')) END,
       (u.created_at AT TIME ZONE c.timezone)::date,u.status
     FROM users u JOIN schools c ON c.id=u.school_id
     WHERE u.role=ANY($2::text[]) AND u.archived_at IS NULL AND ($1::int IS NULL OR u.school_id=$1)
       AND NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.user_id=u.id)
       AND NOT EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id=u.id)
       AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id=u.id)
     ON CONFLICT (user_id) DO NOTHING`,
    [schoolId, roles],
  );
}
