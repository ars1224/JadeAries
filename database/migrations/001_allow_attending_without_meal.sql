DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'guests'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ILIKE '%rsvp_status%<>%attending%meal_choice%IS NOT NULL%'
    LOOP
        EXECUTE format('ALTER TABLE guests DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $$;
