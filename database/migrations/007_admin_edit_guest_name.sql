-- Allow the private Netlify admin dashboard to rename a guest while preserving
-- normalized-name lookup and the existing atomic RSVP update behavior.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
    p_guest_id TEXT,
    p_full_name TEXT,
    p_status TEXT,
    p_main_id TEXT DEFAULT NULL,
    p_dessert_id TEXT DEFAULT NULL,
    p_dietary_requirements TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    selected_guest_id public.guests.id%TYPE;
    cleaned_full_name TEXT;
    cleaned_normalized_name TEXT;
    normalized_name_is_generated BOOLEAN;
BEGIN
    cleaned_full_name := BTRIM(REGEXP_REPLACE(COALESCE(p_full_name, ''), '[[:space:]]+', ' ', 'g'));
    cleaned_normalized_name := LOWER(cleaned_full_name);

    IF CHAR_LENGTH(cleaned_full_name) < 2 OR CHAR_LENGTH(cleaned_full_name) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22001', MESSAGE = 'Guest name must be between 2 and 160 characters.';
    END IF;

    SELECT id
      INTO selected_guest_id
      FROM public.guests
     WHERE id::TEXT = p_guest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Guest not found.';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.guests
         WHERE normalized_name = cleaned_normalized_name
           AND id <> selected_guest_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'A guest with that normalized name already exists.';
    END IF;

    SELECT is_generated <> 'NEVER'
      INTO normalized_name_is_generated
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'guests'
       AND column_name = 'normalized_name';

    IF COALESCE(normalized_name_is_generated, FALSE) THEN
        UPDATE public.guests
           SET full_name = cleaned_full_name,
               updated_at = NOW()
         WHERE id = selected_guest_id;
    ELSE
        UPDATE public.guests
           SET full_name = cleaned_full_name,
               normalized_name = cleaned_normalized_name,
               updated_at = NOW()
         WHERE id = selected_guest_id;
    END IF;

    RETURN public.admin_update_guest_rsvp(
        p_guest_id,
        p_status,
        p_main_id,
        p_dessert_id,
        p_dietary_requirements,
        p_notes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
