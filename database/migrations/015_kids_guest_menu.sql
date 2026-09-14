-- Add a kids-menu flag on guests and a separate kids food audience.
-- Kids only see chicken drums with rice and coleslaw, plus chocolate brownie.
-- Adult guests keep the existing mains and desserts.

BEGIN;

ALTER TABLE public.guests
    ADD COLUMN IF NOT EXISTS is_child BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.food_options
    ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'adult';

ALTER TABLE public.food_options
    DROP CONSTRAINT IF EXISTS food_options_audience_check;

ALTER TABLE public.food_options
    ADD CONSTRAINT food_options_audience_check
    CHECK (audience IN ('adult', 'child'));

UPDATE public.food_options
   SET audience = 'adult'
 WHERE COALESCE(audience, '') NOT IN ('adult', 'child');

INSERT INTO public.food_options (course, name, description, sort_order, is_active, audience)
SELECT 'main',
       'Chicken drums with rice and coleslaw',
       'Crispy chicken drums served with rice and coleslaw',
       100,
       TRUE,
       'child'
WHERE NOT EXISTS (
    SELECT 1
      FROM public.food_options
     WHERE course = 'main'
       AND LOWER(BTRIM(name)) = LOWER('Chicken drums with rice and coleslaw')
);

INSERT INTO public.food_options (course, name, description, sort_order, is_active, audience)
SELECT 'dessert',
       'Chocolate Brownie with Whipped Cream',
       'Warm chocolate brownie served with whipped cream',
       110,
       TRUE,
       'child'
WHERE NOT EXISTS (
    SELECT 1
      FROM public.food_options
     WHERE course = 'dessert'
       AND LOWER(BTRIM(name)) = LOWER('Chocolate Brownie with Whipped Cream')
);

UPDATE public.food_options
   SET audience = 'child',
       description = COALESCE(NULLIF(BTRIM(description), ''), 'Crispy chicken drums served with rice and coleslaw'),
       is_active = TRUE
 WHERE course = 'main'
   AND LOWER(BTRIM(name)) = LOWER('Chicken drums with rice and coleslaw');

UPDATE public.food_options
   SET audience = 'child',
       description = COALESCE(NULLIF(BTRIM(description), ''), 'Warm chocolate brownie served with whipped cream'),
       is_active = TRUE
 WHERE course = 'dessert'
   AND LOWER(BTRIM(name)) = LOWER('Chocolate Brownie with Whipped Cream');

UPDATE public.guests
   SET is_child = TRUE
 WHERE LOWER(BTRIM(role)) IN ('flower girl', 'ring bearer', 'bible bearer', 'coin bearer');

CREATE OR REPLACE FUNCTION public.submit_guest_rsvp(
    p_guest_id TEXT,
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
    selected_main_id public.food_options.id%TYPE;
    selected_dessert_id public.food_options.id%TYPE;
    saved_guest public.guests%ROWTYPE;
    required_audience TEXT;
    has_food_audience BOOLEAN;
    has_guest_is_child BOOLEAN;
BEGIN
    IF p_status NOT IN ('attending', 'not_attending') THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid RSVP status.';
    END IF;

    IF CHAR_LENGTH(COALESCE(p_dietary_requirements, '')) > 1000
       OR CHAR_LENGTH(COALESCE(p_notes, '')) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'RSVP notes are too long.';
    END IF;

    SELECT id
      INTO selected_guest_id
      FROM public.guests
     WHERE id::TEXT = p_guest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Guest not found.';
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'food_options'
           AND column_name = 'audience'
    ) INTO has_food_audience;

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'is_child'
    ) INTO has_guest_is_child;

    required_audience := 'adult';
    IF has_guest_is_child THEN
        SELECT CASE WHEN COALESCE(is_child, FALSE) THEN 'child' ELSE 'adult' END
          INTO required_audience
          FROM public.guests
         WHERE id = selected_guest_id;
    END IF;

    IF p_status = 'attending' THEN
        IF NULLIF(BTRIM(COALESCE(p_main_id, '')), '') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A main is required.';
        END IF;

        IF NULLIF(BTRIM(COALESCE(p_dessert_id, '')), '') IS NULL THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'A dessert is required.';
        END IF;

        SELECT id
          INTO selected_main_id
          FROM public.food_options
         WHERE id::TEXT = p_main_id
           AND course = 'main'
           AND is_active = TRUE
           AND (
               NOT has_food_audience
               OR COALESCE(audience, 'adult') = required_audience
           );

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid or inactive main.';
        END IF;

        SELECT id
          INTO selected_dessert_id
          FROM public.food_options
         WHERE id::TEXT = p_dessert_id
           AND course = 'dessert'
           AND is_active = TRUE
           AND (
               NOT has_food_audience
               OR COALESCE(audience, 'adult') = required_audience
           );

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid or inactive dessert.';
        END IF;

        UPDATE public.guests
           SET rsvp_status = 'attending',
               responded_at = NOW(),
               dietary_requirements = NULLIF(BTRIM(COALESCE(p_dietary_requirements, '')), ''),
               updated_at = NOW()
         WHERE id = selected_guest_id
         RETURNING * INTO saved_guest;

        INSERT INTO public.guest_food_choices (
            guest_id,
            main_id,
            dessert_id,
            notes,
            updated_at
        )
        VALUES (
            selected_guest_id,
            selected_main_id,
            selected_dessert_id,
            NULLIF(BTRIM(COALESCE(p_notes, '')), ''),
            NOW()
        )
        ON CONFLICT (guest_id) DO UPDATE
           SET main_id = EXCLUDED.main_id,
               dessert_id = EXCLUDED.dessert_id,
               notes = EXCLUDED.notes,
               updated_at = NOW();
    ELSE
        UPDATE public.guests
           SET rsvp_status = 'not_attending',
               responded_at = NOW(),
               dietary_requirements = NULL,
               updated_at = NOW()
         WHERE id = selected_guest_id
         RETURNING * INTO saved_guest;

        DELETE FROM public.guest_food_choices
         WHERE guest_id = selected_guest_id;
    END IF;

    RETURN JSONB_BUILD_OBJECT(
        'fullName', saved_guest.full_name,
        'role', saved_guest.role,
        'rsvpStatus', saved_guest.rsvp_status,
        'dietaryRequirements', COALESCE(saved_guest.dietary_requirements, ''),
        'isChild', CASE
            WHEN has_guest_is_child THEN COALESCE(saved_guest.is_child, FALSE)
            ELSE FALSE
        END,
        'foodChoice', CASE
            WHEN p_status = 'attending' THEN JSONB_BUILD_OBJECT(
                'mainId', selected_main_id,
                'dessertId', selected_dessert_id,
                'notes', COALESCE(NULLIF(BTRIM(COALESCE(p_notes, '')), ''), '')
            )
            ELSE NULL
        END
    );
END;
$$;

DROP FUNCTION IF EXISTS public.admin_create_guest(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_create_guest(
    p_full_name TEXT,
    p_role TEXT DEFAULT NULL,
    p_is_child BOOLEAN DEFAULT FALSE
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
    has_is_child BOOLEAN;
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

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'is_child'
    ) INTO has_is_child;

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

    IF has_is_child THEN
        insert_columns := insert_columns || ', is_child';
        insert_values := insert_values || format(', %s', CASE WHEN COALESCE(p_is_child, FALSE) THEN 'TRUE' ELSE 'FALSE' END);
    END IF;

    EXECUTE format(
        'INSERT INTO public.guests (%s) VALUES (%s) RETURNING id',
        insert_columns,
        insert_values
    ) INTO selected_guest_id;

    RETURN JSONB_BUILD_OBJECT('id', selected_guest_id::TEXT);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.admin_update_guest(
    p_guest_id TEXT,
    p_full_name TEXT,
    p_role TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_main_id TEXT DEFAULT NULL,
    p_dessert_id TEXT DEFAULT NULL,
    p_dietary_requirements TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_is_child BOOLEAN DEFAULT FALSE
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
    has_is_child BOOLEAN;
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

    SELECT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'guests'
           AND column_name = 'is_child'
    ) INTO has_is_child;

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
        IF has_attire_profile_id AND has_is_child THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   is_child = COALESCE(p_is_child, FALSE),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSIF has_attire_profile_id THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSIF has_is_child THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   role = cleaned_role,
                   is_child = COALESCE(p_is_child, FALSE),
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
        IF has_attire_profile_id AND has_is_child THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   normalized_name = cleaned_normalized_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   is_child = COALESCE(p_is_child, FALSE),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSIF has_attire_profile_id THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   normalized_name = cleaned_normalized_name,
                   role = cleaned_role,
                   attire_profile_id = COALESCE(selected_attire_profile_id, attire_profile_id),
                   updated_at = NOW()
             WHERE id = selected_guest_id;
        ELSIF has_is_child THEN
            UPDATE public.guests
               SET full_name = cleaned_full_name,
                   normalized_name = cleaned_normalized_name,
                   role = cleaned_role,
                   is_child = COALESCE(p_is_child, FALSE),
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

REVOKE ALL ON FUNCTION public.submit_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

REVOKE ALL ON FUNCTION public.admin_create_guest(TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_guest(TEXT, TEXT, BOOLEAN)
    TO service_role;
GRANT INSERT ON TABLE public.guests TO service_role;

REVOKE ALL ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
