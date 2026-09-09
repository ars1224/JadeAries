-- Run this migration in the Supabase SQL editor for aries-jade-wedding.
-- It does not change RLS or remove any legacy guest/attire columns.

BEGIN;

CREATE INDEX IF NOT EXISTS guests_normalized_name_lookup_idx
    ON public.guests (normalized_name);

-- One current food selection per guest makes the upsert deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS guest_food_choices_one_per_guest_idx
    ON public.guest_food_choices (guest_id);

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
           AND is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid or inactive main.';
        END IF;

        SELECT id
          INTO selected_dessert_id
          FROM public.food_options
         WHERE id::TEXT = p_dessert_id
           AND course = 'dessert'
           AND is_active = TRUE;

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

REVOKE ALL ON FUNCTION public.submit_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
