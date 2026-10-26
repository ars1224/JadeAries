BEGIN;

ALTER TABLE public.guests
    ADD COLUMN IF NOT EXISTS table_number INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'guests_table_number_range'
           AND conrelid = 'public.guests'::REGCLASS
    ) THEN
        ALTER TABLE public.guests
            ADD CONSTRAINT guests_table_number_range
            CHECK (table_number IS NULL OR table_number BETWEEN 1 AND 999);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS guests_table_number_idx
    ON public.guests (table_number)
    WHERE table_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_set_guest_table(
    p_guest_id TEXT,
    p_table_number INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    selected_guest_id public.guests.id%TYPE;
BEGIN
    IF p_table_number IS NOT NULL AND (p_table_number < 1 OR p_table_number > 999) THEN
        RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'Table number must be between 1 and 999.';
    END IF;

    UPDATE public.guests
       SET table_number = p_table_number,
           updated_at = NOW()
     WHERE id::TEXT = p_guest_id
     RETURNING id INTO selected_guest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Guest not found.';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'id', selected_guest_id::TEXT,
        'tableNumber', p_table_number
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_guest_table(TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_guest_table(TEXT, INTEGER)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
