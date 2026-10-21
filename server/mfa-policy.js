export function requiresMfa(user) {
  return !!(
    user.platform_operator ||
    user.platform_scope ||
    [
      "PLATFORM_OWNER",
      "SUPER_ADMIN",
      "PRINCIPAL",
      "VICE_PRINCIPAL",
      "FINANCE_OFFICER",
      "HR_OFFICER",
    ].includes(user.role)
  );
}
