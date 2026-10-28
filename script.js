"use strict";

const API = "/api";
const TOKEN_KEY = "dayzen_token";
const RECORDS_KEY = "dayzen_records_v1";
const FEEDBACK_KEY = "dayzen_feedback_v1";

let currentUser = null;
let tasks = [];
let verifyTimer = null;
let verifyExpiresAt = 0;
let adminUsers = [];
let currentPage = "overview";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (getToken()) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  let body = options.body;

  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body
  });

  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : {};

  if (!response.ok) {
    if (response.status === 401 && getToken()) {
      setToken("");
    }
    throw new Error(result.message || `Request failed (${response.status}).`);
  }

  return result;
}

function showMessage(element, message, type = "success") {
  if (!element) return;
  element.textContent = message;
  element.className = `message ${type}`;
  element.classList.remove("hidden");
}

function hideMessage(element) {
  if (!element) return;
  element.textContent = "";
  element.classList.add("hidden");
}

function showAuthMessage(message, type = "error") {
  showMessage($("#authMessage"), message, type);
}

function showAppMessage(message, type = "success") {
  showMessage($("#appMessage"), message, type);
  window.setTimeout(() => hideMessage($("#appMessage")), 4500);
}

function setBusy(form, busy, label = "Please wait…") {
  if (!form) return;
  const button = $('button[type="submit"]', form);
  if (!button) return;

  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
}

function showPublicPage(page) {
  $("#welcomeScreen").classList.toggle("hidden", page !== "welcome");
  $("#authScreen").classList.toggle("hidden", page !== "auth");
  $("#appScreen").classList.add("hidden");

  if (page === "auth") {
    showAuthForm("login");
    hideMessage($("#authMessage"));
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showAuthForm(name) {
  const formNames = ["login", "signup", "verify", "forgot", "reset"];
  formNames.push("admin");

  formNames.forEach(formName => {
    const form = $(`[data-auth-form="${formName}"]`) ||
      (formName === "admin" ? $("#adminLoginForm") : null);
    if (form) form.classList.add("hidden");
  });

  const selected = $(`[data-auth-form="${name}"]`) ||
    (name === "admin" ? $("#adminLoginForm") : null);

  if (selected) selected.classList.remove("hidden");

  const titles = {
    login: ["Welcome back", "Sign in and continue your day."],
    signup: ["Create your account", "A calmer day starts with one small step."],
    verify: ["Verify your email", "Enter the code sent to your inbox."],
    forgot: ["Forgot your password?", "Request a code to reset your password."],
    reset: ["Choose a new password", "Enter your reset code and new password."],
    admin: ["Administrator login", "Enter your approved admin email and access code."]
  };

  const title = titles[name] || titles.login;
  $("#authTitle").textContent = title[0];
  $("#authSubtitle").textContent = title[1];

  $$("[data-auth-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.authTab === name);
  });

  hideMessage($("#authMessage"));

  if (name === "verify") startVerifyCountdown();
  else stopVerifyCountdown();
}

function startVerifyCountdown() {
  stopVerifyCountdown();
  verifyExpiresAt = Date.now() + 50000;
  const output = $("#verifyCountdown");

  function tick() {
    const remaining = Math.max(0, Math.ceil((verifyExpiresAt - Date.now()) / 1000));
    if (output) {
      output.textContent = remaining > 0
        ? `Code expires in ${remaining} seconds.`
        : "The code may have expired. Please sign up again to request a new code.";
    }

    if (remaining <= 0) {
      stopVerifyCountdown();
    }
  }

  tick();
  verifyTimer = window.setInterval(tick, 1000);
}

function stopVerifyCountdown() {
  if (verifyTimer) window.clearInterval(verifyTimer);
  verifyTimer = null;
}

function saveEmailToInputs(email) {
  ["verifyEmail", "forgotEmail", "resetEmail", "loginEmail"].forEach(id => {
    const input = document.getElementById(id);
    if (input && email) input.value = email;
  });
}

function setTheme(theme) {
  const allowed = ["dark", "light", "ocean"];
  const selected = allowed.includes(theme) ? theme : "dark";

  document.body.dataset.theme = selected;

  if ($("#themeSelect")) $("#themeSelect").value = selected;
  if ($("#settingsTheme")) $("#settingsTheme").value = selected;

  localStorage.setItem("dayzen_theme", selected);
}

function loadTheme() {
  setTheme(localStorage.getItem("dayzen_theme") || "dark");
}

function updateProfile() {
  if (!currentUser) return;

  $("#profileName").textContent = currentUser.name || "DAYZEN member";
  $("#profileCategory").textContent = currentUser.category || "Member";
  $("#profileAvatar").textContent =
    (currentUser.name || "D").trim().charAt(0).toUpperCase();

  const admin = currentUser.role === "admin";
  $("#adminNav").classList.toggle("hidden", !admin);
}

function updateTodayLabel() {
  $("#todayLabel").textContent = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

const pageTitles = {
  overview: "Your overview",
  tasks: "My tasks",
  family: "Family & home",
  calendar: "Calendar",
  health: "Health & wellbeing",
  money: "Money tracker",
  bills: "Bills, EMI & rent",
  goals: "Goals",
  shopping: "Shopping list",
  activities: "Activities & routines",
  feedback: "Your feedback",
  settings: "Settings",
  admin: "Administrator dashboard"
};

function showAppPage(page) {
  const target = $(`[data-app-screen="${page}"]`);

  if (!target) return;

  if (page === "admin" && currentUser?.role !== "admin") {
    showAppMessage("Administrator access only.", "error");
    return;
  }

  currentPage = page;

  $$(".app-page").forEach(section => {
    section.classList.toggle("hidden", section !== target);
  });

  $$("[data-app-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.appPage === page);
  });

  $("#pageHeading").textContent = pageTitles[page] || "DAYZEN";
  $("#sidebar").classList.remove("open");

  if (page === "tasks") loadTasks();
  if (page === "overview") renderOverview();
  if (["family", "calendar", "health", "money", "bills",
       "goals", "shopping", "activities"].includes(page)) {
    renderRecords(page);
  }
  if (page === "feedback") renderFeedback();
  if (page === "admin") loadAdminDashboard();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function showApp(user) {
  currentUser = user;
  $("#welcomeScreen").classList.add("hidden");
  $("#authScreen").classList.add("hidden");
  $("#appScreen").classList.remove("hidden");

  loadTheme();
  updateProfile();
  updateTodayLabel();

  try {
    await loadTasks();
  } catch (error) {
    showAppMessage(error.message, "error");
  }

  showAppPage("overview");
}

async function restoreSession() {
  loadTheme();

  if (!getToken()) {
    showPublicPage("welcome");
    return;
  }

  try {
    const result = await api("/me");
    await showApp(result.user);
  } catch {
    setToken("");
    showPublicPage("welcome");
  }
}

/* ---------------- AUTH FORMS ---------------- */

$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#loginEmail").value.trim().toLowerCase();
  const password = $("#loginPassword").value;

  setBusy(form, true, "Signing in…");
  hideMessage($("#authMessage"));

  try {
    const result = await api("/auth/login", {
      method: "POST",
      body: { email, password }
    });

    setToken(result.token);
    await showApp(result.user);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

$("#signupForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#signupName").value.trim();
  const email = $("#signupEmail").value.trim().toLowerCase();
  const password = $("#signupPassword").value;
  const category = $("#signupCategory").value;

  if (password.length < 8) {
    showAuthMessage("Your password must have at least 8 characters.");
    return;
  }

  setBusy(form, true, "Sending verification code…");
  hideMessage($("#authMessage"));

  try {
    const result = await api("/auth/signup", {
      method: "POST",
      body: { name, email, password, category }
    });

    saveEmailToInputs(email);
    $("#verifyOtp").value = "";
    showAuthForm("verify");
    showAuthMessage(result.message, "success");
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

$("#verifyForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#verifyEmail").value.trim().toLowerCase();
  const otp = $("#verifyOtp").value.trim();

  setBusy(form, true, "Verifying…");

  try {
    const result = await api("/auth/verify-email", {
      method: "POST",
      body: { email, otp }
    });

    stopVerifyCountdown();
    showAuthForm("login");
    saveEmailToInputs(email);
    showAuthMessage(result.message, "success");
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

$("#forgotForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#forgotEmail").value.trim().toLowerCase();

  setBusy(form, true, "Requesting code…");

  try {
    const result = await api("/auth/forgot-password", {
      method: "POST",
      body: { email }
    });

    saveEmailToInputs(email);
    showAuthForm("reset");
    showAuthMessage(result.message, "success");
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

$("#resetForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#resetEmail").value.trim().toLowerCase();
  const otp = $("#resetOtp").value.trim();
  const newPassword = $("#newPassword").value;

  if (newPassword.length < 8) {
    showAuthMessage("Your new password must have at least 8 characters.");
    return;
  }

  setBusy(form, true, "Resetting password…");

  try {
    const result = await api("/auth/reset-password", {
      method: "POST",
      body: { email, otp, newPassword }
    });

    showAuthForm("login");
    saveEmailToInputs(email);
    $("#loginPassword").value = "";
    showAuthMessage(result.message, "success");
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

$("#adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const email = $("#adminEmail").value.trim().toLowerCase();
  const adminCode = $("#adminCode").value;

  setBusy(form, true, "Checking access…");

  try {
    const result = await api("/admin/login", {
      method: "POST",
      body: { email, adminCode }
    });

    setToken(result.token);
    await showApp(result.user);
    showAppPage("admin");
    showAppMessage(result.message);
  } catch (error) {
    showAuthMessage(error.message);
  } finally {
    setBusy(form, false);
  }
});

/* ---------------- TASKS ---------------- */

async function loadTasks() {
  const result = await api("/tasks");
  tasks = Array.isArray(result.tasks) ? result.tasks : [];
  renderTasks();
  updateTaskStats();
  return tasks;
}

function taskCard(task) {
  const completed = Boolean(task.completed);
  const deadline = task.deadlineAt
    ? new Date(task.deadlineAt).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "";

  return `
    <article class="task-item ${completed ? "completed" : ""}">
      <div style="min-width:0;flex:1">
        <strong class="task-title">${escapeHTML(task.title)}</strong>
        <p class="muted small">${escapeHTML(task.category || "Personal")} · ${escapeHTML(task.duration || "")}</p>
        ${task.time ? `<p class="muted small">Preferred time: ${escapeHTML(task.time)}</p>` : ""}
        ${deadline ? `<p class="muted small">Deadline: ${escapeHTML(deadline)}</p>` : ""}
        <div class="row" style="justify-content:flex-start;flex-wrap:wrap">
          <span class="tag">${completed ? "Completed" : "Pending"}</span>
          ${task.notification && !completed ? '<span class="tag">Email reminders on</span>' : ""}
          ${task.attachment ? `<span class="tag">Attachment: ${escapeHTML(task.attachment.originalName)}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        <button class="btn small-btn" data-task-toggle="${escapeHTML(task.id)}">${completed ? "Undo" : "Complete"}</button>
        ${task.attachment ? `<button class="btn small-btn" data-task-download="${escapeHTML(task.id)}">Download</button>` : ""}
        <button class="btn small-btn danger" data-task-delete="${escapeHTML(task.id)}">Delete</button>
      </div>
    </article>`;
}

function renderTasks() {
  const list = $("#taskList");
  if (!list) return;

  const filter = $("#taskFilter")?.value || "all";
  const filtered = tasks.filter(task => {
    if (filter === "pending") return !task.completed;
    if (filter === "completed") return Boolean(task.completed);
    return true;
  });

  list.innerHTML = filtered.length
    ? filtered.map(taskCard).join("")
    : '<div class="empty">No tasks here yet. Add a task to get started.</div>';

  const overview = $("#overviewTasks");
  if (overview) {
    const latest = [...tasks]
      .filter(task => !task.completed)
      .slice(-4)
      .reverse();

    overview.innerHTML = latest.length
      ? latest.map(taskCard).join("")
      : '<div class="empty">You are all caught up. Add a task whenever you need to.</div>';
  }
}

function updateTaskStats() {
  const total = tasks.length;
  const completed = tasks.filter(task => task.completed).length;

  $("#totalTasks").textContent = total;
  $("#completedTasks").textContent = completed;
  $("#pendingTasks").textContent = total - completed;
}

function renderOverview() {
  updateTaskStats();
  renderTasks();
}

$("#taskForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const title = $("#taskTitle").value.trim();
  const category = $("#taskCategory").value;
  const duration = $("#taskDuration").value.trim() || "30 minutes";
  const time = $("#taskTime").value.trim();
  const deadlineValue = $("#taskDeadline").value;
  const notification = $("#taskNotification").checked;
  const file = $("#taskAttachment").files[0];

  if (notification && !deadlineValue) {
    showAppMessage("Add a deadline before enabling email reminders.", "error");
    return;
  }

  const deadlineAt = deadlineValue
    ? new Date(deadlineValue).toISOString()
    : null;

  setBusy(form, true, "Saving task…");

  try {
    const result = await api("/tasks", {
      method: "POST",
      body: { title, category, duration, time, deadlineAt, notification }
    });

    if (file) {
      const data = new FormData();
      data.append("file", file);

      await api(`/tasks/${encodeURIComponent(result.task.id)}/attachment`, {
        method: "POST",
        body: data
      });
    }

    form.reset();
    $("#taskDuration").value = "30 minutes";
    await loadTasks();
    showAppMessage("Task saved successfully.");
  } catch (error) {
    showAppMessage(error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

$("#taskFilter").addEventListener("change", renderTasks);

document.addEventListener("click", async event => {
  const toggleButton = event.target.closest("[data-task-toggle]");
  const deleteButton = event.target.closest("[data-task-delete]");
  const downloadButton = event.target.closest("[data-task-download]");

  if (toggleButton) {
    const id = toggleButton.dataset.taskToggle;
    const task = tasks.find(item => item.id === id);
    if (!task) return;

    toggleButton.disabled = true;
    try {
      await api(`/tasks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { completed: !task.completed }
      });
      await loadTasks();
      showAppMessage(task.completed ? "Task marked pending." : "Task completed.");
    } catch (error) {
      showAppMessage(error.message, "error");
    } finally {
      toggleButton.disabled = false;
    }
  }

  if (deleteButton) {
    const id = deleteButton.dataset.taskDelete;
    if (!confirm("Delete this task permanently?")) return;

    try {
      await api(`/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadTasks();
      showAppMessage("Task deleted.");
    } catch (error) {
      showAppMessage(error.message, "error");
    }
  }

  if (downloadButton) {
    try {
      const response = await fetch(
        `${API}/tasks/${encodeURIComponent(downloadButton.dataset.taskDownload)}/attachment`,
        { headers: { Authorization: `Bearer ${getToken()}` } }
      );

      if (!response.ok) {
        let message = "Could not download attachment.";
        try {
          const data = await response.json();
          message = data.message || message;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "dayzen-task-attachment";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      showAppMessage(error.message, "error");
    }
  }
});

/* ---------------- PERSONAL RECORDS ---------------- */

function getRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(RECORDS_KEY) || "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function saveRecords(records) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

$$("[data-record-form]").forEach(form => {
  form.addEventListener("submit", event => {
    event.preventDefault();

    if (!currentUser) {
      showAppMessage("Please log in first.", "error");
      return;
    }

    const data = Object.fromEntries(new FormData(form).entries());
    const page = form.dataset.recordForm;

    const record = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      userId: currentUser.id,
      page,
      title: String(data.title || "").trim(),
      type: String(data.type || ""),
      amount: String(data.amount || ""),
      date: String(data.date || ""),
      time: String(data.time || ""),
      details: String(data.details || "").trim(),
      createdAt: new Date().toISOString()
    };

    if (!record.title) {
      showAppMessage("Enter a title first.", "error");
      return;
    }

    const records = getRecords();
    records.push(record);
    saveRecords(records);

    form.reset();
    renderRecords(page);
    showAppMessage("Your record was saved in this browser.");
  });
});

function recordsForPage(page) {
  return getRecords().filter(record =>
    record.userId === currentUser?.id && record.page === page
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderRecords(page) {
  const container = document.getElementById(`records-${page}`);
  if (!container) return;

  const records = recordsForPage(page);

  if (!records.length) {
    container.innerHTML = '<div class="empty">No saved records yet.</div>';
    return;
  }

  container.innerHTML = records.map(record => `
    <article class="record-item">
      <div style="flex:1;min-width:0">
        <strong>${escapeHTML(record.title)}</strong>
        <p class="muted small">
          ${escapeHTML(record.type || "")}
          ${record.date ? ` · ${escapeHTML(record.date)}` : ""}
          ${record.time ? ` · ${escapeHTML(record.time)}` : ""}
          ${record.amount ? ` · ₹${escapeHTML(record.amount)}` : ""}
        </p>
        ${record.details ? `<p class="muted small">${escapeHTML(record.details)}</p>` : ""}
      </div>
      <button class="btn small-btn danger" data-record-delete="${escapeHTML(record.id)}">Delete</button>
    </article>
  `).join("");
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-record-delete]");
  if (!button) return;

  const id = button.dataset.recordDelete;
  if (!confirm("Delete this record?")) return;

  saveRecords(getRecords().filter(record =>
    !(record.id === id && record.userId === currentUser?.id)
  ));

  ["family", "calendar", "health", "money", "bills",
   "goals", "shopping", "activities"].forEach(renderRecords);

  showAppMessage("Record deleted.");
});

/* ---------------- FEEDBACK ---------------- */

function getFeedback() {
  try {
    const items = JSON.parse(localStorage.getItem(FEEDBACK_KEY) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

$("#feedbackForm").addEventListener("submit", event => {
  event.preventDefault();
  if (!currentUser) return;

  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());

  const items = getFeedback();
  items.push({
    id: `${Date.now()}-${Math.random()}`,
    userId: currentUser.id,
    rating: Number(data.rating),
    comments: String(data.comments || "").trim(),
    createdAt: new Date().toISOString()
  });

  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(items));
  form.reset();
  renderFeedback();
  showAppMessage("Thank you for your feedback.");
});

function renderFeedback() {
  const container = $("#feedbackList");
  if (!container || !currentUser) return;

  const items = getFeedback().filter(item => item.userId === currentUser.id);
  container.innerHTML = items.length
    ? items.map(item => `
      <article class="record-item">
        <div><strong>${"★".repeat(item.rating)}${"☆".repeat(5 - item.rating)}</strong>
        <p class="muted small">${escapeHTML(item.comments)}</p></div>
      </article>`).join("")
    : '<div class="empty">Your submitted feedback will appear here.</div>';
}

/* ---------------- ADMIN DASHBOARD ---------------- */

async function loadAdminDashboard() {
  if (currentUser?.role !== "admin") {
    $("#adminRestricted").classList.remove("hidden");
    $("#adminDashboard").classList.add("hidden");
    return;
  }

  $("#adminRestricted").classList.add("hidden");
  $("#adminDashboard").classList.remove("hidden");
  $("#adminLoading").classList.remove("hidden");
  $("#adminError").classList.add("hidden");

  try {
    const result = await api("/admin/dashboard");

    $("#adminTotalUsers").textContent = result.stats?.totalUsers ?? 0;
    $("#adminTotalTasks").textContent = result.stats?.totalTasks ?? 0;
    $("#adminCompletedTasks").textContent = result.stats?.completedTasks ?? 0;

    adminUsers = Array.isArray(result.users) ? result.users : [];
    renderAdminUsers();
  } catch (error) {
    showMessage($("#adminError"), error.message, "error");
  } finally {
    $("#adminLoading").classList.add("hidden");
  }
}

function renderAdminUsers() {
  const container = $("#adminUsers");
  const query = ($("#adminSearch").value || "").trim().toLowerCase();

  const filtered = adminUsers.filter(user =>
    `${user.name} ${user.email} ${user.category}`.toLowerCase().includes(query)
  );

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No matching users found.</div>';
    return;
  }

  container.innerHTML = filtered.map(user => `
    <article class="user-item">
      <div style="min-width:0;flex:1">
        <strong>${escapeHTML(user.name || "Unnamed user")}</strong>
        <p class="muted small">${escapeHTML(user.email)}</p>
        <p class="muted small">${escapeHTML(user.category)} · ${user.taskCount || 0} tasks · ${escapeHTML(user.role)}</p>
      </div>
      <button class="btn small-btn" data-admin-user="${escapeHTML(user.id)}">View tasks</button>
    </article>
  `).join("");
}

$("#adminSearch").addEventListener("input", renderAdminUsers);

document.addEventListener("click", event => {
  const button = event.target.closest("[data-admin-user]");
  if (!button) return;

  const user = adminUsers.find(item => item.id === button.dataset.adminUser);
  if (!user) return;

  const details = $("#adminUserDetails");
  details.innerHTML = `
    <div class="admin-user-details">
      <div class="row">
        <div><h2>${escapeHTML(user.name)}</h2><p class="muted small">${escapeHTML(user.email)}</p></div>
        <button class="btn small-btn" id="closeAdminDetails">Close</button>
      </div>
      <p class="muted small">Category: ${escapeHTML(user.category)} · Account: ${escapeHTML(user.role)}</p>
      <h3>Tasks</h3>
      <div class="row" style="justify-content:flex-start;flex-wrap:wrap">
        <button class="btn small-btn" data-admin-task-filter="all">All</button>
        <button class="btn small-btn" data-admin-task-filter="completed">Completed</button>
        <button class="btn small-btn" data-admin-task-filter="pending">Pending</button>
      </div>
      <div id="adminUserTasks"></div>
    </div>
  `;

  details.dataset.userId = user.id;
  renderAdminUserTasks("all");
});

function renderAdminUserTasks(filter) {
  const user = adminUsers.find(item => item.id === $("#adminUserDetails").dataset.userId);
  const container = $("#adminUserTasks");
  if (!user || !container) return;

  const filtered = (user.tasks || []).filter(task => {
    if (filter === "completed") return task.completed;
    if (filter === "pending") return !task.completed;
    return true;
  });

  container.innerHTML = filtered.length
    ? filtered.map(task => `
      <article class="record-item">
        <div><strong>${escapeHTML(task.title)}</strong>
        <p class="muted small">${escapeHTML(task.category || "Personal")} · ${task.completed ? "Completed" : "Pending"}</p></div>
      </article>`).join("")
    : '<div class="empty">No tasks in this category.</div>';
}

document.addEventListener("click", event => {
  const filter = event.target.closest("[data-admin-task-filter]");
  if (filter) renderAdminUserTasks(filter.dataset.adminTaskFilter);

  if (event.target.closest("#closeAdminDetails")) {
    $("#adminUserDetails").innerHTML = "";
    $("#adminUserDetails").removeAttribute("data-user-id");
  }
});

/* ---------------- EXPORT DATA AS PDF ---------------- */

$("#exportData")?.addEventListener("click", exportDayzenAsPDF);

function exportDayzenAsPDF() {
  if (!currentUser) {
    showAppMessage("Please log in before exporting your data.", "error");
    return;
  }

  // Collect this user's personal records.
  const personalRecords = getRecords().filter(
    record => record.userId === currentUser.id
  );

  const feedback = getFeedback().filter(
    item => item.userId === currentUser.id
  );

  // Collect the task data currently loaded from the server.
  const taskData = tasks.map(task => ({
    title: task.title || "",
    category: task.category || "Personal",
    duration: task.duration || "",
    time: task.time || "",
    deadline: task.deadlineAt || "",
    completed: Boolean(task.completed),
    emailReminders: Boolean(task.notification),
    attachment: task.attachment?.originalName || ""
  }));

  const sections = [
    {
      title: "Profile",
      content: {
        name: currentUser.name || "",
        email: currentUser.email || "",
        category: currentUser.category || ""
      }
    },
    {
      title: "Tasks",
      content: taskData
    },
    {
      title: "Personal Records",
      content: personalRecords.map(record => ({
        section: record.page,
        title: record.title,
        type: record.type,
        amount: record.amount,
        date: record.date,
        time: record.time,
        details: record.details
      }))
    },
    {
      title: "Feedback",
      content: feedback.map(item => ({
        rating: item.rating,
        comments: item.comments,
        submittedAt: item.createdAt
      }))
    }
  ];

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    showAppMessage(
      "Allow pop-ups for DAYZEN, then click Export my data as PDF again.",
      "error"
    );
    return;
  }

  const safe = value => escapeHTML(value);

  const formatValue = value => {
    if (value === null || value === undefined || value === "") {
      return "—";
    }

    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }

    return String(value);
  };

  const sectionsHTML = sections.map(section => {
    let contentHTML = "";

    if (Array.isArray(section.content)) {
      if (!section.content.length) {
        contentHTML = "<p>No records available.</p>";
      } else {
        contentHTML = section.content.map((item, index) => `
          <div class="record">
            <h3>${safe(item.title || `${section.title} ${index + 1}`)}</h3>
            <table>
              ${Object.entries(item).map(([key, value]) => `
                <tr>
                  <th>${safe(key.replace(/([A-Z])/g, " $1"))}</th>
                  <td>${safe(formatValue(value))}</td>
                </tr>
              `).join("")}
            </table>
          </div>
        `).join("");
      }
    } else {
      contentHTML = `
        <table>
          ${Object.entries(section.content).map(([key, value]) => `
            <tr>
              <th>${safe(key)}</th>
              <td>${safe(formatValue(value))}</td>
            </tr>
          `).join("")}
        </table>
      `;
    }

    return `
      <section>
        <h2>${safe(section.title)}</h2>
        ${contentHTML}
      </section>
    `;
  }).join("");

  const reportHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>DAYZEN - My Personal Data</title>
      <style>
        * {
          box-sizing: border-box;
        }

        body {
          font-family: Arial, sans-serif;
          max-width: 900px;
          margin: 0 auto;
          padding: 32px;
          color: #29263b;
          background: #ffffff;
          line-height: 1.6;
        }

        h1 {
          color: #7561ce;
          margin-bottom: 5px;
        }

        .subtitle {
          color: #666;
          margin-bottom: 28px;
        }

        h2 {
          color: #51429b;
          border-bottom: 2px solid #e5e0ff;
          padding-bottom: 8px;
          margin-top: 30px;
        }

        h3 {
          font-size: 16px;
          overflow-wrap: anywhere;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 18px;
          table-layout: fixed;
        }

        th, td {
          border: 1px solid #e5e2ef;
          padding: 9px;
          text-align: left;
          vertical-align: top;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }

        th {
          width: 30%;
          background: #f4f1ff;
        }

        .record {
          margin: 18px 0;
          padding: 14px;
          border: 1px solid #e5e2ef;
          border-radius: 8px;
          break-inside: avoid;
        }

        .print-button {
          background: #7561ce;
          color: white;
          border: none;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 15px;
          cursor: pointer;
          margin: 16px 0;
        }

        @media print {
          body {
            padding: 0;
          }

          .print-button {
            display: none;
          }

          section {
            break-inside: auto;
          }
        }
      </style>
    </head>
    <body>
      <h1>DAYZEN — My Personal Data</h1>
      <p class="subtitle">
        Exported on ${safe(new Date().toLocaleString("en-IN"))}
      </p>

      <button class="print-button" onclick="window.print()">
        Print / Save as PDF
      </button>

      ${sectionsHTML}

      <p class="subtitle">
        This report contains the personal records, feedback and tasks
        available to your DAYZEN account at the time of export.
      </p>

      <script>
        window.onload = function () {
          window.focus();
          window.print();
        };
      <\/script>
    </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(reportHTML);
  printWindow.document.close();

  showAppMessage(
    "Your report is ready. In the print window, select Save as PDF."
  );
}

/* ---------------- NAVIGATION AND SETTINGS ---------------- */

document.addEventListener("click", event => {
  const openAuth = event.target.closest("[data-open-auth]");
  if (openAuth) {
    showPublicPage("auth");
    showAuthForm(openAuth.dataset.openAuth === "signup" ? "signup" : "login");
    return;
  }

  const publicPage = event.target.closest("[data-page]");
  if (publicPage) {
    showPublicPage(publicPage.dataset.page || "welcome");
    return;
  }

  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) {
    showAuthForm(authTab.dataset.authTab);
    return;
  }

  const adminButton = event.target.closest("[data-show-admin-login]");
  if (adminButton) {
    showPublicPage("auth");
    showAuthForm("admin");
    return;
  }

  const appPage = event.target.closest("[data-app-page]");
  if (appPage) {
    showAppPage(appPage.dataset.appPage);
    return;
  }

  const logoutButton = event.target.closest('[data-action="logout"]');
  if (logoutButton) logout();
});

$("#themeSelect").addEventListener("change", event => setTheme(event.target.value));
$("#settingsTheme").addEventListener("change", event => setTheme(event.target.value));

$("#reduceMotion").addEventListener("change", event => {
  document.body.style.setProperty(
    "--motion-duration",
    event.target.checked ? "0s" : ".25s"
  );
  document.body.classList.toggle("reduce-motion", event.target.checked);
});

$("#menuToggle").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

async function logout() {
  try {
    if (getToken()) {
      await api("/auth/logout", { method: "POST" });
    }
  } catch {
    // Clear the local session even if the server cannot be reached.
  }

  setToken("");
  currentUser = null;
  tasks = [];
  stopVerifyCountdown();
  showPublicPage("welcome");
}

/* ---------------- STARTUP ---------------- */

document.addEventListener("DOMContentLoaded", restoreSession);

