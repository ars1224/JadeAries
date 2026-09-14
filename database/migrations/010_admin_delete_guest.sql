-- Allow the private admin dashboard to remove a guest record.
-- Related RSVP food choices are deleted first so the guest delete stays
-- explicit and predictable even without a cascading foreign key.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_guest(
    p_guest_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    selected_guest_id public.guests.id%TYPE;
    removed_guest public.guests%ROWTYPE;
BEGIN
    SELECT id
      INTO selected_guest_id
      FROM public.guests
     WHERE id::TEXT = p_guest_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Guest not found.';
    END IF;

    DELETE FROM public.guest_food_choices
     WHERE guest_id = selected_guest_id;

    DELETE FROM public.guests
     WHERE id = selected_guest_id
     RETURNING * INTO removed_guest;

    RETURN JSONB_BUILD_OBJECT(
        'fullName', removed_guest.full_name,
        'role', removed_guest.role
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_guest(TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_guest(TEXT)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
