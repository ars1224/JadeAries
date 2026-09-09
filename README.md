# Aries & Jade wedding invitation

The existing invitation design is paired with a private, name-based RSVP flow:

`browser -> Netlify Functions -> Supabase`

Supabase credentials are used only inside Netlify Functions. The browser receives a short-lived signed guest token after an exact name match; it never receives the service-role key or unrestricted table access.

## Required Supabase migration

The existing Supabase tables and data remain in place. Run only:

`database/migrations/004_supabase_personalized_rsvp.sql`

This adds a normalized-name lookup index, enforces one food-choice row per guest, and creates the atomic `submit_guest_rsvp` RPC. It validates active main/dessert courses, updates RSVP and food together, and removes food choices when a guest changes to not attending. It does not disable RLS or remove migrated columns.

The older `database/schema.sql` and migrations `001`–`003` belong to an abandoned direct-PostgreSQL prototype in this working tree. Do not run or import them into the prepared `aries-jade-wedding` Supabase project.

## Netlify environment variables

Add these values in **Site configuration -> Environment variables**:

- `SUPABASE_URL`: the project URL from Supabase project settings.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role/secret key. Never expose it in browser code.
- `RSVP_TOKEN_SECRET`: a random secret of at least 32 characters, used to sign guest RSVP sessions.

Trigger a fresh deploy after changing environment variables.

The separate legacy admin page/functions still reference `DATABASE_URL` and `ADMIN_PASSWORD`; they were not part of the guest RSVP migration and are not linked from the invitation. Do not rely on them for the prepared Supabase schema until they are migrated separately.

## Local development

1. Install Node.js and the Netlify CLI.
2. Run `npm install` if dependencies are not present.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and a local `RSVP_TOKEN_SECRET`.
4. Run `netlify dev` from this directory.
5. Open the local URL printed by Netlify (normally `http://localhost:8888`).

Use a real invited full name to exercise the complete flow. Do not use the production service-role key on an untrusted computer.

## Checks

- `npm run check` performs JavaScript syntax checks.
- `npm test` runs mocked function/security tests and static flow checks without changing Supabase data.

For a production smoke test, use one designated guest record, submit attending with one main and one dessert, look the guest up again to verify the saved choices, change to not attending, and verify the corresponding `guest_food_choices` row is removed. Restore that test guest to the desired final state afterward.

## Safe Netlify deployment

1. Run the Supabase migration and confirm it completes.
2. Add the three required environment variables in Netlify for the Production deploy context.
3. Run `npm run check` and `npm test`.
4. Deploy a preview first (for example, with a pull request or `netlify deploy`).
5. Test lookup, attire, attending, menu selection, update, decline, music, invitation images, calendar download, and a narrow mobile viewport.
6. Review Netlify Function logs for errors; guest-facing responses intentionally hide database details.
7. Promote the verified deploy preview or merge to the production branch. Avoid putting any secret in Git, frontend JavaScript, or Netlify build output.
