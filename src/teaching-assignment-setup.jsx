import React, { useState } from "react";
import { Button, Form } from "./components";
import { post } from "./api";

export function TeachingAssignmentSetup({
  setup,
  yearId,
  canManage,
  onSaved,
  onSetup,
}) {
  const [open, setOpen] = useState(false);
  const classes = (setup.classes || []).filter(
    (row) => Number(row.academic_year_id) === Number(yearId),
  );
  const ready =
    classes.length && setup.subjects?.length && setup.teachers?.length;
  return (
    <div className="notice">
      <p>
        No subjects have been assigned to classes for this academic year yet. A
        class and a subject need to be linked to a teacher before you can plan
        topics or create assessments.
      </p>
      {canManage ? (
        ready ? (
          <>
            {!open && (
              <Button onClick={() => setOpen(true)}>
                Assign a subject to a class
              </Button>
            )}
            {open && (
              <Form
                fields={[
                  {
                    name: "class_id",
                    label: "Class",
                    options: classes.map((c) => ({
                      value: c.id,
                      label: c.name,
                    })),
                  },
                  {
                    name: "subject_id",
                    label: "Subject",
                    options: setup.subjects.map((s) => ({
                      value: s.id,
                      label: s.name,
                    })),
                  },
                  {
                    name: "teacher_user_id",
                    label: "Teacher",
                    options: setup.teachers.map((t) => ({
                      value: t.id,
                      label: t.name,
                    })),
                  },
                ]}
                submit="Save teaching assignment"
                onSubmit={async (values) => {
                  await post("/class-subjects", values);
                  onSaved();
                }}
              />
            )}
          </>
        ) : (
          <>
            <p>
              {!classes.length &&
                "Add a class for the selected term’s academic year in Administration. "}
              {!setup.subjects?.length &&
                "Add a subject in Academics → Setup. "}
              {!setup.teachers?.length &&
                "Create an active Teacher account in Administration. "}
              Then assign the subject to a class and teacher.
            </p>
            {onSetup ? (
              <Button secondary onClick={onSetup}>
                Open academic setup
              </Button>
            ) : (
              <a href="#academics/setup">Open academic setup</a>
            )}
          </>
        )
      ) : (
        <p>
          Ask your school administrator to assign a subject and teacher to your
          class for this academic year.
        </p>
      )}
    </div>
  );
}
