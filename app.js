const $ = id => document.getElementById(id);
let client = null;

const savedUrl = localStorage.getItem("lua_locker_supabase_url") || "";
const savedKey = localStorage.getItem("lua_locker_supabase_key") || "";
$("supabaseUrl").value = savedUrl;
$("supabaseKey").value = savedKey;

function msg(el, text, ok=false){
  el.textContent = text || "";
  el.style.color = ok ? "#86efac" : "#fbbf24";
}

function validUrl(v){
  try{
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.endsWith(".supabase.co");
  }catch{return false}
}

function configured(){
  return validUrl($("supabaseUrl").value.trim()) && $("supabaseKey").value.trim().length > 20;
}

function setClient(){
  if(!configured()) return false;
  client = supabase.createClient(
    $("supabaseUrl").value.trim(),
    $("supabaseKey").value.trim(),
    {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}
  );
  return true;
}

async function connect(){
  if(!setClient()){
    msg($("setupMsg"), "❌ URL hoặc Publishable key chưa đúng.");
    return false;
  }
  localStorage.setItem("lua_locker_supabase_url", $("supabaseUrl").value.trim());
  localStorage.setItem("lua_locker_supabase_key", $("supabaseKey").value.trim());
  $("setupCard").classList.add("hidden");
  $("authCard").classList.remove("hidden");
  msg($("setupMsg"), "");
  const {data:{session}} = await client.auth.getSession();
  showSession(session);
  return true;
}

function showSession(session){
  if(session?.user){
    $("authCard").classList.add("hidden");
    $("appCard").classList.remove("hidden");
    $("logoutBtn").classList.remove("hidden");
    $("userEmail").textContent = session.user.email || "Tài khoản";
  }else{
    $("appCard").classList.add("hidden");
    $("authCard").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
  }
}

$("saveConfigBtn").onclick = connect;

$("clearConfigBtn").onclick = ()=>{
  localStorage.removeItem("lua_locker_supabase_url");
  localStorage.removeItem("lua_locker_supabase_key");
  $("supabaseUrl").value="";
  $("supabaseKey").value="";
  msg($("setupMsg"), "Đã xóa cấu hình.");
};

$("changeConfigBtn").onclick = ()=>{
  $("appCard").classList.add("hidden");
  $("authCard").classList.add("hidden");
  $("logoutBtn").classList.add("hidden");
  $("setupCard").classList.remove("hidden");
};

$("loginBtn").onclick = async ()=>{
  if(!client && !(await connect())) return;
  const email=$("email").value.trim(), password=$("password").value;
  if(!email || !password) return msg($("authMsg"),"❌ Nhập email và mật khẩu.");
  msg($("authMsg"),"Đang đăng nhập...");
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error){
    let text="❌ "+error.message;
    if(error.message.toLowerCase().includes("email not confirmed"))
      text+="\n→ Hãy mở email xác nhận Supabase rồi đăng nhập lại.";
    msg($("authMsg"),text);
    return;
  }
  msg($("authMsg"),"Đăng nhập thành công.",true);
  showSession(data.session);
};

$("signupBtn").onclick = async ()=>{
  if(!client && !(await connect())) return;
  const email=$("email").value.trim(), password=$("password").value;
  if(!email || password.length<6) return msg($("authMsg"),"❌ Email hợp lệ và mật khẩu từ 6 ký tự.");
  msg($("authMsg"),"Đang tạo tài khoản...");
  const {data,error}=await client.auth.signUp({email,password});
  if(error) return msg($("authMsg"),"❌ "+error.message);
  if(data.session){
    msg($("authMsg"),"Tạo tài khoản và đăng nhập thành công.",true);
    showSession(data.session);
  }else{
    msg($("authMsg"),"✅ Tạo tài khoản xong. Hãy mở email để xác nhận, rồi đăng nhập.");
  }
};

$("googleBtn").onclick = async ()=>{
  if(!client && !(await connect())) return;
  const {error}=await client.auth.signInWithOAuth({
    provider:"google",
    options:{redirectTo:location.href}
  });
  if(error) msg($("authMsg"),"❌ "+error.message);
};

$("logoutBtn").onclick = async ()=>{
  if(client) await client.auth.signOut();
  showSession(null);
};

$("fileInput").onchange = async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  $("scriptName").value=$("scriptName").value || file.name.replace(/\.[^.]+$/,"");
  $("slug").value=$("slug").value || file.name.replace(/\.[^.]+$/,"").toLowerCase().replace(/[^a-z0-9_-]/g,"-");
  $("code").value=await file.text();
};

function b64utf8(s){
  const bytes=new TextEncoder().encode(s);
  let bin="";
  for(const b of bytes) bin+=String.fromCharCode(b);
  return btoa(bin);
}

$("lockBtn").onclick = async ()=>{
  if(!client)return msg($("lockMsg"),"❌ Chưa kết nối Supabase.");
  const {data:{session}}=await client.auth.getSession();
  if(!session?.user)return msg($("lockMsg"),"❌ Bạn chưa đăng nhập.");
  const code=$("code").value;
  const name=$("scriptName").value.trim() || "script";
  let slug=$("slug").value.trim().toLowerCase().replace(/[^a-z0-9_-]/g,"-");
  if(!slug) slug="script-"+Date.now();
  if(!code.trim())return msg($("lockMsg"),"❌ Chưa có code Lua.");

  msg($("lockMsg"),"Đang tạo Raw...");
  const payload=b64utf8(code);
  const key=crypto.randomUUID().replaceAll("-","");

  const {data,error}=await client.from("scripts").insert({
    user_id:session.user.id,name,slug,payload,key
  }).select("slug").single();

  if(error){
    msg($("lockMsg"),"❌ "+error.message+"\n\nNếu báo lỗi bảng scripts chưa tồn tại, hãy chạy file supabase/schema.sql trong Supabase SQL Editor.");
    return;
  }

  const base=$("supabaseUrl").value.trim();
  const raw=`${base}/functions/v1/raw/${encodeURIComponent(data.slug)}?k=${encodeURIComponent(key)}`;
  const loader=`loadstring(game:HttpGet("${raw}"))()`;
  $("rawUrl").value=raw;
  $("loader").textContent=loader;
  $("result").classList.remove("hidden");
  msg($("lockMsg"),"✅ Đã tạo Raw thành công.",true);
};

$("copyRawBtn").onclick=async()=>{
  await navigator.clipboard.writeText($("rawUrl").value);
  msg($("lockMsg"),"✅ Đã sao chép Raw URL.",true);
};
$("copyLoaderBtn").onclick=async()=>{
  await navigator.clipboard.writeText($("loader").textContent);
  msg($("lockMsg"),"✅ Đã sao chép Loader.",true);
};

(async()=>{
  if(savedUrl && savedKey){
    setClient();
    if(client){
      const {data:{session}}=await client.auth.getSession();
      $("setupCard").classList.add("hidden");
      showSession(session);
    }
  }
  if(client){
    client.auth.onAuthStateChange((_event,session)=>showSession(session));
  }
})();
