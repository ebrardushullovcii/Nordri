export const departments = [
  {
    name: "Design",
    roles: ["Product Designer", "Service Designer", "Visual Designer"],
    duties:
      "Research user needs, create accessible prototypes and test designs with fictional participants.",
  },
  {
    name: "Data and Analytics",
    roles: ["Data Analyst", "Analytics Engineer", "Research Analyst"],
    duties:
      "Clean synthetic datasets, explain trends and build useful reporting for fictional teams.",
  },
  {
    name: "Operations and Logistics",
    roles: [
      "Logistics Coordinator",
      "Operations Planner",
      "Supply Chain Analyst",
    ],
    duties:
      "Plan fictional deliveries, track inventory and improve safe day-to-day operations.",
  },
  {
    name: "Teaching",
    roles: ["Teacher", "Instructional Designer", "Learning Coordinator"],
    duties:
      "Design inclusive lessons, assess learning and support fictional learners.",
  },
  {
    name: "Healthcare",
    roles: ["Registered Nurse", "Care Coordinator", "Clinical Educator"],
    duties:
      "Coordinate fictional patient care, document care plans and support a safe simulated clinic.",
  },
  {
    name: "Sales and Customer Success",
    roles: [
      "Account Executive",
      "Customer Success Manager",
      "Sales Coordinator",
    ],
    duties:
      "Understand fictional customer needs, prepare proposals and guide customers through onboarding.",
  },
  {
    name: "Finance",
    roles: ["Financial Analyst", "Accountant", "Payroll Specialist"],
    duties:
      "Reconcile fictional accounts, prepare budgets and explain financial reports.",
  },
  {
    name: "Marketing",
    roles: ["Content Strategist", "Marketing Coordinator", "Campaign Analyst"],
    duties:
      "Write clear campaigns, measure synthetic campaign results and coordinate editorial calendars.",
  },
  {
    name: "Human Resources",
    roles: ["People Partner", "Recruiting Coordinator", "HR Specialist"],
    duties:
      "Support fictional colleagues, coordinate recruitment and improve inclusive people processes.",
  },
  {
    name: "Engineering",
    roles: ["Software Engineer", "Mechanical Engineer", "Quality Engineer"],
    duties:
      "Design reliable systems, review specifications and test fictional products with cross-functional teams.",
  },
];
export const countries = [
  "United States",
  "United Kingdom",
  "Germany",
  "Portugal",
  "Lebanon",
];
export const phoneCodes = ["+1", "+44", "+49", "+351", "+961"];
const locations = [
  ["Boston, United States", "US", "On-site"],
  ["Manchester, United Kingdom", "GB", "Hybrid"],
  ["Berlin, Germany", "DE", "On-site"],
  ["Porto, Portugal", "PT", "Hybrid"],
  ["Beirut, Lebanon / Remote MENA", "LB", "Remote"],
  ["Fully remote, Worldwide", "", "Remote"],
  ["Austin, United States", "US", "Hybrid"],
  ["Remote, United Kingdom", "GB", "Remote"],
];
const levels = ["Intern", "Junior", "Mid-level", "Senior", "Lead", "Director"];
const germanRoles = [
  "Produktdesigner",
  "Datenanalyst",
  "Logistikkoordinator",
  "Lehrkraft",
  "Pflegefachkraft",
  "Kundenberater",
  "Finanzanalyst",
  "Marketingkoordinator",
  "Personalreferent",
  "Qualitätsingenieur",
];
const today = new Date().toISOString().slice(0, 10);
export function dateAgo(days) {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function salary(index, random) {
  const currency = ["USD", "GBP", "EUR"][index % 3];
  const symbol = { USD: "$", GBP: "£", EUR: "€" }[currency];
  const min = (35 + Math.floor(random() * 70)) * 1000;
  const kind = index % 5;
  if (kind === 3) return { label: "Competitive", currency };
  if (kind === 4) return { label: "", currency };
  const hourly = kind === 2;
  const value = hourly ? Math.round(min / 2000) : min;
  const max = hourly ? value + 12 : min + 15000;
  return {
    currency,
    min: value,
    max: kind === 1 || hourly ? max : value,
    unit: hourly ? "HOUR" : "YEAR",
    label:
      kind === 0
        ? `${currency} ${min.toLocaleString("en-US")} per year`
        : hourly
          ? `${symbol}${value}–${max} / hour`
          : `${symbol}${min / 1000}k–${max / 1000}k annually`,
  };
}
export function generateJobs(site) {
  const seed = [...site.slug].reduce(
    (value, char) => Math.imul(value, 31) + char.charCodeAt(0),
    20261002,
  );
  const random = seeded(seed);
  return Array.from({ length: site.count }, (_, index) => {
    const department = departments[index % departments.length];
    const [location, country, mode] =
      locations[(Math.floor(index / 10) + index) % locations.length];
    const german = country === "DE" && index % 3 === 0;
    const level = levels[Math.floor(random() * levels.length)];
    const role = german
      ? germanRoles[index % 10]
      : department.roles[Math.floor(random() * department.roles.length)];
    const company = site.company
      ? site.name
      : `${["Thimble", "Acorn", "Spool", "Pebble", "Cuff", "Pollen"][index % 6]} ${["Moonpath", "Fernwheel", "Buttonbay", "Cloudstitch", "Hushmeadow"][Math.floor(index / 6) % 5]} Workshop`;
    const age = index % 91;
    return {
      id: String(index + 1),
      requisition: `${site.slug.toUpperCase()}-${String(index + 1).padStart(4, "0")}`,
      title: `${level} ${role}`,
      company,
      department: department.name,
      description: german
        ? "Unterstützen Sie unser fiktives Team. Planen Sie Projekte, arbeiten Sie mit Kolleginnen und Kollegen und verbessern Sie unsere Abläufe. Alle Stellen sind lokale Testdaten."
        : department.duties,
      location,
      country,
      mode,
      level,
      employment: ["Full-time", "Part-time", "Contract"][
        Math.floor(index / 4) % 3
      ],
      salary: salary(index, random),
      age,
      posted: dateAgo(age),
      closed: index > 0 && index % 29 === 0,
      sponsored: index % 17 === 0,
      logoOnly: index === 6,
      language: german ? "de" : "en",
      tags: [department.name, "Inclusive team", "Training offered"],
      emailOnly: site.slug === "folio" && index === 1,
    };
  });
}
export function createCatalog(sites) {
  const catalog = new Map(sites.map((site) => [site.slug, generateJobs(site)]));
  // Same requisition, title, company, location, salary and description on two boards.
  const duplicate = {
    ...catalog.get("atlas")[0],
    requisition: "SHARED-ACORN-0001",
    title: "Senior Product Designer",
    company: "Acorn Hushmeadow Workshop",
    department: "Design",
    location: "Fully remote, Worldwide",
    country: "",
    mode: "Remote",
    description: departments[0].duties,
    language: "en",
  };
  catalog.get("atlas")[0] = { ...duplicate };
  catalog.get("ripple")[0] = { ...duplicate };
  // A board application hands the identical fictional vacancy to a local ATS.
  catalog.get("cedar-ats")[2] = { ...catalog.get("ripple")[2] };
  return catalog;
}
