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

  async function fromRemoteOK(bag, roles, locations, days, resumeText) {
    const data = await getJson("https://remoteok.com/api");
    (Array.isArray(data) ? data : []).forEach((row) => {
      if (!row || !row.id) return;
      const posted = parseWhen(row.epoch);
      if (!withinLookback(posted, days)) return;
      const job = {
        title: row.position || row.title || "",
        company: row.company || "",
        location: row.location || "Remote",
        url: row.url || row.apply_url || `https://remoteok.com/remote-jobs/${row.id}`,
        source: "remoteok",
        posted_at: posted,
        description: String(row.description || "").replace(/<[^>]+>/g, " ").slice(0, 1200),
      };
      if (!locationOk(job.location, locations)) return;
      const m = matchJob(job, roles, resumeText);
      if (!m) return;
      pushJob(bag, {
        ...job,
        id: `remoteok:${row.id}`,
        match_score: m.score,
        why: m.why,
        track: m.role,
        status: "new",
        first_seen: posted || new Date().toISOString(),
      });
    });
  }

  async function fromRemotive(bag, roles, locations, days, resumeText) {
    const data = await getJson("https://remotive.com/api/remote-jobs");
    (data.jobs || []).forEach((row) => {
      const posted = parseWhen(row.publication_date);
      if (!withinLookback(posted, days)) return;
      const job = {
        title: row.title || "",
        company: row.company_name || "",
        location: row.candidate_required_location || "Remote",
        url: row.url || "",
        source: "remotive",
        posted_at: posted,
        description: String(row.description || "").replace(/<[^>]+>/g, " ").slice(0, 1200),
      };
      if (!job.url) return;
      if (!locationOk(job.location, locations)) return;
      const m = matchJob(job, roles, resumeText);
      if (!m) return;
      pushJob(bag, {
        ...job,
        id: `remotive:${row.id || job.url}`,
        match_score: m.score,
        why: m.why,
        track: m.role,
        status: "new",
        first_seen: posted || new Date().toISOString(),
      });
    });
  }

  async function fromJobicy(bag, roles, locations, days, resumeText) {
    const data = await getJson("https://jobicy.com/api/v2/remote-jobs?count=100");
    (data.jobs || []).forEach((row) => {
      const posted = parseWhen(row.pubDate);
      if (!withinLookback(posted, days)) return;
      const job = {
        title: row.jobTitle || row.title || "",
        company: row.companyName || "",
        location: row.jobGeo || "Remote",
        url: row.url || row.jobUrl || "",
        source: "jobicy",
        posted_at: posted,
        description: String(row.jobExcerpt || row.jobDescription || "").replace(/<[^>]+>/g, " ").slice(0, 1200),
      };
      if (!job.url) return;
      if (!locationOk(job.location, locations)) return;
      const m = matchJob(job, roles, resumeText);
      if (!m) return;
      pushJob(bag, {
        ...job,
        id: `jobicy:${row.id || job.url}`,
        match_score: m.score,
        why: m.why,
        track: m.role,
        status: "new",
        first_seen: posted || new Date().toISOString(),
      });
    });
  }

  async function fromArbeitnow(bag, roles, locations, days, resumeText) {
    const data = await getJson("https://www.arbeitnow.com/api/job-board-api");
    (data.data || []).forEach((row) => {
      const posted = parseWhen(row.created_at);
      if (!withinLookback(posted, days)) return;
      const job = {
        title: row.title || "",
        company: row.company_name || "",
        location: row.remote ? `${row.location || ""} · Remote` : (row.location || ""),
        url: row.url || (row.slug ? `https://www.arbeitnow.com/jobs/${row.slug}` : ""),
        source: "arbeitnow",
        posted_at: posted,
        description: String(row.description || "").replace(/<[^>]+>/g, " ").slice(0, 1200),
      };
      if (!job.url) return;
      if (!locationOk(job.location, locations)) return;
      const m = matchJob(job, roles, resumeText);
      if (!m) return;
      pushJob(bag, {
        ...job,
        id: `arbeitnow:${row.slug || job.url}`,
        match_score: m.score,
        why: m.why,
        track: m.role,
        status: "new",
        first_seen: posted || new Date().toISOString(),
      });
    });
  }

  async function fromMuse(bag, roles, locations, days, resumeText) {
    const urls = [0, 1, 2].map((page) =>
      `https://www.themuse.com/api/public/jobs?page=${page}&descending=true`
    );
    for (const url of urls) {
      const data = await getJson(url);
      (data.results || []).forEach((row) => {
        const posted = parseWhen(row.publication_date);
        if (!withinLookback(posted, days)) return;
        const where = (row.locations || []).map((x) => x.name).filter(Boolean).join(", ");
        const job = {
          title: row.name || "",
          company: (row.company && row.company.name) || "",
          location: where || "",
          url: (row.refs && row.refs.landing_page) || "",
          source: "themuse",
          posted_at: posted,
          description: String(row.contents || "").replace(/<[^>]+>/g, " ").slice(0, 1200),
        };
        if (!job.url) return;
        if (!locationOk(job.location, locations)) return;
        const m = matchJob(job, roles, resumeText);
        if (!m) return;
        pushJob(bag, {
          ...job,
          id: `muse:${row.id || job.url}`,
          match_score: m.score,
          why: m.why,
          track: m.role,
          status: "new",
          first_seen: posted || new Date().toISOString(),
        });
      });
    }
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
      ["RemoteOK", fromRemoteOK],
      ["Remotive", fromRemotive],
      ["Jobicy", fromJobicy],
      ["Arbeitnow", fromArbeitnow],
      ["The Muse", fromMuse],
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
