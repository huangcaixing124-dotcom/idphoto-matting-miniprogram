/**
 * utils/beautify.js —— 证件照美颜（MVP：美白 + 磨皮）
 *
 * 全部本地 canvas 像素级处理，一次成型，不依赖人脸关键点（后续可扩展瘦脸/大眼）。
 * 设计约束：
 *   - 纯色证件照：美白/磨皮必须"保人像主体、不糊发丝/西装/纯底"。
 *   - 只在 YCbCr 亮度域做，避免色相偏移；用"亮度差门限"做保边，边缘(发丝/轮廓)不被模糊。
 *   - 一次调用处理一整张图，600×800 本地跑 < 0.5s，无卡顿。
 */

// ---- CIE/BT.601 亮度（与 磨皮 边缘判定共用）----
function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 美白：提亮皮肤亮度，压低肤色失真。
 * - 只对"亮度低于上限"的前景像素提亮，避免纯白底/白衬衫整体过曝往上冲。
 * - strength∈[0,1]，0=不变。
 * @param {Float32Array|Uint8ClampedArray} px RGBA 像素（就地改 RGB，alpha 不动）
 * @param {number} n 像素个数
 * @param {number} strength 0~1
 */
function whiten(px, n, strength) {
  if (strength <= 0) return;
  // 提亮倍率：亮度越高提越少（保护高光细节），暗处多提一点（提亮肤色）
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const y = luma(px[j], px[j + 1], px[j + 2]);
    if (y < 40) continue;              // 太暗（深发/黑西装）不动
    const boost = strength * (1 - y / 255) * 0.55;  // 暗皮多提，高光少提
    if (boost <= 0) continue;
    px[j]     = Math.min(255, px[j]     + px[j]     * boost);
    px[j + 1] = Math.min(255, px[j + 1] + px[j + 1] * boost);
    px[j + 2] = Math.min(255, px[j + 2] + px[j + 2] * boost);
  }
}

/**
 * 磨皮：保边亮度域双边平滑。
 * - 3×3/5×5 窗口，只平滑"亮度差小"的像素（同肤色的平滑区域）；
 *   亮度差大的（发丝/人脸轮廓/眼眉）→ 跳过，保住边缘锐利。
 * - 配合 strength∈[0,1]，越高窗口越大、越糊。
 * @param {Uint8ClampedArray} data RGBA（就地改 RGB）
 * @param {number} w
 * @param {number} h
 * @param {number} strength 0~1
 */
function smooth(data, w, h, strength) {
  if (strength <= 0) return;
  const n = w * h;
  const src = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) src[i] = data[i];
  const radius = strength < 0.5 ? 1 : 2;         // 窗口 3×3 / 5×5
  const edgeThr = 22 - strength * 12;            // 亮度差门限：强度越大门限越低(越多被平滑)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const j = i * 4;
      const y0 = luma(src[j], src[j + 1], src[j + 2]);
      if (y0 < 40) continue;                     // 深色(发丝/西装)不磨，别糊轮廓
      let sumR = 0, sumG = 0, sumB = 0, cnt = 0;
      const y1 = Math.max(1, y - radius), y2 = Math.min(h - 2, y + radius);
      const x1 = Math.max(1, x - radius), x2 = Math.min(w - 2, x + radius);
      for (let ny = y1; ny <= y2; ny++) {
        for (let nx = x1; nx <= x2; nx++) {
          const k = (ny * w + nx) * 4;
          const yk = luma(src[k], src[k + 1], src[k + 2]);
          if (Math.abs(yk - y0) > edgeThr) continue;  // 边缘不参与，保锐度
          sumR += src[k]; sumG += src[k + 1]; sumB += src[k + 2]; cnt++;
        }
      }
      if (cnt > 0) {
        const mix = 0.65 + strength * 0.3;          // 平滑程度
        data[j]     = Math.round(src[j]     + (sumR / cnt - src[j])     * mix);
        data[j + 1] = Math.round(src[j + 1] + (sumG / cnt - src[j + 1]) * mix);
        data[j + 2] = Math.round(src[j + 2] + (sumB / cnt - src[j + 2]) * mix);
      }
    }
  }
}

/**
 * 美颜主入口。
 * @param {ImageData} imageData 源图像数据（就地修改并返回）
 * @param {{whiten?:number, smooth?:number}} opts 0~1 强度；缺省 0
 * @returns {ImageData}
 */
function beautify(imageData, opts) {
  opts = opts || {};
  const w = imageData.width, h = imageData.height;
  const n = w * h;
  const data = imageData.data;
  const wh = Math.max(0, Math.min(1, opts.whiten || 0));
  const sm = Math.max(0, Math.min(1, opts.smooth || 0));
  if (wh > 0) whiten(data, n, wh);
  if (sm > 0) smooth(data, w, h, sm);
  return imageData;
}

module.exports = { beautify, whiten, smooth, luma };
