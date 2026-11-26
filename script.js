/* =========================================================
   Mental Health Score Predictor – frontend logic
   Talks to the FastAPI backend: POST {API_BASE}/predict
   ========================================================= */
(() => {
  "use strict";

  const API_BASE = "https://mental-health-score-1-k0n8.onrender.com";// backend link
  const REQUEST_TIMEOUT_MS = 15000;

  const TOP_COUNTRIES = ["India", "USA", "Canada", "Australia", "UK", "Germany", "Mexico", "Turkey", "France", "Other"];

  // Mirrors the Pydantic model's constraints (client-side pre-validation)
  const RULES = {
    age:                     { type: "int",   min: 10, max: 100, label: "Age" },
    gender:                  { type: "enum",  label: "Gender" },
    country:                 { type: "text",  label: "Country" },
    academic_level:          { type: "enum",  label: "Academic level" },
    most_used_platform:      { type: "enum",  label: "Most used platform" },
    purpose_of_use:          { type: "enum",  label: "Purpose of use" },
    avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Average daily usage" },
    daily_unlocks:           { type: "int",   min: 0, label: "Daily unlocks" },
    study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
    physical_activity_hours: { type: "float", min: 0, max: 2,  label: "Physical activity" },
    sleep_hours_per_night:   { type: "float", min: 0, max: 24, label: "Sleep hours" },
    stress_level:            { type: "enum",  label: "Stress level" },
  };

  // ---------- DOM ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const form = $("#predict-form");
  const submitBtn = $("#submit-btn");
  const resetBtn = $("#reset-btn");
  const retryBtn = $("#retry-btn");
  const formAlert = $("#form-alert");
  const states = {
    idle: $("#state-idle"),
    loading: $("#state-loading"),
    success: $("#state-success"),
    error: $("#state-error"),
  };

  // ---------- Init ----------
  $("#api-url").textContent = API_BASE;
  $("#country-list").innerHTML = TOP_COUNTRIES.map((c) => `<option value="${c}"></option>`).join("");
  initSliders();
  checkApi();

  form.addEventListener("submit", onSubmit);
  resetBtn.addEventListener("click", resetAll);
  retryBtn.addEventListener("click", () => form.requestSubmit());
  form.addEventListener("input", (e) => clearFieldError(e.target.closest(".field")));
  form.addEventListener("change", (e) => clearFieldError(e.target.closest(".field")));

  // ---------- UI helpers ----------
  function showState(name) {
    Object.entries(states).forEach(([key, el]) => (el.hidden = key !== name));
    // restart animation
    const el = states[name];
    el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  }

  function setLoading(isLoading) {
    submitBtn.disabled = isLoading;
    submitBtn.classList.toggle("loading", isLoading);
    $(".btn-label", submitBtn).textContent = isLoading ? "Predicting…" : "Predict score";
  }

  function showFormAlert(msg) {
    formAlert.textContent = msg;
    formAlert.hidden = !msg;
  }

  function setFieldError(name, msg) {
    const field = $(`.field[data-field="${name}"]`);
    if (!field) return false;
    field.classList.add("invalid");
    $(".error-msg", field).textContent = msg;
    return true;
  }

  function clearFieldError(field) {
    if (!field) return;
    field.classList.remove("invalid");
    $(".error-msg", field).textContent = "";
  }

  function clearAllErrors() {
    $$(".field").forEach(clearFieldError);
    showFormAlert("");
  }

  // ---------- Sliders (kept in sync with number inputs) ----------
  function initSliders() {
    $$('input[type="range"]').forEach((range) => {
      const number = $(`#${range.dataset.sync}`);
      const badge = $(`.val[data-for="${range.dataset.sync}"]`);
      const paint = () => {
        const pct = ((range.value - range.min) / (range.max - range.min)) * 100;
        range.style.setProperty("--fill", pct + "%");
        if (badge) badge.textContent = number.value === "" ? "" : `${number.value} h`;
      };
      range.addEventListener("input", () => { number.value = range.value; paint(); clearFieldError(number.closest(".field")); });
      number.addEventListener("input", () => {
        if (number.value !== "") range.value = Math.min(Math.max(number.value, range.min), range.max);
        paint();
      });
      paint();
    });
  }

  function repaintSliders() {
    $$('input[type="range"]').forEach((r) => r.dispatchEvent(new Event("paint")));
    $$('input[type="range"]').forEach((range) => {
      const number = $(`#${range.dataset.sync}`);
      number.dispatchEvent(new Event("input"));
    });
  }

  // ---------- Validation ----------
  function collectData() {
    const fd = new FormData(form);
    const data = {};
    const errors = {};

    for (const [key, rule] of Object.entries(RULES)) {
      const raw = (fd.get(key) ?? "").toString().trim();

      if (raw === "") { errors[key] = `${rule.label} is required.`; continue; }

      if (rule.type === "int" || rule.type === "float") {
        const num = Number(raw);
        if (Number.isNaN(num)) { errors[key] = "Enter a valid number."; continue; }
        if (rule.type === "int" && !Number.isInteger(num)) { errors[key] = "Must be a whole number."; continue; }
        if (rule.min !== undefined && num < rule.min) { errors[key] = `Must be at least ${rule.min}.`; continue; }
        if (rule.max !== undefined && num > rule.max) { errors[key] = `Must be at most ${rule.max}.`; continue; }
        data[key] = num;
      } else {
        data[key] = raw;
      }
    }
    return { data, errors };
  }

  // ---------- Submit ----------
  async function onSubmit(e) {
    e.preventDefault();
    clearAllErrors();

    const { data, errors } = collectData();
    const errorKeys = Object.keys(errors);
    if (errorKeys.length) {
      errorKeys.forEach((k) => setFieldError(k, errors[k]));
      showFormAlert("Please fix the highlighted fields and try again.");
      const first = $(".field.invalid");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      $("input, select", first)?.focus({ preventScroll: true });
      return;
    }

    setLoading(true);
    showState("loading");
    if (window.matchMedia("(max-width: 900px)").matches) states.loading.closest(".card").scrollIntoView({ behavior: "smooth", block: "center" });

    try {
      const result = await predict(data);
      renderResult(result.predicted_mental_health_score, data);
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  async function predict(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === "AbortError") throw { kind: "timeout" };
      throw { kind: "network" };
    } finally {
      clearTimeout(timer);
    }

    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }

    if (res.ok) {
      if (!body || typeof body.predicted_mental_health_score !== "number") throw { kind: "badresponse" };
      return body;
    }
    if (res.status === 422) throw { kind: "validation", detail: body?.detail };
    throw { kind: "server", status: res.status, detail: body?.detail };
  }

  // ---------- Results ----------
  function band(score) {
    if (score >= 7) return { cls: "good", label: "Healthy range", text: "The model estimates a relatively strong mental health score for this profile." };
    if (score >= 5) return { cls: "mid", label: "Moderate range", text: "The model estimates a moderate score. Habits like sleep, activity and screen time can all play a role." };
    return { cls: "low", label: "Needs attention", text: "The model estimates a lower score for this profile. Consider healthier routines and support if needed." };
  }

  function renderResult(score, input) {
    const b = band(score);
    const badge = $("#result-band");
    badge.textContent = b.label;
    badge.className = `badge badge-result ${b.cls}`;
    $("#result-text").textContent = b.text;

    const items = [
      ["Daily usage", `${input.avg_daily_usage_hours} h`],
      ["Sleep", `${input.sleep_hours_per_night} h`],
      ["Stress", input.stress_level],
      ["Platform", input.most_used_platform],
    ];
    $("#result-summary").innerHTML = items.map(([k, v]) => `<li><span>${k}</span><b>${escapeHtml(String(v))}</b></li>`).join("");

    showState("success");

    // animate gauge + counter (scale assumed 0–10)
    const fill = $("#gauge-fill");
    const circumference = 2 * Math.PI * 84;
    fill.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      fill.style.strokeDashoffset = circumference * (1 - Math.min(Math.max(score / 10, 0), 1));
    }));
    countUp($("#score-value"), score, 1200);

    if (window.matchMedia("(max-width: 900px)").matches) $("#result-card").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function countUp(el, target, duration) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(2);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---------- Errors ----------
  function handleError(err) {
    let title = "Something went wrong";
    let text = "An unexpected error occurred. Please try again.";

    switch (err.kind) {
      case "validation": {
        title = "Please check your inputs";
        const list = Array.isArray(err.detail) ? err.detail : [];
        const unmapped = [];
        list.forEach((d) => {
          const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
          const msg = prettifyMsg(d.msg);
          if (!(field && setFieldError(field, msg))) unmapped.push(msg);
        });
        text = "The server rejected some values. The affected fields are highlighted in the form.";
        showFormAlert("The server found problems with some inputs: " + (list.length ? "see highlighted fields." : "please review your entries.") + (unmapped.length ? " " + unmapped.join(" ") : ""));
        $(".field.invalid")?.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
      case "network":
        title = "Can't reach the server";
        text = `Make sure your FastAPI backend is running at ${API_BASE} (uvicorn main:app --port 8000 --reload) and try again.`;
        checkApi();
        break;
      case "timeout":
        title = "Request timed out";
        text = "The server took too long to respond. Please try again in a moment.";
        break;
      case "server":
        title = `Server error (${err.status})`;
        text = typeof err.detail === "string" ? err.detail : "The backend failed while making the prediction. Check the server logs for details (e.g. an unseen category or model mismatch).";
        break;
      case "badresponse":
        title = "Unexpected response";
        text = "The server replied, but not with a prediction score.";
        break;
      default:
        console.error(err);
    }

    $("#error-title").textContent = title;
    $("#error-text").textContent = text;
    showState("error");
  }

  function prettifyMsg(msg = "Invalid value") {
    return msg.charAt(0).toUpperCase() + msg.slice(1) + (msg.endsWith(".") ? "" : ".");
  }

  // ---------- Reset / API health ----------
  function resetAll() {
    form.reset();
    clearAllErrors();
    repaintSliders();
    showState("idle");
  }

  async function checkApi() {
    const badge = $("#api-status");
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 4000);
      const res = await fetch(`${API_BASE}/`, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error();
      badge.textContent = "online"; badge.className = "api-status online";
    } catch {
      badge.textContent = "offline"; badge.className = "api-status offline";
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
})();
