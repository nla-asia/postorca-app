import "../env.js";
import { createDatabase } from "../db.js";
import { addCredits } from "../billing/credits.js";

// npm run credits:add -- <email> <credits>
const [email, credits] = process.argv.slice(2);
if (!email || !credits) throw new Error("Use: credits:add <email> <credits>");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const db = createDatabase(process.env.DATABASE_URL);
try {
  const { balance } = await addCredits(db, email, credits);
  console.log(`Added ${credits} credits to ${email}. Balance: ${balance}.`);
} finally {
  await db.end();
}
