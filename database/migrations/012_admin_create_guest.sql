-- Allow the private admin dashboard to add a pending invitee.
-- Mirrors admin_update_guest so create works whether normalized_name is
-- stored or generated, and whether leftover invitation_code exists.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_create_guest(
    p_full_name TEXT,
    p_role TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
    has_normalized_name BOOLEAN;
    has_attire_profile_id BOOLEAN;
    has_invitation_code BOOLEAN;
    insert_columns TEXT;
    insert_values TEXT;
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

    IF EXISTS (
        SELECT 1
          FROM public.guests
         WHERE normalized_name = cleaned_normalized_name
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'A guest with that normalized name already exists.';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'normalized_name'
    ) INTO has_normalized_name;

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

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'invitation_code'
    ) INTO has_invitation_code;

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

    insert_columns := 'full_name, role, rsvp_status';
    insert_values := format('%L, %L, %L', cleaned_full_name, cleaned_role, 'pending');

    IF has_normalized_name AND NOT COALESCE(normalized_name_is_generated, FALSE) THEN
        insert_columns := insert_columns || ', normalized_name';
        insert_values := insert_values || format(', %L', cleaned_normalized_name);
    END IF;

    IF has_attire_profile_id AND selected_attire_profile_id IS NOT NULL THEN
        insert_columns := insert_columns || ', attire_profile_id';
        insert_values := insert_values || format(', %L', selected_attire_profile_id::TEXT);
    END IF;

    IF has_invitation_code THEN
        insert_columns := insert_columns || ', invitation_code';
        insert_values := insert_values || format(
            ', %L',
            'JA-' || UPPER(SUBSTR(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 12))
        );
    END IF;

    EXECUTE format(
        'INSERT INTO public.guests (%s) VALUES (%s) RETURNING id',
        insert_columns,
        insert_values
    ) INTO selected_guest_id;

    RETURN JSONB_BUILD_OBJECT('id', selected_guest_id::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_guest(TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_guest(TEXT, TEXT)
    TO service_role;
GRANT INSERT ON TABLE public.guests TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
