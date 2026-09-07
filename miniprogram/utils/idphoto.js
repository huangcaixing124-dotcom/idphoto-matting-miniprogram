/**
 * utils/idphoto.js —— 证件照图像处理核心
 * 全部本地处理，无任何网络上传。基于 Canvas 2D 像素级操作。
 */

// 证件照规格（像素尺寸按国际标准 300 DPI 计算；1mm ≈ 11.811 px）
// mmW/mmH = 该规格真实物理尺寸(毫米,打印尺寸)，像素 = 物理 × 300DPI。
// note 标注非标准/占位项(保留选择但如实说明)。依据：各国官方证件/签证相片标准(2026-09-06 查证)。
const SPECS = [
  // ---- 常规尺寸 ----
  // scene = 常用场景提示(首页卡片展示；resume 无 scene 则不显示场景行)。
  // 场景文字严格按用户提供的参考表原文(2026-09-06),勿自行缩写/改写。
  // 顺序：一寸保持首位 = SPECS[0] 默认锚点(index默认高亮/edit·crop兜底)；其余按参考表尺寸升序。
  // 大一寸 33×48@300 = 390×567(与中国护照/港澳通行证同像素,通用名),scene 覆盖其护照/通行证/毕业证用途
  { id: 'one1', name: '一寸', width: 295, height: 413, mmW: 25, mmH: 35, group: 'common', scene: '简历、入职、学生证、社保卡、大部分考试报名、教资笔试' },
  { id: 'one1_small', name: '小一寸', width: 260, height: 378, mmW: 22, mmH: 32, group: 'common', scene: '驾驶证、体检表、护士证面试' },
  { id: 'one1_big', name: '大一寸', width: 390, height: 567, mmW: 33, mmH: 48, group: 'common', scene: '护照、港澳通行证、部分签证、毕业证学位证' },
  { id: 'one2_small', name: '小二寸', width: 413, height: 531, mmW: 35, mmH: 45, group: 'common', scene: '日韩签证、事业单位报名材料' }, // 修正 354×472→413×531@300DPI
  { id: 'one2', name: '二寸', width: 413, height: 579, mmW: 35, mmH: 49, group: 'common', scene: '入学报名、四六级、从业证书、结婚证' },
  { id: 'one2_big', name: '大二寸', width: 413, height: 626, mmW: 35, mmH: 53, group: 'common', scene: '考研复试、法考、档案资料、部分签证材料' },
  // ---- 驾驶证 / 通行证 ----
  { id: 'driver', name: '驾驶证', width: 260, height: 378, mmW: 22, mmH: 32, group: 'common', scene: '驾照申领·补换证' }, // 修正 350×490→260×378(22×32mm@300)=小一寸
  { id: 'driver_big', name: '大驾驶证', width: 413, height: 579, mmW: 35, mmH: 49, group: 'cert', note: '非标准·≈二寸' },
  { id: 'hk_macau', name: '港澳通行证', width: 390, height: 567, mmW: 33, mmH: 48, group: 'cert' }, // 修正 350×490→390×567(33×48mm@300)
  { id: 'tw', name: '台湾通行证', width: 567, height: 390, mmW: 48, mmH: 33, group: 'cert' }, // 修正 350×490→567×390(48×33mm 横版@300)
  // ---- 身份证 / 社保 / 学信网毕业采集（官方数字照片标准）----
  { id: 'idcard', name: '二代身份证', width: 358, height: 441, mmW: 26, mmH: 32, group: 'cert', note: '白底·350DPI' }, // 官方 358×441/350DPI/26×32mm 白底
  { id: 'social_card', name: '社保卡', width: 358, height: 441, mmW: 26, mmH: 32, group: 'common', scene: '入职·社保登记' }, // 全国标准 358×441/300DPI/26×32mm 白底
  { id: 'xuelingwang', name: '学信网毕业照', width: 480, height: 640, mmW: 41, mmH: 54, group: 'common', scene: '毕业采集·蓝底' }, // 学信网毕业采集 480×640 蓝底(物理≈41×54mm)
  // ---- 常见护照照片（按国官方标准；像素=物理×300DPI）----
  { id: 'passport_cn', name: '中国护照', width: 390, height: 567, mmW: 33, mmH: 48, group: 'passport' },   // 33×48mm
  { id: 'passport_us', name: '美国护照', width: 600, height: 600, mmW: 51, mmH: 51, group: 'passport' },   // 51×51mm(官方≥600×600)
  { id: 'passport_uk', name: '英国护照', width: 531, height: 413, mmW: 45, mmH: 35, group: 'passport' },   // 45×35mm 横版
  { id: 'passport_jp', name: '日本护照', width: 354, height: 472, mmW: 30, mmH: 40, group: 'passport' },   // 30×40mm 官方
  { id: 'passport_au', name: '澳大利亚护照', width: 413, height: 531, mmW: 35, mmH: 45, group: 'passport' }, // 35×45mm
  { id: 'passport_ca', name: '加拿大护照', width: 591, height: 827, mmW: 50, mmH: 70, group: 'passport' },  // 50×70mm 官网
  // ---- 主流国家签证照片 ----
  { id: 'visa_us', name: '美国签证', width: 600, height: 600, mmW: 51, mmH: 51, group: 'visa' }, // 官方要求≥600×600，修正 317×317
  { id: 'visa_shengen', name: '申根签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' }, // 修正 350×450→413×531@300
  { id: 'visa_japan', name: '日本签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_uk', name: '英国签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_canada', name: '加拿大签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_australia', name: '澳大利亚签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_korea', name: '韩国签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_thailand', name: '泰国签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  { id: 'visa_singapore', name: '新加坡签证', width: 413, height: 531, mmW: 35, mmH: 45, group: 'visa' },
  // ---- 打印照片 ----
  { id: 'photo_6inch', name: '6寸照片', width: 1205, height: 1795, mmW: 152, mmH: 102, group: 'print' }
];

// 内置底色
// 证件照常用底色（含主要国际证件照标准色），点色块即实时换底色。
// 顺序按「国内常用标准色前置」(2026-09-06 用户要求重排)：白(最高频)→浅蓝→深蓝→红→深红→
// 浅米黄→浅灰→黑。注：红用中国通行标准红(216,37,38)而非纯 255,0,0(偏荧光)；浅米黄用标准米黄(#F5E9D0)。
const BG_COLORS = [
  { name: '白色', r: 255, g: 255, b: 255 },  // 国际通行(护照/签证/通用) —— 国内最高频
  { name: '浅蓝', r: 0,   g: 120, b: 192 },  // 浅蓝(护照/大学工照通用)
  { name: '深蓝', r: 30,  g: 64,  b: 128 },  // 深蓝(政务/户口办理)
  { name: '红底', r: 216, g: 37,  b: 38  },  // 中国标准证件红
  { name: '深红', r: 166, g: 30,  b: 30  },  // 深红(部分登记/毕业照)
  { name: '浅米黄', r: 245, g: 233, b: 208 }, // 浅米黄(部分证件/简历)
  { name: '浅灰', r: 190, g: 190, b: 190 },  // 灰(证件中性背景)
  { name: '黑色', r: 0,   g: 0,   b: 0   }   // 黑(登记照/特殊用途)
];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0
  };
}

function rgbToHex(r, g, b) {
  const to = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + to(r) + to(g) + to(b);
}

/**
 * RGB -> YCbCr（BT.601）。以色度为主计算"感知色差"，对蓝背景/蓝衣服这类亮度接近但人眼能辨别的分离更有效。
 * @returns {{y:number, cb:number, cr:number}}
 */
function rgbToYCbCr(r, g, b) {
  return {
    y:  0.2990 * r + 0.5870 * g + 0.1140 * b,
    cb: 128 - 0.1687 * r - 0.3313 * g + 0.5000 * b,
    cr: 128 + 0.5000 * r - 0.4187 * g - 0.0813 * b
  };
}

/**
 * 感知色距（YCbCr 空间）：色度占主导，亮度弱权重，避免 RGB 欧式对亮度敏感的误判。
 * 已预先调了权重：Cb/Cr 是决定"色相"的主力，Y 只给 0.2 权重。
 * 返回值范围类似 RGB 欧氏距离（0~约 250），可以直接当 tol 用。
 */
function perceptualColorDistance(c1, c2) {
  const a = rgbToYCbCr(c1.r, c1.g, c1.b);
  const b = rgbToYCbCr(c2.r, c2.g, c2.b);
  const dy = (a.y - b.y) * 0.2;
  const dcb = a.cb - b.cb;
  const dcr = a.cr - b.cr;
  return Math.sqrt(dy * dy + dcb * dcb + dcr * dcr);
}

/**
 * 取像素到"多个参考色"的最小感知色距。
 * @param {{r:number,g:number,b:number}} px
 * @param {Array<{r:number,g:number,b:number}>} refs
 */
function minPerceptualDistance(px, refs) {
  let best = Infinity;
  for (let i = 0; i < refs.length; i++) {
    const d = perceptualColorDistance(px, refs[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 从 4 边 + 4 角 8 个独立区域分别取一个主色，作为 BFS 的多参考色集合。
 * 比起单个主色，能更好地兼容"顶部蓝底部灰"等渐变/不均背景。
 * @param {Uint8ClampedArray|Uint8Array|Buffer} data
 * @param {number} w
 * @param {number} h
 * @returns {Array<{r:number,g:number,b:number}>} 去重后的参考色数组（≤8）
 */
/**
 * 判断一个颜色是否属于"典型人像色"（肤色/深发色/深色西装）。
 * 当边缘采样的主色是人脸色时，说明该区域被人像占满了，不能作为背景参考色。
 * YCbCr 范围来自常见肤色检测论文：Cb 77~127，Cr 133~173，且 Y>=60。
 * 深色（头发/西装）：Y < 60 也排除（避免黑色西装占边被当成背景参考色）。
 */
function isHumanTone(c) {
  const ycb = rgbToYCbCr(c.r, c.g, c.b);
  // ===== 先排除「中性/近中性色」：Cb 和 Cr 都接近 128 =====
  //   中性灰（任何亮度）不可能是肤色/头发/西装 —— 这是证件照纯色背景的核心特征！
  //   纯灰 (200,200,200)   → Cb=128, Cr=128 ✅ 排除
  //   深灰 (90,90,100)     → Cb=125, Cr=128 ✅ 排除
  //   米黄底 (245,241,232) → Cb=123, Cr=131 ✅ 排除
  //   纯白底 (255,255,255) → Cb=128, Cr=128 ✅ 排除
  //   肤色 (200,170,160)   → Cb=116, Cr=150 ❌ Cr 超范围 → 不排除 ✅
  //   深蓝西装 (22,35,80)  → Cb=166, Cr=104 ❌ 都超范围 → 不排除 ✅
  //   领带 (50,110,200)    → Cb=168, Cr=67 ❌ 都超范围 → 不排除 ✅
  if (ycb.cb >= 115 && ycb.cb <= 140 && ycb.cr >= 115 && ycb.cr <= 140) return false;

  // 肤色（YCbCr 经验区间，已放宽适配 AI 蓝调肤色）
  if (ycb.y >= 50 && ycb.cb >= 60 && ycb.cb <= 145 && ycb.cr >= 118 && ycb.cr <= 185) return true;
  // 深色（头发/西装/阴影）
  if (ycb.y < 90) return true;
  // 极亮（纯白衬衫高光）
  if (ycb.y > 225) return true;
  return false;
}

/**
 * 从 4 条边的整条条带 + 4 角共 8 个区域分别取一个主色，
 * 并过滤掉"明显是人像色"的区域（当某条边被人像占满时不贡献参考色，避免误抠人）。
 * @returns {Array<{r:number,g:number,b:number}>|null} 去重后的参考色；若有效区域太少返回 null
 */
function detectEdgeReferenceColors(data, w, h) {
  const band = Math.min(6, Math.max(3, Math.min(Math.round(w * 0.01), Math.round(h * 0.01))));
  const sampleRegion = (startX, endX, startY, endY) => {
    const freq = {};
    let total = 0;
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const i = (y * w + x) * 4;
        const r = data[i] >> 4, g = data[i + 1] >> 4, b = data[i + 2] >> 4;
        const k = r + ',' + g + ',' + b;
        freq[k] = (freq[k] || 0) + 1;
        total++;
      }
    }
    if (total === 0) return null;
    let bestK = null, bestV = 0;
    for (const k in freq) if (freq[k] > bestV) { bestV = freq[k]; bestK = k; }
    if (!bestK) return null;
    const p = bestK.split(',');
    const c = { r: (+p[0]) << 4, g: (+p[1]) << 4, b: (+p[2]) << 4 };
    c._share = bestV / total;  // 最高频颜色在本区域中的占比（0~1）
    return c;
  };
  // 4 条边带（去掉四角！四角常是人脸/西装/领带干扰色）
  // 左右边带各向内缩 12% 截断，避免证件照西装顶到左右边缘时被当背景取色
  // 上下边带各向内缩 12% 截断，避开额头/领带
  const skipX = Math.floor(w * 0.12), skipY = Math.floor(h * 0.12);
  const regions = [
    [skipX, w - skipX, 0, band],                // 上边中段（不碰脸/头发顶部）
    [skipX, w - skipX, h - band, h],            // 下边中段（不碰西装下摆）
    [0, band, skipY, h - skipY],                // 左边中段（向内缩 skipY，不碰西装肩膀/下摆四角）
    [w - band, w, skipY, h - skipY]             // 右边中段
  ];
  const raw = [];
  for (const r of regions) {
    const c = sampleRegion(r[0], r[1], r[2], r[3]);
    if (c) raw.push(c);
  }
  // 按频率从高到低排序（重要！保证 raw[0] 是真正占比最大的底色）
  raw.sort((a, b) => b._share - a._share);
  if (raw.length === 0) return null;
  // 1. 色系一致性：以 top1 占比最大的颜色为锚定色
  //    色差 > 70 的边视为扫到人像（西装/脸/领带色）→ 直接丢弃
  const anchor = raw[0];
  const TOL_SQ = 70 * 70;
  const consistent = [anchor];
  for (let i = 1; i < raw.length; i++) {
    const c = raw[i];
    const dr = c.r - anchor.r, dg = c.g - anchor.g, db = c.b - anchor.b;
    const d2 = dr*dr + dg*dg + db*db;
    if (d2 <= TOL_SQ) consistent.push(c);
    else console.warn('[detectEdgeReferenceColors] ⚠️ 丢弃非一致边色:', JSON.stringify(c), '与锚色色差', Math.round(Math.sqrt(d2)));
  }
  // 2. 过滤：人像色 + 占比太低（<40% 说明边条带很杂，不该当背景）
  let filtered = consistent.filter(c => !isHumanTone(c) && c._share >= 0.35);
  // ===== 关键修复：如果过滤后为空，但 top1 颜色占比 ≥ 90% =====
  if (filtered.length === 0) {
    const top = consistent[0];
    if (top && top._share >= 0.9) filtered = [top];
  }
  if (filtered.length === 0) return null;
  // 3. 去重（感知色距 < 15 视为同一种）
  const out = [];
  for (const c of filtered) {
    let dup = false;
    for (const e of out) if (perceptualColorDistance(e, c) < 15) { dup = true; break; }
    if (dup) continue;
    out.push({ r: c.r, g: c.g, b: c.b });
  }
  return out.length ? out : null;
}


/**
 * 颜色改底（核心算法）
 * 支持多个目标背景色：像素只要匹配其中任意一个即被替换（用于多次点选）。
 * @param {ImageData} imageData canvas 图像数据
 * @param {Array|Object} targets 目标背景色集合，可传单个 {r,g,b} 或数组 [{r,g,b},...]
 * @param {Object} newBg     新底色 {r,g,b}
 * @param {number} tolerance 容差（色距阈值），越大替换范围越广
 * @returns {ImageData} 处理后的图像数据
 */
function changeBackgroundColor(imageData, targets, newBg, tolerance) {
  const data = imageData.data;
  const tol = tolerance || 80;
  // 羽化过渡带宽度（在容差之上再延伸的模糊区）
  const feather = tol * 0.35;
  const list = Array.isArray(targets) ? targets : [targets];
  const tolSq = tol * tol;
  const featherSq = feather * feather;

  // ===== 模式 1：如果 newBg 存在 → 换色模式（旧接口兼容）=====
  // ===== 模式 2：如果 newBg=null → 抠图模式（输出透明底人像！）=====
  // 抠图模式 = 和 regionGrowMask 产出的结果完全一样的透明底 PNG！
  // 这样 edit.js 的 render 只需要画 selectedBg 背景层 + 这个透明底人像 → 自动换色！
  const doCutout = !newBg;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];

    // 快速欧氏距离（用平方避免 sqrt）
    let minD2 = Infinity;
    for (let k = 0; k < list.length; k++) {
      const t = list[k]; if (!t) continue;
      const dr = r - t.r, dg = g - t.g, db = b - t.b;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 < minD2) minD2 = d2;
    }

    // 人像保护阈值（平方版本）：tol*0.35 ≈ 28
    const protectD2Low = (tol * 0.35) * (tol * 0.35);
    const protectD2Mid = (tol * 0.40) * (tol * 0.40);

    if (minD2 < tolSq) {
      // ===== 完全是底色区域 =====
      const ycb = rgbToYCbCr(r, g, b);
      // 用 isHumanTone()：自带 Cb/Cr 中性排除，避免深蓝底 y<90 被误判成深色西装
      const isPerson = isHumanTone({ r, g, b });
      if (isPerson) continue;  // 人像色：无条件保护，不看与底色的距离（深蓝底西装/米黄底白衬衫 即使与底色相近也不误擦）

      if (doCutout) {
        data[i + 3] = 0;  // 抠图模式：背景 → 完全透明
      } else {
        data[i] = newBg.r; data[i + 1] = newBg.g; data[i + 2] = newBg.b;  // 换色模式
      }
    } else if (minD2 < (tol + feather) * (tol + feather)) {
      // ===== 底色过渡带 =====
      const t = (Math.sqrt(minD2) - tol) / feather;  // 0~1
      const alpha = 1 - t;

      const ycb = rgbToYCbCr(r, g, b);
      // 用 isHumanTone()：自带 Cb/Cr 中性排除，避免深蓝底 y<90 被误判成深色西装
      const isPerson = isHumanTone({ r, g, b });
      if (isPerson) continue;  // 人像色：过渡带也保护（羽化过渡只在背景边缘做）

      if (doCutout) {
        // 抠图模式：半透明羽化
        data[i + 3] = Math.round(255 * alpha);
        // 同时做去色溢（decontaminate）：C' = (C - bg*(1-a))/a
        const a = data[i + 3] / 255;
        if (a > 0.04 && a < 0.96) {
          const bgIdx = 0;
          const bgRef = list[bgIdx];
          data[i] = Math.round((data[i] - bgRef.r * (1 - a)) / a);
          data[i + 1] = Math.round((data[i + 1] - bgRef.g * (1 - a)) / a);
          data[i + 2] = Math.round((data[i + 2] - bgRef.b * (1 - a)) / a);
        }
      } else {
        // 换色模式：颜色过渡混合
        data[i] = Math.round(newBg.r * alpha + r * (1 - alpha));
        data[i + 1] = Math.round(newBg.g * alpha + g * (1 - alpha));
        data[i + 2] = Math.round(newBg.b * alpha + b * (1 - alpha));
      }
    }
    // else: 明确不是底色（dist >= tol+feather）→ 保留原样（人像区域）
  }

  // ═══════════════════════════════════════════════════════════
  // 证件照强先验：中心矩形（宽 80%，高 92%）→ 100% 人像保护区
  // 经过上面判定后，中心区仍有 alpha<200 = 被误擦（西装/衬衫与底色相近时发生）
  // 直接硬恢复 alpha=255 —— 证件照中心绝不可能是背景
  // ═══════════════════════════════════════════════════════════
  {
    const w = imageData.width, h = imageData.height;
    const hw = Math.floor(w * 0.40);
    const hh = Math.floor(h * 0.46);
    const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const x1 = cx - hw, x2 = cx + hw;
    const y1 = cy - hh, y2 = cy + hh;
    const px = imageData.data;
    let recovered = 0;
    // 取 targets 平均底色（用于「像不像底色」的判断）
    let tr=0, tg=0, tb=0, tn=0;
    const tArr = Array.isArray(targets) ? targets : [targets];
    for (const t of tArr) { tr+=t.r; tg+=t.g; tb+=t.b; tn++; }
    const avgR = tr/tn, avgG = tg/tn, avgB = tb/tn;

    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const i = (y * w + x) * 4;
        if (px[i + 3] < 200) {
          // 感知色距 > 60 才判定为「被误擦的人像」→ 恢复
          // 感知色距 < 40 判定为「底色像素确实要透明」→ 不恢复
          const dr = px[i] - avgR, dg = px[i+1] - avgG, db = px[i+2] - avgB;
          const rm = (px[i] + avgR) / 2 / 256;
          // 感知色差（Luma 权重更高，RGB weighted）
          const d2 = (2+rm)*dr*dr + 4*dg*dg + (3-rm)*db*db;
          if (d2 > 60*60) {
            px[i + 3] = 255;
            recovered++;
          }
        }
      }
    }
    if (recovered > 0) {
      console.log('[changeBgColor] 🛡️  中心硬保护：恢复', recovered, '个被误擦人像像素');
    }
  }


  // ═══════════════════════════════════════════════════════════
  // 证件照先验辅助：外层 12% 边带（左右上下各 12%）必为背景
  // 这里的像素中心保护没覆盖到（因为中心保护只覆盖 80%×92%），
  // 可以大胆清：只要和底色感知差 < tol 就直接 alpha=0
  // 解决透明占比偏低（边缘背景残留）的问题
  // ═══════════════════════════════════════════════════════════
  {
    const w = imageData.width, h = imageData.height;
    const bxW = Math.floor(w * 0.12);
    const bxH = Math.floor(h * 0.12);
    const px = imageData.data;

    // 取 targets 平均底色
    let tr=0, tg=0, tb=0, tn=0;
    const tArr = Array.isArray(targets) ? targets : [targets];
    for (const t of tArr) { tr+=t.r; tg+=t.g; tb+=t.b; tn++; }
    const avgR = tr/tn, avgG = tg/tn, avgB = tb/tn;

    let cleared = 0;
    const tolSq = (typeof tolerance==='number' ? tolerance : 220);
    const tolEff = Math.max(tolSq, 200);  // 边带清理更激进
    const tolSqEff = tolEff * tolEff;

    const tryClear = (x, y) => {
      if (x<0||y<0||x>=w||y>=h) return;
      const i = (y * w + x) * 4;
      if (px[i+3] === 0) return;
      const r = px[i], g = px[i+1], b = px[i+2];
      // ① 人像色（肤色/深色西装/衬衫色 YCbCr 落入人像带）→ 绝对不能清！
      //    用 isHumanTone 直接过滤（含 Cb/Cr 中性排除）
      if (isHumanTone({ r, g, b })) return;
      // ② 与底色平均感知色距
      const dr = r - avgR, dg = g - avgG, db = b - avgB;
      const rm = (r + avgR) / 2 / 256;
      const d2 = (2+rm)*dr*dr + 4*dg*dg + (3-rm)*db*db;
      if (d2 <= tolSqEff) {
        px[i+3] = 0;
        cleared++;
      }
    };

    // 左边带
    for (let y = 0; y < h; y++) for (let x = 0; x < bxW; x++) tryClear(x, y);
    // 右边带
    for (let y = 0; y < h; y++) for (let x = w-bxW; x < w; x++) tryClear(x, y);
    // 顶边带（不要左右重复扫）
    for (let y = 0; y < bxH; y++) for (let x = bxW; x < w-bxW; x++) tryClear(x, y);
    // 底边带
    for (let y = h-bxH; y < h; y++) for (let x = bxW; x < w-bxW; x++) tryClear(x, y);

    if (cleared > 0) {
      console.log('[changeBgColor] 🧹 外层边带清理：清掉了', cleared, '个背景残留像素');
    }
  }

  return imageData;
}

/**
 * 自动识别背景主色（不依赖用户手动点选）。
 * 策略：采样图像四角 + 四条边缘的中段区域，用“桶聚类”找出占比最大的颜色作为背景主色。
 * 证件照场景背景多为单一纯色（墙/幕布/天空），四角边缘通常就是背景。
 * @param {ImageData} imageData 图像数据
 * @returns {{r,g,b}|null} 识别到的主背景色；失败返回 null
 */
function detectBackgroundColor(imageData) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  // 边缘采样带宽度（占边长的比例）
  const band = 0.06;
  const sw = Math.max(1, Math.round(w * band));
  const sh = Math.max(1, Math.round(h * band));

  const samples = [];
  const push = (x, y) => {
    const idx = (y * w + x) * 4;
    // 量化到 16 级，减少噪声，利于聚类
    const r = (data[idx] >> 4) << 4;
    const g = (data[idx + 1] >> 4) << 4;
    const b = (data[idx + 2] >> 4) << 4;
    samples.push({ r, g, b });
  };

  // 四角区域
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      push(x, y);
      push(w - 1 - x, y);
      push(x, h - 1 - y);
      push(w - 1 - x, h - 1 - y);
    }
  }
  // 上下边中段
  for (let x = sw; x < w - sw; x += Math.max(1, Math.floor(w / 60))) {
    for (let y = 0; y < sh; y++) {
      push(x, y);
      push(x, h - 1 - y);
    }
  }
  // 左右边中段
  for (let y = sh; y < h - sh; y += Math.max(1, Math.floor(h / 60))) {
    for (let x = 0; x < sw; x++) {
      push(x, y);
      push(w - 1 - x, y);
    }
  }

  // 简单桶聚类：统计量化后颜色频次
  const freq = {};
  let bestKey = null;
  let bestCount = 0;
  for (const s of samples) {
    const key = `${s.r},${s.g},${s.b}`;
    freq[key] = (freq[key] || 0) + 1;
    if (freq[key] > bestCount) {
      bestCount = freq[key];
      bestKey = key;
    }
  }
  if (!bestKey) return null;
  const parts = bestKey.split(',');
  return { r: +parts[0], g: +parts[1], b: +parts[2] };
}

/**
 * 对图像应用一个二进制 alpha 蒙版（用于 AI 抠图结果）。
 * mask 为同尺寸的单通道数组（0~255），255=保留前景，0=背景。
 * 背景像素 alpha 置 0，并去掉原背景色残留（可选）。
 * @param {ImageData} imageData 图像数据
 * @param {Uint8ClampedArray|Array} mask 与图像等尺寸的 alpha 蒙版（每像素 1 值）
 * @returns {ImageData} 处理后的图像（透明底）
 */
function applyMask(imageData, mask) {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const m = mask[i / 4];
    if (m < 128) {
      // 判定为背景：透明
      data[i + 3] = 0;
    }
    // 前景：保留 alpha（或按 mask 平滑过渡）
  }
  return imageData;
}

/**
 * 从图像边缘采样"背景主色"（比四角更稳健，兼容人像占满画面时四角可能被人物占据的情况）
 * @param {Uint8ClampedArray} data RGBA 像素
 * @param {number} w
 * @param {number} h
 * @returns {{r,g,b}|null}
 */
function detectEdgeDominantColor(data, w, h) {
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  const freq = {};
  const push = (x, y) => {
    const i = (y * w + x) * 4;
    const r = data[i] >> 4, g = data[i + 1] >> 4, b = data[i + 2] >> 4;
    const key = r + ',' + g + ',' + b;
    freq[key] = (freq[key] || 0) + 1;
  };
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < w; x++) {
      push(x, y); push(x, h - 1 - y);
    }
  }
  for (let y = band; y < h - band; y++) {
    for (let x = 0; x < band; x++) {
      push(x, y); push(w - 1 - x, y);
    }
  }
  let bestKey = null, best = 0;
  for (const k in freq) {
    if (freq[k] > best) { best = freq[k]; bestKey = k; }
  }
  if (!bestKey) return null;
  const p = bestKey.split(',');
  return { r: (+p[0]) << 4, g: (+p[1]) << 4, b: (+p[2]) << 4 };
}

/**
 * 形态学操作：二值 mask 的膨胀 / 腐蚀（作用于前景值 255）。
 * 使用方形结构元素。只改 mask 的前景/背景分界，不直接改 alpha 分级。
 */
/**
 * 把「人脸框」(来自 wx.faceDetect 的 detectRect：{originX, originY, width, height})
 * 按证件照头肩比例扩成"人像保护矩形"，区域内的像素永远不被 BFS 当作背景抠掉。
 *   - 宽度：人脸宽 × 2.0（约覆盖画面 2/3，留出两侧背景条带给 BFS 扩散起点）
 *   - 高度：人脸高 × 3.0（约覆盖头顶→胸部下方，留出上方头顶留白+下方底部留白）
 *   - 中心下移 fh*0.4（脸在矩形的上半部，下半给西装/肩膀）
 *   关键：保护矩形一定要比图幅小至少 1/3，否则四周背景没通道给 BFS 种子起步，整张图全不抠。
 * @param {{originX:number,originY:number,width:number,height:number}|null} faceRect
 * @param {number} w 图片宽
 * @param {number} h 图片高
 * @returns {{x1:number,y1:number,x2:number,y2:number}|null}  像素坐标系（含边界）的保护矩形；没检测到人脸返回 null
 */
function expandFaceToProtectRect(faceRect, w, h) {
  const empty = { strongRect: null, softRect: null };
  if (!faceRect) return empty;
  const fx = faceRect.originX, fy = faceRect.originY;
  const fw = faceRect.width, fh = faceRect.height;
  if (!fw || !fh) return empty;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const clampRect = (wPx, hPx, cyOff) => {
    const cyFin = cy + cyOff;
    let x1 = Math.round(cx  - wPx / 2);
    let y1 = Math.round(cyFin - hPx / 2);
    let x2 = x1 + wPx - 1;
    let y2 = y1 + hPx - 1;
    if (x1 < 0) x1 = 0; if (y1 < 0) y1 = 0;
    if (x2 > w - 1) x2 = w - 1; if (y2 > h - 1) y2 = h - 1;
    if (x1 >= x2 || y1 >= y2) return null;
    return { x1, y1, x2, y2 };
  };
  // strongRect：严格等于「人脸检测框本身 ± 1 像素安全裕量」，绝不包脖子/领口/头顶以上背景
  //   原因：calcIsBgPixel 已经对肤色/深色有 1.4× / 2.0× 保护，脖子/西装边缘颜色不会被误抠。
  //         strongRect 的唯一作用是防止「脸上高光/痘印/脸颊与背景色很接近的极端像素」被误抠穿。
  //         一旦 strongRect 稍微大一点点，就会把头顶上方真蓝底圈进去，导致背景抠不净。
  const sx1 = Math.max(0, fx);
  const sy1 = Math.max(0, fy);
  const sx2 = Math.min(w - 1, fx + fw - 1);
  const sy2 = Math.min(h - 1, fy + fh - 1);
  const strongRect = (sx1 >= sx2 || sy1 >= sy2) ? null : { x1:sx1, y1:sy1, x2:sx2, y2:sy2 };

  // softRect：头+肩+西装上半的大框
  const softRect   = clampRect(Math.round(fw * 2.1), Math.round(fh * 3.0), fh * 0.5);
  return { strongRect, softRect };
}

function morphDilate(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius && !hit; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[ny * w + nx] === 255) hit = 1;
        }
      }
      out[y * w + x] = hit ? 255 : 0;
    }
  }
  return out;
}
function morphErode(mask, w, h, radius) {
  if (radius <= 0) return mask;
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let full = 1;
      for (let dy = -radius; dy <= radius && full; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius && full; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[ny * w + nx] !== 255) full = 0;
        }
      }
      out[y * w + x] = full ? 255 : 0;
    }
  }
  return out;
}
// 闭运算：膨胀→腐蚀，用于填平前景内部小洞（西装领口、衬衫纽扣缝隙等）
function morphClose(mask, w, h, radius) {
  return morphErode(morphDilate(mask, w, h, radius), w, h, radius);
}
// 开运算：腐蚀→膨胀，用于去掉背景中孤立的小前景噪点
function morphOpen(mask, w, h, radius) {
  return morphDilate(morphErode(mask, w, h, radius), w, h, radius);
}

/**
 * 本地区域生长抠图（针对纯色背景）—— 改进版 v2。
 *
 * 关键能力：
 *   a) YCbCr 感知色距（不再用 RGB 欧式），对亮度变化容忍度更好
 *   b) 8 条边/角多参考色（边条带整段采样+人像色过滤，肤色/深色西装不会被误作参考）
 *   c) 前置"边框命中率"检查：人像占满四周→直接返回 null 让上层兜底，避免"整个人被抠没"
 *   d) 双阈值：tol₁（硬抠）BFS 扩散 → tol₂（软羽化）做缓冲区
 *   e) 形态学闭运算（填前景小洞） + 开运算（去背景小噪点）
 *   f) 羽化缓冲区：修正了 v1 mix 方向错误，对"边界像素"做"越像背景越透明、越远越前景"的软过渡
 *   g) 后置合理性检查：整图透明比例异常（过高/过低）→ 返回 null，拒绝给用户"空底色"
 *
 * @param {ImageData} imageData 原图数据
 * @param {number} tolerance 硬抠容差（推荐 55~80）
 * @returns {Uint8ClampedArray|null} 与图像等长的 mask（0 背景/255 前景/0-255 羽化）；异常返回 null
 */
function regionGrowMask(imageData, tolerance, protectRect) {
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const N = w * h;
  const tol1 = tolerance || 70;
  const refs = detectEdgeReferenceColors(data, w, h);
  if (!refs || !refs.length) return null;

  // ===== 关键检查：参考色和肤色/深色的感知色距是否太近？=====
  // 米黄底、浅灰底等"浅色证件照背景"在 YCbCr 空间和肤色 (Cb≈116,Cr≈149) 的色距
  // 可能只有 ~20，远小于 tol1=70 —— 纯颜色方法根本分不干净，必须跳过抠图走兜底。
  // 判定规则：如果 refs 中任意一个和典型肤色 (200,170,160) 的感知色距 < 35
  //           说明是浅色证件照背景 → 直接返回 null，强制上层走 changeBackgroundColor。
  const SKIN_TONE = { r: 200, g: 170, b: 160 };  // AI 蓝调肤色代表色
  const DARK_TONE = { r: 22, g: 35, b: 80 };     // 深色西装/头发
  let minSkinDist = Infinity, minDarkDist = Infinity;
  for (let k = 0; k < refs.length; k++) {
    const dS = perceptualColorDistance(refs[k], SKIN_TONE);
    const dD = perceptualColorDistance(refs[k], DARK_TONE);
    if (dS < minSkinDist) minSkinDist = dS;
    if (dD < minDarkDist) minDarkDist = dD;
  }
  // 肤色太近（<35）→ 米黄/浅灰底，分不清，跳过
  // 深色太近（<35）→ 深灰/黑底，同样分不清，跳过
  if (minSkinDist < 35 || minDarkDist < 35) return null;
  // 支持新/旧两种 protectRect 入参：优先 expandFaceToProtectRect(faceRect) 返回的 {strongRect, softRect}
  let strongRect = null, softRect = null;
  if (protectRect && protectRect.strongRect !== undefined) {
    strongRect = protectRect.strongRect;
    softRect   = protectRect.softRect;
  } else if (protectRect && ('x1' in protectRect)) {
    // 旧格式（单矩形 x1/y1/x2/y2）：当成强保护（严格），弱保护同样
    strongRect = protectRect;
    softRect   = protectRect;
  }
  // strongProtected：脸/脖子+领口的"绝对前景保护"(值 1=永远前景，即使颜色很像背景也不抠)
  // softProtected  ：头+肩+西装上半的"软保护"(isBgPixel 门槛额外 ×1.25，更难被判为背景)
  const strongProtected = new Uint8Array(N);
  const softProtected   = new Uint8Array(N);
  const fillRect = (r, buf) => {
    if (!r) return;
    for (let y = r.y1; y <= r.y2; y++) {
      const row = y * w;
      for (let x = r.x1; x <= r.x2; x++) buf[row + x] = 1;
    }
  };
  fillRect(strongRect, strongProtected);
  fillRect(softRect,   softProtected);

  // ===== 前置：先算 effectiveTol1，再用 isBgPixel（含人像色放大保护）统计边框命中率 =====
  // 先基于 border 做粗判定自适应：边框像素"未保护时"的色距 < tol1 的比例
  let borderPixels = 0, borderRawHits = 0;
  for (let x = 0; x < w; x++) {
    for (const _y of [0, h - 1]) { borderPixels++;
      const i = (_y * w + x) * 4;
      if (minPerceptualDistance({ r: data[i], g: data[i+1], b: data[i+2] }, refs) < tol1) borderRawHits++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const _x of [0, w - 1]) { borderPixels++;
      const i = (y * w + _x) * 4;
      if (minPerceptualDistance({ r: data[i], g: data[i+1], b: data[i+2] }, refs) < tol1) borderRawHits++;
    }
  }
  const rawHitRate = borderPixels ? borderRawHits / borderPixels : 0;
  if (rawHitRate < 0.18) return null; // 四周几乎没背景色，直接放弃
  // 自适应：原图背景色差小（rawHitRate 低）→ 收紧；色差大（高）→ 放宽
  let effectiveTol1;
  if (rawHitRate < 0.35)      effectiveTol1 = tol1 * 0.85;
  else if (rawHitRate > 0.85) effectiveTol1 = tol1 * 1.1;
  else                        effectiveTol1 = tol1;
  const effectiveTol2 = effectiveTol1 * 1.8 + 18;

  // 再跑一次"带人像色保护"的真实边框命中率，若连 10% 都不到 → 放弃（说明边框上大量都是深色/肤色的人像）
  let borderReal = 0, borderRealHits = 0;
  const yToProtectCache = {};
  const isBgPixelProbe = (r,g,b,x,y) => {
    const yLum = 0.2990*r + 0.5870*g + 0.1140*b;
    const cb = 128 - 0.1687*r - 0.3313*g + 0.5000*b;
    const cr = 128 + 0.5000*r - 0.4187*g - 0.0813*b;
    let protect = 1;
    if (yLum < 90) protect = 2.0;
    else if (yLum >= 50 && cb >= 60 && cb <= 145 && cr >= 118 && cr <= 185) protect = 1.5;
    else if (yLum > 225) protect = 1.3;
    // softProtect 只对人像色候选叠 (protect > 1 才叠)
    const idxP = y*w + x;
    if (protect > 1 && softProtected[idxP]) protect *= 1.3;
    if (protect === 1) return minPerceptualDistance({r,g,b}, refs) < effectiveTol1;
    let best = Infinity;
    for (let k=0; k<refs.length; k++) {
      const d = perceptualColorDistance({r,g,b}, refs[k]) * protect;
      if (d < best) best = d;
    }
    return best < effectiveTol1;
  };
  for (let x = 0; x < w; x++) {
    for (const _y of [0, h - 1]) { borderReal++;
      const i = (_y * w + x) * 4;
      if (isBgPixelProbe(data[i], data[i+1], data[i+2], x, _y)) borderRealHits++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (const _x of [0, w - 1]) { borderReal++;
      const i = (y * w + _x) * 4;
      if (isBgPixelProbe(data[i], data[i+1], data[i+2], _x, y)) borderRealHits++;
    }
  }
  const realRate = borderReal ? borderRealHits / borderReal : 0;
  if (realRate < 0.10) return null; // 带保护后命中率仍低 → 四周全是人像色，放弃
  const visited = new Uint8Array(N);
  const mask = new Uint8ClampedArray(N);
  mask.fill(255);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;

  // 「这像素是否算背景？」判定：
  //   a) 人像典型色（深/肤色/极亮）色距放大保护
  //   b) 在 softRect (头肩大框) 内再额外 ×1.25 (更难被判背景)
  //   c) 在 strongRect (脸+脖子) 内 → calcIsBgPixel 判什么都不重要，外层直接强制前景
  function calcIsBgPixel(r, g, b, idx) {
    const y = 0.2990*r + 0.5870*g + 0.1140*b;
    const cb = 128 - 0.1687*r - 0.3313*g + 0.5000*b;
    const cr = 128 + 0.5000*r - 0.4187*g - 0.0813*b;
    let protect = 1;
    if (y < 90) protect = 2.0;
    else if (y >= 50 && cb >= 60 && cb <= 145 && cr >= 118 && cr <= 185) protect = 1.5;
    else if (y > 225) protect = 1.3;
    // softRect 只对"已经被判定为人像色候选 (protect > 1) 的像素"再叠加收紧，
    // 对纯背景色 (protect === 1) 绝不能叠 softProtect，否则头顶大片蓝底会被错误判不抠
    if (protect > 1 && softProtected[idx]) protect *= 1.3;
    if (protect === 1) return minPerceptualDistance({r,g,b}, refs) < effectiveTol1;
    let best = Infinity;
    for (let k = 0; k < refs.length; k++) {
      const d = perceptualColorDistance({r,g,b}, refs[k]) * protect;
      if (d < best) best = d;
    }
    return best < effectiveTol1;
  }

  const enqueueIfBg = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    const i = idx * 4;
    if (!calcIsBgPixel(data[i], data[i+1], data[i+2], idx)) return;
    visited[idx] = 1;
    // 人脸+脖子强保护：哪怕判定为背景色，也绝不写成 mask=0
    // 但 visited 和 queue 正常入 → 这个点仍可作为 BFS 扩散通道，保证四边种子走通
    if (!strongProtected[idx]) mask[idx] = 0;
    queue[tail++] = idx;
  };
  for (let x = 0; x < w; x++) { enqueueIfBg(x, 0); enqueueIfBg(x, h - 1); }
  for (let y = 0; y < h; y++) { enqueueIfBg(0, y); enqueueIfBg(w - 1, y); }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0)     enqueueIfBg(x - 1, y);
    if (x < w - 1) enqueueIfBg(x + 1, y);
    if (y > 0)     enqueueIfBg(x, y - 1);
    if (y < h - 1) enqueueIfBg(x, y + 1);
  }

  // ====== 形态学：闭运算（填前景小洞）+ 开运算（去背景小噪点）======
  const closeR = Math.max(2, Math.round(Math.min(w, h) * 0.005));
  const openR  = Math.max(1, closeR - 1);
  const stage1 = morphClose(mask, w, h, closeR);
  let stage2 = morphOpen(stage1, w, h, openR);

  // ====== 连通死角补抠（逐像素查表法）======
  // 先把 calcIsBgPixel 的结果预计算成 Uint8Array 查找表，
  // 避免补抠循环里函数调用作用域不一致造成 calc 结果错误。
  {
    const calcBgLookup = new Uint8Array(N);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (strongProtected[idx]) continue;            // 强保护跳过，默认 0 = 不算背景
        const i = idx * 4;
        if (calcIsBgPixel(data[i], data[i+1], data[i+2], idx)) calcBgLookup[idx] = 1;
      }
    }
    let filled = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (stage2[idx] !== 255) continue;
        if (calcBgLookup[idx]) {
          stage2[idx] = 0;
          filled++;
        }
      }
    }
    // console.log('[补抠] 通过查找表新增 bg 像素数 =', filled);
  }

  // ====== 后置合理性检查：透明像素占比 ======
  // 整图几乎全透明（>95%）→ 人像被全抠了，异常返回 null
  // 整图几乎全不透明（<5%）→ 根本没识别到背景，返回 null
  let bgCount = 0; for (let i = 0; i < N; i++) if (stage2[i] === 0) bgCount++;
  const bgRatio = bgCount / N;
  if (bgRatio > 0.95 || bgRatio < 0.05) return null;

  // ====== 软羽化：沿硬边界的前景像素做"距离背景表面远近 + 色差远近"双条件软映射 ======
  // 注意 v1 这里 mix 方向搞反了（把 1-mix 误当前景），下面重写：
  //   - t：色差归一化（0 → tol₁ 边界，1 → tol₂ 边缘），越大越"像前景"
  //   - s：物理距离归一化（靠近背景表面=0→像背景，远离=1→像前景）
  //   - 最终 alpha = max(t,s) × 255
  const alpha = new Uint8ClampedArray(stage2); // 先复制二值（纯前景 255，纯背景 0）
  const featherBand = Math.max(2, Math.round(Math.min(w, h) * 0.008));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (stage2[idx] !== 255) continue;          // 已经是背景（0）→ 不处理
      // 检查 3x3 邻域是否碰到背景，碰不到直接跳过（不是边界）
      let onEdge = false;
      for (let dy = -1; dy <= 1 && !onEdge; dy++) {
        const ny = y + dy; if (ny<0 || ny>=h) continue;
        for (let dx = -1; dx <= 1 && !onEdge; dx++) {
          if (dx===0 && dy===0) continue;
          const nx = x + dx; if (nx<0 || nx>=w) continue;
          if (stage2[ny*w+nx] === 0) onEdge = true;
        }
      }
      if (!onEdge) continue;
      if (strongProtected[idx]) continue;   // 脸+脖子强保护 → 直接前景 255，不做羽化削边
      const inSoft = !!softProtected[idx];  // 头肩软保护 → 羽化门槛再 ×1.25
      const i = idx * 4;
      const r = data[i], g = data[i+1], b = data[i+2];
      const yFeat = 0.2990*r + 0.5870*g + 0.1140*b;
      const cbFeat = 128 - 0.1687*r - 0.3313*g + 0.5000*b;
      const crFeat = 128 + 0.5000*r - 0.4187*g - 0.0813*b;
      let fprotect = 1;
      if (yFeat < 90) fprotect = 2.0;
      else if (yFeat >= 50 && cbFeat >= 60 && cbFeat <= 145 && crFeat >= 118 && crFeat <= 185) fprotect = 1.5;
      else if (yFeat > 225) fprotect = 1.3;
      if (fprotect > 1 && inSoft) fprotect *= 1.3;  // 只对人像色叠保护，纯背景色羽化正常
      let dFeat;
      if (fprotect === 1) dFeat = minPerceptualDistance({r, g, b}, refs);
      else {
        let best = Infinity;
        for (let k = 0; k < refs.length; k++) {
          const d = perceptualColorDistance({r, g, b}, refs[k]) * fprotect;
          if (d < best) best = d;
        }
        dFeat = best;
      }
      if (dFeat >= effectiveTol2) continue;
      const d = dFeat;
      // 找邻域 featherBand 范围内最近的背景像素距离（步长步数）
      let minSteps = featherBand;
      for (let dY = -featherBand; dY <= featherBand; dY++) {
        const ny = y + dY; if (ny<0 || ny>=h) continue;
        for (let dX = -featherBand; dX <= featherBand; dX++) {
          const nx = x + dX; if (nx<0 || nx>=w) continue;
          if (stage2[ny*w+nx] !== 0) continue;
          const steps = Math.max(Math.abs(dX), Math.abs(dY));
          if (steps < minSteps) minSteps = steps;
        }
      }
      // t=0 → 色差就是硬边界，基本是背景；t=1 → 色差刚好达到羽化上限，基本是前景
      const t = Math.max(0, Math.min(1, (d - effectiveTol1) / (effectiveTol2 - effectiveTol1)));
      // s=0 → 紧贴背景像素；s=1 → 离背景表面 featherBand 步开外，纯前景
      const s = Math.max(0, Math.min(1, minSteps / featherBand));
      // 越像前景越不透明：取两者取"更像前景的"那个（max 保守，更不倾向误抠）
      const alphaMix = Math.max(t, s);
      const a = Math.round(255 * alphaMix);
      if (a < alpha[idx]) alpha[idx] = a;  // 只下调（从 255 往半透明改）
    }
  }
  return alpha;
}

/**
 * 综合 8 个参考色，给出"最可能的背景色"（加权平均）。
 * 用于颜色溢出剥离时选择"用哪个背景色去减"。
 */
function avgReferenceColor(refs) {
  if (!refs || !refs.length) return { r: 255, g: 255, b: 255 };
  let r = 0, g = 0, b = 0;
  for (const c of refs) { r += c.r; g += c.g; b += c.b; }
  const n = refs.length;
  return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * 把区域生长 mask 应用到 ImageData，生成透明底图像。
 * 并对边缘半透明像素执行「颜色溢出剥离 (Decontaminate Colors)」：
 *   经典公式 C' = (C - bg*(1-a)) / a，
 *   去掉原背景色在边缘的"白边/彩边"，使得叠到任何新底色上都不会出现假边。
 *
 * @param {ImageData} imageData 原图
 * @param {Uint8ClampedArray} mask regionGrowMask 的返回值（可能含 0~255 半透明）
 * @param {Array<{r:number,g:number,b:number}>|null} refs 背景参考色集合（用于选去溢出色）
 * @returns {ImageData} 处理后的透明底图像
 */
function applyRegionGrowMask(imageData, mask, refs) {
  const data = imageData.data;
  const bg = refs && refs.length ? avgReferenceColor(refs) : null;
  const clamp = v => v < 0 ? 0 : (v > 255 ? 255 : v);
  const hasBg = !!bg;
  for (let i = 0; i < data.length; i += 4) {
    const a = mask[i / 4];
    if (a === 0) {
      data[i + 3] = 0;
      continue;
    }
    if (a === 255) {
      // 纯前景：保持 alpha=255，不做颜色修正（避免破坏前景主体）
      data[i + 3] = 255;
      continue;
    }
    // 半透明像素：写软 alpha；若有参考色背景，则顺便去背景色溢出（防白边/彩边）
    const fa = a / 255;
    if (hasBg && fa > 0.04) {
      const oneMinusA = 1 - fa;
      const inv = 1 / fa;
      data[i]     = clamp((data[i]     - bg.r * oneMinusA) * inv);
      data[i + 1] = clamp((data[i + 1] - bg.g * oneMinusA) * inv);
      data[i + 2] = clamp((data[i + 2] - bg.b * oneMinusA) * inv);
    }
    data[i + 3] = a;
  }
  return imageData;
}

module.exports = {
  SPECS,
  BG_COLORS,
  hexToRgb,
  rgbToHex,
  changeBackgroundColor,
  detectBackgroundColor,
  detectEdgeReferenceColors,
  perceptualColorDistance,
  minPerceptualDistance,
  expandFaceToProtectRect,
  isHumanTone,
  regionGrowMask,
  applyRegionGrowMask,
  applyMask,
  drawCenterCrop
};

/**
 * 缩放图片数据到目标尺寸（用于导出固定规格）
 * @param {Canvas} canvas       目标 canvas 2d 实例（已设置尺寸）
 * @param {CanvasContext} ctx   其 2d 上下文
 * @param {Image} image         源图
 * @param {number} width        目标宽
 * @param {number} height       目标高
 */
function drawCenterCrop(ctx, image, width, height) {
  const sw = image.width;
  const sh = image.height;
  const s_ratio = sw / sh;
  const d_ratio = width / height;

  let sx, sy, sw2, sh2;
  if (s_ratio > d_ratio) {
    // 源图更宽，裁剪左右两侧
    sh2 = sh;
    sw2 = sh * d_ratio;
    sx = (sw - sw2) / 2;
    sy = 0;
  } else {
    // 源图更高，裁剪上下
    sw2 = sw;
    sh2 = sw / d_ratio;
    sx = 0;
    sy = (sh - sh2) / 2;
  }
  ctx.drawImage(image, sx, sy, sw2, sh2, 0, 0, width, height);
}
