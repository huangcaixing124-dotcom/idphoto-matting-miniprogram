const { SPECS, BG_COLORS, rgbToHex, drawCenterCrop, detectEdgeReferenceColors, changeBackgroundColor, detectBackgroundColor, expandFaceToProtectRect, isHumanTone } = require('../../utils/idphoto.js');
const { beautify } = require('../../utils/beautify.js');
const { addRecord } = require('../../utils/storage.js');
const matting = require('../../utils/matting.js');

// 画布显示区：长边上限（CSS 像素）
const DISPLAY_MAX = 320;
// 画布外扩留白比例(相对照片区最长边)：给裁剪线框外的 mm 打版标注留空间，不宜过大否则增高画布盖底部
const PAD_RATIO = 0.045;

Page({
  data: {
    hasImage: false,
    mattingBusy: false,
    mattingMode: false,
    mattingFailed: false,
    canvasW: 300,
    canvasH: 400,
    // 【临时隐藏·勿删数据】edit 页规格 chip 列表过滤掉已下线的「打印」组(6寸)。
    // photo_6inch 数据仍在 SPECS 里；逻辑 find(activeSpec/applyFrameSize) 仍走全量 SPECS，加回时这里放行 print 即可。
    specs: SPECS.filter(s => s.group !== 'print'),
    selectedSpecId: '',
    selectedSpecRatio: 1,
    specRatioLabel: '',
    // 规格 chip 横向滚动定位：值为当前选中 spec 的 id，scroll-view 自动滚到该 chip 可见(首页跳入/页内切规格都触发)
    specScrollIntoView: '',
    bgColors: BG_COLORS.filter(c => c.r !== null),
    selectedBgIdx: 1,
    selectedBg: { r: 67, g: 134, b: 225 },
    tolerance: 80,
    // ---- 人脸检测状态（只用于保护兜底 + 自动定位，失败静默跳过）----
    faceLocked: false
  },

  onLoad(options) {
    // 打开右上角「转发 + 分享到朋友圈」入口
    try { wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (_) {}
    if (!options.image) return;
    this.imagePath = decodeURIComponent(options.image);
    this.specId = options.specId || SPECS[0].id;
    this.setData({ hasImage: true, selectedSpecId: this.specId });
    this._personScale = 1;
    this._personNx = 0;
    this._personNy = 0;
    this._mattingImg = null;
    this._mattingImgPath = null;
    this._colorImg = null;
    this._touch = null;
    this._composed = false;    // 后端已自动排版到 spec → 铺满显示，禁用前端缩放/拖动手势
    this._faceRect = null;       // 人脸框（_srcPixels 空间），detectFace() 异步填充；空 = 没检测到
    this._beautifiedPixels = null; // 美颜后的工作像素；null = 未美颜，用 _srcPixels 原图
    this._epoch = 0;          // 代际守卫(2026-09-06)：每次重载源 +1；在途抠图回调校验 epoch，过期结果不写 _mattingImg，避免 A/B 并发在途旧结果覆盖新图
  },

  onUnload() {
    this._mattingImg = null;
    this._mattingImgPath = null;
    this._colorImg = null;
    this.imagePath = '';
  },

  onReady() {
    this.initCanvas();
  },

  activeSpec() {
    return SPECS.find(s => s.id === this.data.selectedSpecId) || SPECS[0];
  },

  // 抠图/导出用的工作像素源：美颜后优先用 _beautifiedPixels；未美颜用原始 _srcPixels。
  // 美颜结果永远建立在「原始 _srcPixels」之上，绝不基于已合成色底的图。
  _mattingSource() {
    return this._beautifiedPixels || this._srcPixels;
  },

  initCanvas() {
    if (!this.imagePath) return;
    const query = wx.createSelectorQuery();
    query
      .select('#editCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0]) return;
        const { node: canvas } = res[0];
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.applyFrameSize(this.specId);
        this.loadSource();
      });
  },

  // 根据规格真实宽高比设置画布帧尺寸
  applyFrameSize(specId) {
    const spec = SPECS.find(s => s.id === specId) || SPECS[0];
    const ratio = spec.width / spec.height;
    // 画布最长边按「可用视口高度」自适应封顶(2026-09-06 修复)。
    // 0.34 = 屏幕高的约 1/3 留给画布，让画布下方还有空间显示 tips、且不被底部固定工具栏盖住。
    // (工具栏已设 max-height:48vh，画布+tips 需一起落在 52vh 之上。)
    let maxDim = DISPLAY_MAX;
    try {
      const { windowHeight } = wx.getSystemInfoSync();
      if (windowHeight > 0) maxDim = Math.min(maxDim, Math.round(windowHeight * 0.34));
    } catch (_) {}
    let cw, ch;
    if (ratio >= 1) {
      cw = maxDim;
      ch = maxDim / ratio;
    } else {
      ch = maxDim;
      cw = maxDim * ratio;
    }
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    // 照片区逻辑尺寸(手势/导出映射都用它，不含留白)
    this._frameW = cw;
    this._frameH = ch;
    // 四周留白(逻辑 px)：给裁剪线框外的 mm 标注留空间
    const pad = Math.max(14, Math.round(Math.max(cw, ch) * PAD_RATIO));
    this._pad = pad;
    // 画布内部 = 照片区外围一圈留白；DOM 尺寸=canvasW/H 也含留白，让角标可见
    this.canvas.width  = Math.round((cw + pad * 2) * dpr);
    this.canvas.height = Math.round((ch + pad * 2) * dpr);
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.setData({
      canvasW: Math.round(cw + pad * 2),
      canvasH: Math.round(ch + pad * 2),
      selectedSpecId: specId,
      selectedSpecRatio: ratio,
      // 让底部规格 chip 横向滚动到当前选中项(首页跳入/切规格都自动定位)
      specScrollIntoView: specId,
      // 底部像素标注：由「当前比例 A:B」改为「像素 A×B」(数据来自 spec.width/height)
      specRatioLabel: '像素 ' + spec.width + '×' + spec.height,
      // 打版式双 mm 标注(宽对宽、高对高；全部来自同一 SPECS 的 mmW/mmH，缺省按 300DPI 反算 mm)
      mmWLabel: (spec.mmW != null ? spec.mmW : Math.round(spec.width / 11.811)) + 'mm',
      mmHLabel: (spec.mmH != null ? spec.mmH : Math.round(spec.height / 11.811)) + 'mm'
    });
    this._personScale = 1;
    this._personNx = 0;
    this._personNy = 0;
    this._composed = false;
    // 注意：这里【不】清 _mattingImg —— 它是抠图/规格切换都要保留的透明人像结果。
    // 切规格(onSelectSpec)复用同一抠图、仅改画幅 re-fit；清 _mattingImg 会让切规格后
    // render 回退成画原图(2026-09-06 用户上报回归)。重载新源(onReselect)会自己显式清空。
  },

  loadSource() {
    // 代际守卫(2026-09-06)：进入一段新源即提高 epoch，使所有更早发起、尚在途的抠图/换色结果判定为过期
    this._epoch = (this._epoch || 0) + 1;
    const epoch = this._epoch;
    const off = wx.createOffscreenCanvas({ type: '2d', width: 10, height: 10 });
    const img = off.createImage();
    const inst = this;
    img.onload = () => {
      // ── 永久保存原图（绝不能被预览合成覆盖）──
      inst._srcImg = img;                 // 原图 Image 对象（真实像素源）
      inst._srcImagePath = inst.imagePath; // 原图路径，重置时恢复

      // ── 提前把原图缩到 MAX 600，备份好 RGBA 像素（后续每次抠图都从这里深拷贝）──
      const srcW = img.width, srcH = img.height;
      const MAX = 600;
      const scale = Math.min(1, MAX / Math.max(srcW, srcH));
      const ow = Math.round(srcW * scale), oh = Math.round(srcH * scale);
      const offSrc = wx.createOffscreenCanvas({ type: '2d', width: ow, height: oh });
      const ctxSrc = offSrc.getContext('2d');
      ctxSrc.drawImage(img, 0, 0, ow, oh);
      const srcImageData = ctxSrc.getImageData(0, 0, ow, oh);
      // 深拷贝，不被后续 putImageData 改
      inst._srcPixels = {
        data: new Uint8ClampedArray(srcImageData.data),
        width: ow, height: oh
      };
      inst._beautifiedPixels = null;   // 每次重载原图，美颜结果清零（美颜永远基于原始 _srcPixels）

      inst._colorImg = img;
      inst.setData({ hasImage: true });
      // 先立即把原图渲染出来，让用户立刻看到照片（抠图完成后无缝升级）
      inst.render();
      console.warn('[edit] ✅ 原图已备份', img.width + 'x' + img.height, '→ 工作像素', ow + 'x' + oh);
      // ── 人脸检测（保护兜底 + 自动定位用）。全容错：失败/无脸/不兼容 → null，绝不阻断主流程。
      inst.detectFace().then(faceRect => {
        inst._faceRect = faceRect || null;
        if (faceRect) console.warn('[edit] 👤 检测到人脸', JSON.stringify(faceRect), '(用于自动定位 + 保护兜底)');
        else console.warn('[edit] 👤 未检测到人脸 / 本环境不支持 -> 走默认 resetPosition');
      });
      // ── 用户要求(2026-09-06)：AI 智能抠图不自动触发，由用户点按钮才触发。
      // 避免每次换图/进页自动占后端 + 并发竞态。onload 只预览原图，等用户点「✨ AI 智能抠图」。
      console.warn('[edit] ℹ️ 已加载原图，等待用户点击「✨ AI 智能抠图」按钮手动触发云端抠图（不自动跑，省后端占用）');
    };
    img.onerror = (e) => {
      console.error('[edit] 原图加载失败', e);
      wx.showToast({ title: '图片加载失败', icon: 'none' });
    };
    img.src = this.imagePath;
  },

  /**
   * ======================================================
   * 抠图主入口（新版：P1 云端 AI → P2 本地纯颜色兜底）
   * 用户要求「默认 AI 处理，本地纯颜色只在失败时紧急兜底」
   *
   * opts:
   *   skipCloud  true → 强制跳过云端，直接本地纯颜色（未授权时、云端失败递归降级用）
   *   silent     true → 不弹 wx.showLoading / wx.showToast（onload 自动触发用）
   *   _noToast   true → 成功后也不弹 toast（runMatting 降级调用时避免重复提示）
   * ======================================================
   */
  async localMatting(opts) {
    opts = opts || {};
    const skipCloud = !!opts.skipCloud;
    const silent = !!opts.silent;
    // 代际守卫(2026-09-06)：记录发起时的源代际；下方 commit(_mattingImg / mattingMode) 前校验，
    // 若用户重新选图(epoch 已变)，丢弃这份过期结果，防止 A/B 并发在途的旧结果覆盖新图
    const epoch = this._epoch;

    // ── 原图备份修复（热重载/旧会话 _srcPixels 空 → 自动从 _srcImg 重建）──
    if (!this._srcPixels || !this._srcPixels.data || !this._srcPixels.data.length) {
      const origImg = this._srcImg || this._colorImg;
      if (origImg && origImg.width && origImg.height) {
        const MAX = 600;
        const s = Math.min(1, MAX / Math.max(origImg.width, origImg.height));
        const ow = Math.round(origImg.width * s), oh = Math.round(origImg.height * s);
        const oc = wx.createOffscreenCanvas({ type: '2d', width: ow, height: oh });
        oc.getContext('2d').drawImage(origImg, 0, 0, ow, oh);
        const imd = oc.getContext('2d').getImageData(0, 0, ow, oh);
        this._srcPixels = { data: new Uint8ClampedArray(imd.data), width: ow, height: oh };
        this._srcImg = origImg;
        console.warn('[localMatting] 🛠️  自动修复：重建原图备份', ow + 'x' + oh, '(无需返回重选)');
      } else {
        return;
      }
    }
    this.setData({ mattingBusy: true });
    const srcPx = this._mattingSource();
    const ow = srcPx.width, oh = srcPx.height;
    const off = wx.createOffscreenCanvas({ type: '2d', width: ow, height: oh });
    const octx = off.getContext('2d');
    const workBuf = new Uint8ClampedArray(srcPx.data);
    // 强制使用 createImageData：微信小程序 CanvasRenderingContext2D.putImageData 要求参数必须是真 ImageData
    // 传 plain {data,width,height} 对象，JSC 会抛「parameter 1 is not of type 'ImageData'」错误
    const imgData = octx.createImageData(ow, oh);
    imgData.data.set(workBuf);
    octx.putImageData(imgData, 0, 0);

    // ====== 本地纯颜色兜底用的 bgSource（四角sanity + 边带refs冲突检测）======
    const refs = detectEdgeReferenceColors(imgData.data, ow, oh);
    let bgSource;
    if (refs && refs.length >= 1) {
      const ref0 = refs[0];
      let conflict = false;
      for (let k = 1; k < refs.length; k++) {
        const dr = refs[k].r - ref0.r, dg = refs[k].g - ref0.g, db = refs[k].b - ref0.b;
        if (dr*dr + dg*dg + db*db > 70*70) { conflict = true; break; }
      }
      bgSource = conflict ? (detectBackgroundColor(imgData) || ref0) : ref0;
    } else {
      bgSource = detectBackgroundColor(imgData) || { r: 255, g: 255, b: 255 };
    }
    // 证件照四角必为背景 —— sanity check 把边带抓错色的情况打掉
    (function () {
      const d = imgData.data, w = ow, h = oh; let ar=0,ag=0,ab=0,n=0;
      for (let cy=0; cy<3; cy++) for (let cx=0; cx<3; cx++) {
        for (const [bx,by] of [[0,cy],[w-1,h-1-cy],[w-1,cy],[0,h-1-cy]]) {
          const i=(by*w+bx)*4; ar+=d[i]; ag+=d[i+1]; ab+=d[i+2]; n++;
        }
      }
      ar=Math.round(ar/n); ag=Math.round(ag/n); ab=Math.round(ab/n);
      const cornerAvg = { r: ar, g: ag, b: ab };
      const cmp = Array.isArray(bgSource) && bgSource.length ? bgSource[0] : bgSource;
      const dr = cmp.r-ar, dg = cmp.g-ag, db = cmp.b-ab;
      const dist = Math.sqrt(dr*dr+dg*dg+db*db);
      console.warn('[localMatting] 🔬 sanity 四角=', JSON.stringify(cornerAvg), ' vs bgSource 差=', Math.round(dist));
      if (dist > 120) {
        const hs = detectBackgroundColor(imgData) || cornerAvg;
        const hr=hs.r-ar,hg=hs.g-ag,hb=hs.b-ab;
        bgSource = (hr*hr + hg*hg + hb*hb > 90*90) ? cornerAvg : hs;
        console.warn('[localMatting] ✂️ 修正后 bgSource=', JSON.stringify(bgSource));
      }
    })();
    console.warn('[localMatting] bgSource final=', JSON.stringify(bgSource), ' (refs=', refs? refs.length+'个' : 'null', ')');

    let usedCloud = false;
    let mattingSuccess = false;
    const cloudMatting = require('../../utils/matting.js');

    // ====== P1: 自建 BiRefNet 后端（默认主路径，已授权且没 skipCloud 就走）======
    if (!skipCloud && cloudMatting.hasPrivacyConsent()) {
      console.warn('[localMatting] ☁️  P1 云端 AI 抠图…');
      if (!silent) wx.showLoading({ title: 'AI 云端抠图中…', mask: true });
      try {
        const srcPngPath = await new Promise((resolve, reject) => {
          wx.canvasToTempFilePath({ canvas: off, fileType: 'png', success: r => resolve(r.tempFilePath), fail: reject });
        });
        // 云端抠图带 1 次自动重试：Cloudflare 免费版偶发空响应 / QUIC 隧道抖动时，
        // 第一次可能失败，重试一次显著提高真机成功率。两次都失败才走下方 catch 降级 P2。
        const segmentWithRetry = async () => {
          let lastErr;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              return await cloudMatting.segment(srcPngPath);
            } catch (e) {
              lastErr = e;
              console.warn('[localMatting] ☁️  云端第 ' + attempt + ' 次失败:', e && e.code, e && e.message, attempt < 2 ? '→ 稍后重试' : '→ 降级本地');
              if (attempt < 2) await new Promise(r => setTimeout(r, 600)); // 短暂等待再试
            }
          }
          throw lastErr;
        };
        const resultPath = await segmentWithRetry();
        const newImg = off.createImage();
        await new Promise((res, rej) => { newImg.onload = res; newImg.onerror = rej; newImg.src = resultPath; });
        octx.clearRect(0,0,ow,oh);
        octx.drawImage(newImg, 0, 0, ow, oh);
        const newData = octx.getImageData(0, 0, ow, oh);
        imgData.data.set(newData.data);
        usedCloud = true; mattingSuccess = true;
        console.warn('[localMatting] ☁️  云端 AI ✅ 成功');
      } catch (cloudErr) {
        const code = (cloudErr && cloudErr.code) || 'UNKNOWN';
        const msg = (cloudErr && cloudErr.message) || (cloudErr && cloudErr.errMsg) || '';
        console.warn('[localMatting] ⚠️ 云端 AI 失败，降级本地纯颜色:', code, msg);
        // 只在非 silent 时告知用户（静默自动模式不打扰）
        if (!silent) {
          wx.showModal({
            title: '云端 AI 抠图未成功',
            content: '错误码: ' + code + '\n' + msg + '\n\n请确认自建 BiRefNet 后端已启动、且本机网络可达 idphoto.hcxserver.xyz。\n\n已降级为本地快速抠图（纯色背景效果尚可，复杂背景建议稍后重试）。',
            showCancel: false,
            confirmText: '知道了'
          });
        }
      } finally {
        if (!silent) wx.hideLoading();
      }
    }

    // ====== P2: 本地纯颜色兜底（云端没走 / 没成功 / skipCloud 强制）======
    if (!mattingSuccess) {
      console.warn('[localMatting] 🎨 P2 本地纯颜色抠图 (tol=220)');
      changeBackgroundColor(imgData, bgSource, null, 220);
      // ── 保护兜底：如果检测到了人脸，用 strongRect 靶向救回「被误抠成透明的肤色/人像色」──
      // 不动兜底算法本身；只把矩形内 α<128 且是人像色的像素强制恢复为不透明。
      if (this._faceRect) {
        const pr = expandFaceToProtectRect(this._faceRect, ow, oh);
        const sr = pr && pr.strongRect;
        if (sr) {
          const d = imgData.data;
          let recovered = 0;
          for (let y = sr.y1; y <= sr.y2; y++) {
            for (let x = sr.x1; x <= sr.x2; x++) {
              const i = (y * ow + x) * 4;
              if (d[i + 3] < 128 && isHumanTone({ r: d[i], g: d[i + 1], b: d[i + 2] })) {
                d[i + 3] = 255; // 只救肤色/人像色，纯底色（isHumanTone=false）不填回
                recovered++;
              }
            }
          }
          console.warn('[localMatting] 🛡️ 保护兜底：拯救人脸误抠像素', recovered, '个');
        }
      }
      octx.putImageData(imgData, 0, 0);
    }

    // ====== 统计比例 + 载入结果 + 进入可切底色的 mattingMode ======
    let transparent = 0;
    for (let i = 3; i < imgData.data.length; i += 4) if (imgData.data[i] < 128) transparent++;
    const ratio = transparent / (imgData.data.length / 4);
    console.warn('[localMatting] 透明占比=', (ratio*100).toFixed(1) + '%', usedCloud ? '(AI 云端)' : '(本地兜底)');

    const inst = this;
    // 本地兜底异常：直接回退换色合成预览（用户至少能看带底色的照片），不再进 mattingMode
    if (!usedCloud && (ratio > 0.98 || ratio < 0.02)) {
      console.warn('[localMatting] ⚠️ 本地兜底异常，直接回退换色预览');
      const fb = new Uint8ClampedArray(imgData.data);
      changeBackgroundColor({ data: fb, width: ow, height: oh }, bgSource, this.data.selectedBg, 220);
      imgData.data.set(fb);
      octx.putImageData(imgData, 0, 0);
      wx.canvasToTempFilePath({
        canvas: off, fileType: 'png',
        success: res => {
          const p = res.tempFilePath;
          const off2 = wx.createOffscreenCanvas({ type: '2d', width: 10, height: 10 });
          const img2 = off2.createImage();
          img2.onload = () => {
            // 代际守卫：用户重新选图后本结果已过期 → 丢弃不写，仅复位忙碌态
            if (epoch !== inst._epoch) {
              console.warn('[localMatting] ⚠️ 兜底结果已过期(源已更换)，丢弃');
              inst.setData({ mattingBusy: false });
              return;
            }
            inst._mattingImg = img2;
            inst.imagePath = p;
            inst.setData({ mattingBusy: false, mattingFailed: false, mattingMode: false }, () => {
              inst.render();
              wx.showToast({ title: '已切换预览底色', icon: 'none' });
            });
          };
          img2.src = p;
        }
      });
    } else {
      // 正常路径：进入 mattingMode（可以切换底色）
      wx.canvasToTempFilePath({
        canvas: off, fileType: 'png',
        success: res => {
          this.loadMattingImage(res.tempFilePath).then(stale => {
            // 代际守卫：结果已过期(loadMattingImage 返回 'STALE' 未写 _mattingImg) → 不再进 mattingMode
            if (stale === 'STALE' || epoch !== this._epoch) {
              console.warn('[localMatting] ⚠️ 结果已过期(源已更换)，不进 mattingMode');
              this.setData({ mattingBusy: false });
              return;
            }
            const title = usedCloud ? 'AI 云端抠图完成' : '已生成透明人像';
            this._composed = false;  // 手动模式
            this.setData({ mattingMode: true, mattingBusy: false, mattingFailed: false }, () => {
              this.resetPerson();   // contain 等比铺满整张人像，不自动构图，用户手势微调
              if (!silent && !opts._noToast) wx.showToast({ title, icon: 'success' });
            });
          }).catch(err => {
            console.error('[localMatting] 载入结果失败', err);
            this.setData({ mattingBusy: false, mattingFailed: true }); this.render();
          });
        },
        fail: () => { this.setData({ mattingBusy: false, mattingFailed: true }); this.render(); }
      });
    }
  },

  /** 用户点「一键抠图」按钮 → 按钮即视为同意云端授权（写入 storage），然后走云端抠图 */
  onStartMatting() {
    if (!this._srcPixels && !this._srcImg) { wx.showToast({ title: '请先选择照片', icon: 'none' }); return; }
    const cloudMatting = require('../../utils/matting.js');
    cloudMatting.grantPrivacyConsent();  // 点按钮即授权，无论之前有没有
    // 直接写一次 storage 确认真的生效
    try { const ok = !!wx.getStorageSync('matting_privacy_consent'); console.warn('[onStartMatting] ✅ 用户点击「一键抠图」按钮 = 同意云端处理授权。storage 状态=', ok); } catch(_){}
    console.warn('[onStartMatting] 🚀 立即启动云端抠图流程（导出原图 PNG → 自建 BiRefNet 后端 → 返回透明 PNG）');
    this.runMatting();
  },

  /** 云端 AI 抠图（主执行器）：导出 PNG → 上传 → callFunction → 下载结果 → 进入 mattingMode */
  async runMatting(opts) {
    opts = opts || {};
    const silent = !!opts.silent;
    if (this.data.mattingBusy) return;
    // 代际守卫(2026-09-06)：记下发起时的源代际；下方 commit 结果前校验，过期(stale)则不写 _mattingImg
    const epoch = this._epoch;
    // 老页面（热重载）_srcPixels 空 → 立刻从 _srcImg 重建
    if (!this._srcPixels) {
      const origImg = this._srcImg || this._colorImg;
      if (origImg && origImg.width && origImg.height) {
        const MAX = 600;
        const s = Math.min(1, MAX / Math.max(origImg.width, origImg.height));
        const ow = Math.round(origImg.width * s), oh = Math.round(origImg.height * s);
        const oc = wx.createOffscreenCanvas({ type: '2d', width: ow, height: oh });
        oc.getContext('2d').drawImage(origImg, 0, 0, ow, oh);
        const imd = oc.getContext('2d').getImageData(0, 0, ow, oh);
        this._srcPixels = { data: new Uint8ClampedArray(imd.data), width: ow, height: oh };
        this._srcImg = origImg;
      } else {
        wx.showToast({ title: '请先选择照片', icon: 'none' }); return;
      }
    }
    // 自建 RMBG 后端：不再依赖微信云开发，直接走 HTTP（失败由下方 catch 降级本地）
    this.setData({ mattingBusy: true });
    const cloudMatting = require('../../utils/matting.js');
    if (!cloudMatting.hasPrivacyConsent()) cloudMatting.grantPrivacyConsent();

    // 排队/拥挤提示：通过 onQueue 回调动态更新 loading 标题，让用户看到「排队序号/预计等待」
    const baseTitle = 'AI 精修抠图中…';
    let lastQueueShownAt = 0;
    const onQueue = (qi) => {
      if (!silent && qi && (qi.isRetry || qi.queue > 0)) {
        const now = Date.now();
        if (now - lastQueueShownAt < 800) return; // 节流，避免疯狂刷 title
        lastQueueShownAt = now;
        let t = qi.busy ? '⏳ 服务繁忙，排队中…' : 'AI 抠图中…';
        if (qi.queue > 0) t = `⏳ 前面还有 ${qi.queue} 位，预计等待…`;
        if (qi.isRetry) t = `🔄 重试中(${qi.attempt}/4)…`;
        try { wx.showLoading({ title: t, mask: true }); } catch (_) {}
      }
    };
    if (!silent) wx.showLoading({ title: baseTitle, mask: true });
    try {
      const srcP = await this.exportCompressedPNG();
      console.warn('[runMatting] 导出原图 PNG →', srcP);
      // 只抠图不自动排版：后端返回原始透明人像，前端初始 contain 铺满展示，用户手势缩放/拖动微调。
      let result, lastErr;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          result = await cloudMatting.segment(srcP, { onQueue });   // 不传 compose → 后端只抠透明图
          break;
        } catch (e) {
          lastErr = e;
          console.warn('[runMatting] ☁️  云端第 ' + attempt + ' 次失败:', e && e.code, e && e.message, attempt < 2 ? '→ 稍后重试' : '→ 降级本地');
          if (attempt < 2) await new Promise(r => setTimeout(r, 600));
        }
      }
      if (!result) throw lastErr || new Error('NO_RESULT');
      console.warn('[runMatting] 云端返回透明 PNG →', result);
      // 代际守卫：若期间用户重新选图(epoch 已变)，丢弃这份过期结果，避免旧图覆盖新图
      if (epoch !== this._epoch) {
        console.warn('[runMatting] ⚠️ 结果已过期(用户重新选图/换源)，丢弃,A/B 并发在途旧结果不覆盖新图');
        if (!silent) wx.hideLoading();
        this.setData({ mattingBusy: false, mattingFailed: false });
        return;
      }
      await this.loadMattingImage(result);
      this._composed = false;   // 手动模式：保留双指缩放/拖动，初始铺满(contain)
      this.setData({ mattingMode: true, mattingBusy: false, mattingFailed: false }, () => {
        if (!silent) wx.hideLoading();
        this.resetPerson();   // contain 等比铺满整张人像，不缩小不裁剪
        if (!silent) wx.showToast({ title: 'AI 云端抠图完成，可缩放/拖动调整', icon: 'success' });
      });
    } catch (err) {
      console.error('[runMatting] 云端失败降级本地:', err && err.code, err && err.message);
      this.setData({ mattingBusy: false, mattingFailed: false });
      if (!silent) wx.hideLoading();
      const code = (err && err.code) || 'UNKNOWN';
      const msg = (err && err.message) || (err && err.errMsg) || '';
      if (!silent) {
        wx.showModal({
          title: '智能抠图未成功',
          content: '错误码: ' + code + '\n' + msg + '\n\n已降级为本地快速抠图（纯色背景效果尚可）。\n\n若需使用 AI 高精度抠图，请确认自建 BiRefNet 后端已启动（idphoto-backend）、且本机网络可达 idphoto.hcxserver.xyz 后重试。',
          showCancel: false,
          confirmText: '知道了'
        });
      }
      this.localMatting({ skipCloud: true, _noToast: true });
    }
  },

  /** 导出上传用的原图像素为 PNG（长边 1024px 封顶）。
   *  关键修复(2026-09-05)：必须从「原始全分辨率原图」直接缩放采样，
   *  而不是从 _srcPixels(长边600工作像素) 取——否则后端收到的只是一张 600 长边的小图，
   *  实测同图 600→1024→1280 长边经 RMBG 抠图，「脸颊占高比」0.253→0.270→0.273，
   *  低清输入会让脸颊过渡被往里收窄（脸抠窄）。从原图采 1024 可消除该问题。
   *  若源仍 ≤1024 会走下方兜底分支，但工作像素为 1024 或 600(仅热重载兜底)。 */
  exportCompressedPNG() {
    return new Promise((resolve, reject) => {
      // 未美颜且存在原始全图 → 从原图采样（修复脸颊抠窄）；否则走工作像素（含美颜）
      const orig = this._srcImg || this._colorImg;
      if (!this._beautifiedPixels && orig && orig.width && orig.height) {
        const srcW = orig.width, srcH = orig.height;
        const MAX = 1024;
        const s = Math.min(1, MAX / Math.max(srcW, srcH));
        const dw = Math.round(srcW * s), dh = Math.round(srcH * s);
        const oc = wx.createOffscreenCanvas({ type: '2d', width: dw, height: dh });
        const cx = oc.getContext('2d');
        cx.drawImage(orig, 0, 0, dw, dh);
        wx.canvasToTempFilePath({
          canvas: oc, fileType: 'png',
          success: r => resolve(r.tempFilePath), fail: reject
        });
        return;
      }
      // 兜底/美颜：沿用原逻辑（从 _srcPixels / _beautifiedPixels，长边1024封顶但源本身≤600）
      const srcPx = this._mattingSource();
      if (!srcPx) return reject(new Error('NO_SRC'));
      const srcW = srcPx.width, srcH = srcPx.height;
      const MAX = 1024;
      const s = Math.min(1, MAX / Math.max(srcW, srcH));
      const dw = Math.round(srcW * s), dh = Math.round(srcH * s);
      const oc = wx.createOffscreenCanvas({ type: '2d', width: dw, height: dh });
      const cx = oc.getContext('2d');
      if (dw === srcW && dh === srcH) {
        // 必须用 createImageData 生成真正的 ImageData（不能用 plain object，否则 JSC putImageData 抛类型错）
        const img = cx.createImageData(dw, dh);
        img.data.set(srcPx.data);
        cx.putImageData(img, 0, 0);
      } else {
        // 先在原尺寸画布画出真 ImageData，然后 drawImage 缩放（避免 putImageData plain object 类型错误）
        const srcC = wx.createOffscreenCanvas({ type: '2d', width: srcW, height: srcH });
        const sctx = srcC.getContext('2d');
        const srcImg = sctx.createImageData(srcW, srcH);
        srcImg.data.set(srcPx.data);
        sctx.putImageData(srcImg, 0, 0);
        cx.drawImage(srcC, 0, 0, srcW, srcH, 0, 0, dw, dh);
      }
      wx.canvasToTempFilePath({
        canvas: oc, fileType: 'png',
        success: r => resolve(r.tempFilePath), fail: reject
      });
    });
  },


  loadMattingImage(path) {
    this._mattingImgPath = path;
    const epoch = this._epoch;  // 代际守卫：解码/在途期间源可能已换，onload 提交前校验
    return new Promise((resolve, reject) => {
      const img = this.canvas.createImage();
      img.onload = () => {
        // 代际守卫：用户重新选图后本结果已过期 → 不写 _mattingImg，丢弃
        if (epoch !== this._epoch) {
          console.warn('[loadMattingImage] ⚠️ 结果已过期(源已更换)，丢弃不写入 _mattingImg');
          resolve('STALE');
          return;
        }
        this._mattingImg = img;
        // 真机排查(2026-09-05)：onload 后务必确认尺寸非0。微信 canvas.createImage 对某些本地PNG
        // 在真机上加载完成但 width/height 仍为0 → render 因 mw=0 走回退(显示原图)。
        console.warn('[loadMattingImage] ✅ 载入 matting 图', img.width, 'x', img.height, 'mode=', img && img.dataType);
        if (!img.width || !img.height) {
          // 给一次 draw 触发解码的机会 (有些真机需先 drawImage 才有尺寸)；仍为0则不强求
          setTimeout(() => {
            console.warn('[loadMattingImage] ⚠️ 载入后尺寸为0，真机 canvas 解码异常，尝试 fallback 读取', img.width, img.height);
            resolve();
          }, 50);
          return;
        }
        resolve();
      };
      img.onerror = (e) => { console.error('[loadMattingImage] onerror', e && e.errMsg); reject(e); };
      img.src = path;
    });
  },


  /** 导出当前成片到规格像素（高清、无辅助线），返回临时路径。
   *  opts.transparent = true → 不填底色，导出透明底人像 PNG(保 alpha)，含大规格内存守卫。
   *  返回 Promise<{path, ew, eh, downscaled}>：downscaled=true 表示因内存被等比封顶。 */
  exportComposed(opts) {
    opts = opts || {};
    const transparent = !!opts.transparent;
    return new Promise((resolve, reject) => {
      const spec = this.activeSpec();
      // ── 大规格内存守卫：预估导出 RGBA 内存，超预算则按「面积字节预算 + 最长边封顶」等比缩，防低端机 OOM ──
      const MAX_EXPORT_BYTES = 6 * 1024 * 1024; // 6MB 导出画布预算
      const MAX_EXPORT_DIM  = 1800;             // 封顶后的最长边上限
      let ew = spec.width, eh = spec.height;
      let capped = false;
      if (ew * eh * 4 > MAX_EXPORT_BYTES) {
        // sArea：按面积预算缩，确保缩后 RGBA ≤ 预算（仅靠最长边封顶不够——如六寸 1795 边不触发）
        const sArea = Math.sqrt(MAX_EXPORT_BYTES / (ew * eh * 4));
        const sDim  = MAX_EXPORT_DIM / Math.max(ew, eh);
        const s = Math.min(1, sArea, sDim);
        ew = Math.max(1, Math.round(ew * s));
        eh = Math.max(1, Math.round(eh * s));
        capped = true;
        console.warn('[exportComposed] ⚠️ 大规格内存守卫：', spec.width + 'x' + spec.height,
          '(', Math.round(spec.width * spec.height * 4 / 1024 / 1024), 'MB ) → 压缩到', ew + 'x' + eh);
      }
      const off = wx.createOffscreenCanvas({ type: '2d', width: ew, height: eh });
      const ctx = off.getContext('2d');
      // 1. 背景：非透明档填 selectedBg；透明档不填 → 全透明(alpha=0)
      if (!transparent) {
        const bg = this.data.selectedBg;
        ctx.fillStyle = 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')';
        ctx.fillRect(0, 0, ew, eh);
      }
      // 2. 人像（透明底，source-over alpha 合成，GPU 快且无锯齿）或原图铺满
      const usePerson = this.data.mattingMode && this._mattingImgPath;
      const img = off.createImage();
      img.onload = () => {
        if (usePerson) {
          if (this._composed) {
            // 后端已排版到 spec：直接 1:1 铺满，所见即所得（无额外缩放）
            ctx.drawImage(img, 0, 0, ew, eh);
          } else {
            const scale = ew / this._frameW;
            const drawW = Math.round(img.width * this._personScale * scale);
            const cx = (this._frameW / 2 + this._personNx * this._frameW) * scale;
            const cy = (this._frameH / 2 + this._personNy * this._frameH) * scale;
            const drawH = Math.round(drawW * (img.height / img.width));
            const x0 = Math.round(cx - drawW / 2);
            const y0 = Math.round(cy - drawH / 2);
            // 透明人像 source-over 叠到已填底色 / 透明底（GPU 等效于旧 per-pixel，无锯齿）
            ctx.drawImage(img, x0, y0, drawW, drawH);
          }
        } else if (!transparent) {
          drawCenterCrop(ctx, img, ew, eh);
        } else {
          // 透明档但无人像可导（未抠图）→ 抛错让调用方提示
          reject(new Error('NO_TRANSPARENT_SOURCE'));
          return;
        }
        wx.canvasToTempFilePath({
          canvas: off,
          fileType: 'jpg',
          quality: 0.92, // 标准 JPG，高品质，不过度压缩模糊（2026-09-06 用户要求保存证件照用 JPG）
          success: r => resolve({ path: r.tempFilePath, ew: ew, eh: eh, downscaled: capped }),
          fail: reject
        });
      };
      img.onerror = () => reject(new Error('COMPOSE_LOAD_FAILED'));
      img.src = usePerson ? this._mattingImgPath : this.imagePath;
    });
  },

  resetPerson() {
    if (!this._mattingImg) return;
    const fw = this._frameW, fh = this._frameH;
    const iw = this._mattingImg.width, ih = this._mattingImg.height;
    if (!iw || !ih) return;
    // contain 等比铺满：整张人像(含整身高)完整可见，不缩小、不裁剪，初始不畸变。
    const sw = fw / iw, sh = fh / ih;
    this._personScale = Math.min(sw, sh);
    this._personNx = 0;
    this._personNy = 0;
    this.render();
  },

  // ======================================================
  // 自动排版(自动构图)——按「中国证件照国标」把抠好的透明人像自动排进画幅，
  // 用户拿到图即可用，无需手动缩放/拖动。
  // 国标要点(公安 GA461 证件数字相片 + 行业通行规范)：
  //   · 头顶(含发)到画幅上缘留白 ≈ 画幅高 8~10%   → TOP_MARGIN
  //   · 两肩占画面宽 ≈ 85~90%                     → SHOULDER_WIDTH
  //   · 底部自然裁到胸口/肋部(下缘溢出裁掉)      → 不当独立约束
  //   · 水平以「面/身中心」为准                    → face 或 bbox 中心
  // 混合策略(2026-09-06 用户选定)：
  //   · 头顶锚点 = alpha 最高点(含发)，永远可靠，无需人脸框。
  //   · 脸框(真机 VKSession 时不总是可靠)仅在校验通过后才用来做水平居中，
  //     并沿用 autoAlignPerson 的 sanity guard(脸高≥画幅25% 才信)，防爆炸回退。
  // 参数集中在此，真机看效果靠这一处调。用户仍可手动双指缩放/拖动微调。
  // ======================================================
  autoCompose() {
    if (!this._mattingImg) return;
    const fw = this._frameW, fh = this._frameH;
    const mw = this._mattingImg.width, mh = this._mattingImg.height;
    if (!mw || !mh || mw > 2048 || mh > 2048) { this.resetPerson(); return; } // 超大图跳过(读像素太重)
    // ── 国标参数(真机调这里) ──
    const TOP_MARGIN     = 0.10;  // 头顶(含发)到画幅顶留白 / 画幅高 — 国标8~10%
    const SHOULDER_WIDTH = 0.88;  // 肩占画面宽 — 国标85~90%
    const SCALE_MIN = 0.3, SCALE_MAX = 4;
    const FACE_GUARD = 0.25;      // 脸高/画幅 ≥ 25% 才信脸框(防真机 VKSession 爆炸)
    try {
      // 读透明人像像素 → 算 alpha bbox
      const oc = wx.createOffscreenCanvas({ type: '2d', width: mw, height: mh });
      const ctx = oc.getContext('2d');
      ctx.drawImage(this._mattingImg, 0, 0, mw, mh);
      const d = ctx.getImageData(0, 0, mw, mh).data;
      let bx0=mw, by0=mh, bx1=-1, by1=-1, sum=0, n=0;
      for (let y=0;y<mh;y++){
        for (let x=0;x<mw;x++){
          const a=d[(y*mw+x)*4+3];
          if (a>20){ if(x<bx0)bx0=x; if(x>bx1)bx1=x; if(y<by0)by0=y; if(y>by1)by1=y; sum+=a; n++; }
        }
      }
      if (n===0 || bx1<=bx0 || by1<=by0) { this.resetPerson(); return; }
      const bw=bx1-bx0, bh=by1-by0;
      // 肩宽: bbox 上部 28%-52% 带内最宽的 alpha 行(≈肩膀)
      let sw=0;
      for (let y=Math.round(by0+bh*0.28); y<=Math.round(by0+bh*0.52); y++){
        if (y>=mh) break;
        let minx=mw,maxx=-1;
        for (let x=0;x<mw;x++){ if (d[(y*mw+x)*4+3]>20){ if(x<minx)minx=x; if(x>maxx)maxx=x; } }
        if (maxx>minx && (maxx-minx)>sw) sw=maxx-minx;
      }
      if (sw<=0) sw=bw; // 兜底用 bbox 宽

      // ── 尺度约束 ──
      // 主尺度 = 肩宽(可靠锚, 与源构图无关): 肩占画幅 SHOULDER_WIDTH 宽。
      // 不用 by0 驱动 scale(全身照头顶位置随源构图变, 会误判)。头顶留白由下方 Ny 的 offset 保证。
      const scale_s = (fw * SHOULDER_WIDTH) / sw;
      let scale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scale_s));

      // 垂直: 用最终 scale 解 Ny, 令头顶(by0,含发)精确落在 TOP_MARGIN*fh
      // 画布人像中心 y = fh/2 + Ny*fh; 像源顶 y = 中心 - (mh*scale)/2; 头顶 y = 像源顶 + by0*scale = TOP_MARGIN*fh
      const Ny = (TOP_MARGIN * fh - fh / 2 + (mh * scale) / 2 - by0 * scale) / fh;

      // 水平中心: 脸框校验通过→用脸心; 否则用 bbox 中心(左右对称时相等)
      let centerX = bx0 + bw / 2;
      const fr = this._faceRect;
      const srcPx = this._srcPixels;
      if (fr && fr.width && fr.height && srcPx && srcPx.width) {
        const sxm = mw / srcPx.width, sym = mh / srcPx.height;
        const fx = fr.originX * sxm, fw2 = fr.width * sxm;
        const fhFace = fr.height * sym;
        if (fw2 > 0 && fhFace > 0 && fhFace >= FACE_GUARD * fh) {
          centerX = fx + fw2 / 2; // 脸心(发型/头型让 bbox 中心偏时会纠正)
        }
      }
      // 画布人像中心 x = fw/2 + Nx*fw; 像源左 x = 中心 - (mw*scale)/2;
      // 令 像源左 + centerX*scale = fw/2(centerX 像素对齐画布中心) → Nx = ((mw*scale)/2 - centerX*scale)/fw
      const Nx = (mw * scale / 2 - centerX * scale) / fw;
      const nx = Math.max(-1.2, Math.min(1.2, Nx));
      const ny = Math.max(-1.2, Math.min(1.2, Ny));

      this._personScale = scale;
      this._personNx = nx;
      this._personNy = ny;
      console.warn('[autoCompose] 国标排版 scale=', scale.toFixed(2),
        '头顶留白=', (by0 * scale / fh * 100).toFixed(0) + '%',
        '肩占幅=', (sw * scale / fw * 100).toFixed(0) + '%',
        'Nx=', nx.toFixed(3), 'Ny=', ny.toFixed(3),
        '脸校准=', this._faceRect ? 'on' : 'off');
      this.render();
    } catch (e) {
      console.warn('[autoCompose] 失败，回退 resetPerson', (e&&e.message)||e);
      this.resetPerson();
    }
  },

  // ======================================================
  // 人脸检测 + 自动定位（VisionKit）
  // 用途：① 自动把头部对齐到证件照标准头占比  ② P2 本地兜底的保护矩形
  // 不喂美颜关键点。全容错：失败/无脸/环境不支持 → 静默 resolve(null)。
  // 返回 {originX,originY,width,height}（_srcPixels 像素空间，左上角原点）。
  // 检测顺序：VKSession(官方新API) → 弃用的 wx.faceDetect(兼容) → null
  // ======================================================
  detectFace() {
    return new Promise(resolve => {
      const srcPx = this._srcPixels;
      if (!srcPx || !srcPx.data || !srcPx.width || !srcPx.height) { resolve(null); return; }
      const ow = srcPx.width, oh = srcPx.height;
      // ── 方案1（首选）：wx.createVKSession 静态图检测（官方推荐，base≥2.32？/需真机）
      // 直接把 _srcPixels 的 RGBA 像素喂进去，脸框天然在 _srcPixels 空间。
      if (typeof wx.createVKSession === 'function') {
        let settled = false;
        const done = rect => { if (!settled) { settled = true; resolve(rect); } };
        try {
          const session = wx.createVKSession({
            track: { face: { mode: 2 } } // mode 2 = 手动传入静态图像
          });
          let gotAnchor = false;
          const onAnchors = anchors => {
            if (gotAnchor) return; gotAnchor = true;
            if (!Array.isArray(anchors) || !anchors.length) { done(null); return; }
            // 取最大脸
            let best = null;
            for (const a of anchors) {
              const o = a.origin, s = a.size;
              if (!o || !s || !s.width || !s.height) continue;
              // 诊断用：真机打印 VKSession 原始返回，用于核对 origin 是"左上角"还是"中心"、size 是全宽还是半宽
              console.warn('[detectFace] VKSession anchor: origin=', JSON.stringify(o), 'size=', JSON.stringify(s),
                'points个数=', Array.isArray(a.points) ? a.points.length : 0, 'angle=', JSON.stringify(a.angle));
              const area = s.width * s.height;
              if (!best || area > best.area) {
                best = { originX: o.x, originY: o.y, width: s.width, height: s.height, area };
              }
            }
            try { session.stop && session.stop(); } catch (_) {}
            done(best ? { originX: best.originX, originY: best.originY, width: best.width, height: best.height } : null);
          };
          session.start(errno => {
            if (errno) {
              console.warn('[detectFace] VKSession.start 失败(errno=' + errno + ')，降级 wx.faceDetect');
              _legacyDetect(ow, oh).then(done);
              return;
            }
            // 构造 RGBA 像素流（字节序：低地址是 R）→ createVKSession frameBuffer 需要 ArrayBuffer（RGBA每4项一像素）
            const frameBuffer = srcPx.data.buffer.slice(srcPx.data.byteOffset, srcPx.data.byteOffset + srcPx.data.byteLength);
            session.on && session.on('updateAnchors', onAnchors);
            session.detectFace && session.detectFace({
              frameBuffer,
              width: ow,
              height: oh,
              scoreThreshold: 0.5,
              sourceType: 1,
              modelMode: 1
            });
            // 兜底：8.5s 内没等到 updateAnchors → 视为无脸/平台受限
            setTimeout(() => done(null), 8500);
          });
          return;
        } catch (e) {
          console.warn('[detectFace] wx.createVKSession 异常，降级 wx.faceDetect:', e);
          _legacyDetect(ow, oh).then(done);
          return;
        }
      }

      // ── 方案2（兜底）：弃用的 wx.faceDetect（部分老环境仍可用）──
      _legacyDetect(ow, oh).then(resolve);

      // 老接口：把 _srcPixels 导出 PNG 喂，脸框在 _srcPixels 空间
      function _legacyDetect(w, h) {
        return new Promise(res2 => {
          if (typeof wx.faceDetect !== 'function') { console.warn('[detectFace] 环境无 VKSession，也无 wx.faceDetect，跳过人脸检测'); res2(null); return; }
          const oc = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
          const cx = oc.getContext('2d');
          const img = cx.createImageData(w, h);
          img.data.set(srcPx.data);
          cx.putImageData(img, 0, 0);
          wx.canvasToTempFilePath({
            canvas: oc, fileType: 'png',
            success: r => {
              wx.faceDetect({
                imgPath: r.tempFilePath,
                timeout: 8000,
                success: res => {
                  const list = (res && res.faceList) || [];
                  if (!list || !list.length) { res2(null); return; }
                  let best = null;
                  for (const f of list) {
                    const d = f && f.detectRect;
                    if (!d || !d.width || !d.height) continue;
                    if (!best || d.width * d.height > best.width * best.height) best = d;
                  }
                  res2(best ? { originX: best.originX, originY: best.originY, width: best.width, height: best.height } : null);
                },
                fail: () => { console.warn('[detectFace] wx.faceDetect 失败，静默跳过'); res2(null); }
              });
            },
            fail: () => res2(null)
          });
        });
      }
    });
  },

  // ======================================================
  // 自动定位：证件照排版本。
  // 用"眼睛线"作垂直基准（业界标准，比"头顶"对 distance/裁剪更稳），
  // 头(头顶~下巴)占画幅约 60%，眼睛线落在画幅约 40%。
  // faceRect 在 _srcPixels 空间；matting 图可能是云端 ≤1500 的不同尺寸 → 先缩放到 matting 空间。
  // 无脸/不兼容 → 回退 resetPerson()，绝不阻断。
  // ======================================================
  autoAlignPerson(faceRect) {
    if (!this._mattingImg) return;
    const srcPx = this._srcPixels;
    if (!faceRect || !faceRect.width || !faceRect.height || !srcPx || !srcPx.width) {
      this.resetPerson(); return;
    }
    const matW = this._mattingImg.width, matH = this._mattingImg.height;
    if (!matW || !matH) { this.resetPerson(); return; }
    // 1) 把脸框从 _srcPixels 空间缩放到 matting 图空间（云端路径图幅会变）
    const sxm = matW / srcPx.width, sym = matH / srcPx.height;
    const fx = faceRect.originX * sxm;
    const fy = faceRect.originY * sym;
    const fw = faceRect.width * sxm;
    const fh = faceRect.height * sym;
    if (fw <= 0 || fh <= 0) { this.resetPerson(); return; }

    // 2) 几何模型（对全身照/特写统一适用）：
    //    脸框近似"眉毛→下巴"。头顶(冠)在脸框顶上方约 0.55×faceH(含发量)，
    //    下巴略低于脸框底(0.08)。头高 ≈ 1.63×faceH。
    const crown = fy - 0.55 * fh;         // 头顶
    const chin  = fy + 1.08 * fh;          // 下巴(含下颏)
    const headSpan = chin - crown;         // 头部高度(matting像素)
    const eyeY = fy + 0.38 * fh;           // 眼睛线约在脸框上缘往下 0.38×faceH

    const frmH = this._frameH;
    // 头占画幅约 60%
    // ── 真机修复(2026-09-05)：VKSession 人脸框在真机可能不可靠(头占比算成~2%)，
    //    导致 headSpan 极小、scale 冲到封顶→drawW/drawH 爆炸(13163px)→render 守卫拦截→显示原图。
    //    这里加 sanity: 头高须合理(≥画幅25%), 否则人脸框数据不可信 → 用 resetPerson 居中兜底,
    //    保证显示"合适的抠图人像"而非回退成原图。
    if (headSpan < frmH * 0.25) { this.resetPerson(); return; }
    let scale = (0.60 * frmH) / headSpan;
    scale = Math.max(0.3, Math.min(4, scale));   // 上限收4, 防绘制尺寸爆炸
    const drawW = matW * scale;
    const drawH = matH * scale;
    // 最终硬保护: 绘制尺寸不能超过画幅(逻辑px)的16倍, 否则人脸框/缩放异常 → resetPerson
    if (drawW > this._frameW * 16 || drawH > frmH * 16) { this.resetPerson(); return; }

    // 3) 水平：脸中心对齐画布中心
    let nx = (drawW / 2 - (fx + fw / 2) * scale) / this._frameW;

    // 4) 垂直：眼睛线落在画幅约 40% 处（通过画布中心点反推）
    //    画布人像中心 y = frmH/2 + Ny*frmH；同一点也是 y0 + eyeY*scale。
    //    令画布眼睛线 = 0.40*frmH → 解得 Ny。
    const eyeFrameTarget = 0.40 * frmH;
    let ny = (eyeFrameTarget - frmH / 2 - eyeY * scale + drawH / 2) / frmH;

    // 夹取：别把整个人移出画布边缘太多（允许一定容差）
    nx = Math.max(-1.2, Math.min(1.2, nx));
    ny = Math.max(-1.2, Math.min(1.2, ny));

    this._personScale = scale;
    this._personNx = nx;
    this._personNy = ny;
    console.warn('[autoAlignPerson] 头占比≈', (headSpan * scale / frmH * 100).toFixed(0) + '%',
      '眼睛线=', ((0.40 * frmH) / frmH * 100).toFixed(0) + '%',
      'scale=', scale.toFixed(2), 'Nx=', nx.toFixed(3), 'Ny=', ny.toFixed(3));
    this.render();
  },

  // 渲染：留白(四周) + 照片区(背景色+人像) + 尺寸框 + mm 打版标注(照片区外的留白带)
  render() {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cw = this._frameW, ch = this._frameH;
    const pad = this._pad || 0;
    const s = cw > 0 ? (W / (cw + pad * 2)) : 1;   // 逻辑→canvas 像素(含四周留白)
    const PB = pad * s;                              // 留白(canvas 像素)
    const pW = cw * s, pH = ch * s;                  // 照片区(canvas 像素)尺寸
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 四周留白铺成卡片深色(标注落在其上的底色)
    ctx.fillStyle = '#242833';
    ctx.fillRect(0, 0, W, H);
    // 平移到照片区原点(照片区居左 0..pW,顶部 0..pH，四周是留白)
    ctx.translate(PB, PB);
    // 1. 照片背景(纯色)
    const bg = this.data.selectedBg;
    ctx.fillStyle = 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')';
    ctx.fillRect(0, 0, pW, pH);

    // 2. 人像层（真正 alpha 合成，GPU source-over）
    if (this.data.mattingMode && this._mattingImg) {
      const fw = cw, fh = ch;
      const mw = this._mattingImg.width, mh = this._mattingImg.height;
      // 防御(真机"只剩底板")：matting 图必须有效尺寸，且缩放后 drawW/drawH 必须为正有限数。
      if (!mw || !mh || !isFinite(mw) || !isFinite(mh)) {
        console.warn('[render] ⚠️ _mattingImg 无效尺寸', mw, mh, '→ 回退画原图 cover');
        this.drawLocalCover(ctx, pW, pH);
        this.drawFrame(ctx, pW, pH);
        return;
      }
      const dpr = pW / fw;   // 照片区 逻辑→canvas 像素(不含留白)
      const cx = (fw / 2 + this._personNx * fw) * dpr;
      const cy = (fh / 2 + this._personNy * fh) * dpr;
      const drawW = mw * this._personScale * dpr;
      const drawH = drawW * (mh / mw);
      if (!isFinite(drawW) || !isFinite(drawH) || drawW <= 0 || drawH <= 0 || drawW > 8192 || drawH > 8192) {
        console.warn('[render] ⚠️ 绘制尺寸非法', Math.round(drawW), Math.round(drawH), 'scale=', this._personScale, '→ 回退画原图 cover');
        this.drawLocalCover(ctx, pW, pH);
        this.drawFrame(ctx, pW, pH);
        return;
      }
      try {
        const x0 = Math.round(cx - drawW / 2);
        const y0 = Math.round(cy - drawH / 2);
        // 人像只显示在照片区(尺寸框虚线内)：超出虚线部分的像素裁掉，避免"框外还有人像"误导裁切。
        // mm 标注在 drawFrame 里、clip 之后绘制，位于照片区外的留白带，不受本裁剪影响。
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, pW, pH);
        ctx.clip();
        ctx.drawImage(this._mattingImg, x0, y0, Math.round(drawW), Math.round(drawH));
        ctx.restore();
      } catch (err) {
        console.warn('[render] ⚠️ 人像 alpha 合成异常，回退原图 cover', (err && err.message) || err);
        this.drawLocalCover(ctx, pW, pH);
      }
    } else if (this._colorImg) {
      // 抠图尚未完成 / 已降级：原图等比铺满照片区（用户立刻能看到照片）
      this.drawLocalCover(ctx, pW, pH);
    }

    // 3. 尺寸框（虚线裁剪线）+ mm 打版标注（照片区外的留白带，贴裁剪线外侧）
    this.drawFrame(ctx, pW, pH);
  },

  // 降级模式：原图等比铺满帧（居中裁剪）
  drawLocalCover(ctx, W, H) {
    const img = this._colorImg;
    const ratio = W / H;
    let sw, sh, sx, sy;
    if (img.width / img.height > ratio) {
      sh = img.height;
      sw = img.height * ratio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = img.width / ratio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  },

  // 尺寸框：照片区边缘画虚线裁剪线 + 十字参考；mm 打版标注画在裁剪线(照片区)外侧的留白带
  drawFrame(ctx, pW, pH) {
    // 照片区边缘(render 已 translate 到位，故这里以照片区左上角为原点 0..pW, 0..pH)
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeRect(1, 1, pW - 2, pH - 2);
    // 中央十字参考线（辅助对齐人像头部）
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.moveTo(pW / 2, 0);
    ctx.lineTo(pW / 2, pH);
    ctx.moveTo(0, pH / 2);
    ctx.lineTo(pW, pH / 2);
    ctx.stroke();
    ctx.restore();

    // ── mm 打版标注：裁剪线(照片区)外侧留白带，不覆盖人像；白字+黑阴影任意底色清晰 ──
    const mmW = this.data.mmWLabel;
    const mmH = this.data.mmHLabel;
    if (!mmW && !mmH) return;
    // 字号随照片区自适应，但要足够小(≈照片最长边 3.5%)，不会跑出留白
    const fs = Math.max(9, Math.round(Math.min(pW, pH) * 0.035));
    const gap = Math.max(2, Math.round(fs * 0.35));   // 标注与裁剪线的间距
    ctx.save();
    ctx.font = fs + 'px sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = Math.max(2, Math.round(fs * 0.3));
    ctx.fillStyle = '#ffffff';
    // 宽边(mmW)：底边外侧、水平居中 —— 横排
    if (mmW) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(mmW, pW / 2, pH + gap);
    }
    // 高边(mmH)：右边外侧、在中点旋转 90° 竖排(读向自下而上)
    if (mmH) {
      ctx.save();
      ctx.translate(pW + gap + fs * 0.6, pH / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mmH, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  },

  // ============ 手势（composed 模式下禁用——后端已排版好，用户拿图即用，不缩放拖动）============
  onTouchStart(e) {
    if (this._composed) return;   // 后端成品：禁缩放/拖动，避免高频 render 卡顿 + 破坏排版
    if (!this.data.mattingMode || !this._mattingImg) return;
    const touches = e.touches;
    if (touches.length === 1) {
      this._touch = {
        type: 'drag',
        x: touches[0].clientX,
        y: touches[0].clientY,
        startNx: this._personNx,
        startNy: this._personNy,
        startDist: 0
      };
    } else if (touches.length >= 2) {
      const d = this.touchDist(touches[0], touches[1]);
      this._touch = {
        type: 'zoom',
        startDist: d,
        startScale: this._personScale,
        cx: (touches[0].clientX + touches[1].clientX) / 2,
        cy: (touches[0].clientY + touches[1].clientY) / 2
      };
    }
  },

  onTouchMove(e) {
    if (!this._touch || !this.data.mattingMode) return;
    const touches = e.touches;
    if (this._touch.type === 'drag' && touches.length === 1) {
      const dx = (touches[0].clientX - this._touch.x) / this._frameW;
      const dy = (touches[0].clientY - this._touch.y) / this._frameH;
      this._personNx = this._touch.startNx + dx;
      this._personNy = this._touch.startNy + dy;
      this.render();
    } else if (this._touch.type === 'zoom' && touches.length >= 2) {
      const d = this.touchDist(touches[0], touches[1]);
      if (this._touch.startDist > 0) {
        let s = this._touch.startScale * (d / this._touch.startDist);
        // 增强(2026-09-05)：放宽缩放范围供自由裁剪——可缩得很小看全身，也可放大到 10 倍精修。
        // 用户手动缩放后即视为自定义定位，不再被自动对齐覆盖（autoAlignPerson 只在抠图完成首次调用）。
        s = Math.max(0.15, Math.min(10, s));
        this._personScale = s;
      }
      this.render();
    }
  },

  onTouchEnd() {
    this._touch = null;
  },

  touchDist(a, b) {
    return Math.sqrt(
      (a.clientX - b.clientX) * (a.clientX - b.clientX) +
      (a.clientY - b.clientY) * (a.clientY - b.clientY)
    );
  },

  // ============ 换底色（人像不动） ============
  onSelectColor(e) {
    const name = e.currentTarget.dataset.bg;
    const idx = this.data.bgColors.findIndex(c => c.name === name);
    const color = this.data.bgColors[idx];
    this.setData({ selectedBgIdx: idx, selectedBg: { r: color.r, g: color.g, b: color.b } }, () => {
      this.render();
    });
  },

  // ============ 重新选图 ============
  onReselect() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'], // 取原图(标准输入，防真机压缩图导致抠图脸颊内凹)
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.setData({ hasImage: true, mattingBusy: false, mattingMode: false, mattingFailed: false });
        this.imagePath = tempFilePath;
        // 重置抠图/人像状态（旧的在途抠图结果由代际守卫在回调里丢弃，不会覆盖新图）
        this._mattingImg = null; this._mattingImgPath = null; this._colorImg = null;
        this._touch = null; this._composed = false; this._beautifiedPixels = null;
        this._personScale = 1; this._personNx = 0; this._personNy = 0;
        this.applyFrameSize(this.data.selectedSpecId);   // 保持当前规格
        this.loadSource();
      }
    });
  },

  // ============ 规格切换（改尺寸框真实比例） ============
  onSelectSpec(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.selectedSpecId) return;
    this.applyFrameSize(id);
    // 抠图结果保留：切规格后把同一透明人像重新 contain 铺满到新画幅(而非回退画原图)
    if (this.data.mattingMode && this._mattingImg) {
      this.resetPerson();
    } else {
      this.render();
    }
  },

  // 重置人像位置：回到整张人像等比铺满(contain)，不自动构图，用户可再手势微调
  onReset() {
    this.resetPerson();
  },

  // ============ 保存到相册 ============
  onSave() {
    if (!this.canvas) return;
    this.ensureAlbumPerm(() => this.doSave(false));
  },

  // 冲印品质下载：跳转专页，基于上传原图 300DPI 换底导出 JPG(不依赖 AI 抠图/不经过 600/1024 压缩)
  onOpenOriginal() {
    if (!this.imagePath) { wx.showToast({ title: '请先选择照片', icon: 'none' }); return; }
    wx.navigateTo({
      url: '/pages/original/original?image=' + encodeURIComponent(this.imagePath) +
           '&specId=' + encodeURIComponent(this.data.selectedSpecId || '') +
           '&bgIdx=' + (this.data.selectedBgIdx != null ? this.data.selectedBgIdx : 0)
    });
  },

  // 统一相册权限检查，通过后执行 next()
  ensureAlbumPerm(next) {
    wx.getSetting({
      success: res => {
        const auth = res.authSetting['scope.writePhotosAlbum'];
        if (auth === false) {
          wx.showModal({
            title: '需要相册权限',
            content: '请在设置中开启"保存到相册"权限',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        next();
      }
    });
  },

  doSave(transparent) {
    this.exportComposed({ transparent: !!transparent })
      .then(res => {
        wx.saveImageToPhotosAlbum({
          filePath: res.path,
          success: () => {
            // 大规格内存守卫触发时，优先提示用户实际输出像素，避免"要6寸却存小图"的误解
            if (res.downscaled) {
              wx.showToast({
                title: '已保存(内存所限缩放至 ' + res.ew + '×' + res.eh + ')',
                icon: 'none',
                duration: 3000
              });
            } else {
              wx.showToast({ title: transparent ? '已保存透明PNG' : '已保存到相册', icon: 'success' });
            }
            const spec = this.activeSpec();
            addRecord({
              size: spec.name + ' ' + spec.width + 'x' + spec.height +
                (res.downscaled ? ' (' + res.ew + 'x' + res.eh + ')' : ''),
              color: transparent ? '透明' : rgbToHex(this.data.selectedBg.r, this.data.selectedBg.g, this.data.selectedBg.b),
              hd: this.data.mattingMode
            });
          },
          fail: () => {
            wx.showModal({
              title: '保存失败',
              content: '请在设置中允许保存到相册',
              confirmText: '去设置',
              success: r => { if (r.confirm) wx.openSetting(); }
            });
          }
        });
      })
      .catch(() => wx.showToast({ title: '生成图片失败', icon: 'none' }));
  },

  // 分享给好友（右上角菜单 + 朋友圈已开）。path 回首页：朋友点开进入自己的选图流程，而非他人结果图。
  onShareAppMessage() {
    const title = this.data.mattingMode
      ? '证件照做完了 | 你也可以一键抠图换底色'
      : '证件照一键抠图换底色 | 一寸二寸护照通用';
    return {
      title,
      path: '/pages/index/index'
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '证件照快速搞定：抠图/换底色/标准尺寸',
      query: ''
    };
  }
});
