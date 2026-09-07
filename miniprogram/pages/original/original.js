const { SPECS, BG_COLORS, rgbToHex, detectBackgroundColor, changeBackgroundColor } = require('../../utils/idphoto.js');
const matting = require('../../utils/matting.js');

// 冲印品质专页（方案1 + 手势，2026-09-06 定稿）
//   · 抠图 = edit 同款后端 BiRefNet(≤1024 透明人像)
//   · 成品人像像素 = 「原图 ⊓ 抠图alpha」合成的透明大图 _cutImg（原图级高清，发丝=抠图alpha）
//   · 导出像素 = 原图分辨率(封顶 CUT_LONG 防 OOM，远高于规格像素) → 放大清晰
//   · 手势(双指缩放0.15~10/单指拖动) = 与 edit 一致，作用于 _cutImg

// 工作/导出长边封顶：平衡「清晰度」与「真机内存」。远高于规格(295~626)，但低端机不至 OOM。
const CUT_LONG = 2600;
// 颜色方案
Page({
  data: {
    hasImage: false,
    mattingBusy: false,
    mattingMode: false,
    specs: (SPECS || []).filter(s => s.group !== 'print'),
    bgColors: [],
    selectedSpecId: '',
    selectedBgIdx: 0, // 已重排：白(常用)/浅蓝/深蓝/红/深红/米黄/灰/黑，默认白底
    specRatioLabel: '',
    canvasW: 300,
    canvasH: 400
  },

  onLoad(options) {
    // 打开右上角「转发 + 分享到朋友圈」入口
    try { wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (_) {}
    if (!options.image) { wx.showToast({ title: '缺少照片', icon: 'none' }); return; }
    this.imagePath = decodeURIComponent(options.image);
    const specId = options.specId || SPECS[0].id;
    const bgIdx = parseInt(options.bgIdx, 10);
    this._epoch = 0;
    this._mattingImg = null;
    this._mattingImgPath = null;
    this._cutImg = null;      // 原图级透明人像（方案1合成好的成品素材）
    this._personScale = 1;
    this._personNx = 0;
    this._personNy = 0;
    this._touch = null;
    this.setData({
      bgColors: BG_COLORS.map((c, idx) => ({ ...c, idx, hex: rgbToHex(c.r, c.g, c.b) })),
      selectedSpecId: specId,
      selectedBgIdx: (bgIdx >= 0 && bgIdx < BG_COLORS.length) ? bgIdx : 0
    });
  },

  onReady() { this.initCanvas(); },

  activeSpec() { return SPECS.find(s => s.id === this.data.selectedSpecId) || SPECS[0]; },

  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#origCanvas').fields({ node: true }).exec(res => {
      if (!res || !res[0]) return;
      this.canvas = res[0].node;
      this.ctx = this.canvas.getContext('2d');
      const img = this.canvas.createImage();
      img.onload = () => {
        this._srcImg = img;
        this.setData({ hasImage: true });
        this.applyFrame(this.data.selectedSpecId);
        this.runMatting();
      };
      img.onerror = () => wx.showToast({ title: '原图加载失败', icon: 'none' });
      img.src = this.imagePath;
    });
  },

  // 后端 BiRefNet 抠图 → 合成 _cutImg（原图级透明人像）；失败回退本地换底
  runMatting() {
    this._epoch = (this._epoch || 0) + 1;
    const epoch = this._epoch;
    this.setData({ mattingBusy: true });
    matting.segment(this.imagePath)
      .then(path => {
        if (epoch !== this._epoch) { this.setData({ mattingBusy: false }); return; }
        this._mattingImgPath = path;
        const img = this.canvas.createImage();
        img.onload = () => {
          if (epoch !== this._epoch) return;
          this._mattingImg = img;
          this.buildCutImg(() => {
            this.setData({ mattingMode: true, mattingBusy: false });
            this.resetPerson();
          });
        };
        img.onerror = () => { this.setData({ mattingMode: false, mattingBusy: false }); this.render(); };
        img.src = path;
      })
      .catch(() => {
        if (epoch !== this._epoch) return;
        this.setData({ mattingMode: false, mattingBusy: false });
        this.render();
      });
  },

  // 合成原图级透明人像 _cutImg：原图(rgb) × 抠图alpha(destination-in)，长边封顶 CUT_LONG
  buildCutImg(next) {
    const img = this._srcImg;
    const mat = this._mattingImg;
    if (!img || !img.width || !mat || !mat.width) { if (next) next(); return; }
    // 目标：长边封顶，比例=原图
    const long = Math.min(Math.max(img.width, img.height), CUT_LONG);
    let cw, ch;
    if (img.width >= img.height) { cw = long; ch = Math.round(long * img.height / img.width); }
    else { ch = long; cw = Math.round(long * img.width / img.height); }
    const off = wx.createOffscreenCanvas({ type: '2d', width: cw, height: ch });
    const ctx = off.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, 0, 0, cw, ch);
    // destination-in: 用抠图alpha蒙版裁出人像（抠图盖回原尺寸，全幅对齐）
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mat, 0, 0, cw, ch);
    this._cutImg = off;
    this._cutImgW = cw; this._cutImgH = ch;
    if (next) next();
  },

  // 预览画布：DOM 显示尺寸限幅(长边≤屏幕约 0.8，防大规格铺满/溢出屏幕——与 edit 一致)。
  // _frameW/_frameH = 手势逻辑坐标空间(≤屏幕)，drawScene 导出时再按 dprF 映射到导出像素。
  applyFrame(specId) {
    const spec = this.activeSpec();
    const ratio = spec.width / spec.height;
    let disp = 320;
    try {
      const sys = wx.getSystemInfoSync();
      if (sys.windowWidth > 0) disp = Math.min(320, Math.round(sys.windowWidth * 0.8));
    } catch (_) {}
    let fw, fh;
    if (ratio >= 1) { fw = disp; fh = Math.round(disp / ratio); }
    else { fh = disp; fw = Math.round(disp * ratio); }
    this._frameW = fw; this._frameH = fh;
    if (this.canvas) { this.canvas.width = fw; this.canvas.height = fh; this.ctx.setTransform(1, 0, 0, 1, 0, 0); }
    this.setData({
      canvasW: fw,
      canvasH: fh,
      selectedSpecId: specId,
      specRatioLabel: '← 规格 ' + spec.width + '×' + spec.height
    });
  },

  // 重置人像：contain 铺满整个规格框（居中）
  resetPerson() {
    const cw = this._cutImgW || 1, ch = this._cutImgH || 1;
    this._personScale = Math.min(this._frameW / cw, this._frameH / ch);
    this._personNx = 0; this._personNy = 0;
    this.render();
  },

  // 在给定画布上按当前手势值绘制：底色 + _cutImg(缩放/位移)
  drawScene(canvas, ctx, opts) {
    opts = opts || {};
    const cw = opts.cw || canvas.width, ch = opts.ch || canvas.height;
    canvas.width = cw; canvas.height = ch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bg = this.data.bgColors[this.data.selectedBgIdx];
    ctx.fillStyle = 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')';
    ctx.fillRect(0, 0, cw, ch);

    if (this.data.mattingMode && this._cutImg) {
      // frame→canvas 缩放
      const dprF = cw / this._frameW;
      const cx = (this._frameW / 2 + this._personNx * this._frameW) * dprF;
      const cy = (this._frameH / 2 + this._personNy * this._frameH) * dprF;
      const drawW = this._cutImgW * this._personScale * dprF;
      const drawH = drawW * this._cutImgH / this._cutImgW;
      const x0 = Math.round(cx - drawW / 2);
      const y0 = Math.round(cy - drawH / 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.clip();
      ctx.drawImage(this._cutImg, x0, y0, Math.round(drawW), Math.round(drawH));
      ctx.restore();
    } else if (this._srcImg) {
      // 兜底：原图 contain 铺满 + 本地换底
      ctx.drawImage(this._srcImg, 0, 0, cw, ch);
      try {
        const imgData = ctx.getImageData(0, 0, cw, ch);
        const bgRef = detectBackgroundColor(imgData);
        if (bgRef) changeBackgroundColor(imgData, bgRef, { r: bg.r, g: bg.g, b: bg.b }, 60);
        ctx.putImageData(imgData, 0, 0);
      } catch (e) { /* 忽略读像素失败 */ }
    }
  },

  render() {
    if (!this.canvas) return;
    this.drawScene(this.canvas, this.ctx);
  },

  // ==== 手势(与 edit 一致) ====
  onTouchStart(e) {
    if (!this.data.mattingMode || !this._cutImg) return;
    const t = e.touches;
    if (t.length === 1) {
      this._touch = { type: 'drag', x: t[0].clientX, y: t[0].clientY, startNx: this._personNx, startNy: this._personNy };
    } else if (t.length >= 2) {
      this._touch = { type: 'zoom', startDist: this.touchDist(t[0], t[1]), startScale: this._personScale };
    }
  },
  onTouchMove(e) {
    if (!this._touch || !this.data.mattingMode) return;
    const t = e.touches;
    if (this._touch.type === 'drag' && t.length === 1) {
      const dx = (t[0].clientX - this._touch.x) / this._frameW;
      const dy = (t[0].clientY - this._touch.y) / this._frameH;
      this._personNx = this._touch.startNx + dx;
      this._personNy = this._touch.startNy + dy;
      this.render();
    } else if (this._touch.type === 'zoom' && t.length >= 2) {
      const d = this.touchDist(t[0], t[1]);
      if (this._touch.startDist > 0) {
        let s = this._touch.startScale * (d / this._touch.startDist);
        s = Math.max(0.15, Math.min(10, s));
        this._personScale = s;
        this.render();
      }
    }
  },
  onTouchEnd() { this._touch = null; },
  touchDist(a, b) {
    return Math.sqrt((a.clientX - b.clientX) * (a.clientX - b.clientX) + (a.clientY - b.clientY) * (a.clientY - b.clientY));
  },

  onSelectSpec(e) {
    if (this.data.mattingBusy) return; // 抠图/制作中禁用规格操作，避免触发重排
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedSpecId: id });
    this.applyFrame(id);
    if (this.data.mattingMode && this._cutImg) this.resetPerson(); else this.render();
  },
  onSelectBg(e) {
    if (this.data.mattingBusy) return; // 制作中禁用换底
    const idx = parseInt(e.currentTarget.dataset.idx, 10);
    this.setData({ selectedBgIdx: idx });
    this.render();
  },

  onReset() {
    this.resetPerson();
  },

  // 导出：原图级像素(长边≤CUT_LONG)，用当前手势值，填底 + _cutImg，JPG最高画质
  onDownload() {
    if (!this._srcImg) { wx.showToast({ title: '照片未就绪', icon: 'none' }); return; }
    if (this.data.mattingBusy) { wx.showToast({ title: 'AI 抠图中，请稍候…', icon: 'none' }); return; }
    const img = this._srcImg;
    const long = Math.min(Math.max(img.width, img.height), CUT_LONG);
    let ew, eh;
    if (img.width >= img.height) { ew = long; eh = Math.round(long * img.height / img.width); }
    else { eh = long; ew = Math.round(long * img.width / img.height); }
    const off = wx.createOffscreenCanvas({ type: '2d', width: ew, height: eh });
    const ctx = off.getContext('2d');
    this.drawScene(off, ctx, { cw: ew, ch: eh });
    wx.canvasToTempFilePath({
      canvas: off,
      fileType: 'jpg',
      quality: 1,
      success: r => this.saveToAlbum(r.tempFilePath, ew, eh, false),
      fail: () => wx.showToast({ title: '导出失败', icon: 'none' })
    });
  },

  saveToAlbum(path, ew, eh, capped) {
    wx.getSetting({
      success: res => {
        const auth = res.authSetting['scope.writePhotosAlbum'];
        if (auth === false) {
          wx.showModal({ title: '需要相册权限', content: '请在设置中开启"保存到相册"权限', confirmText: '去设置', success: r => { if (r.confirm) wx.openSetting(); } });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: path,
          success: () => wx.showToast({ title: '已保存(%高画质 ' + ew + '×' + eh + ')', icon: 'success', duration: 2500 }),
          fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
        });
      }
    });
  },

  // 分享给好友：朋友点开进入首页各自选图，而非他人结果图
  onShareAppMessage() {
    return {
      title: '证件照标清大图一键导出 | 换底色/标准尺寸',
      path: '/pages/index/index'
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '证件照标清大图导出：抠图/换底色/标准尺寸',
      query: ''
    };
  }
});
