(() => {
  const JOBS_KEY = "jobAutopilotJobs";
  const META_KEY = "jobAutopilotScoutMeta";
  const MAX_JOBS = 80;
  const STOP = new Set([
    "the", "and", "for", "with", "from", "this", "that", "your", "our",
    "role", "job", "jobs", "position", "intern", "internship", "senior",
    "junior", "staff", "level", "full", "time", "part",
  ]);

  function tokens(text) {
    return String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9+]+/)
      .filter((t) => t.length > 2 && !STOP.has(t));
  }

  function xml(s) {
    return String(s || "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i += 1) {
      c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function u16(n) {
    return Uint8Array.of(n & 255, (n >>> 8) & 255);
  }
  function u32(n) {
    return Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  }
  function concat(parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    parts.forEach((p) => { out.set(p, o); o += p.length; });
    return out;
  }

  function zipStore(files) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((f) => {
      const name = new TextEncoder().encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const local = concat([
        Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data,
      ]);
      const central = concat([
        Uint8Array.of(0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const center = concat(centrals);
    const eocd = concat([
      Uint8Array.of(0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0),
      u16(files.length), u16(files.length), u32(center.length), u32(offset), u16(0),
    ]);
    return new Blob([concat([...locals, center, eocd])], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  function jobsToXlsx(jobs) {
    const headers = ["Status", "Score", "Title", "Company", "Location", "Source", "Posted", "URL", "Why"];
    const rows = [headers].concat((jobs || []).map((j) => [
      j.status || "new",
      String(j.match_score || ""),
      j.title || "",
      j.company || "",
      j.location || "",
      j.source || "",
      (j.posted_at || j.first_seen || "").slice(0, 10),
      j.url || "",
      j.why || "",
    ]));
    const sheetRows = rows.map((row, r) => {
      const cells = row.map((val, c) =>
        `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${xml(val).slice(0, 800)}</t></is></c>`
      ).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    }).join("");
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Jobs" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const enc = new TextEncoder();
    return zipStore([
      { name: "[Content_Types].xml", data: enc.encode(types) },
      { name: "_rels/.rels", data: enc.encode(rels) },
      { name: "xl/workbook.xml", data: enc.encode(workbook) },
      { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
      { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
    ]);
  }

  async function getJson(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  function parseWhen(raw) {
    if (!raw && raw !== 0) return "";
    if (typeof raw === "number") {
      const ms = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : raw;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? "" : d.toISOString();
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }

  function withinLookback(iso, days) {
    if (!iso) return true;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return true;
    return (Date.now() - d.getTime()) <= Math.max(1, days) * 86400000;
  }

  function locationOk(jobLoc, wanted) {
    const j = String(jobLoc || "").toLowerCase();
    const wants = (wanted || []).map((w) => String(w || "").toLowerCase()).filter(Boolean);
    if (!wants.length) return true;
    if (wants.some((w) => /remote/.test(w)) && /remote|worldwide|anywhere|distributed/.test(j || "remote")) return true;
    const us = wants.some((w) => /united states|^usa$|^us$|u\.s\.|america/.test(w));
    if (us) {
      if (!j || /remote|worldwide|anywhere|united states|usa|u\.s\.|\bus\b/.test(j)) return true;
      if (/\b(al|ak|az|ar|ca|co|ct|dc|de|fl|ga|hi|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy)\b/.test(j)) return true;
      if (/wisconsin|california|new york|texas|illinois|washington|massachusetts|colorado|georgia|florida|ohio|michigan|minnesota|pennsylvania|virginia|north carolina/.test(j)) return true;
      if (/germany|india|london|united kingdom|\buk\b|berlin|amsterdam|france|spain|nigeria|singapore|australia only|europe only/.test(j) && !/usa|united states|\bus\b/.test(j)) return false;
      return true;
    }
    return wants.some((w) => !j || j.includes(w) || w.includes(j) || /remote|worldwide/.test(j));
  }

  function matchJob(job, roles, resumeText) {
    const blob = `${job.title || ""} ${job.company || ""} ${job.description || ""}`.toLowerCase();
    const resumeToks = tokens(resumeText).slice(0, 80);
    let best = null;
    roles.forEach((role) => {
      const tks = tokens(role);
      if (!tks.length) return;
      const hits = tks.filter((t) => blob.includes(t));
      const need = Math.min(2, tks.length);
      const full = blob.includes(String(role || "").toLowerCase());
      if (!full && hits.length < need) return;
      const resumeHits = resumeToks.filter((t) => blob.includes(t)).length;
      const score = Math.max(12, Math.min(99,
        28 + hits.length * 14 + (full ? 10 : 0) + Math.min(24, resumeHits * 2)
      ));
      if (!best || score > best.score) {
        best = { score, why: (full ? [role] : hits).join(", "), role };
      }
    });
    return best;
  }

  function pushJob(bag, job) {
    const url = job.url || "";
    const key = url || `${job.company}|${job.title}`.toLowerCase();
    if (!job.title || bag.has(key)) return;
    bag.set(key, job);
  }

  function decodeUddg(href) {
    try {
      const u = new URL(href, "https://duckduckgo.com/");
      const raw = u.searchParams.get("uddg");
      let out = raw || href.split("&rut=")[0];
      for (let i = 0; i < 3; i += 1) {
        try {
          const next = decodeURIComponent(out);
          if (next === out) break;
          out = next;
        } catch (_) {
          break;
        }
      }
      return out;
    } catch (_) {
      return href;
    }
  }

  function sourceFromUrl(url) {
    const u = String(url || "");
    if (/linkedin\.com\/jobs\/view\//i.test(u)) return "linkedin";
    if (/indeed\.com/i.test(u)) return "indeed";
    if (/jobright\.ai\/jobs\/info\//i.test(u)) return "jobright";
    return "google";
  }

  function isListingTitle(title) {
    const t = String(title || "");
    return /\|\s*jobright\s*$/i.test(t)
      || /\bjobs in\b.+\|\s*(jobright|linkedin|indeed)\b/i.test(t);
  }

  function isPostingUrl(url) {
    const u = String(url || "");
    return /linkedin\.com\/jobs\/view\/(?:[^/]*-)?\d{8,}/i.test(u)
      || /indeed\.com\/.*(viewjob|jk=)/i.test(u)
      || /jobright\.ai\/jobs\/info\/[A-Za-z0-9_-]+/i.test(u)
      || /google\.com\/search.*(?:udm=8|ibp=htl)/i.test(u);
  }

  function splitHeading(heading) {
    let s = String(heading || "").replace(/\s+[-–]\s+(Lever|Greenhouse(?: Software)?|Ashby|LinkedIn|Indeed|ZipRecruiter)\s*$/i, "").trim();
    const parts = s.split(/\s+[-–]\s+/);
    if (parts.length < 2) return { title: s, company: "" };
    const roleish = /engineer|analyst|developer|scientist|intern|designer|researcher|specialist|associate|coordinator|operator|consultant/i;
    if (roleish.test(parts[0]) && !roleish.test(parts.slice(1).join(" "))) {
      return { title: parts[0], company: parts.slice(1).join(" - ") };
    }
    return { company: parts[0], title: parts.slice(1).join(" - ") };
  }

  async function getText(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 14000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, referrerPolicy: "no-referrer" });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  }

  async function readPublic(target) {
    const urls = [
      "https://r.jina.ai/" + target,
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(target),
    ];
    let last = "";
    for (let i = 0; i < urls.length; i += 1) {
      try {
        const text = await getText(urls[i], 14000);
        if (text && text.length > 400) return text;
        last = text || last;
      } catch (_) {}
    }
    if (last) return last;
    throw new Error("blocked");
  }

  function parseDdgMarkdown(text) {
    const rows = [];
    const lines = String(text || "").split(/\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const m = lines[i].match(/^##\s+\[([^\]]+)\]\(([^)]+)\)/);
      if (!m) continue;
      let snip = "";
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        const ln = lines[j].trim();
        if (!ln || ln.startsWith("## ") || ln.startsWith("[![") || ln === "Ad") continue;
        snip = ln.replace(/^\[[^\]]*\]\s*/, "").replace(/\*\*/g, " ");
        break;
      }
      rows.push({ heading: m[1], href: decodeUddg(m[2]), snip });
    }
    return rows;
  }

  function parseDdgHtml(html) {
    const rows = [];
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("a.result__a").forEach((a) => {
        const box = a.closest(".result");
        const snipEl = box && box.querySelector(".result__snippet, .result__body");
        rows.push({
          heading: (a.textContent || "").trim(),
          href: decodeUddg(a.getAttribute("href") || ""),
          snip: snipEl ? snipEl.textContent.trim() : "",
        });
      });
    } catch (_) {}
    return rows;
  }

  function parseGoogleMarkdown(text) {
    if (/unusual traffic|captcha/i.test(text || "")) return [];
    const rows = [];
    const lines = String(text || "").split(/\n/).map((l) => l.replace(/\*\*/g, "").trim()).filter(Boolean);
    for (let i = 0; i < lines.length - 2; i += 1) {
      const loc = lines[i + 2] || "";
      if (!/\bvia\b/i.test(loc)) continue;
      const title = lines[i];
      const company = lines[i + 1];
      if (!title || title.length < 4 || title.length > 120) continue;
      if (/skip to|sign in|job postings|search results|date posted|saved jobs|more jobs/i.test(title)) continue;
      rows.push({
        heading: `${company} - ${title}`,
        title,
        company,
        location: loc.replace(/\s+via\s+.*/i, "").replace(/[•·]/g, " ").trim(),
        href: `https://www.google.com/search?q=${encodeURIComponent(`${title} ${company} jobs`)}&udm=8`,
        snip: loc,
      });
    }
    return rows.slice(0, 15);
  }

  function ingestSearchRows(bag, rows, roles, locations, resumeText) {
    (rows || []).forEach((row) => {
      const url = String(row.href || "").split("&rut=")[0];
      if (!url || /duckduckgo\.com|\/y\.js/i.test(url)) return;
      if (!isPostingUrl(url)) return;
      const split = row.title
        ? { title: row.title, company: row.company || "" }
        : splitHeading(row.heading);
      if (!split.title || isListingTitle(split.title) || isListingTitle(row.heading)) return;
      const source = sourceFromUrl(url);
      const job = {
        title: split.title,
        company: split.company,
        location: row.location || "",
        url,
        source,
        posted_at: "",
        description: String(row.snip || row.heading || "").slice(0, 1200),
      };
      const m = matchJob(job, roles, resumeText);
      if (!m) return;
      pushJob(bag, {
        ...job,
        id: `google:${url}`,
        match_score: m.score,
        why: m.why,
        track: m.role,
        status: "new",
        first_seen: new Date().toISOString(),
      });
    });
  }

  async function fromGoogle(bag, roles, locations, days, resumeText) {
    const loc = (locations && locations[0]) || "United States";
    const slice = (roles || []).slice(0, 4);
    const queries = [];
    slice.forEach((role) => {
      queries.push(`${role} jobs ${loc} site:linkedin.com/jobs/view`);
      queries.push(`${role} jobs ${loc} site:indeed.com/viewjob`);
      queries.push(`${role} jobs ${loc} site:jobright.ai/jobs/info`);
    });
    const uniq = [...new Set(queries)].slice(0, 10);
    let ok = false;
    for (let i = 0; i < uniq.length; i += 3) {
      await Promise.all(uniq.slice(i, i + 3).map(async (q) => {
        try {
          const target = "http://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
          const text = await readPublic(target);
          const rows = /result__a/.test(text) ? parseDdgHtml(text) : parseDdgMarkdown(text);
          ingestSearchRows(bag, rows, roles, locations, resumeText);
          ok = true;
        } catch (_) {}
      }));
    }
    if (slice[0]) {
      try {
        const gtext = await readPublic(
          "https://www.google.com/search?q=" + encodeURIComponent(`${slice[0]} jobs ${loc}`) + "&udm=8&hl=en&gl=us"
        );
        ingestSearchRows(bag, parseGoogleMarkdown(gtext), roles, locations, resumeText);
        ok = true;
      } catch (_) {}
    }
    if (!ok) throw new Error("blocked");
  }

  function addScored(bag, job, roles, locations, days, resumeText) {
    if (!job || !job.title || !job.url) return;
    if (job.posted_at && !withinLookback(job.posted_at, days)) return;
    if (job.location && !locationOk(job.location, locations)) return;
    const m = matchJob(job, roles, resumeText);
    if (!m) return;
    pushJob(bag, {
      ...job,
      match_score: m.score,
      why: m.why,
      track: m.role,
      status: "new",
      first_seen: job.posted_at || new Date().toISOString(),
    });
  }

  async function fromLinkedIn(bag, roles, locations, days, resumeText) {
    const loc = (locations && locations[0]) || "United States";
    let ok = false;
    for (const role of (roles || []).slice(0, 4)) {
      const target = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
        + `?keywords=${encodeURIComponent(role)}&location=${encodeURIComponent(loc)}`
        + "&f_E=1%2C2%2C3&f_JT=F%2CC&start=0";
      try {
        const text = await readPublic(target);
        ok = true;
        const doc = new DOMParser().parseFromString(text, "text/html");
        doc.querySelectorAll("a[href*='/jobs/view']").forEach((a) => {
          const href = (a.getAttribute("href") || "").split("?")[0];
          const idm = href.match(/(\d{8,})/);
          if (!idm) return;
          const card = a.closest("li") || a.parentElement;
          const titleEl = card && card.querySelector(".base-search-card__title, h3");
          const compEl = card && card.querySelector(".base-search-card__subtitle, h4");
          const locEl = card && card.querySelector(".job-search-card__location");
          const timeEl = card && card.querySelector("time");
          addScored(bag, {
            id: `linkedin:${idm[1]}`,
            title: ((titleEl && titleEl.textContent) || a.textContent || "").trim(),
            company: (compEl && compEl.textContent || "").trim(),
            location: (locEl && locEl.textContent || loc).trim(),
            url: href.startsWith("http") ? href : `https://www.linkedin.com/jobs/view/${idm[1]}`,
            source: "linkedin",
            posted_at: parseWhen(timeEl && (timeEl.getAttribute("datetime") || timeEl.textContent)),
            description: ((titleEl && titleEl.textContent) || a.textContent || "").trim(),
          }, roles, locations, days, resumeText);
        });
        const md = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]*linkedin\.com\/jobs\/view\/(\d{8,})[^)]*)\)/gi)];
        md.forEach((m) => {
          addScored(bag, {
            id: `linkedin:${m[3]}`,
            title: m[1].replace(/\s+/g, " ").trim(),
            company: "",
            location: loc,
            url: m[2].split("?")[0],
            source: "linkedin",
            posted_at: "",
            description: m[1],
          }, roles, locations, days, resumeText);
        });
      } catch (_) {}
    }
    if (!ok) throw new Error("blocked");
  }

  async function fromIndeed(bag, roles, locations, days, resumeText) {
    const loc = (locations && locations[0]) || "United States";
    const fromage = Math.max(1, Math.min(14, Number(days) || 7));
    let ok = false;
    for (const role of (roles || []).slice(0, 4)) {
      const target = "https://www.indeed.com/rss"
        + `?q=${encodeURIComponent(role)}&l=${encodeURIComponent(loc)}&sort=date&fromage=${fromage}`;
      try {
        const text = await readPublic(target);
        ok = true;
        const xml = text.includes("<item") ? text : "";
        if (xml) {
          const doc = new DOMParser().parseFromString(xml, "text/xml");
          doc.querySelectorAll("item").forEach((item) => {
            const link = (item.querySelector("link") && item.querySelector("link").textContent) || "";
            const guid = (item.querySelector("guid") && item.querySelector("guid").textContent) || "";
            const jk = ((link + guid).match(/jk=([a-zA-Z0-9]+)/) || [])[1];
            if (!jk) return;
            const titleRaw = (item.querySelector("title") && item.querySelector("title").textContent) || "";
            const parts = titleRaw.split(/\s+[-–]\s+/);
            addScored(bag, {
              id: `indeed:${jk}`,
              title: (parts[0] || titleRaw).trim(),
              company: (parts[1] || "").trim(),
              location: (parts[2] || loc).trim(),
              url: `https://www.indeed.com/viewjob?jk=${jk}`,
              source: "indeed",
              posted_at: parseWhen(item.querySelector("pubDate") && item.querySelector("pubDate").textContent),
              description: (item.querySelector("description") && item.querySelector("description").textContent || titleRaw).replace(/<[^>]+>/g, " "),
            }, roles, locations, days, resumeText);
          });
        }
        const jks = [...text.matchAll(/viewjob\?jk=([a-zA-Z0-9]+)/g)];
        const titles = [...text.matchAll(/##\s+\[([^\]]+)\]\([^)]*jk=([a-zA-Z0-9]+)[^)]*\)/g)];
        titles.forEach((m) => {
          const parts = m[1].split(/\s+[-–]\s+/);
          addScored(bag, {
            id: `indeed:${m[2]}`,
            title: (parts[0] || m[1]).trim(),
            company: (parts[1] || "").trim(),
            location: loc,
            url: `https://www.indeed.com/viewjob?jk=${m[2]}`,
            source: "indeed",
            posted_at: "",
            description: m[1],
          }, roles, locations, days, resumeText);
        });
        jks.forEach((m) => {
          addScored(bag, {
            id: `indeed:${m[1]}`,
            title: role,
            company: "",
            location: loc,
            url: `https://www.indeed.com/viewjob?jk=${m[1]}`,
            source: "indeed",
            posted_at: "",
            description: role,
          }, roles, locations, days, resumeText);
        });
      } catch (_) {}
    }
    if (!ok) throw new Error("blocked");
  }

  async function fromJobright(bag, roles, locations, days, resumeText) {
    const loc = (locations && locations[0]) || "United States";
    let ok = false;
    for (const role of (roles || []).slice(0, 4)) {
      const target = "https://jobright.ai/jobs/search?"
        + `searchType=job_title&value=${encodeURIComponent(role)}&country=US`;
      try {
        const text = await readPublic(target);
        ok = true;
        const md = [...text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]*jobright\.ai\/jobs\/info\/([^/?)#]+)[^)]*)\)/gi)];
        md.forEach((m) => {
          addScored(bag, {
            id: `jobright:${m[3]}`,
            title: m[1].replace(/\s+/g, " ").trim(),
            company: "",
            location: loc,
            url: m[2].split("?")[0],
            source: "jobright",
            posted_at: "",
            description: m[1],
          }, roles, locations, days, resumeText);
        });
        const ids = [...text.matchAll(/jobright\.ai\/jobs\/info\/([A-Za-z0-9_-]+)/g)];
        ids.forEach((m) => {
          addScored(bag, {
            id: `jobright:${m[1]}`,
            title: role,
            company: "",
            location: loc,
            url: `https://jobright.ai/jobs/info/${m[1]}`,
            source: "jobright",
            posted_at: "",
            description: role,
          }, roles, locations, days, resumeText);
        });
      } catch (_) {}
    }
    if (!ok) throw new Error("blocked");
  }

  function loadJobs() {
    try {
      const rows = JSON.parse(localStorage.getItem(JOBS_KEY) || "[]");
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function saveJobs(jobs) {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs.slice(0, MAX_JOBS)));
  }

  function loadMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function excelName() {
    const day = new Date().toISOString().slice(0, 10);
    return `Jobs_${day}.xlsx`;
  }

  async function run(setup) {
    const roles = (setup && setup.roles) || [];
    const locations = (setup && setup.locations && setup.locations.length)
      ? setup.locations
      : String((setup && setup.location) || "United States").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const days = Math.max(14, Number((setup && setup.lookback_days) || 7));
    const resumeText = (setup && setup.resume_text) || "";
    if (!roles.length) throw new Error("Add at least one job title, then press Find jobs.");
    const bag = new Map();
    const errors = [];
    const tasks = [
      ["Google", fromGoogle],
      ["LinkedIn", fromLinkedIn],
      ["Indeed", fromIndeed],
      ["Jobright", fromJobright],
    ];
    await Promise.all(tasks.map(async ([name, fn]) => {
      try {
        await fn(bag, roles, locations, days, resumeText);
      } catch (err) {
        errors.push(name);
      }
    }));
    const jobs = [...bag.values()]
      .sort((a, b) => (b.match_score || 0) - (a.match_score || 0))
      .slice(0, MAX_JOBS)
      .map((j) => ({ ...j, description: (j.description || "").slice(0, 400) }));
    saveJobs(jobs);
    const meta = {
      finished_at: new Date().toISOString(),
      count: jobs.length,
      errors,
      name: excelName(),
    };
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    const blob = jobsToXlsx(jobs);
    return { jobs, meta, blob, name: meta.name };
  }

  window.JobAutopilotScout = {
    run,
    loadJobs,
    loadMeta,
    jobsToXlsx,
    excelName,
    zipStore,
  };
})();
