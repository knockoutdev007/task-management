/**
 * Create the first manager on a fresh, unseeded database.
 *   npm run create-manager -- "Roshani Shinde"
 */
import { upsertEmployee, setPassword, usernameFor, listEmployees } from "../src/db.js";
import { hashPassword, randomPassword } from "../src/auth.js";

const [name] = process.argv.slice(2);
if (!name) {
  console.error('Usage: npm run create-manager -- "Full Name"');
  process.exit(1);
}

const username = await usernameFor(name);
const id = "emp-" + username;
const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
await upsertEmployee({ id, name, username, initials, role: "manager", title: "Manager",
                 departmentId: "mkt", teamId: "seo", capacityHours: 40, active: true });
const password = randomPassword();
await setPassword(id, hashPassword(password), 1);

console.log(`
  Manager created.

    User ID:  ${username}
    Password: ${password}

  You'll be asked to change it after signing in.
  ${(await listEmployees()).length} people in the database.
`);
process.exit(0);   // the connection pool otherwise keeps the process alive
