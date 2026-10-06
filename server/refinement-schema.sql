CREATE TABLE IF NOT EXISTS academic_roster_sets (
 school_id INT NOT NULL,class_id INT NOT NULL,term_id INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(school_id,class_id,term_id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS academic_rosters (
 school_id INT NOT NULL,class_id INT NOT NULL,term_id INT NOT NULL,student_id INT NOT NULL,excluded BOOLEAN NOT NULL DEFAULT false,subject_ids JSONB,
 source TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(school_id,class_id,term_id,student_id),
 FOREIGN KEY(school_id,class_id,term_id) REFERENCES academic_roster_sets(school_id,class_id,term_id),FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id)
);
CREATE TABLE IF NOT EXISTS academic_class_policies (
 school_id INT NOT NULL,class_id INT NOT NULL,term_id INT NOT NULL,label TEXT NOT NULL,policy JSONB NOT NULL,PRIMARY KEY(school_id,class_id,term_id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS report_revisions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,report_card_id INT NOT NULL,revision INT NOT NULL,record JSONB NOT NULL,reason TEXT NOT NULL,archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(report_card_id,revision),FOREIGN KEY(school_id,report_card_id) REFERENCES report_cards(school_id,id)
);
CREATE TABLE IF NOT EXISTS exam_sessions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,class_subject_id INT NOT NULL,term_id INT NOT NULL,exam_date DATE NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,room TEXT NOT NULL,invigilator_id INT NOT NULL,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,class_subject_id) REFERENCES class_subjects(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),FOREIGN KEY(school_id,invigilator_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS staff_documents (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,staff_id INT NOT NULL,name TEXT NOT NULL,category TEXT NOT NULL,storage_key TEXT NOT NULL,mime TEXT NOT NULL,size INT NOT NULL,uploaded_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),FOREIGN KEY(school_id,uploaded_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS work_calendars (
 school_id INT PRIMARY KEY REFERENCES schools(id),weekdays JSONB NOT NULL DEFAULT '[1,2,3,4,5]',annual_leave_days INT NOT NULL DEFAULT 20 CHECK(annual_leave_days BETWEEN 0 AND 366)
);
CREATE TABLE IF NOT EXISTS school_holidays (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),date DATE NOT NULL,name TEXT NOT NULL,UNIQUE(school_id,date),UNIQUE(school_id,id)
);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_note TEXT NOT NULL DEFAULT '';
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS working_days INT;
CREATE TABLE IF NOT EXISTS leave_attendance_changes (
 school_id INT NOT NULL,leave_id INT NOT NULL,attendance_date DATE NOT NULL,attendance_id INT NOT NULL,previous_record JSONB,
 PRIMARY KEY(leave_id,attendance_date),FOREIGN KEY(school_id,leave_id) REFERENCES leave_requests(school_id,id)
);
ALTER TABLE performance_reviews ADD COLUMN IF NOT EXISTS revision INT NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS review_revisions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,review_id INT NOT NULL,revision INT NOT NULL,record JSONB NOT NULL,reason TEXT NOT NULL,changed_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(review_id,revision),FOREIGN KEY(school_id,review_id) REFERENCES performance_reviews(school_id,id),FOREIGN KEY(school_id,changed_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS intelligence_datasets (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),kind TEXT NOT NULL CHECK(kind IN ('REVENUE','STUDENT_SUPPORT','RETENTION')),name TEXT NOT NULL,source_note TEXT NOT NULL,records JSONB NOT NULL,checksum TEXT NOT NULL,created_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS model_runs (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,dataset_id INT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,report JSONB NOT NULL,artifact JSONB,created_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,dataset_id) REFERENCES intelligence_datasets(school_id,id),FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id)
);
