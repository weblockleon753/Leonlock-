/**
 * obfuscator.js
 * -------------------------------------------------------------------------
 * Thuật toán khóa (lock) mã Lua tự viết, KHÔNG dùng API/dịch vụ bên ngoài.
 *
 * Ý tưởng:
 *  1. Đọc source Lua gốc -> chuyển thành mảng byte (Buffer UTF-8).
 *  2. XOR từng byte với 1 key số nguyên ngẫu nhiên (1-250) VÀ xáo trộn thêm
 *     bằng một "rolling key" để tăng độ khó đọc bằng mắt thường.
 *  3. Đảo ngược thứ tự mảng byte (thêm 1 lớp che giấu đơn giản).
 *  4. Sinh ra 1 đoạn code Lua "stub" tự giải mã: nó chứa mảng byte đã mã
 *     hóa, tự XOR ngược lại bằng bit32.bxor(), ráp thành chuỗi source gốc,
 *     rồi gọi loadstring(source)() để thực thi bình thường.
 *
 * -> Kết quả trả về là 1 chuỗi Lua HOÀN CHỈNH, chạy được ngay qua
 *    loadstring() trên Roblox Executor mà không cần thư viện ngoài,
 *    vì bit32 là thư viện chuẩn có sẵn trong Luau (Roblox).
 * -------------------------------------------------------------------------
 */

function randomKey() {
  // key XOR trong khoảng 1-250 (tránh 0 để luôn thực sự đổi giá trị byte)
  return Math.floor(Math.random() * 250) + 1;
}

function randomVarName(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "_";
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

/**
 * Mã hóa (lock) mã nguồn Lua.
 * @param {string} luaSource - code Lua gốc
 * @returns {{ locked: string, key: number }}
 */
function obfuscate(luaSource) {
  if (typeof luaSource !== "string" || luaSource.trim().length === 0) {
    throw new Error("Lua source rỗng hoặc không hợp lệ");
  }

  const key = randomKey();
  const rollAdd = Math.floor(Math.random() * 30) + 1; // rolling key tăng dần mỗi byte

  const rawBytes = Buffer.from(luaSource, "utf8");
  const encodedBytes = [];

  for (let i = 0; i < rawBytes.length; i++) {
    // rolling xor: mỗi byte dùng key khác nhau (key + i*rollAdd) mod 256
    const rollingKey = (key + i * rollAdd) % 256;
    encodedBytes.push(rawBytes[i] ^ rollingKey);
  }

  // Lớp che giấu thêm: đảo ngược mảng byte
  encodedBytes.reverse();

  // Tên biến ngẫu nhiên cho stub, tránh pattern dễ đoán / dễ tìm-thay
  const vKey = randomVarName();
  const vRoll = randomVarName();
  const vBytes = randomVarName();
  const vOut = randomVarName();
  const vSrc = randomVarName();
  const vI = randomVarName(3);
  const vFn = randomVarName();

  const byteArrayLiteral = encodedBytes.join(",");

  // Stub Lua tự giải mã - chỉ dùng bit32 (built-in Luau, không cần thư viện ngoài)
  const stub = `local ${vKey}=${key};local ${vRoll}=${rollAdd};local ${vBytes}={${byteArrayLiteral}};local ${vOut}={};local _n=#${vBytes};for ${vI}=1,_n do local _idx=_n-${vI}+1;local _rk=(${vKey}+(_idx-1)*${vRoll})%256;${vOut}[_idx]=string.char(bit32.bxor(${vBytes}[${vI}],_rk));end;local ${vSrc}=table.concat(${vOut});local ${vFn}=loadstring(${vSrc});if ${vFn} then return ${vFn}() end`;

  return { locked: stub, key };
}

module.exports = { obfuscate };
