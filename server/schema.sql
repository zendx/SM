CREATE TABLE IF NOT EXISTS schools (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, short_code TEXT NOT NULL UNIQUE,
 currency_code TEXT NOT NULL DEFAULT 'NGN', timezone TEXT NOT NULL DEFAULT 'Africa/Lagos',
 attendance_threshold INT NOT NULL DEFAULT 80 CHECK(attendance_threshold BETWEEN 1 AND 100),
 staff_start TEXT NOT NULL DEFAULT '08:00', attendance_cutoff TEXT NOT NULL DEFAULT '23:59',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS roles (name TEXT PRIMARY KEY, permissions JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id), name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL REFERENCES roles(name),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED')),
 mfa_secret TEXT, mfa_enabled BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(school_id,id)
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL,
 mfa_verified BOOLEAN NOT NULL DEFAULT false, expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reset_tokens (
 token_hash TEXT PRIMARY KEY,user_id INT NOT NULL REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
 key TEXT PRIMARY KEY,hits INT NOT NULL,reset_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limit_expiry ON auth_rate_limits(reset_at);
CREATE TABLE IF NOT EXISTS academic_years (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),name TEXT NOT NULL,
 start_date DATE NOT NULL,end_date DATE NOT NULL,CHECK(end_date>start_date),UNIQUE(school_id,id),UNIQUE(school_id,name)
);
CREATE TABLE IF NOT EXISTS terms (
 id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),academic_year_id INT NOT NULL,
 name TEXT NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,is_current BOOLEAN NOT NULL DEFAULT false,
 FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id),
 CHECK(end_date>=start_date),UNIQUE(school_id,id),UNIQUE(school_id,academic_year_id,name)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_current_term ON terms(school_id) WHERE is_current;
CREATE TABLE IF NOT EXISTS staff (
 id SERIAL PRIMARY KEY, school_id INT NOT NULL REFERENCES schools(id),user_id INT,
 staff_number TEXT NOT NULL,first_name TEXT NOT NULL,last_name TEXT NOT NULL,department TEXT NOT NULL,
 position TEXT NOT NULL,employment_type TEXT NOT NULL DEFAULT 'FULL_TIME',hire_date DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(school_id,staff_number),UNIQUE(user_id),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS classes (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),academic_year_id INT NOT NULL,
 name TEXT NOT NULL,capacity INT NOT NULL CHECK(capacity>0),teacher_user_id INT,
 UNIQUE(school_id,id),UNIQUE(school_id,academic_year_id,name),
 FOREIGN KEY(school_id,academic_year_id) REFERENCES academic_years(school_id,id),
 FOREIGN KEY(school_id,teacher_user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS students (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_number TEXT,
 first_name TEXT NOT NULL,middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL,
 gender TEXT NOT NULL CHECK(gender IN ('MALE','FEMALE','OTHER')),date_of_birth DATE NOT NULL,
 nationality TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',medical_info TEXT NOT NULL DEFAULT '',special_requirements TEXT NOT NULL DEFAULT '',
 boarding_status TEXT NOT NULL DEFAULT 'DAY' CHECK(boarding_status IN ('DAY','BOARDING')),transportation_required BOOLEAN NOT NULL DEFAULT false,
 status TEXT NOT NULL DEFAULT 'PROSPECTIVE' CHECK(status IN ('PROSPECTIVE','ENROLLED','WITHDRAWN','GRADUATED','SUSPENDED')),
 guardian_name TEXT NOT NULL,guardian_phone TEXT NOT NULL,guardian_email TEXT NOT NULL DEFAULT '',relationship TEXT NOT NULL DEFAULT 'GUARDIAN',
 parent_user_id INT, class_id INT,discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(discount_percent BETWEEN 0 AND 100),
 scholarship_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(scholarship_percent BETWEEN 0 AND 100),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(school_id,student_number),
 FOREIGN KEY(school_id,parent_user_id) REFERENCES users(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);
CREATE TABLE IF NOT EXISTS admission_applications (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,
 applied_class_id INT NOT NULL,previous_school TEXT NOT NULL DEFAULT '',
 stage TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(stage IN ('SUBMITTED','REVIEWED','ASSESSMENT_SCHEDULED','DECISION_PENDING','OFFERED','FEES_PENDING','ENROLLED','REJECTED')),
 decision_notes TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(student_id),FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
 FOREIGN KEY(school_id,applied_class_id) REFERENCES classes(school_id,id)
);
CREATE TABLE IF NOT EXISTS student_enrollment (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,class_id INT NOT NULL,
 enrollment_date DATE NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','TRANSFERRED','WITHDRAWN','GRADUATED')),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_enrollment ON student_enrollment(student_id) WHERE status='ACTIVE';
CREATE TABLE IF NOT EXISTS student_documents (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,
 name TEXT NOT NULL,storage_key TEXT NOT NULL,mime TEXT NOT NULL,size INT NOT NULL,
 uploaded_by INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,uploaded_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS student_attendance (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,class_id INT NOT NULL,
 attendance_date DATE NOT NULL,status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE','EXCUSED','SICK','AUTHORIZED_ABSENCE')),
 recorded_by INT NOT NULL,remarks TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(student_id,attendance_date),FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,recorded_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS attendance_unlocks (
 school_id INT NOT NULL,class_id INT NOT NULL,attendance_date DATE NOT NULL,PRIMARY KEY(school_id,class_id,attendance_date),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id)
);
CREATE TABLE IF NOT EXISTS staff_attendance (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),staff_id INT NOT NULL,attendance_date DATE NOT NULL,
 check_in_time TIMESTAMPTZ,check_out_time TIMESTAMPTZ,status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE','LEAVE','SICK_LEAVE','OFFICIAL_ASSIGNMENT')),
 UNIQUE(staff_id,attendance_date),FOREIGN KEY(school_id,staff_id) REFERENCES staff(school_id,id),
 CHECK(check_out_time IS NULL OR check_out_time>=check_in_time)
);
CREATE TABLE IF NOT EXISTS fee_structures (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),class_id INT NOT NULL,term_id INT NOT NULL,
 fee_category TEXT NOT NULL CHECK(fee_category IN ('TUITION','BOARDING','TRANSPORT','EXAM','BOOKS','UNIFORM','MEALS','ACTIVITY','OTHER')),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0),UNIQUE(school_id,id),UNIQUE(class_id,term_id,fee_category),
 FOREIGN KEY(school_id,class_id) REFERENCES classes(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS student_invoices (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),student_id INT NOT NULL,term_id INT NOT NULL,
 invoice_number TEXT NOT NULL,total_cents BIGINT NOT NULL CHECK(total_cents>=0),paid_cents BIGINT NOT NULL DEFAULT 0 CHECK(paid_cents>=0),
 due_date DATE NOT NULL,waived BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(paid_cents<=total_cents),UNIQUE(school_id,id),UNIQUE(student_id,term_id),UNIQUE(school_id,invoice_number),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES terms(school_id,id)
);
CREATE TABLE IF NOT EXISTS invoice_items (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),invoice_id INT NOT NULL,description TEXT NOT NULL,amount_cents BIGINT NOT NULL,
 FOREIGN KEY(school_id,invoice_id) REFERENCES student_invoices(school_id,id)
);
CREATE TABLE IF NOT EXISTS payments (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),invoice_id INT NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH','BANK_TRANSFER','CARD','INSTALLMENT')),
 reference_number TEXT NOT NULL DEFAULT '',receipt_number TEXT NOT NULL,idempotency_key TEXT NOT NULL,received_by INT NOT NULL,
 paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(school_id,id),UNIQUE(school_id,receipt_number),UNIQUE(school_id,idempotency_key),
 FOREIGN KEY(school_id,invoice_id) REFERENCES student_invoices(school_id,id),FOREIGN KEY(school_id,received_by) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS payment_plans (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),invoice_id INT NOT NULL,due_date DATE NOT NULL,amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 note TEXT NOT NULL DEFAULT '',FOREIGN KEY(school_id,invoice_id) REFERENCES student_invoices(school_id,id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),user_id INT,entity_type TEXT NOT NULL,entity_id INT NOT NULL,
 action TEXT NOT NULL,previous_value JSONB,new_value JSONB,occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE TABLE IF NOT EXISTS alerts (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),category TEXT NOT NULL,severity TEXT NOT NULL,
 entity_id INT NOT NULL,message TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'ACTIVE',updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,category,entity_id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),user_id INT,email TEXT,title TEXT NOT NULL,body TEXT NOT NULL,
 dedupe_key TEXT NOT NULL,delivery_status TEXT NOT NULL DEFAULT 'PENDING',attempts INT NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),sent_at TIMESTAMPTZ,
 UNIQUE(school_id,dedupe_key),FOREIGN KEY(school_id,user_id) REFERENCES users(school_id,id)
);
CREATE INDEX IF NOT EXISTS student_class ON students(school_id,class_id);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS claimed_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS attendance_date ON student_attendance(school_id,attendance_date);
CREATE INDEX IF NOT EXISTS staff_attendance_date ON staff_attendance(school_id,attendance_date);
CREATE INDEX IF NOT EXISTS invoice_school ON student_invoices(school_id,term_id);
CREATE INDEX IF NOT EXISTS payment_date ON payments(school_id,paid_at);
CREATE INDEX IF NOT EXISTS audit_school ON audit_logs(school_id,occurred_at);
