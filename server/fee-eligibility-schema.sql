-- Retain the first school entry term across all class transfers.
ALTER TABLE students ADD COLUMN IF NOT EXISTS school_entry_term_id INT;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='students_school_entry_term_fk' AND conrelid='students'::regclass) THEN
 ALTER TABLE students ADD CONSTRAINT students_school_entry_term_fk FOREIGN KEY(school_id,school_entry_term_id) REFERENCES terms(school_id,id);
 END IF;
END $$;
ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS fee_structures_fee_category_check;
ALTER TABLE fee_structures ADD CONSTRAINT fee_structures_fee_category_check CHECK(fee_category IN ('ADMISSION','TUITION','BOARDING','TRANSPORT','EXAM','BOOKS','UNIFORM','MEALS','ACTIVITY','OTHER'));
ALTER TABLE fee_structures ADD COLUMN IF NOT EXISTS applies_to TEXT NOT NULL DEFAULT 'ALL' CHECK(applies_to IN ('ALL','NEW_INTAKES','RETURNING'));
ALTER TABLE fee_structures DROP CONSTRAINT IF EXISTS admission_new_intakes_only;
ALTER TABLE fee_structures ADD CONSTRAINT admission_new_intakes_only CHECK(fee_category <> 'ADMISSION' OR applies_to='NEW_INTAKES');
