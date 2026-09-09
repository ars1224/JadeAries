const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run import:guests -- <tab-separated guest file>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it to .env before importing guests.");
  process.exit(1);
}

const DEFAULT_ATTIRE = {
  title: "Guest attire",
  description: "Semi-formal attire in a whimsical pastel shade."
};

const ATTIRE_BY_ROLE = {
  Bride: {
    title: "Bridal attire",
    description: "White is lovingly reserved for the bride."
  },
  Groom: {
    title: "Groom attire",
    description: "Ivory / cream three-piece suit, white shirt, light pink tie, and brown shoes."
  },
  Bridesmaid: {
    title: "Bridesmaid attire",
    description: "Floor-length A-line gown in lavender, blush, butter yellow, or sky blue."
  },
  "Maid of Honour": {
    title: "Maid of Honour attire",
    description: "Muted olive one-shoulder floor-length gown."
  },
  Groomsmen: {
    title: "Groomsmen attire",
    description: "Light grey / stone two-piece suit, white undershirt, no tie, and black shoes."
  },
  Groomsman: {
    title: "Groomsman attire",
    description: "Light grey / stone two-piece suit, white undershirt, no tie, and black shoes."
  },
  "Best Man": {
    title: "Best Man attire",
    description: "Latte / taupe two-piece suit, white shirt, matching tie, no vest, and black shoes."
  },
  Ninong: {
    title: "Ninong attire",
    description: "Navy two-piece suit, white shirt, matching navy tie, and brown shoes."
  },
  Ninang: {
    title: "Ninang attire",
    description: "Dusty pink floor-length gown with off-the-shoulder sleeves."
  },
  Parents: {
    title: "Parents attire",
    description: "Formal attire in a complementary pastel or neutral tone."
  },
  "Flower Girl": {
    title: "Flower girl attire",
    description: "A pretty dress in a soft pastel shade."
  },
  "Ring Bearer": {
    title: "Ring bearer attire",
    description: "A smart mini barong or suit."
  },
  "Bible Bearer": {
    title: "Bible bearer attire",
    description: "A smart mini barong or suit."
  },
  "Coin Bearer": {
    title: "Coin bearer attire",
    description: "A smart mini barong or suit."
  },
  "Guest - Officiant": {
    title: "Officiant attire",
    description: "Formal attire suitable for leading the ceremony."
  }
};

function normalize(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function attireForRole(role) {
  return ATTIRE_BY_ROLE[role] || {
    title: `${role} attire`,
    description: DEFAULT_ATTIRE.description
  };
}

function parseGuestFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  const headers = lines.shift().split("\t").map(normalize);
  const codeIndex = headers.indexOf("RSVP CODE");
  const nameIndex = headers.indexOf("GUEST NAME");
  const statusIndex = headers.indexOf("RSVP STATUS");
  const roleIndex = ["Roles", "ROLE", "Role"].map((header) => headers.indexOf(header)).find((index) => index >= 0) ?? -1;

  if ([codeIndex, nameIndex, statusIndex].includes(-1)) {
    throw new Error("The file must contain RSVP CODE, GUEST NAME, and RSVP STATUS columns.");
  }

  const seenNames = new Set();
  return lines.map((line, index) => {
    const columns = line.split("\t");
    const invitationCode = normalize(columns[codeIndex]).toUpperCase();
    const name = normalize(columns[nameIndex]);
    const status = normalize(columns[statusIndex]).toLowerCase();
    const role = roleIndex >= 0 ? (normalize(columns[roleIndex]) || "Guest") : "Guest";
    const attire = attireForRole(role);

    if (!invitationCode || !name || !["pending", "attending", "declined"].includes(status)) {
      throw new Error(`Invalid guest data on source line ${index + 2}.`);
    }

    const normalizedName = name.toLowerCase();
    if (seenNames.has(normalizedName)) {
      throw new Error(`Duplicate guest name in import: ${name}.`);
    }
    seenNames.add(normalizedName);

    return {
      invitationCode,
      name,
      status,
      role,
      attireTitle: attire.title,
      attireDescription: attire.description
    };
  });
}

async function ensureSchema(client) {
  const result = await client.query("SELECT to_regclass('public.guests') AS guests_table");

  if (!result.rows[0].guests_table) {
    const schema = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
    await client.query(schema);
  }

  const migration = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "001_allow_attending_without_meal.sql"),
    "utf8"
  );
  await client.query(migration);

  const menuMigration = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "002_wedding_menu.sql"),
    "utf8"
  );
  await client.query(menuMigration);

  const chickenMigration = fs.readFileSync(
    path.join(__dirname, "..", "database", "migrations", "003_add_chicken_main.sql"),
    "utf8"
  );
  await client.query(chickenMigration);
}

async function importGuests() {
  const guests = parseGuestFile(path.resolve(inputPath));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await ensureSchema(client);
    await client.query("BEGIN");

    const existingResult = await client.query("SELECT LOWER(full_name) AS name FROM guests");
    const existingNames = new Set(existingResult.rows.map((row) => row.name));
    let inserted = 0;
    let updated = 0;

    for (const guest of guests) {
      await client.query(
        `INSERT INTO guests (
           invitation_code,
           full_name,
           role,
           attire_title,
           attire_description,
           rsvp_status,
           responded_at
         ) VALUES ($1, $2, $3, $4, $5, $6::VARCHAR,
           CASE WHEN $6::VARCHAR = 'pending' THEN NULL ELSE NOW() END)
         ON CONFLICT ((LOWER(full_name))) DO UPDATE
         SET invitation_code = EXCLUDED.invitation_code,
             role = EXCLUDED.role,
             attire_title = EXCLUDED.attire_title,
             attire_description = EXCLUDED.attire_description,
             rsvp_status = EXCLUDED.rsvp_status,
             meal_choice = CASE
               WHEN EXCLUDED.rsvp_status = 'attending' THEN guests.meal_choice
               ELSE NULL
             END,
             dessert_choice = CASE
               WHEN EXCLUDED.rsvp_status = 'attending' THEN guests.dessert_choice
               ELSE NULL
             END,
             responded_at = CASE
               WHEN EXCLUDED.rsvp_status = 'pending' THEN NULL
               ELSE COALESCE(guests.responded_at, NOW())
             END,
             updated_at = NOW()`,
        [
          guest.invitationCode,
          guest.name,
          guest.role,
          guest.attireTitle,
          guest.attireDescription,
          guest.status
        ]
      );

      if (existingNames.has(guest.name.toLowerCase())) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    const names = guests.map((guest) => guest.name.toLowerCase());
    const removed = await client.query(
      `DELETE FROM guests
       WHERE NOT (LOWER(full_name) = ANY($1::TEXT[]))`,
      [names]
    );

    await client.query("COMMIT");

    const verification = await client.query(
      `SELECT rsvp_status, COUNT(*)::INTEGER AS count
       FROM guests
       GROUP BY rsvp_status
       ORDER BY rsvp_status`
    );
    const total = await client.query("SELECT COUNT(*)::INTEGER AS count FROM guests");

    console.log(JSON.stringify({
      sourceRows: guests.length,
      inserted,
      updated,
      removed: removed.rowCount,
      tableRows: total.rows[0].count,
      statuses: verification.rows,
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

importGuests().catch((error) => {
  console.error(`Guest import failed: ${error.message}`);
  process.exit(1);
});
