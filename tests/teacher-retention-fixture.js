import { createMemoryDocumentStorage } from "../server/document-storage.js";
import { accountFixture } from "./account-fixture.js";
import { one, insert } from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { ensureTeacherStaff } from "../server/teacher-staff.js";
export async function teacherRetentionFixture() {
  const documentStorage = createMemoryDocumentStorage();
  const f = await accountFixture({ documentStorage });
  f.documentStorage = documentStorage;
  for (const [key, name, role, school] of [
    ["teacher", "Mariam Bello", "TEACHER", f.school.id],
    ["foreignTeacher", "Foreign Teacher", "TEACHER", f.otherSchool.id],
    ["parent", "Ada Okafor", "PARENT", f.school.id],
    ["proprietor", "School Proprietor", "PROPRIETOR", f.school.id],
  ]) {
    f.users[key] = await insert(f.db, "users", {
      school_id: school,
      name,
      email: `${key.toLowerCase()}@retention.test`,
      role,
      password_hash: hashPassword(f.password),
      email_verified: true,
      phone_number: "+2348012345678",
    });
  }
  await ensureTeacherStaff(f.db, f.school.id);
  await ensureTeacherStaff(f.db, f.otherSchool.id);
  f.staff = await one(f.db, "SELECT * FROM staff WHERE user_id=$1", [
    f.users.teacher.id,
  ]);
  await insert(f.db, "staff_profiles", {
    staff_id: f.staff.id,
    school_id: f.school.id,
    qualifications: "B.Ed Mathematics",
    employment_history: "Teaching since 2020",
    contract_notes: "Original signed contract retained.",
  });
  await insert(f.db, "staff_attendance", {
    school_id: f.school.id,
    staff_id: f.staff.id,
    attendance_date: "2026-10-23",
    status: "PRESENT",
    check_in_time: "2026-10-23T07:30:00Z",
  });
  const year = await one(
    f.db,
    "SELECT id FROM academic_years WHERE school_id=$1",
    [f.school.id],
  );
  f.cls = await insert(f.db, "classes", {
    school_id: f.school.id,
    academic_year_id: year.id,
    name: "Primary 5",
    capacity: 30,
    teacher_user_id: f.users.teacher.id,
  });
  const subject = await insert(f.db, "subjects", {
    school_id: f.school.id,
    name: "Mathematics",
    code: "MATH",
  });
  f.assignment = await insert(f.db, "class_subjects", {
    school_id: f.school.id,
    class_id: f.cls.id,
    subject_id: subject.id,
    teacher_user_id: f.users.teacher.id,
  });
  f.document = await insert(f.db, "staff_documents", {
    school_id: f.school.id,
    staff_id: f.staff.id,
    name: "employment-contract.pdf",
    category: "CONTRACT",
    storage_key: "retained-fixture-private-key",
    mime: "application/pdf",
    size: 42,
    uploaded_by: f.users.tenant.id,
  });
  await documentStorage.put(
    f.document.storage_key,
    Buffer.from("%PDF-retained-contract"),
    "application/pdf",
  );
  return f;
}
