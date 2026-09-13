/* ===========================
   ONLY EDIT THESE 2 VALUES
   =========================== */
const SUPABASE_URL = "PASTE_SUPABASE_URL_HERE";
const SUPABASE_PUBLISHABLE_KEY = "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE";
/* =========================== */

const { createClient } = supabase;
const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = id => document.getElementById(id);

function configured(){ return !SUPABASE_URL.includes("PASTE_") && !SUPABASE_PUBLISHABLE_KEY.includes("PASTE_"); }
function msg(el, text, bad=false){ el.textContent=text; el.style.color=bad?"#fb7185":"#fbbf24"; }

async function refresh(){
  if(!configured()){ msg($("authMsg"),"Mở app.js và chỉ điền 2 dòng SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY."); return; }
  const {data:{session}} = await client.auth.getSession();
  $("auth").classList.toggle("hidden",!!session);
  $("panel").classList.toggle("hidden",!session);
  if(session) $("userEmail").textContent=session.user.email||"Đã đăng nhập";
}
$("login").onclick=async()=>{
  const {error}=await client.auth.signInWithPassword({email:$("email").value,password:$("password").value});
  msg($("authMsg"),error?error.message:"Đăng nhập thành công",!!error); await refresh();
};
$("signup").onclick=async()=>{
  const {error}=await client.auth.signUp({email:$("email").value,password:$("password").value});
  msg($("authMsg"),error?error.message:"Đăng ký xong. Kiểm tra email nếu cần xác nhận.",!!error);
};
$("google").onclick=async()=>{
  const {error}=await client.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+location.pathname}});
  if(error) msg($("authMsg"),error.message,true);
};
$("logout").onclick=async()=>{await client.auth.signOut();refresh()};
$("file").onchange=async e=>{
  const f=e.target.files[0]; if(f) $("code").value=await f.text();
};

function randomSlug(){
  const a="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s=""; for(let i=0;i<12;i++) s+=a[Math.floor(Math.random()*a.length)];
  return s;
}
function xor(text,key){
  let out=""; for(let i=0;i<text.length;i++) out+=String.fromCharCode(text.charCodeAt(i)^key.charCodeAt(i%key.length));
  return btoa(unescape(encodeURIComponent(out)));
}
function makeLoader(payload,key){
  const safeKey=JSON.stringify(key), safePayload=JSON.stringify(payload);
  return `-- Lua Locker protected loader
local b64=${safePayload}
local key=${safeKey}
local function dec(s,k)
  local chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  s=s:gsub('[^'..chars..'=]','')
  local bits=s:gsub('.',function(x) if x=='=' then return '' end local r,f='',(chars:find(x)-1) for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end return r end)
  local out={}
  for i=1,#bits-7,8 do local c=0 for j=0,7 do c=c+(bits:sub(i+j,i+j)=='1' and 2^(7-j) or 0) end out[#out+1]=string.char(c) end
  local raw=table.concat(out)
  raw=raw:gsub('.',function(c) return string.char(bit32 and bit32.bxor(c:byte(),k:byte(1+(#out%#k))) or c:byte()) end)
  return raw
end
-- The public Raw endpoint returns the complete loader.`;
}
$("lock").onclick=async()=>{
  const code=$("code").value.trim(), name=$("name").value.trim()||"Untitled";
  if(!code) return msg($("status"),"Chưa có code Lua.",true);
  msg($("status"),"Đang tạo...");
  const slug=randomSlug();
  const key=randomSlug();
  const payload=btoa(unescape(encodeURIComponent(code)));
  const {data:{session}}=await client.auth.getSession();
  if(!session) return msg($("status"),"Hãy đăng nhập trước.",true);
  const {data,error}=await client.from("scripts").insert({user_id:session.user.id,name,slug,payload,key}).select().single();
  if(error) return msg($("status"),error.message,true);
  const raw=`${SUPABASE_URL}/functions/v1/raw/${slug}`;
  $("rawUrl").value=raw;
  $("loader").textContent=`loadstring(game:HttpGet(${JSON.stringify(raw)}))()`;
  $("result").classList.remove("hidden");
  msg($("status"),"Đã tạo Raw Link.");
};
$("copy").onclick=async()=>{await navigator.clipboard.writeText($("rawUrl").value);$("copy").textContent="Đã copy ✓";};
client.auth.onAuthStateChange(()=>refresh());
refresh();