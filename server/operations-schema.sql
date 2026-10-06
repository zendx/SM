CREATE TABLE IF NOT EXISTS operations_settings (
 school_id INT PRIMARY KEY REFERENCES schools(id), complaint_sla_hours INT NOT NULL DEFAULT 24 CHECK(complaint_sla_hours BETWEEN 1 AND 720),
 discipline_threshold INT NOT NULL DEFAULT 3 CHECK(discipline_threshold BETWEEN 2 AND 100), discipline_window_days INT NOT NULL DEFAULT 30 CHECK(discipline_window_days BETWEEN 1 AND 365),
 review_weights JSONB NOT NULL DEFAULT '{"attendance":25,"punctuality":25,"curriculum":25,"development":25}'
);
CREATE TABLE IF NOT EXISTS facilities (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),name TEXT NOT NULL,category TEXT NOT NULL,location TEXT NOT NULL,
 condition TEXT NOT NULL CHECK(condition IN ('GOOD','FAIR','POOR','OUT_OF_SERVICE')),responsible_user_id INT,
 UNIQUE(school_id,id),UNIQUE(school_id,name),FOREIGN KEY(school_id,responsible_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS assets (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),facility_id INT NOT NULL,asset_code TEXT NOT NULL,description TEXT NOT NULL,
 purchase_date DATE NOT NULL,purchase_value_cents BIGINT NOT NULL CHECK(purchase_value_cents>=0),condition TEXT NOT NULL CHECK(condition IN ('GOOD','FAIR','POOR','OUT_OF_SERVICE')),
 responsible_user_id INT,UNIQUE(school_id,id),UNIQUE(school_id,asset_code),FOREIGN KEY(school_id,facility_id) REFERENCES facilities(school_id,id),FOREIGN KEY(school_id,responsible_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS service_cases (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),kind TEXT NOT NULL CHECK(kind IN ('DISCIPLINE','COMPLAINT','MAINTENANCE')),
 category TEXT NOT NULL,description TEXT NOT NULL,event_date DATE NOT NULL,priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK(priority IN ('LOW','NORMAL','HIGH','URGENT')),
 stage TEXT NOT NULL,student_id INT,facility_id INT,asset_id INT,parent_user_id INT,created_by INT NOT NULL,assigned_to INT,
 due_at TIMESTAMPTZ,parent_notified_at TIMESTAMPTZ,action_type TEXT,follow_up TEXT NOT NULL DEFAULT '',cost_cents BIGINT CHECK(cost_cents>=0),
 feedback_score INT CHECK(feedback_score BETWEEN 1 AND 5),feedback_note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),resolved_at TIMESTAMPTZ,
 UNIQUE(school_id,id),FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,facility_id) REFERENCES facilities(school_id,id),FOREIGN KEY(school_id,asset_id) REFERENCES assets(school_id,id),
 FOREIGN KEY(school_id,parent_user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,created_by) REFERENCES users(school_id,id),FOREIGN KEY(school_id,assigned_to) REFERENCES users(school_id,id),
 CHECK(kind<>'DISCIPLINE' OR student_id IS NOT NULL),CHECK(kind<>'COMPLAINT' OR parent_user_id IS NOT NULL),CHECK(kind<>'MAINTENANCE' OR facility_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS case_actions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,case_id INT NOT NULL,actor_id INT NOT NULL,from_stage TEXT NOT NULL,to_stage TEXT NOT NULL,note TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,case_id) REFERENCES service_cases(school_id,id),FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS maintenance_history (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,case_id INT NOT NULL UNIQUE,cost_cents BIGINT NOT NULL CHECK(cost_cents>=0),closed_by INT NOT NULL,closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,case_id) REFERENCES service_cases(school_id,id),FOREIGN KEY(school_id,closed_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS satisfaction_surveys (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),title TEXT NOT NULL,questions JSONB NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,published BOOLEAN NOT NULL DEFAULT false,
 UNIQUE(school_id,id),CHECK(end_date>=start_date)
);
CREATE TABLE IF NOT EXISTS survey_responses (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,survey_id INT NOT NULL,parent_user_id INT NOT NULL,answers JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(survey_id,parent_user_id),FOREIGN KEY(school_id,survey_id) REFERENCES satisfaction_surveys(school_id,id),FOREIGN KEY(school_id,parent_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS staff_profiles (
 staff_id INT PRIMARY KEY,school_id INT NOT NULL,supervisor_user_id INT,qualifications TEXT NOT NULL DEFAULT '',certifications TEXT NOT NULL DEFAULT '',employment_history TEXT NOT NULL DEFAULT '',contract_notes TEXT NOT NULL DEFAULT '',training TEXT NOT NULL DEFAULT '',
 FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),FOREIGN KEY(school_id,supervisor_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS vacancies (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),title TEXT NOT NULL,department TEXT NOT NULL,description TEXT NOT NULL,closing_date DATE NOT NULL,status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),UNIQUE(school_id,id)
);
CREATE TABLE IF NOT EXISTS job_applicants (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,vacancy_id INT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,qualifications TEXT NOT NULL,
 stage TEXT NOT NULL DEFAULT 'APPLIED' CHECK(stage IN ('APPLIED','SHORTLISTED','INTERVIEW','OFFERED','HIRED','REJECTED')),interview_at TIMESTAMPTZ,evaluation TEXT NOT NULL DEFAULT '',staff_id INT,
 UNIQUE(school_id,id),UNIQUE(vacancy_id,email),FOREIGN KEY(school_id,vacancy_id) REFERENCES vacancies(school_id,id),FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id)
);
CREATE TABLE IF NOT EXISTS recruitment_history (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,applicant_id INT NOT NULL,stage TEXT NOT NULL,note TEXT NOT NULL,actor_id INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,applicant_id) REFERENCES job_applicants(school_id,id),FOREIGN KEY(school_id,actor_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS leave_requests (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,staff_id INT NOT NULL,supervisor_user_id INT NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','REVIEWED','APPROVED','REJECTED')),decision_note TEXT NOT NULL DEFAULT '',decided_by INT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),CHECK(end_date>=start_date),FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),FOREIGN KEY(school_id,supervisor_user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,decided_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS performance_reviews (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,staff_id INT NOT NULL,academic_year_id INT NOT NULL,development_score NUMERIC NOT NULL CHECK(development_score BETWEEN 0 AND 100),overall_score NUMERIC,snapshot JSONB NOT NULL,notes TEXT NOT NULL,reviewed_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(staff_id,academic_year_id),FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id),FOREIGN KEY(school_id,reviewed_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
 user_id INT NOT NULL REFERENCES users(id),code_hash TEXT NOT NULL,PRIMARY KEY(user_id,code_hash)
);
CREATE INDEX IF NOT EXISTS cases_scope ON service_cases(school_id,kind,stage);
CREATE INDEX IF NOT EXISTS cases_repeat ON service_cases(school_id,student_id,event_date);
CREATE INDEX IF NOT EXISTS leave_scope ON leave_requests(school_id,staff_id,start_date,end_date);
CREATE TABLE IF NOT EXISTS platform_operators (user_id INT PRIMARY KEY REFERENCES users(id));
CREATE TABLE IF NOT EXISTS gateway_transactions (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL,invoice_id INT NOT NULL,initiated_by INT NOT NULL,reference TEXT NOT NULL UNIQUE,
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0),currency TEXT NOT NULL,mode TEXT NOT NULL CHECK(mode IN ('TEST','LIVE')),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','INITIALIZED','PAID','TEST_CONFIRMED','REVIEW','FAILED')),authorization_url TEXT,provider_id TEXT,payment_id INT,review_note TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),FOREIGN KEY(school_id,invoice_id) REFERENCES student_invoices(school_id,id),FOREIGN KEY(school_id,initiated_by) REFERENCES users(school_id,id),FOREIGN KEY(school_id,payment_id) REFERENCES payments(school_id,id)
);
