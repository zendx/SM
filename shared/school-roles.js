// School account roles shared by tenant forms and the configuration API.
export const SCHOOL_ROLE_LABELS = Object.freeze({
  SUPER_ADMIN: "School Administrator",
  PROPRIETOR: "Proprietor",
  PRINCIPAL: "Principal",
  VICE_PRINCIPAL: "Vice Principal",
  ADMISSIONS_OFFICER: "Admissions Officer",
  TEACHER: "Teacher",
  FINANCE_OFFICER: "Finance Officer",
  HR_OFFICER: "HR Officer",
  FACILITIES_MANAGER: "Facilities Manager",
  PARENT: "Parent",
  STUDENT: "Student",
});
export const SCHOOL_ROLES = Object.freeze(Object.keys(SCHOOL_ROLE_LABELS));
export const SCHOOL_ROLE_OPTIONS = Object.freeze(
  SCHOOL_ROLES.map((value) =>
    Object.freeze({ value, label: SCHOOL_ROLE_LABELS[value] }),
  ),
);
