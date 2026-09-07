/**
 * 人像抠图客户端（直接调用自建 BiRefNet 后端，不再走微信云函数）
 *
 * 调用链：
 *   本地图片 PNG → base64 → wx.request POST 到 https://idphoto.hcxserver.xyz/extract
 *   → BiRefNet 后端返回透明 PNG 的 base64
 *   → 小程序端: base64 → writeFileSync(USER_DATA_PATH) → 临时文件路径
 *
 * 说明：
 *   - 后端跑在独立实例（BiRefNet，MIT 可商用），与微信云开发无关。
 *   - 单张约 5~7s（BiRefNet 在 M3 CPU 推理）。
 *   - 失败时抛错，调用方（edit.js）会降级到本地纯颜色兜底。
 */

const BACKEND_URL = 'https://idphoto.hcxserver.xyz/extract';
const STATUS_URL = 'https://idphoto.hcxserver.xyz/status';

// ── 重试阶梯配置 ──
const RETRY_MAX = 4;                 // 最多重试次数（不含首次）
const RETRY_DELAYS = [800, 1500, 3000, 5000]; // 每次重试前等待 ms（递增退避）
const STATUS_TIMEOUT = 3000;         // 探活 /status 的超时（失败则默默忽略，不影响主流程）

/**
 * 用户是否已经明确同意「把照片传到云端处理」—— 隐私合规保留
 * （直接调自建后端本质也是把图传出去，语义上沿用原有确认。）
 */
function hasPrivacyConsent() {
  try { return !!wx.getStorageSync('matting_privacy_consent'); } catch (_) { return false; }
}
async function grantPrivacyConsent() {
  try { wx.setStorageSync('matting_privacy_consent', true); } catch (_) {}
  return true;
}

/**
 * 探活后端负载：GET /status → { processing, queue, maxQueue, busy }
 * 用于前端在真正请求前获取排队状况，实现「拥挤提示 / 排队序号」。
 * @param {Function} [onStatus] 拿到 /status 后回调，若失败则不回传（不影响主流程）
 */
function checkStatus(onStatus) {
  try {
    wx.request({
      url: STATUS_URL,
      method: 'GET',
      timeout: STATUS_TIMEOUT,
      success: res => {
        if (res.statusCode === 200 && onStatus) {
          const d = res.data || {};
          onStatus({ processing: d.processing || 0, queue: d.queue || 0, maxQueue: d.maxQueue || 3, busy: !!d.busy });
        }
      },
      fail: () => {}
    });
  } catch (_) {}
}

/**
 * 自建 RMBG 抠图
 * @param {string} tempFilePath 本地临时 PNG 路径
 * @param {Object} [opts]
 * @param {Function} [opts.onQueue] 每次发起/重试前回调排队信息，形如
 *        onQueue({ attempt, queue, processing, busy, isRetry }) 供 UI 显示排队提示。
 * @returns {Promise<string>} 抠图后透明底 PNG 的本地临时路径
 */
async function segment(tempFilePath, opts) {
  opts = opts || {};
  const fs = wx.getFileSystemManager();
  const nonce = Math.random().toString(36).slice(2, 10);

  // 读 PNG → base64
  const b64 = fs.readFileSync(tempFilePath, 'base64');
  console.log('[matting.segment] PNG→base64 ≈' + Math.round(b64.length / 1024) + 'KB，直传 RMBG 后端');

  // 单次请求；resolve → 结果对象；reject → Error（code 标记类型）
  const doOnce = (attempt) => new Promise((resolve, reject) => {
    const started = Date.now();
    const data = { pngBase64: b64 };
    if (opts.compose && opts.compose.w && opts.compose.h) {
      data.compose = { w: opts.compose.w, h: opts.compose.h };  // 后端自动排版到该规格
    }
    wx.request({
      url: BACKEND_URL,
      method: 'POST',
      data: data,
      header: { 'Content-Type': 'application/json' },
      timeout: 120000,
      dataType: 'json',
      success: res => {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else if (res.statusCode === 429) {
          const err = new Error('MATTING_BUSY: 服务繁忙');
          err.code = 'MATTING_BUSY';
          reject(err);
        } else {
          reject(new Error('MATTING_HTTP_' + res.statusCode + ': ' + (res.data ? JSON.stringify(res.data).slice(0, 200) : '空响应')));
        }
      },
      fail: err => {
        // 请求阶段本身的失败（网络/超时）—— 同样进入重试阶梯，而非一次判死
        const e = new Error('MATTING_NETWORK: ' + (err.errMsg || JSON.stringify(err)));
        e.code = 'MATTING_NETWORK';
        reject(e);
      }
    });
  });

  // 重试阶梯：第一次为 attempt=1；失败后按 RETRY_DELAYS 递增等待重试，最多 RETRY_MAX 次。
  async function attemptLoop(attempt) {
    if (attempt > 1 && opts && opts.onQueue) {
      // 重试前：先探活拿到当前排队，如实告知用户正在重试
      let qi = { attempt, isRetry: true };
      checkStatus(s => { qi.queue = s.queue; qi.processing = s.processing; qi.busy = s.busy; });
      try { opts.onQueue(qi); } catch (_) {}
      const delay = RETRY_DELAYS[attempt - 2] != null ? RETRY_DELAYS[attempt - 2] : RETRY_DELAYS[RETRY_DELAYS.length - 1];
      await new Promise(r => setTimeout(r, delay));
    }
    let res;
    try {
      res = await doOnce(attempt);
    } catch (e) {
      // 429 或网络类错误 → 若还有次数，继续重试；否则抛给上层
      if ((e.code === 'MATTING_BUSY' || e.code === 'MATTING_NETWORK') && attempt < RETRY_MAX) {
        return await attemptLoop(attempt + 1);
      }
      throw e;
    }
    return res;
  }

  const result = await attemptLoop(1);
  if (!result || (result.code && result.code !== 0) || !result.pngBase64) {
    const err = new Error('MATTING_ERROR: ' + ((result && result.message) || '后端返回异常'));
    err.code = 'MATTING_ERROR';
    throw err;
  }
  console.log('[matting.segment] RMBG 完成 tookSec=' + (result.tookSec || '?') + ' model=' + (result.model || ''));

  // 写透明 PNG 到本地临时文件
  const out = wx.env.USER_DATA_PATH + '/matting_out_' + Date.now() + '_' + nonce + '.png';
  try {
    fs.writeFileSync(out, result.pngBase64, 'base64');
    console.log('[matting.segment] 透明 PNG 已写入临时文件 →', out,
                '≈' + Math.round(result.pngBase64.length / 1024 * 0.75) + 'KB');
    // compose 请求时返回 {path, composed}；无 compose 沿用字符串返回（向后兼容）
    if (opts.compose) {
      return { path: out, composed: !!result.detectOk, photoError: result.photoError || null };
    }
    return out;
  } catch (e) {
    // 老版本基础库 writeFileSync 不支持 base64 encoding → fallback ArrayBuffer
    console.warn('[matting.segment] writeFileSync base64 失败，fallback ArrayBuffer：', (e && e.errMsg) || e);
    const fb = await saveBufferToTemp(base64ToArrayBuffer(result.pngBase64), 'matting_out_' + Date.now() + '_' + nonce + '.png');
    if (opts.compose) {
      return { path: fb, composed: !!result.detectOk, photoError: result.photoError || null };
    }
    return fb;
  }
}

/** Base64 → ArrayBuffer（writeFileSync base64 不可用时的兜底） */
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** ArrayBuffer → 本地临时文件（writeFileSync base64 不可用兜底） */
function saveBufferToTemp(buffer, fileName) {
  return new Promise((resolve, reject) => {
    const fs = wx.getFileSystemManager();
    const out = wx.env.USER_DATA_PATH + '/' + fileName;
    fs.writeFile({
      filePath: out,
      data: buffer,
      encoding: 'binary',
      success: () => resolve(out),
      fail: (e) => reject(new Error('SAVE_BUFFER_FAILED: ' + (e.errMsg || JSON.stringify(e))))
    });
  });
}

module.exports = {
  segment,
  checkStatus,
  hasPrivacyConsent,
  grantPrivacyConsent,
  saveBufferToTemp
};
