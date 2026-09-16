/**
 * Replace all data with the real Marketing team roster.
 *   npm run load-marketing-team
 *
 * Wipes every table (like `seed.js --reset`) then creates the 19 real
 * people from "Marketing Team.xlsx". Every account gets the same temporary
 * password below and must change it on first sign-in.
 */
import { db, upsertEmployee, setPassword, setConfig, listEmployees, usernameForBatch } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const PASSWORD = process.env.SEED_PASSWORD || "controlcenter1";

const CONFIG_OVERRIDE = {
  departments: [
    { id: "mkt", name: "Marketing", teams: [
      { id: "seo", name: "SEO" },
      { id: "content", name: "Content" },
      { id: "webdev", name: "Web Development" },
      { id: "design", name: "Design" },
      { id: "email", name: "Email Marketing" }
    ] },
    { id: "ops", name: "Operations", teams: [{ id: "admin", name: "Admin" }, { id: "hr", name: "HR" }, { id: "it", name: "IT" }] }
  ]
};

// name, title, role, teamId
const PEOPLE = [
  ["Roshani Shinde",                  "Marketing Manager",                        "manager",  ""],
  ["Mayuresh Sorap",                  "Team Lead - Digital Marketing",            "manager",  ""],
  ["Wilson Fernandes",                "Senior SEO Executive",                     "employee", "seo"],
  ["Moinul Khan",                     "Senior Content Writer",                    "employee", "content"],
  ["Param Lakhani",                   "SEO Content Writer",                       "employee", "content"],
  ["Samruddhi Prashant Machirale",    "SEO Executive",                            "employee", "seo"],
  ["Nishant Bharmal",                 "Web developer",                            "employee", "webdev"],
  ["Shubham Vilas Girkar",            "Web developer",                            "employee", "webdev"],
  ["Devendra Rajendra Patil",         "Web developer",                            "employee", "webdev"],
  ["Anup Santosh Kankale",            "Web developer",                            "employee", "webdev"],
  ["Bhavin Patel",                    "Web developer",                            "employee", "webdev"],
  ["Danish Abdul Hamid Shaikh",       "Web developer",                            "employee", "webdev"],
  ["Namrata Pandurang",               "UI/UX Designer",                           "employee", "design"],
  ["Priyanka Kochrekar",              "UI/UX Designer",                           "employee", "design"],
  ["Shreyash Sanjay Patil",           "Graphic Designer",                         "employee", "design"],
  ["Avinash Tippanna Padsalgi",       "Graphic Designer",                         "employee", "design"],
  ["Parmeshwar Sherve",               "Email marketing Executive",                "employee", "email"],
  ["Rina Nadar",                      "Salesforce Marketing Cloud Executive",     "employee", "email"],
  ["Sarvesh Bhosale",                 "Email marketing & automation specialist",  "employee", "email"]
];

console.log("Wiping every table…");
db.exec(`DELETE FROM task_activity; DELETE FROM task_comments; DELETE FROM tasks;
         DELETE FROM daily_updates; DELETE FROM projects; DELETE FROM sessions;
         DELETE FROM employees; DELETE FROM config;`);

const managerUsernames = [];
const load = db.transaction(() => {
  setConfig(CONFIG_OVERRIDE);
  const taken = new Set();
  for (const [name, title, role, teamId] of PEOPLE) {
    const username = usernameForBatch(name, taken);
    const id = "emp-" + username;
    const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
    upsertEmployee({ id, name, username, initials, role, title, departmentId: "mkt", teamId, capacityHours: 40, active: true });
    setPassword(id, hashPassword(PASSWORD), 1);
    if (role === "manager") managerUsernames.push(`${name} (${username})`);
  }
});
load();

console.log(`
  Loaded ${listEmployees().length} people from the Marketing Team roster.

  Everyone's starting password is:  ${PASSWORD}
  They are prompted to change it after signing in.

  Managers:   ${managerUsernames.join("\n              ")}
`);
