/**
 * server.js
 * -------------------------------------------------------------------------
 * Backend Express cho hệ thống "Lua Locker & Obfuscator".
 *
 * Chức năng:
 *  - POST /api/register        : đăng ký tài khoản
 *  - POST /api/login           : đăng nhập, trả về JWT token
 *  - GET  /api/me              : lấy thông tin user hiện tại (kiểm tra token)
 *  - POST /api/lock            : (cần đăng nhập) khóa 1 đoạn code Lua, lưu DB,
 *                                 trả về id + raw url + lệnh loadstring mẫu
 *  - GET  /api/scripts         : (cần đăng nhập) danh sách script của user
 *  - GET  /raw/:id             : trả code đã obfuscate dạng text/plain
 *                                 (endpoint này Roblox Executor sẽ gọi tới)
 * -------------------------------------------------------------------------
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { nanoid } = require("nanoid");
const { createClient } = require("@supabase/supabase-js");
const { obfuscate } = require("./obfuscator");

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  JWT_SECRET,
  PORT,
  PUBLIC_BASE_URL,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[FATAL] Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env");
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error("[FATAL] Thiếu JWT_SECRET trong .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // cho phép paste code Lua khá dài
app.use(express.static(path.join(__dirname, "public")));

const TOKEN_EXPIRES_IN = "7d";

// ---------------------------------------------------------------------------
// Middleware xác thực JWT
// ---------------------------------------------------------------------------
function authMiddleware(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Thiếu token đăng nhập" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, username }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token không hợp lệ hoặc đã hết hạn" });
  }
}

// ---------------------------------------------------------------------------
// AUTH: Đăng ký
// ---------------------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: "Vui lòng nhập tài khoản và mật khẩu" });
    }
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({
        error: "Username tối thiểu 3 ký tự, mật khẩu tối thiểu 6 ký tự",
      });
    }

    const { data: existing, error: findErr } = await supabase
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (findErr) throw findErr;
    if (existing) {
      return res.status(409).json({ error: "Tài khoản đã tồn tại" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data: newUser, error: insertErr } = await supabase
      .from("users")
      .insert({ username, password_hash })
      .select("id, username")
      .single();

    if (insertErr) throw insertErr;

    const token = jwt.sign(
      { id: newUser.id, username: newUser.username },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );

    return res.json({ token, user: newUser });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Lỗi server khi đăng ký" });
  }
});

// ---------------------------------------------------------------------------
// AUTH: Đăng nhập
// ---------------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Vui lòng nhập tài khoản và mật khẩu" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, password_hash")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES_IN }
    );

    return res.json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Lỗi server khi đăng nhập" });
  }
});

// Kiểm tra phiên đăng nhập (frontend gọi lúc load trang để xác nhận token còn hạn)
app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------------
// LOCK: Khóa code Lua + lưu DB + sinh ID ngẫu nhiên
// ---------------------------------------------------------------------------
app.post("/api/lock", authMiddleware, async (req, res) => {
  try {
    const { code, title } = req.body || {};
    if (!code || typeof code !== "string" || code.trim().length === 0) {
      return res.status(400).json({ error: "Code Lua trống" });
    }

    const { locked, key } = obfuscate(code);
    const id = nanoid(10); // ID ngẫu nhiên, khó đoán

    const { error } = await supabase.from("scripts").insert({
      id,
      user_id: req.user.id,
      title: title || "Untitled Script",
      original_code: code,
      locked_code: locked,
      key_used: key,
    });

    if (error) throw error;

    const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const rawUrl = `${base}/raw/${id}`;
    const loadstringCmd = `loadstring(game:HttpGet("${rawUrl}"))()`;

    return res.json({ id, rawUrl, loadstringCmd });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Lỗi server khi khóa code" });
  }
});

// Danh sách script của user hiện tại
app.get("/api/scripts", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("scripts")
      .select("id, title, views, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ scripts: data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Lỗi server khi lấy danh sách script" });
  }
});

// ---------------------------------------------------------------------------
// RAW ENDPOINT: trả code đã obfuscate dạng text/plain
// Đây là URL mà Roblox Executor sẽ HttpGet tới qua loadstring()
// ---------------------------------------------------------------------------
app.get("/raw/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: script, error } = await supabase
      .from("scripts")
      .select("id, locked_code, views")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!script) {
      res.set("Content-Type", "text/plain; charset=utf-8");
      return res.status(404).send("-- Script not found");
    }

    // Tăng lượt xem (không cần chờ, không chặn response)
    supabase
      .from("scripts")
      .update({ views: (script.views || 0) + 1 })
      .eq("id", id)
      .then(() => {})
      .catch((e) => console.error("update views error:", e));

    res.set("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(script.locked_code);
  } catch (err) {
    console.error(err);
    res.set("Content-Type", "text/plain; charset=utf-8");
    return res.status(500).send("-- Server error");
  }
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Lua Locker & Obfuscator server đang chạy tại http://localhost:${port}`);
});
