// Keep the teacher's login as the attendance identity. Existing staff profiles
// and their employment details are preserved; concurrent calls cannot duplicate them.
export async function ensureTeacherStaff(db, schoolId = null) {
  await db.query(
    `INSERT INTO staff(school_id,user_id,staff_number,first_name,last_name,department,position,hire_date,status)
     SELECT u.school_id,u.id,'STF-TEACHER-' || u.id,
       split_part(trim(u.name),' ',1),
       trim(substr(trim(u.name),length(split_part(trim(u.name),' ',1))+1)),
       'Teaching','Teacher',(u.created_at AT TIME ZONE c.timezone)::date,u.status
     FROM users u JOIN schools c ON c.id=u.school_id
     WHERE u.role='TEACHER' AND ($1::int IS NULL OR u.school_id=$1)
       AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.user_id=u.id)
     ON CONFLICT (user_id) DO NOTHING`,
    [schoolId],
  );
}
