-- Keep the assigned attire profile in sync when the admin dashboard changes a role.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest(
    p_guest_id TEXT,
    p_full_name TEXT,
    p_role TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
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
    selected_attire_profile_id public.attire_profiles.id%TYPE;
    cleaned_full_name TEXT;
    cleaned_normalized_name TEXT;
    cleaned_role TEXT;
    normalized_role TEXT;
    normalized_name_is_generated BOOLEAN;
    has_attire_profile_id BOOLEAN;
BEGIN
    cleaned_full_name := BTRIM(REGEXP_REPLACE(COALESCE(p_full_name, ''), '[[:space:]]+', ' ', 'g'));
    cleaned_normalized_name := LOWER(cleaned_full_name);
    cleaned_role := BTRIM(REGEXP_REPLACE(COALESCE(NULLIF(p_role, ''), 'Guest'), '[[:space:]]+', ' ', 'g'));
    normalized_role := LOWER(cleaned_role);

    IF CHAR_LENGTH(cleaned_full_name) < 2 OR CHAR_LENGTH(cleaned_full_name) > 160 THEN
        RAISE EXCEPTION USING ERRCODE = '22001', MESSAGE = 'Guest name must be between 2 and 160 characters.';
    END IF;

    IF CHAR_LENGTH(cleaned_role) < 2 OR CHAR_LENGTH(cleaned_role) > 80 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid guest role.';
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

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'attire_profile_id'
    ) INTO has_attire_profile_id;

    IF has_attire_profile_id THEN
        SELECT id
          INTO selected_attire_profile_id
          FROM public.attire_profiles
         WHERE LOWER(BTRIM(display_name)) = ANY(CASE normalized_role
             WHEN 'proxy ninong' THEN ARRAY['ninong']
             WHEN 'proxy ninang' THEN ARRAY['ninang']
             WHEN 'groomsmen' THEN ARRAY['groomsman', 'groomsmen']
             WHEN 'guest - officiant' THEN ARRAY['officiant']
             WHEN 'guest' THEN ARRAY['guest', 'wedding guest']
             WHEN 'parents' THEN ARRAY['parents', 'father of the bride', 'mother of the bride', 'father of the groom', 'mother of the groom']
             ELSE ARRAY[normalized_role]
         END)
         ORDER BY CASE LOWER(BTRIM(display_name))
             WHEN normalized_role THEN 0
             WHEN 'wedding guest' THEN 1
             WHEN 'parents' THEN 1
             WHEN 'father of the bride' THEN 2
             WHEN 'mother of the bride' THEN 3
             WHEN 'father of the groom' THEN 4
             WHEN 'mother of the groom' THEN 5
             ELSE 6
         END, id
         LIMIT 1;
    END IF;

    IF COALESCE(normalized_name_is_generated, FALSE) THEN
        IF has_attire_profile_id THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSE
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   role = cleaned_role,
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        END IF;
    ELSE
        IF has_attire_profile_id THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   normalized_name = cleaned_normalized_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSE
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   normalized_name = cleaned_normalized_name,
                   role = cleaned_role,
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        END IF;
    END IF;

    RETURN public.admin_update_guest_rsvp(
        p_guest_id,
        COALESCE(NULLIF(p_status, ''), 'pending'),
        p_main_id,
        p_dessert_id,
        p_dietary_requirements,
        p_notes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
