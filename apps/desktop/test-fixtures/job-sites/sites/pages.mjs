import { departments, dateAgo } from "./data.mjs";
import { escape, applicationForm } from "./forms.mjs";

const cookieLabels = [
  "Cookie choices",
  "Your privacy matters",
  "Cookie settings",
  "Local storage notice",
  "Privacy preferences",
  "Cookies for this visit",
  "Choose your cookies",
  "Privacy on this site",
  "Cookie consent",
  "Our cookie notice",
  "Your data choices",
  "Applicant privacy",
  "Embedded form cookies",
  "Before you browse",
  "Manage local cookies",
];
export function page(site, title, content, language = "en", embedded = false) {
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)} | ${escape(site.name)}</title><link rel="stylesheet" href="/assets/styles.css"><link rel="stylesheet" href="/replica-assets/styles.css"><script src="/replica-assets/client.js" defer></script></head><body data-replica="${site.slug}" class="replica theme-${site.theme}" data-cookie-style="${site.theme % 3}">${embedded ? "" : `<header><a href="/${site.slug}/">${escape(site.name)}</a><a href="/">All test sites</a></header>`}<main><p class="fixture">Local test fixture • Fictional jobs • Use synthetic data only</p>${content}</main>${embedded ? "" : `<aside class="cookie-banner variant-${site.theme}" role="dialog" aria-label="${cookieLabels[site.theme]}" data-cookie-banner><h2>${cookieLabels[site.theme]}</h2><p>${site.theme % 2 ? "Optional cookies help us remember your preferences. Only this local tab stores the choice." : "Choose whether to allow optional cookies for this fictional site."}</p><button type="button" data-cookie="essential">${site.theme % 2 ? "Use essential only" : "Reject optional"}</button> <button type="button" data-cookie="all">${site.theme % 2 ? "Allow all" : "Accept cookies"}</button>${site.theme % 3 === 2 ? ' <details><summary>Customize</summary><label class="check"><input type="checkbox" data-optional-cookie> Optional analytics</label><button type="button" data-cookie="custom">Save preferences</button></details>' : ""}</aside>`}</body></html>`;
}
function listingUrl(site, params, change) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(change)) next.set(key, value);
  return `/${site.slug}/?${escape(next.toString())}`;
}
function card(site, job) {
  const company = job.logoOnly
    ? `<span class="initials" role="img" aria-label="Company logo">${job.company
        .split(" ")
        .slice(0, 2)
        .map((part) => part[0])
        .join("")}</span>`
    : `<p class="company">${escape(job.company)}</p>`;
  return `<article class="job" lang="${job.language}">${company}<div><h2><a href="/${site.slug}/jobs/${job.id}" data-job-id="${job.id}">${escape(job.title)}</a></h2><p class="job-location">${escape(job.location)} · ${job.mode}</p><p class="tags">${job.tags.map((tag) => `<span>${escape(tag)}</span>`).join(" ")}</p><p>${job.employment}${job.salary.label ? ` · ${job.salary.label}` : ""}</p><p><time datetime="${job.posted}">${job.posted}</time> · ${job.age === 0 ? "Today" : `${job.age} days ago`}${job.closed ? " · Closed" : ""}${job.sponsored ? ' · <strong class="sponsored">Sponsored</strong>' : ""}</p></div></article>`;
}
export function listing(site, jobs, params) {
  const q = (params.get("q") || "").trim().toLowerCase();
  const location = (params.get("location") || "").trim().toLowerCase();
  const department = params.get("department") || "";
  const sort = ["newest", "oldest", "title", "salary"].includes(
    params.get("sort"),
  )
    ? params.get("sort")
    : "newest";
  const matched = jobs.filter(
    (job) =>
      `${job.title} ${job.company} ${job.department} ${job.description}`
        .toLowerCase()
        .includes(q) &&
      `${job.location} ${job.mode}`.toLowerCase().includes(location) &&
      (!department || job.department === department),
  );
  matched.sort((a, b) =>
    sort === "title"
      ? a.title.localeCompare(b.title, "en") || Number(a.id) - Number(b.id)
      : sort === "salary"
        ? (b.salary.min || 0) - (a.salary.min || 0) ||
          Number(a.id) - Number(b.id)
        : sort === "oldest"
          ? b.age - a.age || Number(a.id) - Number(b.id)
          : a.age - b.age || Number(a.id) - Number(b.id),
  );
  const integer = (value, fallback) =>
    /^\d{1,7}$/.test(value || "") ? Number(value) : fallback;
  const current = Math.max(1, integer(params.get("page"), 1));
  const offset =
    site.pagination === "offset"
      ? integer(params.get("offset"), 0)
      : (current - 1) * 20;
  const visible = matched.slice(offset, offset + 20);
  const hasNext = offset + 20 < matched.length;
  const filters = `<form method="get" class="filters" action="/${site.slug}/"><label>Keyword<input name="q" value="${escape(params.get("q") || "")}" placeholder="designer"></label><label>Location<input name="location" value="${escape(params.get("location") || "")}" placeholder="remote"></label>${site.company ? `<label>Department<select name="department"><option value="">All departments</option>${departments.map(({ name }) => `<option ${department === name ? "selected" : ""}>${escape(name)}</option>`).join("")}</select></label>` : ""}<label>Sort<select name="sort">${["newest", "oldest", "title", "salary"].map((value) => `<option value="${value}" ${sort === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><button>Find jobs</button></form>`;
  const navigation =
    site.pagination === "offset"
      ? hasNext
        ? `<a class="button" href="${listingUrl(site, params, { offset: String(offset + 20) })}" data-load-more>Load more</a><p data-load-status role="status"></p>`
        : "<p>All matching jobs shown.</p>"
      : `<nav aria-label="Job pages">${current > 1 ? `<a href="${listingUrl(site, params, { page: String(current - 1) })}" rel="prev">Previous</a> ` : ""}${Array.from({ length: Math.ceil(matched.length / 20) }, (_, index) => `<a href="${listingUrl(site, params, { page: String(index + 1) })}" ${index + 1 === current ? 'aria-current="page"' : ""}>${index + 1}</a>`).join(" ")}${hasNext ? ` <a href="${listingUrl(site, params, { page: String(current + 1) })}" rel="next">Next</a>` : ""}</nav>`;
  return page(
    site,
    "Find jobs",
    `<h1>${site.company ? "Careers at " + escape(site.name) : "Find your next role"}</h1><p data-total="${jobs.length}" data-matches="${matched.length}">${matched.length} matching jobs · ${jobs.length} total fictional jobs</p>${filters}<aside class="editorial"><a href="/${site.slug}/category/berlin">Jobs in Berlin</a> · <a href="/${site.slug}/companies">Top companies</a> · <a href="/${site.slug}/blog/interview-tips">How to prepare for interviews</a> · <a href="/${site.slug}/salary-guide">Salary guide</a></aside><section id="jobs" data-offset="${offset}">${visible.length ? visible.map((job) => card(site, job)).join("") : "<p>No jobs match these filters.</p>"}</section>${navigation}`,
  );
}
export function detail(site, job, origin) {
  const structured =
    Number(job.id) % 2 === 1
      ? `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", identifier: { "@type": "PropertyValue", name: job.company, value: job.requisition }, title: job.title, description: job.description, datePosted: job.posted, validThrough: dateAgo(job.closed ? 1 : -30), hiringOrganization: { "@type": "Organization", name: job.company, sameAs: `https://${site.slug}.example` }, employmentType: { "Full-time": "FULL_TIME", "Part-time": "PART_TIME", Contract: "CONTRACTOR" }[job.employment], ...(job.mode === "Remote" ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: job.country || "Worldwide" } } : {}), jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location.split(",")[0], addressCountry: job.country || "Worldwide" } }, ...(job.salary.min ? { baseSalary: { "@type": "MonetaryAmount", currency: job.salary.currency, value: { "@type": "QuantitativeValue", minValue: job.salary.min, maxValue: job.salary.max, unitText: job.salary.unit } } } : {}), url: `${origin}/${site.slug}/jobs/${job.id}` }).replaceAll("<", "\\u003c")}</script>`
      : "";
  const apply = job.closed
    ? '<p class="error" role="status">This job is no longer accepting applications.</p>'
    : job.emailOnly
      ? `<p>Apply by sending your CV to <a href="mailto:jobs@foliofern.example">jobs@foliofern.example</a>. This fictional address does not deliver mail.</p>`
      : `<a class="button" href="/${site.slug}/apply/${job.id}">${site.slug === "ripple" && job.id === "3" ? "Apply on employer applicant desk" : "Apply now"}</a>`;
  return page(
    site,
    job.title,
    `${structured}<article><h1>${escape(job.title)}</h1><p class="company">${escape(job.company)}</p><p class="job-location">${escape(job.location)} · ${job.mode}</p><p>${escape(job.department)} · ${job.employment} · ${escape(job.level)}</p>${job.salary.label ? `<p>Salary: ${job.salary.label}</p>` : ""}<p>Posted <time datetime="${job.posted}">${job.posted}</time> · Reference ${escape(job.requisition)}</p><h2>${job.language === "de" ? "Über die Stelle" : "About the role"}</h2><p>${escape(job.description)}</p><h2>${job.language === "de" ? "Anforderungen" : "What you bring"}</h2><p>${job.language === "de" ? "Fachkenntnisse, klare Kommunikation und Lernbereitschaft. Berufseinsteiger sind willkommen." : `Relevant ${escape(job.department.toLowerCase())} skills, clear communication and a willingness to learn. Experience expectations reflect the ${escape(job.level.toLowerCase())} level.`}</p><p class="tags">${job.tags.map((tag) => `<span>${escape(tag)}</span>`).join(" ")}</p>${apply}</article>`,
    job.language,
  );
}
export function applyPage(site, job, params, values = {}, errors = {}) {
  if (site.guest && !params.has("guest"))
    return page(
      site,
      "Choose how to apply",
      `<h1>Apply: ${escape(job.title)}</h1><h2>Optional applicant profile</h2><a class="button" href="/${site.slug}/apply/${job.id}?guest=1">Continue as guest</a><details><summary>Create a local profile (optional)</summary><p>Use made-up credentials. The profile lasts until this server stops.</p><form action="/${site.slug}/account/${job.id}" method="post"><label class="field">Email<input type="email" name="email" required></label><label class="field">Password<input type="password" name="password" minlength="8" required></label><button>Create profile and continue</button></form></details>`,
    );
  if (site.iframe && !params.has("embedded"))
    return page(
      site,
      "Application",
      `<h1>${escape(job.title)}</h1><p>Complete the application below.</p><iframe title="Application for ${escape(job.title)}" src="/${site.slug}/apply/${job.id}?embedded=1"></iframe>`,
    );
  return page(
    site,
    "Application",
    applicationForm(site, job, values, errors),
    "en",
    site.iframe,
  );
}
export function editorial(site, path) {
  const title = path.endsWith("/companies")
    ? "Top companies"
    : path.endsWith("/salary-guide")
      ? "Salary guide"
      : path.includes("/blog/")
        ? "How to prepare for interviews"
        : "Jobs in Berlin";
  return page(
    site,
    title,
    `<article class="editorial"><h1>${title}</h1><p>${title === "Jobs in Berlin" ? "Explore the fictional teams hiring in Berlin." : "Editorial information for fictional job seekers. This is not a vacancy and has no application form."}</p><a href="/${site.slug}/?${title === "Jobs in Berlin" ? "location=Berlin" : "q="}">Browse actual job listings</a></article>`,
  );
}
