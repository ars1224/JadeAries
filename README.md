# Aries & Jade wedding invitation

The existing invitation design is paired with a private, name-based RSVP flow:

`browser -> Netlify Functions -> Supabase`

Supabase credentials are used only inside Netlify Functions. The browser receives a short-lived signed guest token after an exact name match; it never receives the service-role key or unrestricted table access.

## Required Supabase migrations

The existing Supabase tables and data remain in place. Run these migrations in order:

`database/migrations/004_supabase_personalized_rsvp.sql`

`database/migrations/005_populate_image_urls.sql`

`database/migrations/006_supabase_admin_rsvp.sql`

`database/migrations/007_admin_edit_guest_name.sql`

`database/migrations/008_fix_wedding_guest_attire_image.sql`

Migration `004` adds a normalized-name lookup index, enforces one food-choice row per guest, and creates the atomic `submit_guest_rsvp` RPC. It validates active main/dessert courses, updates RSVP and food together, and removes food choices when a guest changes to not attending. It does not disable RLS or remove migrated columns.

The older `database/schema.sql` and migrations `001`–`003` belong to an abandoned direct-PostgreSQL prototype in this working tree. Do not run or import them into the prepared `aries-jade-wedding` Supabase project.

Migration `005` maps all approved attire and menu photos to root-relative `/images/attire/` and `/images/food/` paths served by Netlify.

Migration `006` adds a service-role-only admin RSVP wrapper. It reuses the public RSVP transaction for attending and not-attending updates and adds an atomic pending reset that removes any saved food choice. It does not disable RLS or grant browser roles access.

Migration `007` adds the service-role-only admin rename operation. It updates `full_name` and the normalized lookup value in the same transaction as the existing admin RSVP update, rejects duplicate normalized names, and accommodates either a stored or generated `normalized_name` column.

Migration `008` corrects the production attire-profile label mismatch by mapping both `Guest` and `Wedding Guest` to the existing approved `/images/attire/guest-attire-reference.jpg` asset.

## Netlify environment variables

Add these values in **Site configuration -> Environment variables**:

- `SUPABASE_URL`: the project URL from Supabase project settings.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role/secret key. Never expose it in browser code.
- `RSVP_TOKEN_SECRET`: a random secret of at least 32 characters, used to sign guest RSVP sessions.
- `ADMIN_PASSWORD`: a strong password for the private `/admin` dashboard. The browser exchanges it once for an eight-hour signed HttpOnly cookie; it is not retained in frontend JavaScript.

Trigger a fresh deploy after changing environment variables.

The Supabase-backed admin functions do not use `DATABASE_URL`. The old `scripts/import-guests.js`, `netlify/functions/lib/database.js`, and `pg` dependency remain only for the abandoned direct-PostgreSQL prototype and can be removed after the Supabase admin has been verified in production.

## Local development

1. Install Node.js and the Netlify CLI.
2. Run `npm install` if dependencies are not present.
3. Copy `.env.example` to `.env` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, a local `RSVP_TOKEN_SECRET`, and `ADMIN_PASSWORD`.
4. Run `netlify dev` from this directory.
5. Open the local URL printed by Netlify (normally `http://localhost:8888`).

Use a real invited full name to exercise the complete flow. Do not use the production service-role key on an untrusted computer.

## Checks

- `npm run check` performs JavaScript syntax checks.
- `npm test` runs mocked function/security tests and static flow checks without changing Supabase data.

For a production smoke test, use one designated guest record, submit attending with one main and one dessert, look the guest up again to verify the saved choices, change to not attending, and verify the corresponding `guest_food_choices` row is removed. Restore that test guest to the desired final state afterward.

## Safe Netlify deployment

1. Run the Supabase migrations and confirm they complete.
2. Add the four required environment variables in Netlify for the Production deploy context.
3. Run `npm run check` and `npm test`.
4. Deploy a preview first (for example, with a pull request or `netlify deploy`).
5. Test lookup, attire, attending, menu selection, update, decline, music, invitation images, calendar download, and a narrow mobile viewport.
6. Open `/admin`, verify correct/incorrect password handling, confirm all guest and catering totals, exercise search and both filters, then update one designated guest through attending, pending, and not attending. Confirm not attending removes its `guest_food_choices` row.
7. Review Netlify Function logs for errors; guest-facing responses intentionally hide database details.
8. Promote the verified deploy preview or merge to the production branch. Avoid putting any secret in Git, frontend JavaScript, or Netlify build output.
