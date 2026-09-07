const { SPECS, drawCenterCrop } = require('../../utils/idphoto.js');
const { watchAd } = require('../../utils/ad.js');
const { addRecord } = require('../../utils/storage.js');

// 画布显示区最长边(逻辑px)；canvas 尺寸随所选规格宽高比变化(同 edit 页 applyFrameSize)。
const DISPLAY = 420;

Page({
  data: {
    hasImage: false,
    specs: SPECS,
    selectedSpecId: '',
    canvasW: 300,
    canvasH: 400
  },

  onLoad(options) {
    this.imagePath = decodeURIComponent(options.image || '');
    const specId = options.specId || SPECS[0].id;
    this.setData({ selectedSpecId: specId });
    this._originalImg = null;
  },

  onReady() {
    this.initCanvas();
  },

  activeSpec() {
    return SPECS.find(s => s.id === this.data.selectedSpecId) || SPECS[0];
  },

  initCanvas() {
    if (!this.imagePath) return;
    wx.createSelectorQuery()
      .select('#cropCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res || !res[0]) return;
        const { node: canvas } = res[0];
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        const img = canvas.createImage();
        img.onload = () => {
          this._originalImg = img;
          this.setData({ hasImage: true }, () => {
            this.applyFrameSize(this.data.selectedSpecId);
            this.renderSync();
          });
        };
        img.onerror = () => wx.showToast({ title: '图片加载失败', icon: 'none' });
        img.src = this.imagePath;
      });
  },

  // 画布尺寸跟随所选规格宽高比（同 edit 页 applyFrameSize）
  applyFrameSize(specId) {
    const spec = SPECS.find(s => s.id === specId) || SPECS[0];
    const ratio = spec.width / spec.height;
    let cw, ch;
    if (ratio >= 1) {
      cw = DISPLAY;
      ch = DISPLAY / ratio;
    } else {
      ch = DISPLAY;
      cw = DISPLAY * ratio;
    }
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    this._cw = cw; this._ch = ch;
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.setData({ canvasW: Math.round(cw), canvasH: Math.round(ch) });
  },

  renderSync() {
    if (!this._originalImg || !this.canvas) return;
    const dpr = wx.getSystemInfoSync().pixelRatio || 2;
    const cw = this._cw, ch = this._ch;
    const canvasW = Math.round(cw * dpr), canvasH = Math.round(ch * dpr);
    this.canvas.width = canvasW;
    this.canvas.height = canvasH;
    this.ctx.clearRect(0, 0, canvasW, canvasH);
    // 单张：按规格比例画布居中裁剪铺满
    drawCenterCrop(this.ctx, this._originalImg, canvasW, canvasH);
  },

  onSelectSpec(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ selectedSpecId: id }, () => {
      this.applyFrameSize(id);
      this.renderSync();
    });
  },

  onBackToEdit() {
    wx.navigateBack();
  },

  // 生成并保存：按当前规格导出（激励视频为 MVP 占位，不阻塞）
  onExport() {
    watchAd().then(() => this.exportSingle());
  },

  exportSingle() {
    const spec = this.activeSpec();
    const off = wx.createOffscreenCanvas({ type: '2d', width: spec.width, height: spec.height });
    const octx = off.getContext('2d');
    drawCenterCrop(octx, this._originalImg, spec.width, spec.height);
    wx.canvasToTempFilePath({
      canvas: off,
      fileType: 'png',
      success: res => this.saveToAlbum(res.tempFilePath),
      fail: () => wx.showToast({ title: '生成失败', icon: 'none' })
    });
  },

  saveToAlbum(tempPath) {
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
        wx.saveImageToPhotosAlbum({
          filePath: tempPath,
          success: () => {
            wx.showToast({ title: '已保存到相册', icon: 'success' });
            const s = this.activeSpec();
            addRecord({ size: s.name, color: '', hd: true });
          },
          fail: () => wx.showModal({
            title: '保存失败',
            content: '请在设置中允许保存到相册',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting(); }
          })
        });
      }
    });
  }
});