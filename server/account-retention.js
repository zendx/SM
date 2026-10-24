import { one, rows, insert } from "./db.js";
// Keep an immutable account snapshot before future school edits change linked records.
export async function retainAccountRecord(db, schoolId, userId) {
  const user = await one(
    db,
    `SELECT u.id,u.school_id,u.name,u.email,u.role,u.status,u.phone_number,u.address,u.created_at,u.archived_at,u.archive_reason,
    a.name AS archived_by_name,s.name AS school_name,s.portal_slug FROM users u JOIN schools s ON s.id=u.school_id
    LEFT JOIN users a ON a.id=u.archived_by WHERE u.id=$1 AND u.school_id=$2`,
    [userId, schoolId],
  );
  const staff = await one(
    db,
    "SELECT * FROM staff WHERE school_id=$1 AND user_id=$2",
    [schoolId, userId],
  );
  const profile = staff
    ? await one(
        db,
        "SELECT * FROM staff_profiles WHERE school_id=$1 AND staff_id=$2",
        [schoolId, staff.id],
      )
    : null;
  const attendance = staff
    ? await rows(
        db,
        "SELECT * FROM staff_attendance WHERE school_id=$1 AND staff_id=$2 ORDER BY attendance_date DESC,id DESC",
        [schoolId, staff.id],
      )
    : [];
  const leave_requests = staff
    ? await rows(
        db,
        "SELECT * FROM leave_requests WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
        [schoolId, staff.id],
      )
    : [];
  const reviews = staff
    ? await rows(
        db,
        "SELECT * FROM performance_reviews WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
        [schoolId, staff.id],
      )
    : [];
  const documents = staff
    ? await rows(
        db,
        "SELECT id,name,category,mime,size,created_at FROM staff_documents WHERE school_id=$1 AND staff_id=$2 ORDER BY id",
        [schoolId, staff.id],
      )
    : [];
  const assignments = await rows(
    db,
    `SELECT cs.id,c.name AS class_name,s.name AS subject_name,y.name AS academic_year
    FROM class_subjects cs JOIN classes c ON c.id=cs.class_id JOIN subjects s ON s.id=cs.subject_id JOIN academic_years y ON y.id=c.academic_year_id
    WHERE cs.school_id=$1 AND cs.teacher_user_id=$2 ORDER BY y.start_date DESC,c.name,s.name`,
    [schoolId, userId],
  );
  const linked_students = await rows(
    db,
    `SELECT s.id,s.student_number,s.first_name,s.last_name,s.status,c.name AS class_name
    FROM students s LEFT JOIN classes c ON c.id=s.class_id WHERE s.school_id=$1 AND s.parent_user_id=$2 ORDER BY s.id`,
    [schoolId, userId],
  );
  await insert(db, "account_archives", {
    school_id: schoolId,
    user_id: userId,
    record: JSON.stringify({
      version: 1,
      user,
      staff,
      profile,
      attendance,
      leave_requests,
      reviews,
      documents,
      assignments,
      linked_students,
      counts: {
        attendance: attendance.length,
        leave_requests: leave_requests.length,
        reviews: reviews.length,
        documents: documents.length,
      },
    }),
  });
}
