CREATE TABLE IF NOT EXISTS academic_settings (
 school_id INT PRIMARY KEY REFERENCES schools(id),
 grading_scale JSONB NOT NULL DEFAULT '[{"letter":"A","minimum":70,"points":5},{"letter":"B","minimum":60,"points":4},{"letter":"C","minimum":50,"points":3},{"letter":"D","minimum":45,"points":2},{"letter":"E","minimum":40,"points":1},{"letter":"F","minimum":0,"points":0}]',
 pass_mark NUMERIC(5,2) NOT NULL DEFAULT 50 CHECK(pass_mark BETWEEN 0 AND 100),
 ranking_enabled BOOLEAN NOT NULL DEFAULT false,gpa_enabled BOOLEAN NOT NULL DEFAULT false,
 decline_threshold NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK(decline_threshold>0 AND decline_threshold<=100),
 repeated_failure_terms INT NOT NULL DEFAULT 2 CHECK(repeated_failure_terms BETWEEN 2 AND 6),
 risk_attendance_threshold INT NOT NULL DEFAULT 80 CHECK(risk_attendance_threshold BETWEEN 1 AND 100),
 curriculum_lag_weeks INT NOT NULL DEFAULT 2 CHECK(curriculum_lag_weeks BETWEEN 0 AND 12),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subjects (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),name TEXT NOT NULL,code TEXT NOT NULL,department TEXT NOT NULL DEFAULT 'General',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(school_id,code)
);
CREATE TABLE IF NOT EXISTS class_subjects (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),class_id INT NOT NULL,subject_id INT NOT NULL,teacher_user_id INT NOT NULL,
 credits NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK(credits>0 AND credits<=20),
 UNIQUE(school_id,id),UNIQUE(class_id,subject_id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,subject_id) REFERENCES subjects(school_id,id),FOREIGN KEY(school_id,teacher_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS academic_term_controls (
 school_id INT NOT NULL,term_id INT NOT NULL,closed BOOLEAN NOT NULL DEFAULT false,unlock_until DATE,reason TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(school_id,term_id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS assessments (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),class_subject_id INT NOT NULL,term_id INT NOT NULL,name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('ASSIGNMENT','TEST','CA','PRACTICAL','PROJECT','EXAM')),
 max_score NUMERIC(8,2) NOT NULL CHECK(max_score>0 AND max_score<=10000),weight_percent NUMERIC(5,2) NOT NULL CHECK(weight_percent>0 AND weight_percent<=100),
 assessment_date DATE NOT NULL,created_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(class_subject_id,term_id,name),
 FOREIGN KEY(school_id,class_subject_id) REFERENCES class_subjects(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS student_scores (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),assessment_id INT NOT NULL,student_id INT NOT NULL,
 score NUMERIC(8,2) NOT NULL CHECK(score>=0),entered_by INT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(assessment_id,student_id),FOREIGN KEY(school_id,assessment_id) REFERENCES assessments(school_id,id),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,entered_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS report_batches (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),class_id INT NOT NULL,term_id INT NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FINALIZED','PUBLISHED')),revision INT NOT NULL DEFAULT 1,
 generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),finalized_at TIMESTAMPTZ,published_at TIMESTAMPTZ,
 UNIQUE(school_id,id),UNIQUE(class_id,term_id),FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS report_cards (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),batch_id INT NOT NULL,student_id INT NOT NULL,
 overall_average NUMERIC(6,2) NOT NULL,overall_grade TEXT NOT NULL,gpa NUMERIC(5,2),class_rank INT,
 snapshot JSONB NOT NULL,teacher_comment TEXT NOT NULL DEFAULT '',principal_comment TEXT NOT NULL DEFAULT '',
 UNIQUE(school_id,id),UNIQUE(batch_id,student_id),
 FOREIGN KEY(school_id,batch_id) REFERENCES report_batches(school_id,id),FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id)
);
CREATE TABLE IF NOT EXISTS academic_student_accounts (
 school_id INT NOT NULL,student_id INT NOT NULL,user_id INT NOT NULL,PRIMARY KEY(school_id,student_id),UNIQUE(user_id),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS at_risk_flags (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,term_id INT NOT NULL,class_id INT NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('REPEATED_FAILURE','GRADE_DECLINE','LOW_ATTENDANCE_AND_PERFORMANCE')),
 detail TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),resolution_note TEXT NOT NULL DEFAULT '',
 resolved_by INT,resolved_at TIMESTAMPTZ,flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(student_id,term_id,reason),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,resolved_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS curriculum_topics (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),class_subject_id INT NOT NULL,term_id INT NOT NULL,
 topic_name TEXT NOT NULL,planned_week INT NOT NULL CHECK(planned_week BETWEEN 1 AND 53),sequence_order INT NOT NULL CHECK(sequence_order>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(class_subject_id,term_id,sequence_order),
 FOREIGN KEY(school_id,class_subject_id) REFERENCES class_subjects(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS curriculum_coverage_logs (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),curriculum_topic_id INT NOT NULL,date_taught DATE NOT NULL,
 lesson_duration_minutes INT NOT NULL CHECK(lesson_duration_minutes BETWEEN 0 AND 600),
 completion_status TEXT NOT NULL CHECK(completion_status IN ('COMPLETED','PARTIAL','NOT_STARTED')),
 reason_for_noncompletion TEXT NOT NULL DEFAULT '',logged_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(completion_status='COMPLETED' OR length(trim(reason_for_noncompletion))>0),
 FOREIGN KEY(school_id,curriculum_topic_id) REFERENCES curriculum_topics(school_id,id),FOREIGN KEY(school_id,logged_by) REFERENCES users(school_id,id)
);
CREATE INDEX IF NOT EXISTS scores_student ON student_scores(school_id,student_id);
CREATE INDEX IF NOT EXISTS assessment_term ON assessments(school_id,term_id);
CREATE INDEX IF NOT EXISTS report_student ON report_cards(school_id,student_id);
CREATE INDEX IF NOT EXISTS coverage_topic ON curriculum_coverage_logs(school_id,curriculum_topic_id,date_taught DESC,id DESC);
CREATE INDEX IF NOT EXISTS risk_status ON at_risk_flags(school_id,term_id,status);
