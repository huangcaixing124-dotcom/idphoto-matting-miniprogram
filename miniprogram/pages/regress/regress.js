// pages/regress/regress.js
// ============================================================
// 成品页（2026-09-05）：上传 → 后端抠透明人像 → 前端直接显示透明人像(叠可选底色) → 下载。
// 刻意不碰 edit.js 的 canvas 坐标/缩放/自动对齐/规格框 —— 真机问题重灾区。
// 复用 utils/matting.js 的 segment()（自建 RMBG 后端 POST /extract）。
// ============================================================
const { segment } = require('../../utils/matting.js');

Page({
  data: {
    hasImage: false,
    originalPath: '',
    resultPath: '',       // 后端返回的透明 PNG 临时路径
    mattingMode: false,
    mattingBusy: false,
    mattingFailed: false,
    statusText: '',
    bgIndex: 1,           // 默认蓝底
    bgColors: [
      { name: '白', val: [255,255,255], rgb: 'rgb(255,255,255)' },
      { name: '黑', val: [28,28,30],    rgb: 'rgb(28,28,30)' },
      { name: '蓝', val: [0,120,220],   rgb: 'rgb(0,120,220)' },
      { name: '红', val: [220,40,50],   rgb: 'rgb(220,40,50)' },
      { name: '米黄', val: [240,220,180], rgb: 'rgb(240,220,180)' },
    ],
  },

  onChoose() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['album'],
      sizeType: ['original'], // 取原图,避免压缩图导致低清抠图脸颊内凹
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (f) {
          this.setData({ originalPath: f.tempFilePath, hasImage: true,
                         resultPath: '', mattingMode: false, mattingFailed: false, statusText: '' });
        }
      },
    });
  },

  async onMatting() {
    if (!this.data.originalPath) { wx.showToast({ title: '请先选择照片', icon: 'none' }); return; }
    this.setData({ mattingBusy: true, mattingFailed: false, statusText: 'AI 抠图中…' });
    try {
      const segPath = await segment(this.data.originalPath, {});
      console.warn('[regress] segment 返回透明图 →', segPath);
      this.setData({ resultPath: segPath, mattingMode: true, mattingBusy: false, statusText: '抠图完成' });
    } catch (e) {
      console.error('[regress] 抠图失败', e && e.code, e && e.message);
      this.setData({ mattingBusy: false, mattingFailed: true, statusText: '抠图失败：' + ((e && e.message) || e) });
    }
  },

  onPickBg(e) {
    this.setData({ bgIndex: Number(e.currentTarget.dataset.idx) });
  },

  // 下载：透明人像铺到所选底色 → 合成成品 → 存相册。用离屏 canvas，无坐标/缩放。
  onDownload() {
    if (!this.data.mattingMode || !this.data.resultPath) { wx.showToast({ title: '请先完成抠图', icon: 'none' }); return; }
    const bg = this.data.bgColors[this.data.bgIndex].val || [255,255,255];
    const rgbay = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    this._downloadPath = this.data.resultPath;
    this._downloadBg = rgbay;

    wx.getSetting({
      success: res => {
        const auth = res.authSetting['scope.writePhotosAlbum'];
        if (auth === false) {
          wx.showModal({
            title: '需要相册权限', content: '请在设置中开启"保存到相册"权限',
            confirmText: '去设置',
            success: r => { if (r.confirm) wx.openSetting(); }
          });
          return;
        }
        this._composeAndSave();
      },
      fail: () => this._composeAndSave()
    });
  },

  _composeAndSave() {
    const path = this._downloadPath;
    const bgRgb = this._downloadBg;
    wx.getImageInfo({
      src: path,
      success: (info) => {
        const W = info.width, H = info.height;
        if (!W || !H) { wx.showToast({ title: '图片信息无效', icon: 'none' }); return; }
        const oc = wx.createOffscreenCanvas({ type: '2d', width: W, height: H });
        const ctx = oc.getContext('2d');
        ctx.fillStyle = bgRgb;
        ctx.fillRect(0, 0, W, H);
        const img = oc.createImage();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, W, H);
          wx.canvasToTempFilePath({
            canvas: oc, fileType: 'png',
            success: r => {
              this.setData({ statusText: '成片已生成，正在保存…' });
              wx.saveImageToPhotosAlbum({
                filePath: r.tempFilePath,
                success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
                fail: (e) => { console.error('[regress] save fail', e); wx.showToast({ title: '保存失败', icon: 'none' }); }
              });
            },
            fail: (e) => { console.error('[regress] canvasToTempFilePath fail', e); wx.showToast({ title: '生成失败', icon: 'none' }); }
          });
        };
        img.onerror = (e) => { console.error('[regress] compose img onerror', e); wx.showToast({ title: '生成失败', icon: 'none' }); };
        img.src = path;
      },
      fail: (e) => { console.error('[regress] getImageInfo fail', e); wx.showToast({ title: '生成失败', icon: 'none' }); }
    });
  },
});