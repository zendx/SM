ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS school_inbox_unread ON notifications(user_id,school_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS message_session_presence ON sessions(user_id,last_seen_at DESC) WHERE mfa_verified;
CREATE INDEX IF NOT EXISTS message_parent_children ON students(school_id,parent_user_id,class_id) WHERE status='ENROLLED';

CREATE TABLE IF NOT EXISTS school_conversations (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),
 student_id INT NOT NULL,parent_user_id INT NOT NULL,staff_user_id INT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(school_id,id),UNIQUE(school_id,student_id,parent_user_id,staff_user_id),
 CHECK(parent_user_id<>staff_user_id),
 FOREIGN KEY(school_id,student_id) REFERENCES students(school_id,id),
 FOREIGN KEY(school_id,parent_user_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,staff_user_id) REFERENCES users(school_id,id)
);
CREATE INDEX IF NOT EXISTS school_conversations_parent ON school_conversations(school_id,parent_user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS school_conversations_staff ON school_conversations(school_id,staff_user_id,updated_at DESC);
-- Direct school/parent chats also work before a child has been enrolled.
ALTER TABLE school_conversations ALTER COLUMN student_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS school_conversations_direct
 ON school_conversations(school_id,parent_user_id,staff_user_id) WHERE student_id IS NULL;
CREATE TABLE IF NOT EXISTS school_messages (
 id SERIAL PRIMARY KEY,school_id INT NOT NULL REFERENCES schools(id),conversation_id INT NOT NULL,
 sender_id INT NOT NULL,recipient_id INT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 4000),
 client_key TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_id,client_key),
 FOREIGN KEY(school_id,conversation_id) REFERENCES school_conversations(school_id,id),
 FOREIGN KEY(school_id,sender_id) REFERENCES users(school_id,id),
 FOREIGN KEY(school_id,recipient_id) REFERENCES users(school_id,id)
);
CREATE INDEX IF NOT EXISTS school_messages_thread ON school_messages(conversation_id,id DESC);
CREATE INDEX IF NOT EXISTS school_messages_unread ON school_messages(school_id,recipient_id,conversation_id) WHERE read_at IS NULL;
