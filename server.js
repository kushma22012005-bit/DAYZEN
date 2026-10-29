

require("dotenv").config();



const express = require("express");

const path = require("path");

const fs = require("fs");

const crypto = require("crypto");

const bcrypt = require("bcryptjs");

const nodemailer = require("nodemailer");

const rateLimit = require("express-rate-limit");

const multer = require("multer");



const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;



app.use(express.json({ limit: "1mb" }));

app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));



const DATA_DIR = path.join(__dirname, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");

const UPLOAD_DIR = path.join(DATA_DIR, "task-attachments");



for (const directory of [DATA_DIR, UPLOAD_DIR]) {

  if (!fs.existsSync(directory)) {

    fs.mkdirSync(directory, { recursive: true });

  }

}



if (!fs.existsSync(USERS_FILE)) {

  fs.writeFileSync(USERS_FILE, "[]", "utf8");

}



function readUsers() {

  try {

    const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));

    return Array.isArray(users) ? users : [];

  } catch (error) {

    console.error("Could not read users.json:", error.message);

    return [];

  }

}



function saveUsers(users) {

  const temporaryFile = USERS_FILE + ".tmp";

  fs.writeFileSync(temporaryFile, JSON.stringify(users, null, 2), "utf8");

  fs.renameSync(temporaryFile, USERS_FILE);

}



const allowedExtensions = new Set([

  ".pdf", ".doc", ".docx", ".ppt", ".pptx",

  ".xls", ".xlsx", ".txt", ".csv",

  ".jpg", ".jpeg", ".png", ".zip"

]);



const storage = multer.diskStorage({

  destination: (req, file, cb) => cb(null, UPLOAD_DIR),

  filename: (req, file, cb) => {

    cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase());

  }

});



const upload = multer({

  storage,

  limits: { fileSize: 15 * 1024 * 1024 },

  fileFilter: (req, file, cb) => {

    if (!allowedExtensions.has(path.extname(file.originalname).toLowerCase())) {

      return cb(new Error("This file type is not supported."));

    }

    cb(null, true);

  }

});



const otpStore = new Map();

const sessions = new Map();



const EMAIL_USER = process.env.EMAIL_USER;

const EMAIL_APP_PASSWORD = process.env.EMAIL_APP_PASSWORD;



const transporter = nodemailer.createTransport({

  service: "gmail",

  auth: {

    user: EMAIL_USER,

    pass: EMAIL_APP_PASSWORD

  }

});



if (EMAIL_USER && EMAIL_APP_PASSWORD) {

  transporter.verify()

    .then(() => console.log("DAYZEN email connection successful."))

    .catch(error => console.error("Email connection failed:", error.message));

} else {

  console.warn("Email settings missing. Check your .env file.");

}



const otpLimiter = rateLimit({

  windowMs: 15 * 60 * 1000,

  limit: 10,

  standardHeaders: true,

  legacyHeaders: false,

  message: { message: "Too many attempts. Please try again later." }

});



function cleanEmail(email) {

  return String(email || "").trim().toLowerCase();

}



function validEmail(email) {

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

}



function escapeHtml(value) {

  return String(value ?? "").replace(/[&<>"']/g, char => ({

    "&": "&amp;", "<": "&lt;", ">": "&gt;",

    '"': "&quot;", "'": "&#39;"

  })[char]);

}



function makeOtp() {

  return String(crypto.randomInt(100000, 1000000));

}



function storeOtp(email, purpose, extra = {}) {

  const otp = makeOtp();

  otpStore.set(`${purpose}:${email}`, {

    otp,

    expiresAt: Date.now() + 50000,

    attempts: 0,

    ...extra

  });

  return otp;

}



async function sendOtpEmail(email, otp, purpose) {

  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {

    throw new Error("Email settings are missing in .env.");

  }



  const reset = purpose === "reset";

  const heading = reset ? "Reset your password" : "Verify your email";

  const description = reset

    ? "Use this code to reset your DAYZEN password."

    : "Use this code to verify your DAYZEN account.";



  await transporter.sendMail({

    from: `"DAYZEN" <${EMAIL_USER}>`,

    to: email,

    subject: `DAYZEN - ${heading}`,

    text: `${heading}\n${description}\nYour code: ${otp}\nThis code expires in 50 seconds.`,

    html: `<div style="font-family:Arial;padding:25px">

      <h1 style="color:#7464e8">DAYZEN</h1>

      <h2>${heading}</h2><p>${description}</p>

      <h1 style="letter-spacing:8px">${escapeHtml(otp)}</h1>

      <p>This code expires in 50 seconds.</p></div>`

  });

}



async function sendTaskReminderEmail(email, task, label) {

  if (!EMAIL_USER || !EMAIL_APP_PASSWORD) {

    throw new Error("Email settings are missing.");

  }



  const deadlineText = new Date(task.deadlineAt).toLocaleString("en-IN", {

    dateStyle: "full",

    timeStyle: "short",

    timeZone: "Asia/Kolkata"

  });



  await transporter.sendMail({

    from: `"DAYZEN Reminders" <${EMAIL_USER}>`,

    to: email,

    subject: `DAYZEN reminder: ${task.title}`,

    text: `Your task: ${task.title}\n${label}\nDeadline: ${deadlineText}`,

    html: `<div style="font-family:Arial;padding:25px">

      <h2 style="color:#7464e8">DAYZEN Reminder</h2>

      <h2>${escapeHtml(task.title)}</h2>

      <p>${escapeHtml(label)}</p>

      <p>Deadline: ${escapeHtml(deadlineText)}</p>

    </div>`

  });

}



function getSession(req) {

  const match = String(req.headers.authorization || "")

    .match(/^Bearer\s+(.+)$/i);



  if (!match) return null;



  const token = match[1].trim();

  const session = sessions.get(token);



  if (!session || Date.now() >= session.expiresAt) {

    sessions.delete(token);

    return null;

  }



  return session;

}



function getUserForRequest(req) {

  const session = getSession(req);

  if (!session) return null;

  return readUsers().find(user => user.id === session.userId) || null;

}



function getAdminEmails() {

  return String(process.env.ADMIN_EMAILS || "")

    .split(",").map(cleanEmail).filter(Boolean);

}



function removeAttachmentFile(attachment) {

  if (!attachment?.storedName) return;



  const filename = path.basename(attachment.storedName);

  const filePath = path.join(UPLOAD_DIR, filename);



  fs.unlink(filePath, error => {

    if (error && error.code !== "ENOENT") {

      console.error("Attachment cleanup error:", error.message);

    }

  });

}



app.get("/api/health", (req, res) => {

  res.json({ status: "DAYZEN backend is running" });

});



// SIGNUP: SEND EMAIL OTP

app.post("/api/auth/signup", otpLimiter, async (req, res) => {

  try {

    const name = String(req.body.name || "").trim();

    const email = cleanEmail(req.body.email);

    const password = String(req.body.password || "");

    const category = String(req.body.category || "other").trim();



    if (!name || !validEmail(email) || password.length < 8) {

      return res.status(400).json({

        message: "Enter your name, valid email, and password with at least 8 characters."

      });

    }



    if (readUsers().some(user => user.email === email)) {

      return res.status(409).json({

        message: "An account with this email already exists. Please log in."

      });

    }



    const otp = storeOtp(email, "verify", {

      name,

      passwordHash: await bcrypt.hash(password, 12),

      category

    });



    try {

      await sendOtpEmail(email, otp, "verify");

    } catch (error) {

      otpStore.delete(`verify:${email}`);

      throw error;

    }



    res.json({ message: "Verification code sent. It expires in 50 seconds." });

  } catch (error) {

    console.error("Signup OTP error:", error.message);

    res.status(500).json({ message: "Could not send verification email." });

  }

});



// VERIFY EMAIL

app.post("/api/auth/verify-email", otpLimiter, (req, res) => {

  const email = cleanEmail(req.body.email);

  const otp = String(req.body.otp || "").trim();

  const key = `verify:${email}`;

  const record = otpStore.get(key);



  if (!record || Date.now() >= record.expiresAt) {

    otpStore.delete(key);

    return res.status(400).json({ message: "Code expired. Please sign up again." });

  }



  if (++record.attempts > 5) {

    otpStore.delete(key);

    return res.status(429).json({ message: "Too many incorrect attempts." });

  }



  if (record.otp !== otp) {

    return res.status(400).json({ message: "Incorrect verification code." });

  }



  const users = readUsers();



  if (users.some(user => user.email === email)) {

    otpStore.delete(key);

    return res.status(409).json({ message: "Account already exists. Please log in." });

  }



  users.push({

    id: crypto.randomUUID(),

    name: record.name,

    email,

    passwordHash: record.passwordHash,

    category: record.category,

    emailVerified: true,

    role: "user",

    createdAt: new Date().toISOString(),

    tasks: []

  });



  saveUsers(users);

  otpStore.delete(key);



  res.json({ message: "Email verified! Your account is active. You can now log in." });

});



// ADMIN LOGIN: verifies the allowlisted email and secret code on the server.
app.post("/api/admin/login", otpLimiter, (req, res) => {
  try {
    const email = cleanEmail(req.body.email);
    const submittedCode = String(req.body.adminCode || "");
    const configuredCode = String(process.env.ADMIN_ACCESS_CODE || "");
    const allowedAdmins = getAdminEmails();

    if (!configuredCode || !allowedAdmins.includes(email)) {
      return res.status(401).json({ message: "Invalid administrator email or access code." });
    }

    // Compare equal-length buffers to avoid a simple timing comparison.
    const submittedBuffer = Buffer.from(submittedCode);
    const configuredBuffer = Buffer.from(configuredCode);
    const codeMatches = submittedBuffer.length === configuredBuffer.length &&
      crypto.timingSafeEqual(submittedBuffer, configuredBuffer);

    if (!codeMatches) {
      return res.status(401).json({ message: "Invalid administrator email or access code." });
    }

    const user = readUsers().find(item => cleanEmail(item.email) === email);
    if (!user) {
      return res.status(403).json({ message: "Create and verify a normal DAYZEN account using this administrator email first, then sign in here." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      message: "Administrator login successful.",
      token,
      user: {
        id: user.id,
        name: user.name || "Administrator",
        email: user.email,
        category: user.category || "Administrator",
        role: "admin"
      }
    });
  } catch (error) {
    console.error("Admin login error:", error.message);
    return res.status(500).json({ message: "Administrator login failed. Please try again." });
  }
});

// LOGIN

app.post("/api/auth/login", otpLimiter, async (req, res) => {

  try {

    const email = cleanEmail(req.body.email);

    const password = String(req.body.password || "");

    const user = readUsers().find(item => item.email === email);



    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {

      return res.status(401).json({ message: "Invalid email or password." });

    }



    if (!user.emailVerified) {

      return res.status(403).json({ message: "Please verify your email first." });

    }



    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {

      userId: user.id,

      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000

    });



    res.json({

      message: "Login successful.",

      token,

      user: {

        id: user.id,

        name: user.name,

        email: user.email,

        category: user.category,

        role: getAdminEmails().includes(user.email) ? "admin" : "user"

      }

    });

  } catch (error) {

    console.error("Login error:", error.message);

    res.status(500).json({ message: "Login failed. Please try again." });

  }

});



// FORGOT PASSWORD

app.post("/api/auth/forgot-password", otpLimiter, async (req, res) => {

  try {

    const email = cleanEmail(req.body.email);



    if (!validEmail(email)) {

      return res.status(400).json({ message: "Enter a valid email address." });

    }



    if (!readUsers().some(user => user.email === email)) {

      return res.json({ message: "If the account exists, a reset code will be sent." });

    }



    const otp = storeOtp(email, "reset");



    try {

      await sendOtpEmail(email, otp, "reset");

    } catch (error) {

      otpStore.delete(`reset:${email}`);

      throw error;

    }



    res.json({ message: "If the account exists, a reset code will be sent. It expires in 50 seconds." });

  } catch (error) {

    console.error("Reset OTP error:", error.message);

    res.status(500).json({ message: "Could not send reset email." });

  }

});



// RESET PASSWORD

app.post("/api/auth/reset-password", otpLimiter, async (req, res) => {

  try {

    const email = cleanEmail(req.body.email);

    const otp = String(req.body.otp || "").trim();

    const newPassword = String(req.body.newPassword || "");

    const key = `reset:${email}`;

    const record = otpStore.get(key);



    if (!record || Date.now() >= record.expiresAt) {

      otpStore.delete(key);

      return res.status(400).json({ message: "Code expired. Request a new one." });

    }



    if (++record.attempts > 5) {

      otpStore.delete(key);

      return res.status(429).json({ message: "Too many attempts. Request a new code." });

    }



    if (record.otp !== otp) {

      return res.status(400).json({ message: "Incorrect reset code." });

    }



    if (newPassword.length < 8) {

      return res.status(400).json({ message: "Password must have at least 8 characters." });

    }



    const users = readUsers();

    const user = users.find(item => item.email === email);



    if (!user) {

      otpStore.delete(key);

      return res.status(400).json({ message: "Unable to reset this account." });

    }



    user.passwordHash = await bcrypt.hash(newPassword, 12);

    saveUsers(users);

    otpStore.delete(key);



    for (const [token, session] of sessions.entries()) {

      if (session.userId === user.id) sessions.delete(token);

    }



    res.json({ message: "Password reset successful. Please log in." });

  } catch (error) {

    console.error("Password reset error:", error.message);

    res.status(500).json({ message: "Could not reset password." });

  }

});



// CURRENT USER

app.get("/api/me", (req, res) => {

  const user = getUserForRequest(req);



  if (!user) return res.status(401).json({ message: "Please log in again." });



  res.json({

    user: {

      id: user.id,

      name: user.name,

      email: user.email,

      category: user.category,

      role: getAdminEmails().includes(user.email) ? "admin" : "user"

    }

  });

});



// LOGOUT

app.post("/api/auth/logout", (req, res) => {

  const match = String(req.headers.authorization || "")

    .match(/^Bearer\s+(.+)$/i);



  if (match) sessions.delete(match[1].trim());

  res.json({ message: "Logged out." });

});



// LIST TASKS

app.get("/api/tasks", (req, res) => {

  const user = getUserForRequest(req);

  if (!user) return res.status(401).json({ message: "Please log in." });



  res.json({ tasks: user.tasks || [] });

});



// CREATE TASK

app.post("/api/tasks", (req, res) => {

  const user = getUserForRequest(req);

  if (!user) return res.status(401).json({ message: "Please log in." });



  const title = String(req.body.title || "").trim();

  const notification = req.body.notification === true;

  const deadlineInput = req.body.deadlineAt;

  const deadlineAt = deadlineInput ? new Date(deadlineInput) : null;



  if (!title || title.length > 200) {

    return res.status(400).json({ message: "Enter a task title of 1–200 characters." });

  }



  if (notification && (!deadlineAt || Number.isNaN(deadlineAt.getTime()))) {

    return res.status(400).json({ message: "Enter a valid deadline for email reminders." });

  }



  if (notification && deadlineAt.getTime() <= Date.now()) {

    return res.status(400).json({ message: "Choose a future deadline for reminders." });

  }



  const users = readUsers();

  const savedUser = users.find(item => item.id === user.id);

  if (!savedUser) return res.status(401).json({ message: "Account not found." });



  const task = {

    id: crypto.randomUUID(),

    title,

    category: String(req.body.category || "Personal").trim(),

    duration: String(req.body.duration || "30 minutes").trim(),

    time: String(req.body.time || "").trim(),

    deadlineAt: deadlineAt ? deadlineAt.toISOString() : null,

    notification,

    completed: false,

    reminderHistory: [],

    createdAt: new Date().toISOString()

  };



  savedUser.tasks = savedUser.tasks || [];

  savedUser.tasks.push(task);

  saveUsers(users);



  res.status(201).json({

    message: "Task saved.",

    task

  });

});



// UPDATE / COMPLETE TASK

app.patch("/api/tasks/:id", (req, res) => {

  const session = getSession(req);

  if (!session) return res.status(401).json({ message: "Please log in." });



  const users = readUsers();

  const user = users.find(item => item.id === session.userId);

  const task = user?.tasks?.find(item => item.id === req.params.id);



  if (!task) return res.status(404).json({ message: "Task not found." });



  for (const field of ["title", "category", "duration", "time"]) {

    if (Object.prototype.hasOwnProperty.call(req.body, field)) {

      task[field] = String(req.body[field] ?? "").trim();

    }

  }



  if (Object.prototype.hasOwnProperty.call(req.body, "title")) {

    if (!task.title || task.title.length > 200) {

      return res.status(400).json({ message: "Task title must be 1–200 characters." });

    }

  }



  if (Object.prototype.hasOwnProperty.call(req.body, "deadlineAt")) {

    if (!req.body.deadlineAt) {

      task.deadlineAt = null;

    } else {

      const date = new Date(req.body.deadlineAt);

      if (Number.isNaN(date.getTime())) {

        return res.status(400).json({ message: "Invalid deadline." });

      }

      task.deadlineAt = date.toISOString();

    }

    task.reminderHistory = [];

  }



  if (Object.prototype.hasOwnProperty.call(req.body, "notification")) {

    if (typeof req.body.notification !== "boolean") {

      return res.status(400).json({ message: "Notification must be true or false." });

    }

    task.notification = req.body.notification;

  }



  if (Object.prototype.hasOwnProperty.call(req.body, "completed")) {

    if (typeof req.body.completed !== "boolean") {

      return res.status(400).json({ message: "Completed must be true or false." });

    }

    task.completed = req.body.completed;

  }



  if (task.notification && !task.completed && !task.deadlineAt) {

    return res.status(400).json({ message: "Add a deadline before enabling reminders." });

  }



  if (task.completed || !task.notification) {

    task.remindersStoppedAt = new Date().toISOString();

  } else {

    delete task.remindersStoppedAt;

  }



  saveUsers(users);

  res.json({ message: "Task updated.", task });

});



// UPLOAD TASK ATTACHMENT

app.post("/api/tasks/:id/attachment", (req, res) => {

  const user = getUserForRequest(req);

  if (!user) return res.status(401).json({ message: "Please log in again." });



  if (!(user.tasks || []).some(task => task.id === req.params.id)) {

    return res.status(404).json({ message: "Task not found." });

  }



  upload.single("file")(req, res, error => {

    if (error) {

      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({

        message: error.code === "LIMIT_FILE_SIZE"

          ? "File exceeds the 15 MB limit."

          : error.message || "Upload failed."

      });

    }



    if (!req.file) {

      return res.status(400).json({ message: "Choose a file first." });

    }



    try {

      const users = readUsers();

      const savedUser = users.find(item => item.id === user.id);

      const task = savedUser?.tasks?.find(item => item.id === req.params.id);



      if (!task) {

        fs.unlink(req.file.path, () => {});

        return res.status(404).json({ message: "Task not found." });

      }



      const oldAttachment = task.attachment;



      task.attachment = {

        originalName: path.basename(req.file.originalname),

        storedName: req.file.filename,

        size: req.file.size,

        uploadedAt: new Date().toISOString()

      };



      saveUsers(users);

      removeAttachmentFile(oldAttachment);



      res.status(201).json({

        message: "Attachment uploaded.",

        attachment: task.attachment

      });

    } catch (error) {

      fs.unlink(req.file.path, () => {});

      console.error("Attachment save error:", error.message);

      res.status(500).json({ message: "Could not save attachment." });

    }

  });

});



// DOWNLOAD TASK ATTACHMENT

app.get("/api/tasks/:id/attachment", (req, res) => {

  const user = getUserForRequest(req);

  if (!user) return res.status(401).json({ message: "Please log in again." });



  const task = (user.tasks || []).find(item => item.id === req.params.id);

  if (!task?.attachment?.storedName) {

    return res.status(404).json({ message: "No attachment found for this task." });

  }



  const filePath = path.join(UPLOAD_DIR, path.basename(task.attachment.storedName));

  if (!fs.existsSync(filePath)) {

    return res.status(404).json({ message: "Attached file is missing from the server." });

  }
  res.download(

    filePath,

    path.basename(task.attachment.originalName || "task-file"),

    error => {

      if (error && !res.headersSent) {

        res.status(500).json({ message: "Could not download attachment." });

      }

    }

  );

});



// DELETE TASK

app.delete("/api/tasks/:id", (req, res) => {

  const user = getUserForRequest(req);

  if (!user) return res.status(401).json({ message: "Please log in again." });



  const users = readUsers();

  const savedUser = users.find(item => item.id === user.id);

  if (!savedUser) return res.status(404).json({ message: "Account not found." });



  savedUser.tasks = savedUser.tasks || [];

  const index = savedUser.tasks.findIndex(item => item.id === req.params.id);



  if (index === -1) return res.status(404).json({ message: "Task not found." });



  const [deletedTask] = savedUser.tasks.splice(index, 1);



  try {

    saveUsers(users);

  } catch (error) {

    console.error("Delete task error:", error.message);

    return res.status(500).json({ message: "Could not delete task." });

  }



  removeAttachmentFile(deletedTask.attachment);

  res.json({ message: "Task deleted successfully." });

});



// ADMIN DASHBOARD: all endpoints below validate the session and server-side allowlist.
function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ message: "Please log in." });
    return null;
  }
  const user = readUsers().find(item => item.id === session.userId);
  const allowedAdmins = getAdminEmails();
  if (!user || !allowedAdmins.includes(cleanEmail(user.email))) {
    res.status(403).json({ message: "Admin access only." });
    return null;
  }
  return { user, allowedAdmins };
}

function getAdminSummary(users, allowedAdmins) {
  const allTasks = users.flatMap(user => Array.isArray(user.tasks) ? user.tasks : []);
  const completedTasks = allTasks.filter(task => Boolean(task.completed)).length;
  return {
    totalUsers: users.length,
    totalAdmins: users.filter(user => allowedAdmins.includes(cleanEmail(user.email))).length,
    totalTasks: allTasks.length,
    completedTasks,
    pendingTasks: allTasks.length - completedTasks
  };
}

function safeAdminUser(user, allowedAdmins) {
  const userTasks = Array.isArray(user.tasks) ? user.tasks : [];
  return {
    id: user.id,
    name: user.name || "",
    email: user.email || "",
    category: user.category || "Other",
    role: allowedAdmins.includes(cleanEmail(user.email)) ? "admin" : "user",
    createdAt: user.createdAt || null,
    taskCount: userTasks.length,
    tasks: userTasks.map(task => ({
      id: task.id,
      title: task.title,
      category: task.category,
      completed: Boolean(task.completed),
      deadlineAt: task.deadlineAt || null,
      createdAt: task.createdAt || null
    }))
  };
}

app.get("/api/admin/dashboard", (req, res) => {
  const authorization = requireAdmin(req, res);
  if (!authorization) return;
  const users = readUsers();
  const safeUsers = users.map(user => safeAdminUser(user, authorization.allowedAdmins));
  const recentUsers = [...safeUsers]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 10);
  res.json({
    stats: getAdminSummary(users, authorization.allowedAdmins),
    users: safeUsers,
    recentUsers
  });
});

app.get("/api/admin/users", (req, res) => {
  const authorization = requireAdmin(req, res);
  if (!authorization) return;
  const query = String(req.query.search || "").trim().toLowerCase();
  const users = readUsers()
    .map(user => safeAdminUser(user, authorization.allowedAdmins))
    .filter(user => !query || `${user.name} ${user.email}`.toLowerCase().includes(query));
  res.json({ users });
});
// REMINDER SCHEDULER
const REMINDER_DAYS = [15, 10, 8, 6, 4, 2, 0];

function buildReminderSchedule(deadlineAt) {
  const deadlineMs = new Date(deadlineAt).getTime();

  return REMINDER_DAYS.map(daysBefore => ({
    key: `days-${daysBefore}`,
    scheduledAt: deadlineMs - daysBefore * 86400000,
    label: daysBefore === 0
      ? "Your task deadline is today."
      : `Your task deadline is in ${daysBefore} days.`
  }));
}

let schedulerRunning = false;
async function processTaskReminders() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const users = readUsers();
    const now = Date.now();
    let changed = false;
    for (const user of users) {
      if (!user.emailVerified || !validEmail(user.email)) continue;
      for (const task of user.tasks || []) {
        if (task.completed || task.notification !== true || !task.deadlineAt) continue;
        const deadlineMs = new Date(task.deadlineAt).getTime();
        if (Number.isNaN(deadlineMs)) continue;
        task.reminderHistory = Array.isArray(task.reminderHistory)
          ? task.reminderHistory : [];
        // Avoid sending old reminders all at once.
        // If the deadline is already past, disable reminders.
        if (now > deadlineMs + 60000) {
          task.notification = false;
          task.remindersStoppedAt = new Date().toISOString();
          changed = true;
          continue;
        }
        const sentKeys = new Set(task.reminderHistory.map(item => item.key));
        const dueReminders = buildReminderSchedule(task.deadlineAt)
          .filter(item => now >= item.scheduledAt && !sentKeys.has(item.key));

        // Send at most ONE due reminder per task per scheduler pass.
        // Choose the closest upcoming milestone, not all missed milestones.
        if (dueReminders.length === 0) continue;
        const reminder = dueReminders
          .sort((a, b) => b.scheduledAt - a.scheduledAt)[0];
        try {
          await sendTaskReminderEmail(user.email, task, reminder.label);
          task.reminderHistory.push({
            key: reminder.key,
            sentAt: new Date().toISOString()
          });
          changed = true;
          console.log(
            `Reminder sent to ${user.email} for "${task.title}" (${reminder.key}).`
          );
          if (reminder.key === "days-0") {
            task.notification = false;
            task.remindersStoppedAt = new Date().toISOString();
          }
        } catch (error) {
          console.error(
            `Could not send reminder for "${task.title}":`,
            error.message
          );
        }
      }
    }

    if (changed) saveUsers(users);
  } catch (error) {
    console.error("Reminder scheduler error:", error.message);
  } finally {
    schedulerRunning = false;
  }
}

processTaskReminders();
setInterval(processTaskReminders, 15000);

// Multer / unexpected server errors return JSON rather than an HTML error page.

app.use((error, req, res, next) => {
  console.error("Request error:", error.message);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    message: error.message || "An unexpected server error occurred."
  });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`DAYZEN server running on port ${PORT}`);
});