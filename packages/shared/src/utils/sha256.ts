/**
 * SHA-256（FIPS 180-4）的纯 JavaScript 实现 —— 只服务于 Mock 登录的密码比对。
 *
 * **为什么不用浏览器的 `crypto.subtle`**：它是 Web Crypto 的一部分，只在**安全上下文**
 * （https 或 localhost）里存在。演示环境常挂在局域网 IP + http 下，那时 `crypto.subtle`
 * 是 `undefined`，登录会直接崩 —— 而这是演示最不能出问题的一步。仓库里也没有任何加密依赖
 * （shared 只装了 echarts / katex），所以自带一份同步实现，零依赖、任何环境都能跑。
 *
 * **不是真的「安全」**，写清楚免得被当成防护：盐与哈希都随前端 bundle 一起发到浏览器，
 * 拿到 bundle 就能离线爆破小口令空间。它满足的是「仓库里不出现明文密码、比对时不明文比较」，
 * 真正的密码安全必须由服务端负责（见 README 的「当前限制」）。
 *
 * **必须与 Node 的 `crypto.createHash('sha256')` 逐字节一致**：`scripts/hash-password.mjs`
 * 用 Node 生成配置里的盐与哈希，运行时用本文件比对，两边算不出同一个值就是「生成的哈希
 * 永远登录失败」这种最难查的故障。为此字符串先经 `TextEncoder` 编码成 **UTF-8 字节**
 * （`TextEncoder` 是标准 API，不受安全上下文限制，浏览器与 Node 都在），而不是按
 * charCodeAt 逐字符处理 —— 后者遇到中文密码会算出与 Node 不同的结果。
 *
 * 自检向量（`auth/accounts.ts` 顶部有 dev-only 断言，改动本文件后必须仍然通过）：
 *   sha256Hex('')     === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
 *   sha256Hex('abc')  === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 *   sha256Hex('The quick brown fox jumps over the lazy dog')
 *                     === 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'
 */

/** FIPS 180-4 §4.2.2：64 个轮常量（前 64 位小数部分的前 32 位） */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** 初始哈希值：前 8 个质数平方根小数部分的前 32 位（FIPS 180-4 §5.3.3） */
const H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

/** 32 位循环右移。`>>> 0` 是为了让 `x << n` 产生的高位不把它变成负数 */
function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0
}

/** 计算字符串（UTF-8 编码）的 SHA-256，返回 64 位小写十六进制 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)

  /* 填充：先补一个 0x80，再补 0 到「长度 ≡ 56 (mod 64)」，最后 8 字节放**比特**长度（大端）。
     长度按 64 位写：字符串超过 2^29 字节时低 32 位会溢出，高位必须单独算，否则长文本静默算错。 */
  const blockCount = Math.ceil((bytes.length + 9) / 64)
  const msg = new Uint8Array(blockCount * 64)
  msg.set(bytes)
  msg[bytes.length] = 0x80
  const bitLen = bytes.length * 8
  const view = new DataView(msg.buffer)
  view.setUint32(blockCount * 64 - 8, Math.floor(bitLen / 0x100000000))
  view.setUint32(blockCount * 64 - 4, bitLen >>> 0)

  const h = H0.slice()
  const w = new Uint32Array(64)

  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * 64
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }

    let a = h[0]!
    let b = h[1]!
    let c = h[2]!
    let d = h[3]!
    let e = h[4]!
    let f = h[5]!
    let g = h[6]!
    let hh = h[7]!

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      // 五项相加最大不到 2^35，double 精确表示得下，最后再截成 32 位即可
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0

      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }

    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }

  let out = ''
  for (let i = 0; i < 8; i += 1) out += h[i]!.toString(16).padStart(8, '0')
  return out
}
