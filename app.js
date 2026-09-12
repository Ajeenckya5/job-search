(() => {
  const state = { track: "all", overview: null, view: "home", wizardStep: 1, excelObjectUrl: null };
  const STATIC_MODE = /\.github\.io$/i.test(location.hostname) || location.protocol === "file:";
  const WIZARD_STEPS = 6;

  const TITLES = {
    home: "Overview",
    apps: "Applications",
    mail: "Mail",
    setup: "Set up",
    settings: "Settings",
  };

  const $ = (id) => document.getElementById(id);

  function fmt(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  function pill(status) {
    const label = status || "unknown";
    return `<span class="pill ${label}">${label.replaceAll("_", " ")}</span>`;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function setSyncNote(text, show) {
    const el = $("syncNote");
    el.hidden = !show;
    el.textContent = text;
  }

  function renderKpis(k, mail) {
    const cards = [
      { label: "Applied", value: k.applied, hint: `${fmt(k.companies)} companies`, accent: true },
      { label: "Waiting", value: k.waiting, hint: `${fmt(k.stale_applied_21d)} older than 21 days` },
      { label: "Interviews", value: k.interviews, hint: `${fmt(k.reached_interview)} reached overall` },
      { label: "Assessments", value: k.assessments, hint: `${fmt(k.reached_assessment)} reached overall` },
      { label: "Offers", value: k.offers, hint: "Matched offer mail" },
      { label: "Rejected", value: k.rejected, hint: `${k.response_rate}% heard back` },
    ];
    $("kpis").innerHTML = cards.map((c) => `
      <div class="kpi${c.accent ? " accent" : ""}">
        <div class="label">${c.label}</div>
        <div class="value">${fmt(c.value)}</div>
        <div class="hint">${c.hint}</div>
      </div>
    `).join("");

    const name = (state.overview && state.overview.candidate && state.overview.candidate.name) || "Job search";
    $("candidateName").textContent = name;
    const last = mail.last_processed_at || mail.last_received_at;
    const addr = mail.address || "";
    $("mailboxLine").textContent = addr
      ? (mail.enabled
        ? `${addr} · last mailbox read ${fmtWhen(last)} · ${fmt(mail.job_related)} job emails / ${fmt(mail.scanned)} scanned`
        : `${addr} · mailbox reading is off until you turn it on and press Sync mailbox`)
      : "Mailbox reading stays off unless you choose it.";
  }

  function renderFunnel(o) {
    const reached = o.funnel_reached || {};
    const current = o.funnel_current || {};
    const max = Math.max(reached.applied || o.kpis.applied || 1, 1);
    const rows = [
      ["Applied", reached.applied || o.kpis.applied, "applied"],
      ["Reached assessment", reached.assessment || 0, "assessment"],
      ["Reached interview", reached.interview || 0, "interview"],
      ["Reached offer", reached.offer || 0, "offer"],
      ["Currently waiting", current.waiting || 0, "waiting"],
      ["Rejected", current.rejected || 0, "rejected"],
    ];
    $("funnel").innerHTML = `<div class="funnel">${rows.map(([name, n, cls]) => {
      const w = n <= 0 ? 0 : Math.max(2, Math.round((n / max) * 100));
      return `<div class="funnel-row">
        <div class="name">${name}</div>
        <div class="bar ${cls}"><span style="width:${w}%"></span></div>
        <div class="n">${fmt(n)}</div>
      </div>`;
    }).join("")}</div>`;
  }

  function stackedChart(el, series, keys) {
    if (!series || !series.length) {
      el.innerHTML = `<p class="empty">No weekly series yet.</p>`;
      return;
    }
    const colors = {
      applied: "#1d3f5c",
      rejected: "#8a3d34",
      interview: "#2b5c49",
      assessment: "#8a5f1f",
      offer: "#6e5424",
    };
    const w = 640, h = 220, padL = 28, padR = 8, padT = 28, padB = 36;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const max = Math.max(1, ...series.map((d) => keys.reduce((s, k) => s + (d[k] || 0), 0)));
    const bw = innerW / series.length;
    const bars = series.map((d, i) => {
      let y = padT + innerH;
      const stack = keys.map((k) => {
        const v = d[k] || 0;
        const bh = (v / max) * innerH;
        y -= bh;
        return `<rect x="${padL + i * bw + bw * 0.18}" y="${y}" width="${bw * 0.64}" height="${Math.max(0, bh)}" fill="${colors[k]}"></rect>`;
      }).join("");
      const label = i % 2 === 0 || series.length < 12 ? d.label : "";
      return `${stack}<text x="${padL + i * bw + bw / 2}" y="${h - 12}" text-anchor="middle" fill="#6c675e" font-size="10">${label}</text>`;
    }).join("");
    const legend = keys.map((k, i) =>
      `<g transform="translate(${padL + i * 92}, 12)">
         <rect width="9" height="9" fill="${colors[k]}"></rect>
         <text x="14" y="9" font-size="11" fill="#6c675e">${k}</text>
       </g>`
    ).join("");
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Weekly counts">${legend}${bars}</svg>`;
  }

  function renderInsights(list) {
    if (!list.length) {
      $("insights").innerHTML = `<p class="empty">Insights appear after mailbox sync has classified applications.</p>`;
      return;
    }
    $("insights").innerHTML = list.map((item) => `
      <div class="insight">
        <h3>${item.title}</h3>
        <div class="val">${item.value}</div>
        <p>${item.detail}</p>
      </div>
    `).join("");
  }

  function jobTable(rows, { editable = false } = {}) {
    if (!rows.length) return `<p class="empty">Nothing in this slice.</p>`;
    const head = `<tr>
      <th>Status</th><th>Role</th><th>Company</th><th>Score</th><th>Logged</th><th>Last mail</th><th></th>
    </tr>`;
    const body = rows.map((j) => {
      const statusCell = editable
        ? `<select class="status-select" data-id="${j.id}" data-track="${j.track}">
             ${["applied", "assessment", "interview", "offer", "rejected", "withdrawn"].map((s) =>
               `<option value="${s}"${s === j.status ? " selected" : ""}>${s}</option>`).join("")}
           </select>`
        : pill(j.status);
      const mail = j.last_mail_stage
        ? `${pill(j.last_mail_stage)} <span class="muted">${fmtDate(j.last_mail_at)}</span>`
        : `<span class="muted">${j.last_mail_at ? fmtDate(j.last_mail_at) : "—"}</span>`;
      return `<tr>
        <td>${statusCell}</td>
        <td class="title">${j.url ? `<a href="${j.url}" target="_blank" rel="noreferrer">${escapeHtml(j.title || "Untitled")}</a>` : escapeHtml(j.title || "Untitled")}
          <div class="muted">${escapeHtml(j.track || "")}${j.location ? " · " + escapeHtml(j.location) : ""}</div>
        </td>
        <td>${escapeHtml(j.company)}</td>
        <td>${j.match_score || "—"}</td>
        <td class="muted">${fmtDate(j.first_seen)}</td>
        <td>${mail}</td>
        <td>${j.source ? `<span class="muted">${escapeHtml(j.source)}</span>` : ""}${j.search_query ? `<div class="muted">${escapeHtml(j.search_query)}</div>` : ""}</td>
      </tr>`;
    }).join("");
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function renderCompanies(rows) {
    if (!rows.length) {
      $("companies").innerHTML = `<p class="empty">No matched applications yet.</p>`;
      return;
    }
    $("companies").innerHTML = rows.map((c) => `
      <div class="company-row">
        <div>${escapeHtml(c.company)}</div>
        <div class="meters">${c.n} apps · ${c.waiting} waiting · ${c.interviews} interviews · ${c.rejected} rejected</div>
      </div>
    `).join("");
  }

  function mailTable(events) {
    if (!events.length) return `<p class="empty">No job-related mail in this filter.</p>`;
    const head = `<tr><th>When</th><th>Stage</th><th>Subject</th><th>From</th><th>Match</th></tr>`;
    const body = events.map((e) => `<tr>
      <td class="muted">${fmtWhen(e.received_at)}</td>
      <td>${pill(e.stage)}${e.ambiguous ? ` <span class="pill">ambiguous</span>` : ""}</td>
      <td class="title">${escapeHtml(e.subject || "(no subject)")}
        ${e.snippet ? `<div class="muted">${escapeHtml(e.snippet)}</div>` : ""}
      </td>
      <td class="muted">${escapeHtml(e.from_addr)}</td>
      <td>${e.linked ? `<span class="pill applied">matched</span>` : `<span class="pill unlinked">unmatched</span>`}</td>
    </tr>`).join("");
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  function renderProfile(setup) {
    const host = $("searchProfile");
    if (!host) return;
    const s = setup || {};
    const resume = s.resume_name
      || (s.resume_pdf || "").split(/[/\\]/).pop()
      || (s.resume_text ? "Resume saved on this phone" : "Not set — click Edit");
    const list = s.roles || [];
    const titles = !list.length
      ? "Not set — click Edit"
      : list.length <= 4
        ? list.join(", ")
        : `${list.slice(0, 3).join(", ")} +${list.length - 3} more`;
    const locList = s.locations && s.locations.length ? s.locations : String(s.location || "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    const locText = locList.length ? locList.join(", ") : "Not set";
    const sources = STATIC_MODE
      ? "LinkedIn, Indeed, Jobright, and Google — scored on this device"
      : "LinkedIn, Indeed, Jobright, and Google — each match is scored against your resume";
    const rows = [
      ["Resume", resume],
      ["Job titles", titles],
      ["Locations", locText],
      ["Look back", `${s.lookback_days || "—"} days of postings`],
      ["Schedule", Number(s.runs_per_day) > 0 ? `${s.runs_per_day} times per day` : "Manual — press Find jobs"],
      ["Sources", sources],
    ];
    host.innerHTML = rows.map(([k, v]) => `
      <div class="profile-item">
        <div class="label">${k}</div>
        <div class="val">${escapeHtml(String(v))}</div>
      </div>`).join("");
  }

  function renderTracks(tracks) {
    $("tracks").innerHTML = (tracks || []).map((t) => {
      const d = t.digest;
      const digestLine = d
        ? `Latest scout ${fmtWhen(d.generated_at)} · ${fmt(d.new_this_run)} new · ${fmt(d.shortlist)} on the shortlist`
        : "No recent scout yet — press Find jobs to scrape now";
      return `<div class="track-card">
        <h3>${escapeHtml(t.label)}</h3>
        <div class="mini">
          <span><b>${fmt(t.funnel)}</b> applied</span>
          <span><b>${fmt(t.interview)}</b> interviews</span>
          <span><b>${fmt(t.assessment)}</b> assessments</span>
          <span><b>${fmt(t.rejected)}</b> rejected</span>
          <span><b>${fmt(t.new)}</b> new matches</span>
        </div>
        <p class="caption">${digestLine}</p>
      </div>`;
    }).join("") || `<p class="empty">${STATIC_MODE ? "Press Find jobs to search from this phone or computer." : "Save setup, then press Find jobs."}</p>`;
  }

  function renderTrackNav(tracks) {
    const host = $("trackSeg");
    if (!host) return;
    const current = state.track;
    const bits = [`<button class="seg-btn${current === "all" ? " is-on" : ""}" data-track="all" type="button">All</button>`];
    (tracks || []).forEach((t) => {
      bits.push(`<button class="seg-btn${current === t.id ? " is-on" : ""}" data-track="${escapeHtml(t.id)}" type="button">${escapeHtml(t.label)}</button>`);
    });
    host.innerHTML = bits.join("");
    host.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        state.track = btn.dataset.track;
        host.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("is-on", b === btn));
        await refresh();
      });
    });
  }

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((el) => el.classList.toggle("is-on", el.id === id));
  }

  function isConfigured() {
    if (STATIC_MODE) {
      return !!(state.overview && state.overview.setup && state.overview.setup.configured)
        || !!setupFromStored(storedSetup());
    }
    if (!state.overview || !state.overview.setup) return false;
    return !!state.overview.setup.configured;
  }

  function routePath() {
    const raw = (location.hash || "#/").replace(/^#/, "");
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  function showView(name) {
    state.view = name;
    document.querySelectorAll(".view").forEach((el) => el.classList.toggle("is-on", el.id === `view-${name}`));
    document.querySelectorAll(".app-nav a").forEach((a) => {
      a.classList.toggle("is-on", a.dataset.view === name);
    });
  }

  async function applyRoute() {
    const path = routePath();
    const configured = isConfigured();
    if (!configured || path === "/setup" || path === "/settings") {
      let status = (state.overview && state.overview.setup) || null;
      if (!status && !STATIC_MODE) {
        try { status = await getJSON("/api/setup-status"); }
        catch (_) { status = storedSetup(); }
      } else if (!status) {
        status = storedSetup();
      }
      fillSetup(status);
      $("btnSetupCancel").hidden = !configured;
      const heading = $("setupHeading");
      if (heading) heading.textContent = configured ? "Update your search" : "Set up your job search";
      const lead = $("setupLead");
      if (lead) {
        lead.textContent = configured
          ? "Change your answers one screen at a time. Mail is never scanned unless you say so."
          : "A few questions, one screen at a time. Answers stay on this device.";
      }
      showWizardStep(configured ? 1 : 1);
      showScreen("screen-setup");
      document.title = `${configured ? TITLES.settings : TITLES.setup} · Job Autopilot`;
      return;
    }
    showScreen("screen-app");
    const view = path === "/applications" ? "apps" : path === "/mail" ? "mail" : "home";
    showView(view);
    document.title = `${TITLES[view]} · Job Autopilot`;
    if (STATIC_MODE) renderStaticDashboard();
    fillGoogleQuery((state.overview && state.overview.setup) || setupFromStored(storedSetup()));
  }

  function collectRepeat(listId) {
    return [...document.querySelectorAll(`#${listId} input`)].map((el) => el.value.trim()).filter(Boolean);
  }

  function addRepeatRow(listId, placeholder, value, focus) {
    const host = $(listId);
    if (!host) return;
    const row = document.createElement("div");
    row.className = "repeat-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = value || "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost";
    btn.textContent = "Remove";
    btn.addEventListener("click", () => {
      if (host.children.length > 1) row.remove();
      else input.value = "";
    });
    row.appendChild(input);
    row.appendChild(btn);
    host.appendChild(row);
    if (focus !== false) input.focus();
  }

  function fillRepeatList(listId, placeholder, values) {
    const host = $(listId);
    if (!host) return;
    host.innerHTML = "";
    const items = values && values.length ? values : [""];
    items.forEach((value) => addRepeatRow(listId, placeholder, value, false));
  }

  function showWizardStep(step) {
    state.wizardStep = Math.max(1, Math.min(WIZARD_STEPS, step));
    const frame = document.querySelector(".setup-frame");
    if (frame) frame.dataset.step = String(state.wizardStep);
    const idx = $("setupStepIndex");
    if (idx) {
      idx.textContent = `${String(state.wizardStep).padStart(2, "0")}  /  ${String(WIZARD_STEPS).padStart(2, "0")}`;
    }
    document.querySelectorAll(".wizard-step").forEach((el) => {
      el.classList.toggle("is-on", Number(el.dataset.step) === state.wizardStep);
    });
    document.querySelectorAll("#wizardProgress li").forEach((el, i) => {
      const n = i + 1;
      el.classList.toggle("is-on", n === state.wizardStep);
      el.classList.toggle("is-done", n < state.wizardStep);
    });
    const last = state.wizardStep === WIZARD_STEPS;
    $("btnWizardBack").hidden = state.wizardStep === 1;
    $("btnWizardNext").hidden = last;
    $("btnSetupSave").hidden = !last;
    const focus = document.querySelector(`.wizard-step.is-on input:not([type="file"]), .wizard-step.is-on textarea, .wizard-step.is-on select`);
    if (focus) focus.focus();
  }

  function syncCadence(n) {
    const parsed = Number(n);
    const value = Number.isFinite(parsed) ? parsed : 4;
    const input = document.querySelector('[name="runs_per_day"]');
    if (input) input.value = value;
    document.querySelectorAll("#cadenceChoices [data-runs]").forEach((btn) => {
      btn.classList.toggle("is-on", Number(btn.dataset.runs) === value);
    });
  }

  function wizardError(msg) {
    const err = $("setupError");
    err.hidden = !msg;
    err.textContent = msg || "";
    return !msg;
  }

  function validateWizardStep(step) {
    const form = $("setupForm");
    if (step === 1) {
      return wizardError(form.elements.name.value.trim() ? "" : "Enter your name to continue.");
    }
    if (step === 2) {
      const file = form.elements.resume_file?.files?.[0];
      const path = (form.elements.resume_pdf.value || "").trim();
      if (file || path || form.dataset.resumeOk === "1") return wizardError("");
      if (STATIC_MODE) return wizardError("");
      return wizardError("Upload a resume or paste the file path.");
    }
    if (step === 3) {
      return wizardError(collectRepeat("roleList").length ? "" : "Add at least one job role.");
    }
    if (step === 4) {
      if (!collectRepeat("locationList").length) {
        addRepeatRow("locationList", "City, state, Remote, or United States", "United States");
      }
      return wizardError("");
    }
    if (step === 5) {
      const n = Number(form.elements.runs_per_day.value);
      return wizardError(Number.isFinite(n) && n >= 0 && n <= 24 ? "" : "Enter 0 to run only by hand, or 1 to 24 times a day.");
    }
    return wizardError("");
  }

  function storedSetup() {
    try {
      return JSON.parse(localStorage.getItem("jobAutopilotSetup") || "null");
    } catch (_) {
      return null;
    }
  }

  function setupFromStored(raw) {
    if (!raw) return null;
    const name = String(raw.name || (raw.candidate && raw.candidate.name) || "").trim();
    const roles = Array.isArray(raw.roles)
      ? raw.roles.filter(Boolean)
      : String(raw.roles || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const resumeOk = !!(raw.resume_ok || raw.resume_name || raw.resume_pdf || raw.configured);
    if (!name || !roles.length || !resumeOk) return null;
    const email = String(raw.email || (raw.candidate && raw.candidate.email) || "").trim();
    const locValues = Array.isArray(raw.locations) && raw.locations.length
      ? raw.locations.filter(Boolean)
      : String(raw.location || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    return {
      configured: true,
      candidate: {
        name,
        email,
        phone: raw.phone || "",
        linkedin: raw.linkedin || "",
      },
      name,
      email,
      phone: raw.phone || "",
      linkedin: raw.linkedin || "",
      roles,
      location: locValues.join(", "),
      locations: locValues,
      resume_pdf: raw.resume_pdf || "",
      resume_ok: true,
      resume_name: raw.resume_name || "",
      resume_text: raw.resume_text || "",
      lookback_days: raw.lookback_days || 7,
      runs_per_day: raw.runs_per_day == null || raw.runs_per_day === "" ? 4 : Number(raw.runs_per_day),
      max_years_required: raw.max_years_required || 3,
      llm_provider: raw.llm_provider || "gemini",
      scraper_type: raw.scraper_type || "none",
      mail_enabled: false,
      mail_scan_consent: false,
      mail_provider: raw.mail_provider || "auto",
      imap_host: raw.imap_host || "",
    };
  }

  function emptyOverview(setup) {
    const email = (setup.candidate && setup.candidate.email) || setup.email || "";
    const name = (setup.candidate && setup.candidate.name) || setup.name || "";
    return {
      setup,
      candidate: { name, email, mail_enabled: false },
      kpis: {
        applied: 0, waiting: 0, interviews: 0, assessments: 0, offers: 0, rejected: 0,
        companies: 0, stale_applied_21d: 0, reached_interview: 0, reached_assessment: 0, response_rate: 0,
      },
      mailbox: {
        enabled: false, address: email, scanned: 0, job_related: 0,
        receipts_this_week: 0, receipts_last_week: 0,
      },
      funnel_reached: { applied: 0, assessment: 0, interview: 0, offer: 0 },
      funnel_current: { waiting: 0, rejected: 0 },
      weekly_mail: [],
      weekly_jobs: [],
      insights: [],
      attention: [],
      companies: [],
      tracks: [],
      sync: { running: false },
      scout: { running: false },
    };
  }

  function browserJobRows() {
    const scout = window.JobAutopilotScout;
    const jobs = scout && scout.loadJobs ? scout.loadJobs() : [];
    return jobs.map((j) => ({
      id: j.id,
      title: j.title,
      company: j.company,
      url: j.url,
      location: j.location,
      match_score: j.match_score,
      status: j.status || "new",
      first_seen: j.posted_at || j.first_seen,
      source: j.source,
      search_query: j.search_query,
      track: j.track || "",
    }));
  }

  function hydrateBrowserExcel(jobs) {
    const scout = window.JobAutopilotScout;
    if (!scout || !jobs || !jobs.length) return null;
    if (state.excelObjectUrl) URL.revokeObjectURL(state.excelObjectUrl);
    const blob = scout.jobsToXlsx(jobs);
    const url = URL.createObjectURL(blob);
    state.excelObjectUrl = url;
    const name = (scout.loadMeta() && scout.loadMeta().name) || scout.excelName();
    const excel = { ready: true, url, name };
    updateExcelButton(excel);
    return excel;
  }

  function renderStaticDashboard() {
    const setup = (state.overview && state.overview.setup) || setupFromStored(storedSetup());
    if (!setup) return;
    const rows = browserJobRows();
    const jobs = window.JobAutopilotScout && window.JobAutopilotScout.loadJobs
      ? window.JobAutopilotScout.loadJobs()
      : [];
    const meta = window.JobAutopilotScout && window.JobAutopilotScout.loadMeta
      ? window.JobAutopilotScout.loadMeta()
      : null;
    state.overview = emptyOverview(setup);
    const byCo = {};
    rows.forEach((j) => {
      const name = j.company || "Unknown";
      if (!byCo[name]) byCo[name] = { company: name, n: 0, waiting: 0, interviews: 0, rejected: 0 };
      byCo[name].n += 1;
    });
    const uniqueCos = Object.values(byCo).sort((a, b) => b.n - a.n).slice(0, 12);
    renderProfile(setup);
    renderTrackNav([]);
    renderKpis(state.overview.kpis, state.overview.mailbox);
    $("candidateName").textContent = (setup.candidate && setup.candidate.name) || setup.name || "Job search";
    renderFunnel(state.overview);
    stackedChart($("mailChart"), [], ["applied", "rejected", "interview"]);
    $("mailCaption").textContent = "Mailbox reading is not available in the phone browser.";
    stackedChart($("jobsChart"), [], ["applied", "rejected", "interview"]);
    renderInsights(rows.length ? [{
      title: "Matches on this device",
      value: String(rows.length),
      detail: "Matched on this device from public job lists. Your resume never left this browser.",
    }] : []);
    $("attention").innerHTML = jobTable(rows.slice(0, 12));
    renderCompanies(uniqueCos);
    renderTracks(rows.length ? [{
      id: "phone",
      label: "This device",
      funnel: 0,
      interview: 0,
      assessment: 0,
      rejected: 0,
      new: rows.length,
      digest: {
        generated_at: meta && meta.finished_at,
        new_this_run: rows.length,
        shortlist: rows.length,
      },
    }] : []);
    $("pipeline").innerHTML = jobTable(rows);
    $("pipelineCaption").textContent = rows.length
      ? `${rows.length} jobs found in this browser. Download Excel for the full list.`
      : "Press Find jobs to search LinkedIn, Indeed, Jobright, and Google from this phone. Matches stay on the device.";
    $("mail").innerHTML = mailTable([]);
    $("mailTableCaption").textContent = "Mail is read on a computer after you say yes and press Sync mailbox.";
    if ($("btnScout")) $("btnScout").hidden = false;
    if ($("btnScoutInline")) $("btnScoutInline").hidden = false;
    if ($("btnSync")) $("btnSync").hidden = true;
    const excel = hydrateBrowserExcel(jobs);
    if (rows.length) {
      setSyncNote(
        excel
          ? `Found ${rows.length} jobs on this device. Excel is ready — tap Download Excel.`
          : `Found ${rows.length} jobs on this device.`,
        true
      );
    } else {
      setSyncNote("Press Find jobs to search from this device. Resume and matches stay here — we have no copy.", true);
      pingExcel();
    }
  }

  function extractPdfText(buf) {
    const raw = new TextDecoder("latin1").decode(buf);
    const chunks = [];
    const paren = /\((\\.|[^\\)]){4,400}\)/g;
    let m;
    while ((m = paren.exec(raw))) {
      const s = m[0].slice(1, -1)
        .replace(/\\n/g, " ")
        .replace(/\\r/g, " ")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\./g, "");
      if (/[A-Za-z]{4}/.test(s)) chunks.push(s);
      if (chunks.length > 400) break;
    }
    return chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 20000);
  }

  async function readResumeForStore(file) {
    if (!file) return { name: "", text: "" };
    const name = file.name || "resume";
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith(".txt") || (file.type || "").startsWith("text/")) {
        return { name, text: (await file.text()).slice(0, 20000) };
      }
      if (lower.endsWith(".pdf") || file.type === "application/pdf") {
        const buf = await file.arrayBuffer();
        return { name, text: extractPdfText(buf) };
      }
    } catch (_) { /* keep the file name even if we cannot read text */ }
    return { name, text: "" };
  }

  function formPayload(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    delete data.resume_file;
    return data;
  }

  function fillSetup(status) {
    const form = $("setupForm");
    if (!form) return;
    const c = (status && (status.candidate || status)) || {};
    const roleValues = Array.isArray(status && status.roles)
      ? status.roles.filter(Boolean)
      : String((status && status.roles) || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const locValues = Array.isArray(status && status.locations) && status.locations.length
      ? status.locations
      : String((status && status.location) || c.location || "United States").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const map = {
      name: c.name,
      email: c.email,
      phone: c.phone,
      linkedin: c.linkedin,
      resume_pdf: status && status.resume_pdf,
      lookback_days: (status && status.lookback_days) || 7,
      runs_per_day: status && status.runs_per_day != null && status.runs_per_day !== "" ? status.runs_per_day : 4,
      max_years_required: (status && status.max_years_required) || 3,
      llm_provider: (status && status.llm_provider) || "gemini",
      scraper_type: status && status.scraper_type && status.scraper_type !== "none" ? status.scraper_type : "none",
      mail_provider: (status && status.mail_provider) || "auto",
      imap_host: (status && status.imap_host) || "",
    };
    Object.entries(map).forEach(([k, v]) => {
      if (form.elements[k] && v != null && v !== "") form.elements[k].value = v;
    });
    fillRepeatList("roleList", "Software Engineer", roleValues.length ? roleValues : [""]);
    fillRepeatList("locationList", "City, state, Remote, or United States", locValues.length ? locValues : ["United States"]);
    syncCadence(status && status.runs_per_day != null && status.runs_per_day !== ""
      ? status.runs_per_day
      : (form.elements.runs_per_day?.value || 4));
    form.dataset.resumeOk = status && (status.resume_ok || status.resume_name) ? "1" : "";
    if (status && (status.resume_ok || status.resume_name)) {
      $("resumeHint").textContent = status.resume_name
        ? `Resume on file: ${status.resume_name}. Upload a new file only if you want to replace it.`
        : "A resume is already saved. Upload a new file only if you want to replace it.";
    }
    toggleAdzuna();
    toggleImapHost();
    const raw = status && status.mail_scan_consent;
    const yes = !STATIC_MODE && (raw === true || /^(yes|true|1|on)$/i.test(String(raw || "")));
    setMailConsent(yes ? "yes" : "no", { fromEmail: Boolean((c.email || "").trim()) });
  }

  function toggleAdzuna() {
    const wrap = $("adzunaIdWrap");
    const sel = $("scraperType");
    if (wrap && sel) wrap.hidden = sel.value !== "adzuna";
  }

  function toggleImapHost() {
    const wrap = $("imapHostWrap");
    const sel = $("mailProvider");
    if (wrap && sel) wrap.hidden = sel.value !== "other";
  }

  function setMailConsent(value, opts) {
    const consent = value === "yes" ? "yes" : "no";
    const emailOn = Boolean((opts && opts.fromEmail) || ($("setupEmail") && $("setupEmail").value.trim()));
    const hidden = $("mailScanConsent");
    if (hidden) hidden.value = consent;
    document.querySelectorAll("#mailConsentChoices [data-consent]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.consent === consent);
    });
    const ask = $("mailConsentBlock");
    if (ask) ask.hidden = !emailOn;
    const fields = $("mailScanFields");
    if (fields) fields.hidden = STATIC_MODE || !emailOn || consent !== "yes";
    const localOnly = $("mailLocalOnly");
    if (localOnly) localOnly.hidden = !(STATIC_MODE && emailOn && consent === "yes");
    toggleImapHost();
  }

  async function saveSetup(ev) {
    ev.preventDefault();
    for (let i = 1; i <= 5; i += 1) {
      if (!validateWizardStep(i)) {
        showWizardStep(i);
        return;
      }
    }
    const form = $("setupForm");
    const err = $("setupError");
    err.hidden = true;
    const fd = new FormData(form);
    const file = form.elements.resume_file?.files?.[0];
    if (file) fd.set("resume_file", file);
    else fd.delete("resume_file");
    fd.set("roles", collectRepeat("roleList").join("\n"));
    fd.set("location", collectRepeat("locationList").join("\n"));
    fd.set("locations", collectRepeat("locationList").join("\n"));
    try {
      $("btnSetupSave").disabled = true;
      if (STATIC_MODE) {
        const payload = formPayload(form);
        payload.roles = collectRepeat("roleList");
        payload.locations = collectRepeat("locationList");
        payload.location = payload.locations.join(", ");
        const prev = storedSetup() || {};
        payload.resume_ok = !!(file || payload.resume_pdf || prev.resume_name || prev.resume_text);
        payload.resume_name = file ? file.name : (prev.resume_name || "");
        payload.resume_text = prev.resume_text || "";
        if (file) {
          const got = await readResumeForStore(file);
          payload.resume_name = got.name;
          if (got.text) payload.resume_text = got.text;
          payload.resume_ok = true;
        }
        delete payload.llm_api_key;
        delete payload.scraper_api_key;
        delete payload.mail_password;
        delete payload.adzuna_app_id;
        payload.mail_scan_consent = "no";
        payload.configured = true;
        localStorage.setItem("jobAutopilotSetup", JSON.stringify(payload));
        const setup = setupFromStored(payload);
        if (!setup) throw new Error("Save your name, resume, and at least one role first.");
        state.overview = emptyOverview(setup);
        if (location.hash !== "#/") location.hash = "#/";
        showScreen("screen-app");
        showView("home");
        document.title = `${TITLES.home} · Job Autopilot`;
        renderStaticDashboard();
        return;
      }
      const res = await fetch("/api/setup", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.status) {
        state.overview = state.overview || {};
        state.overview.setup = data.status;
      }
      if (location.hash !== "#/") location.hash = "#/";
      showScreen("screen-app");
      await refresh();
      await applyRoute();
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    } finally {
      $("btnSetupSave").disabled = false;
    }
  }

  function updateScoutButton(scout, opts) {
    ["btnScout", "btnScoutInline"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.hidden = false;
      if (scout && scout.running) {
        btn.disabled = true;
        btn.classList.add("busy");
        btn.textContent = id === "btnScoutInline" ? "Scraping…" : "Finding jobs";
      } else {
        btn.disabled = false;
        btn.classList.remove("busy");
        btn.textContent = id === "btnScoutInline" ? "Run scraper now" : "Find jobs";
      }
    });
    const excel = (scout && scout.excel) || (scout && scout.result && scout.result.excel);
    if (!excel || excel.ready) updateExcelButton(excel);
    const announce = !opts || opts.announce !== false;
    if (!announce) return;
    if (scout && scout.running) {
      setSyncNote("Searching boards and scoring against your resume. Excel will be ready to download when this finishes.", true);
    } else if (scout && scout.error) {
      setSyncNote(`Job search failed: ${scout.error}`, true);
    } else if (scout && scout.result && scout.finished_at) {
      const ready = !!(excel && excel.ready);
      setSyncNote(
        ready
          ? "Job search finished. Excel is ready — click Download Excel."
          : "Job search finished. The ledger and shortlist are updated.",
        true
      );
    }
  }

  function excelUrl(excel) {
    const path = (excel && excel.url) || "/api/excel?track=main";
    if (/^(https?:|blob:)/i.test(path)) return path;
    return path;
  }

  function updateExcelButton(excel) {
    const ready = !!(excel && excel.ready);
    if (!ready) {
      const current = $("btnExcel");
      if (current && !current.hidden) return;
    }
    ["btnExcel", "btnExcelInline"].forEach((id) => {
      const btn = $(id);
      if (!btn) return;
      btn.hidden = !ready;
      if (!ready) return;
      btn.href = excelUrl(excel);
      btn.setAttribute("download", excel.name || "jobs.xlsx");
      btn.textContent = "Download Excel";
    });
  }

  async function pingExcel() {
    if (STATIC_MODE) return;
    try {
      const data = await scoutJSON("/api/overview?track=all");
      updateExcelButton(data.excel || (data.scout && data.scout.excel));
    } catch (_) {
      try {
        const scout = await scoutJSON("/api/scout");
        updateExcelButton(scout.excel);
      } catch (_) { /* local dashboard may be off */ }
    }
  }

  async function loadOverview() {
    const data = await getJSON(`/api/overview?track=${encodeURIComponent(state.track)}`);
    state.overview = data;
    if (data.setup && !data.setup.configured) {
      fillSetup(data.setup);
      if (location.hash !== "#/setup") location.hash = "#/setup";
      await applyRoute();
      return data;
    }
    renderProfile(data.setup);
    renderTrackNav(data.tracks || []);
    renderKpis(data.kpis, data.mailbox);
    renderFunnel(data);
    stackedChart($("mailChart"), data.weekly_mail, ["applied", "rejected", "interview"]);
    const mail = data.mailbox;
    $("mailCaption").textContent =
      `Source: mailbox + job ledger · this week ${fmt(mail.receipts_this_week)} receipts vs ${fmt(mail.receipts_last_week)} last week`;
    stackedChart($("jobsChart"), data.weekly_jobs, ["applied", "rejected", "interview"]);
    renderInsights(data.insights || []);
    $("attention").innerHTML = jobTable(data.attention || []);
    renderCompanies(data.companies || []);
    renderTracks(data.tracks || []);
    updateSyncButton(data.sync);
    updateScoutButton(data.scout, { announce: !!(data.scout && data.scout.running) });
    updateExcelButton(data.excel || (data.scout && data.scout.excel));
    return data;
  }

  async function loadPipeline() {
    if (STATIC_MODE) {
      const rows = browserJobRows();
      $("pipeline").innerHTML = jobTable(rows);
      $("pipelineCaption").textContent = rows.length
        ? `${rows.length} jobs found in this browser. Download Excel for the full list.`
        : "Press Find jobs to search LinkedIn, Indeed, Jobright, and Google from this phone. Matches stay on the device.";
      return;
    }
    const status = $("statusFilter").value;
    const q = $("jobSearch").value.trim();
    const url = `/api/pipeline?track=${encodeURIComponent(state.track)}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&limit=80`;
    const data = await getJSON(url);
    $("pipeline").innerHTML = jobTable(data.jobs || [], { editable: true });
    $("pipelineCaption").textContent = `${fmt(data.total)} rows in this filter. Changing status writes through to SQLite.`;
    $("pipeline").querySelectorAll(".status-select").forEach((el) => {
      el.addEventListener("change", async () => {
        try {
          await postJSON("/api/jobs/mark", {
            id: el.dataset.id,
            track: el.dataset.track,
            status: el.value,
          });
          await refresh();
        } catch (err) {
          setSyncNote(err.message, true);
        }
      });
    });
  }

  async function loadMail() {
    if (STATIC_MODE) {
      $("mail").innerHTML = mailTable([]);
      $("mailTableCaption").textContent = "Mail is read on your computer after you say yes and press Sync mailbox.";
      return;
    }
    const stage = $("mailStage").value;
    const linked = $("mailLinked").value;
    const data = await getJSON(
      `/api/mail?track=${encodeURIComponent(state.track)}&stage=${encodeURIComponent(stage)}&linked=${encodeURIComponent(linked)}&limit=60`
    );
    $("mail").innerHTML = mailTable(data.events || []);
    $("mailTableCaption").textContent = `${fmt(data.total)} job-related messages in this filter.`;
  }

  function updateSyncButton(sync) {
    const btn = $("btnSync");
    if (!btn) return;
    if (STATIC_MODE) {
      btn.hidden = true;
      return;
    }
    const enabled = !!(state.overview && state.overview.setup && state.overview.setup.mail_enabled);
    btn.hidden = !enabled;
    if (!enabled) return;
    if (sync && sync.running) {
      btn.disabled = true;
      btn.classList.add("busy");
      btn.textContent = "Reading mailbox";
      setSyncNote("This computer is reading your mailbox over IMAP. Mail never comes to us.", true);
    } else {
      btn.disabled = false;
      btn.classList.remove("busy");
      btn.textContent = "Sync mailbox";
      if (sync && sync.error) {
        setSyncNote(`Mailbox sync failed: ${sync.error}`, true);
      } else if (sync && sync.result) {
        const bits = sync.result.map((r) =>
          `${r.track}: ${r.updated} updated, ${r.classified} classified`
        );
        setSyncNote(`Mailbox sync finished on this computer. ${bits.join(" · ")}`, true);
      }
    }
  }

  let pollTimer = null;
  async function pollSync() {
    const sync = await getJSON("/api/sync");
    updateSyncButton(sync);
    if (sync.running) pollTimer = setTimeout(pollSync, 2500);
    else {
      pollTimer = null;
      if (sync.finished_at) await refresh();
    }
  }

  let scoutTimer = null;
  async function scoutJSON(path, opts) {
    if (STATIC_MODE) throw new Error("This page keeps data on this device only.");
    const url = path;
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function pollScout() {
    try {
      const scout = await scoutJSON("/api/scout");
      updateScoutButton(scout);
      if (scout.running) scoutTimer = setTimeout(pollScout, 3000);
      else {
        scoutTimer = null;
        if (scout.finished_at && !STATIC_MODE) await refresh();
        else if (scout.finished_at) {
          updateExcelButton(scout.excel);
          setSyncNote(
            scout.excel && scout.excel.ready
              ? "Job search finished on your computer. Excel is ready — click Download Excel."
              : "Job search finished on your computer. Open the local dashboard to see new matches.",
            true
          );
        }
      }
    } catch (err) {
      scoutTimer = null;
      setSyncNote(err.message, true);
    }
  }

  function googleQueryValue() {
    const el = $("googleQuery");
    return el ? String(el.value || "").trim() : "";
  }

  function persistGoogleQuery(q) {
    const val = String(q || "").trim();
    try {
      if (val) localStorage.setItem("jobAutopilotGoogleQuery", val);
      else localStorage.removeItem("jobAutopilotGoogleQuery");
    } catch (_) {}
    const el = $("googleQuery");
    if (el && el.value.trim() !== val) el.value = val;
  }

  function fillGoogleQuery(setup) {
    const el = $("googleQuery");
    if (!el) return;
    let stored = "";
    try { stored = String(localStorage.getItem("jobAutopilotGoogleQuery") || "").trim(); } catch (_) {}
    if (stored) {
      el.value = stored;
      return;
    }
    if (el.value.trim()) return;
    const roles = (setup && setup.roles) || [];
    const locs = (setup && setup.locations) || [];
    const loc = locs[0] || (setup && setup.location) || "United States";
    const role = roles[0] || "";
    if (!role) return;
    el.value = /job/i.test(role) ? `${role} ${loc}`.trim() : `${role} jobs ${loc}`.trim();
  }

  async function runBrowserScout() {
    const scoutApi = window.JobAutopilotScout;
    if (!scoutApi) throw new Error("Scout script failed to load. Refresh and try again.");
    const stored = storedSetup() || {};
    const setup = (state.overview && state.overview.setup) || setupFromStored(stored) || stored;
    const roles = (setup && setup.roles) || stored.roles || [];
    const googleQuery = googleQueryValue();
    persistGoogleQuery(googleQuery);
    if (!setup || (!roles.length && !googleQuery)) {
      throw new Error("Type a Google search, or save a job title, then press Find jobs.");
    }
    updateScoutButton({ running: true }, { announce: false });
    setSyncNote(
      googleQuery
        ? `Searching Google for “${googleQuery}”, then LinkedIn, Indeed, and Jobright. Your resume stays here.`
        : "Searching LinkedIn, Indeed, Jobright, and Google from this device. Your resume stays here.",
      true
    );
    const result = await scoutApi.run({
      ...setup,
      roles,
      google_query: googleQuery,
      resume_text: (setup && setup.resume_text) || stored.resume_text || "",
    });
    const excel = hydrateBrowserExcel(result.jobs);
    updateScoutButton({
      running: false,
      finished_at: result.meta.finished_at,
      result: { ok: true, excel },
      excel,
    }, { announce: false });
    renderStaticDashboard();
    const n = result.jobs.length;
    const missed = (result.meta.errors || []).length;
    setSyncNote(
      n
        ? `Found ${n} jobs on this device. Excel is ready — tap Download Excel.`
        : `No matches in the last ${setup.lookback_days || 7} days${missed ? " (some boards were blocked)" : ""}. Try another title or a longer look-back.`,
      true
    );
  }

  async function runScout() {
    if (STATIC_MODE) {
      try {
        await runBrowserScout();
      } catch (err) {
        updateScoutButton({ running: false }, { announce: false });
        setSyncNote(err.message || "Could not search from this device.", true);
      }
      return;
    }
    try {
      const scout = await scoutJSON("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ google_query: googleQueryValue() }),
      });
      updateScoutButton(scout);
      if (!scoutTimer) pollScout();
    } catch (err) {
      setSyncNote(err.message, true);
    }
  }

  async function refresh() {
    if (STATIC_MODE) {
      renderStaticDashboard();
      return;
    }
    const data = await loadOverview();
    if (data && data.setup && !data.setup.configured) return;
    await Promise.all([loadPipeline(), loadMail()]);
  }

  $("btnSync").addEventListener("click", async () => {
    if (STATIC_MODE) {
      setSyncNote("Mailbox sync runs on your computer after you say yes, then press Sync mailbox.", true);
      return;
    }
    const ok = window.confirm(
      "Read your mailbox from this computer now?\n\nMail is fetched over IMAP to this machine only. It is not sent to us. Nothing runs unless you press this button."
    );
    if (!ok) return;
    try {
      const sync = await postJSON("/api/sync", {});
      updateSyncButton(sync);
      if (!pollTimer) pollSync();
    } catch (err) {
      setSyncNote(err.message, true);
    }
  });

  $("btnScout").addEventListener("click", runScout);
  if ($("btnScoutInline")) $("btnScoutInline").addEventListener("click", runScout);
  if ($("googleQuery")) {
    $("googleQuery").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        runScout();
      }
    });
    $("googleQuery").addEventListener("change", () => persistGoogleQuery(googleQueryValue()));
  }
  if ($("btnEraseDevice")) {
    $("btnEraseDevice").addEventListener("click", () => {
      const ok = window.confirm(
        "Erase setup and job matches from this device?\n\nThis browser is the only copy. We cannot restore it."
      );
      if (!ok) return;
      ["jobAutopilotSetup", "jobAutopilotJobs", "jobAutopilotScoutMeta", "jobAutopilotGoogleQuery"].forEach((k) => {
        try { localStorage.removeItem(k); } catch (_) { /* ignore */ }
      });
      if (state.excelObjectUrl) {
        URL.revokeObjectURL(state.excelObjectUrl);
        state.excelObjectUrl = null;
      }
      location.hash = "#/setup";
      location.reload();
    });
  }

  $("btnSetupCancel").addEventListener("click", () => {
    location.hash = "#/";
  });
  window.addEventListener("hashchange", () => {
    applyRoute().catch((err) => setSyncNote(err.message, true));
  });
  $("setupForm").addEventListener("submit", saveSetup);
  $("btnWizardNext").addEventListener("click", () => {
    if (validateWizardStep(state.wizardStep)) showWizardStep(state.wizardStep + 1);
  });
  $("btnWizardBack").addEventListener("click", () => showWizardStep(state.wizardStep - 1));
  $("btnAddRole").addEventListener("click", () => addRepeatRow("roleList", "Software Engineer"));
  $("btnAddLocation").addEventListener("click", () => addRepeatRow("locationList", "City, state, Remote, or United States"));
  document.querySelectorAll("#cadenceChoices [data-runs]").forEach((btn) => {
    btn.addEventListener("click", () => syncCadence(btn.dataset.runs));
  });
  const runsInput = document.querySelector('[name="runs_per_day"]');
  if (runsInput) runsInput.addEventListener("input", () => syncCadence(runsInput.value));
  const resumeFile = document.querySelector('[name="resume_file"]');
  if (resumeFile) {
    resumeFile.addEventListener("change", () => {
      const name = resumeFile.files?.[0]?.name;
      const ui = $("fileDropLabel");
      if (ui) ui.textContent = name || "Drop a PDF here, or browse";
    });
  }
  if ($("setupEmail")) {
    $("setupEmail").addEventListener("input", () => {
      const current = ($("mailScanConsent") && $("mailScanConsent").value) || "no";
      setMailConsent(current, { fromEmail: Boolean($("setupEmail").value.trim()) });
    });
  }
  document.querySelectorAll("#mailConsentChoices [data-consent]").forEach((btn) => {
    btn.addEventListener("click", () => setMailConsent(btn.dataset.consent, { fromEmail: true }));
  });
  document.querySelectorAll("#wizardProgress button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dest = Number(btn.dataset.goto);
      if (dest <= state.wizardStep) showWizardStep(dest);
      else if (dest === state.wizardStep + 1 && validateWizardStep(state.wizardStep)) showWizardStep(dest);
    });
  });
  $("setupForm").addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.target.tagName === "TEXTAREA") return;
    if (state.wizardStep < WIZARD_STEPS) {
      ev.preventDefault();
      $("btnWizardNext").click();
    }
  });
  $("scraperType").addEventListener("change", toggleAdzuna);
  if ($("mailProvider")) $("mailProvider").addEventListener("change", toggleImapHost);

  $("statusFilter").addEventListener("change", loadPipeline);
  let searchTimer;
  $("jobSearch").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPipeline, 250);
  });
  $("mailStage").addEventListener("change", loadMail);
  $("mailLinked").addEventListener("change", loadMail);

  function bootStatic() {
    document.body.classList.add("static-web");
    const apis = $("optionalApisBlock");
    if (apis) apis.hidden = true;
    const erase = $("btnEraseDevice");
    if (erase) erase.hidden = false;
    const note = $("pagesNote");
    const setup = setupFromStored(storedSetup());
    if (setup) state.overview = emptyOverview(setup);
    if (note) {
      note.hidden = !!setup;
      note.textContent = "This page never receives your data. Setup and matches stay on this device.";
    }
    applyRoute().catch(() => {
      showScreen("screen-setup");
      document.title = "Set up · Job Autopilot";
    });
  }

  if (STATIC_MODE) bootStatic();
  else {
    refresh()
      .then(() => applyRoute())
      .catch((err) => {
        showScreen("screen-setup");
        $("btnSetupCancel").hidden = true;
        fillSetup(null);
        showWizardStep(1);
        const box = $("setupError");
        box.hidden = false;
        box.textContent = err.message;
      });
  }
})();
