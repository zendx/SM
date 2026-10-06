import { z } from "zod";
export { z };
export const text = z.string().trim().min(1).max(250);
export const optionalText = z.string().trim().max(2000).default("");
export const id = z.coerce.number().int().positive();
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid calendar date",
  );
export const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128);
export const email = z.string().trim().toLowerCase().email();
export const attendanceStatuses = [
  "PRESENT",
  "ABSENT",
  "LATE",
  "EXCUSED",
  "SICK",
  "AUTHORIZED_ABSENCE",
];
export const studentSchema = z.object({
  first_name: text,
  middle_name: optionalText,
  last_name: text,
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  date_of_birth: date.refine(
    (v) => v < new Date().toISOString().slice(0, 10),
    "Birth date must be in the past",
  ),
  nationality: optionalText,
  address: optionalText,
  medical_info: optionalText,
  special_requirements: optionalText,
  boarding_status: z.enum(["DAY", "BOARDING"]).default("DAY"),
  transportation_required: z.boolean().default(false),
  guardian_name: text,
  guardian_phone: text,
  guardian_email: z.union([email, z.literal("")]).default(""),
  relationship: z.enum(["FATHER", "MOTHER", "GUARDIAN"]).default("GUARDIAN"),
  applied_class_id: id,
  previous_school: optionalText,
});
