import React, { useState } from "react";
import { Form } from "./components";
import { post } from "./api";

export function TeachingAssignmentForm({ setup, yearId, onSaved }) {
  const classes = setup.classes.filter(
    (c) => Number(c.academic_year_id) === Number(yearId),
  );
  const [classIds, setClasses] = useState([]),
    [subjectIds, setSubjects] = useState([]),
    [values, setValues] = useState({});
  const toggle = (setter, id) =>
    setter((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const existing = setup.assignments.filter(
    (a) => classIds.includes(a.class_id) && subjectIds.includes(a.subject_id),
  );
  const replacements = existing.filter(
    (a) =>
      values.teacher_user_id &&
      Number(a.teacher_user_id) !== Number(values.teacher_user_id),
  );
  const count = classIds.length * subjectIds.length;
  if (!classes.length || !setup.subjects.length || !setup.teachers.length)
    return (
      <div className="notice">
        Add a class for the selected academic year, a subject and an active
        teacher account before assigning teaching work.
      </div>
    );
  return (
    <div className="assignment-editor">
      <p>
        Select the classes and subjects this teacher will teach. Each selected
        subject will be assigned in every selected class. Creating a subject
        alone does not assign it to a teacher.
      </p>
      <div className="assignment-selections">
        <fieldset>
          <legend>Classes</legend>
          {classes.map((c) => (
            <label className="selection-option" key={c.id}>
              <input
                type="checkbox"
                checked={classIds.includes(c.id)}
                onChange={() => toggle(setClasses, c.id)}
              />
              <span>{c.name}</span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Subjects</legend>
          {setup.subjects.map((s) => (
            <label className="selection-option" key={s.id}>
              <input
                type="checkbox"
                checked={subjectIds.includes(s.id)}
                onChange={() => toggle(setSubjects, s.id)}
              />
              <span>{s.name}</span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="assignment-preview" aria-live="polite">
        <strong>
          {count} teaching assignment{count === 1 ? "" : "s"} selected
        </strong>
        {count > 0 && (
          <ul>
            {classes
              .filter((c) => classIds.includes(c.id))
              .map((c) => (
                <li key={c.id}>
                  <strong>{c.name}:</strong>{" "}
                  {setup.subjects
                    .filter((s) => subjectIds.includes(s.id))
                    .map((s) => s.name)
                    .join(", ")}
                </li>
              ))}
          </ul>
        )}
        {replacements.length > 0 && (
          <p role="alert">
            {replacements.length} existing assignment(s) belong to another
            teacher. Confirm the change below to reassign them.
          </p>
        )}
      </div>
      <Form
        onValuesChange={setValues}
        fields={[
          {
            name: "teacher_user_id",
            label: "Teacher",
            options: setup.teachers.map((t) => ({
              value: t.id,
              label: t.name,
            })),
          },
          {
            name: "credits",
            label: "Subject credits",
            type: "number",
            min: 0.01,
            max: 20,
            step: 0.01,
            default: 1,
          },
          ...(replacements.length
            ? [
                {
                  name: "confirm_reassignment",
                  label:
                    "Reassign the selected subjects from their current teacher",
                  type: "checkbox",
                  required: true,
                  wide: true,
                },
              ]
            : []),
        ]}
        submit="Save assignments"
        onSubmit={async (v) => {
          if (!classIds.length || !subjectIds.length)
            throw new Error("Select at least one class and one subject.");
          if (count > 100)
            throw new Error(
              "Select at most 100 class and subject combinations at a time.",
            );
          if (replacements.length && !v.confirm_reassignment)
            throw new Error("Confirm the teacher reassignment before saving.");
          const result = await post("/class-subjects/bulk", {
            class_ids: classIds,
            subject_ids: subjectIds,
            teacher_user_id: v.teacher_user_id,
            credits: v.credits,
          });
          onSaved(result.assignments);
        }}
      />
    </div>
  );
}
