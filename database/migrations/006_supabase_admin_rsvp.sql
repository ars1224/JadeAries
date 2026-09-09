-- Add the admin RSVP wrapper used by the private Netlify admin dashboard.
-- It reuses submit_guest_rsvp for final responses and only adds the ability
-- to return a guest to pending. RLS remains enabled and browser roles receive
-- no table or function access.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_guest_rsvp(
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
    saved_guest public.guests%ROWTYPE;
BEGIN
    IF p_status IN ('attending', 'not_attending') THEN
        RETURN public.submit_guest_rsvp(
            p_guest_id,
            p_status,
            p_main_id,
            p_dessert_id,
            p_dietary_requirements,
            p_notes
        );
    END IF;

    IF p_status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid RSVP status.';
    END IF;

    IF CHAR_LENGTH(COALESCE(p_dietary_requirements, '')) > 1000 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Dietary requirements are too long.';
    END IF;

    SELECT id
      INTO selected_guest_id
      FROM public.guests
     WHERE id::TEXT = p_guest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Guest not found.';
    END IF;

    UPDATE public.guests
       SET rsvp_status = 'pending',
           responded_at = NULL,
           dietary_requirements = NULLIF(BTRIM(COALESCE(p_dietary_requirements, '')), ''),
           updated_at = NOW()
     WHERE id = selected_guest_id
     RETURNING * INTO saved_guest;

    DELETE FROM public.guest_food_choices
     WHERE guest_id = selected_guest_id;

    RETURN JSONB_BUILD_OBJECT(
        'fullName', saved_guest.full_name,
        'role', saved_guest.role,
        'rsvpStatus', saved_guest.rsvp_status,
        'dietaryRequirements', COALESCE(saved_guest.dietary_requirements, ''),
        'foodChoice', NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_guest_rsvp(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
