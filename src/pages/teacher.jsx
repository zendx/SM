import React from "react";
import { BookOpen, CalendarCheck, GraduationCap } from "lucide-react";
import { useData } from "../hooks";
import { Button, Empty, Loading, PageHead, Panel, Table } from "../components";

export function TeacherWorkspace({ go }) {
  const setup = useData("/academics/setup", null);
  const classes = setup.data?.classes || [],
    assignments = setup.data?.assignments || [];

  return (
    <>
      <PageHead
        eyebrow="YOUR TEACHING DAY"
        title="Teacher workspace"
        description="Your assigned classes, subjects and learner records are gathered here."
      />
      {setup.error ? (
        <p className="form-error">{setup.error}</p>
      ) : !setup.data ? (
        <Loading />
      ) : classes.length === 0 ? (
        <Panel title="Class assignment pending">
          <Empty
            title="No classes or subjects are assigned yet"
            description="Your Teacher account is active. Ask the school administrator to assign you to a class or subject; it will appear here as soon as it is saved."
          />
        </Panel>
      ) : (
        <Panel
          title="My classes and subjects"
          description="Only classes and subjects assigned to your account appear here."
        >
          {assignments.length ? (
            <Table
              rows={assignments}
              columns={[
                { label: "Class", key: "class_name" },
                { label: "Subject", key: "subject_name" },
                {
                  label: "Actions",
                  render: () => (
                    <Button
                      small
                      secondary
                      onClick={() => go("academics", "gradebook")}
                    >
                      Open gradebook
                    </Button>
                  ),
                },
              ]}
            />
          ) : (
            <Table
              rows={classes}
              columns={[
                { label: "Class", key: "name" },
                {
                  label: "Actions",
                  render: () => (
                    <Button small secondary onClick={() => go("students")}>
                      View learners
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Panel>
      )}
      <Panel
        title="Quick access"
        description="Open the tools available to your Teacher account."
      >
        <div className="toolbar">
          <Button secondary onClick={() => go("academics")}>
            <BookOpen size={17} /> Academics
          </Button>
          <Button secondary onClick={() => go("attendance")}>
            <CalendarCheck size={17} /> Attendance
          </Button>
          <Button secondary onClick={() => go("students")}>
            <GraduationCap size={17} /> My learners
          </Button>
        </div>
      </Panel>
    </>
  );
}
