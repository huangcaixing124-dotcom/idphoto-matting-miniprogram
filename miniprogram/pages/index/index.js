const { SPECS } = require('../../utils/idphoto.js');

// 分类 Tab 定义（顺序即展示顺序）
// 【临时隐藏】「打印」tab 已下线(2026-09-06)：A4/拼版功能已废弃，6寸单图无实际用途。
// 恢复方式：把 print 加回本数组即可，SPECS 里的 photo_6inch 数据仍在，无需改别的。
const GROUPS = [
  { id: 'common', name: '常用' },
  { id: 'cert', name: '证件' },
  { id: 'passport', name: '护照' },
  { id: 'visa', name: '签证' }
];

Page({
  data: {
    groups: GROUPS,
    activeGroup: GROUPS[0].id,
    displaySpecs: [],
    selectedSpec: SPECS[0].id,
    features: [
      { title: '证件照换底色', sub: '红 / 蓝 / 白等 8 种预设，一键改色' },
      { title: '规格裁剪', sub: '一寸、二寸、护照等标准尺寸' }
    ]
  },

  onLoad() {
    // 打开「转发」+「分享到朋友圈」右上角入口（朋友圈对工具类主体灰度开放；开发者工具可预览）
    try { wx.showShareMenu({ menus: ['shareAppMessage', 'shareTimeline'] }); } catch (_) {}
    // 隐私确认（合规）：首次进入提示用户照片会上传服务器处理。同意后写入统一字段 matting_privacy_consent。
    this.ensurePrivacyConsent();
    // 初始展示第一个分类下的规格
    this.setData({ displaySpecs: this.filterByGroup(this.data.activeGroup) });
  },

  // 隐私同意：合法域名/保存相册前需用户确认照片会传服务器。未同意则弹窗；同意写 storage。
  ensurePrivacyConsent() {
    const C = 'matting_privacy_consent';
    if (wx.getStorageSync(C)) return; // 已同意，不再打扰
    wx.showModal({
      title: '照片上传提示',
      content: '使用本小程序抠图/换底色时，你选中的照片会经加密上传至服务器进行抠图处理；处理结果会在服务器暂存以便去重复用，并定期自动清理，不用于任何其他用途。是否同意？',
      confirmText: '同意并继续',
      cancelText: '暂不使用',
      success: res => {
        if (res.confirm) {
          try { wx.setStorageSync(C, true); } catch (_) {}
        } else {
          wx.showToast({ title: '未同意则无法使用抠图功能', icon: 'none', duration: 2500 });
        }
      }
    });
  },

  // 按分类过滤规格
  filterByGroup(groupId) {
    return SPECS.filter(s => s.group === groupId);
  },

  onSwitchGroup(e) {
    const gid = e.currentTarget.dataset.id;
    if (gid === this.data.activeGroup) return;
    const list = this.filterByGroup(gid);
    this.setData({
      activeGroup: gid,
      displaySpecs: list,
      // 切换分类时，若当前选中项不在该分类，回退到该分类第一个
      selectedSpec: list.some(s => s.id === this.data.selectedSpec) ? this.data.selectedSpec : (list[0] ? list[0].id : '')
    });
  },

  onSelectSpec(e) {
    this.setData({ selectedSpec: e.currentTarget.dataset.id });
  },

  // 分享给好友（右上角菜单 + 主动按钮）
  onShareAppMessage() {
    return {
      title: '证件照一键抠图换底色 | 一寸二寸护照通用',
      path: '/pages/index/index',
      // imageUrl: 不传 → 使用小程序默认 Logo。如需自定义分享图，放入本地路径或 https 图后在此启用。
    };
  },

  // 分享到朋友圈（右上角菜单「分享到朋友圈」；微信对工具类主体灰度开放入口）
  onShareTimeline() {
    return {
      title: '证件照快速搞定：抠图/换底色/标准尺寸',
      query: ''
    };
  },

  onChooseImage() {
    // 兜底：未同意隐私（storage 被清/绕过弹窗）则先引导同意，不直接选图
    if (!wx.getStorageSync('matting_privacy_consent')) { this.ensurePrivacyConsent(); return; }
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album'],
      sizeType: ['original'], // 关键修复(2026-09-05): 必须取原图。默认['original','compressed']会返回压缩图,
                              // 实测真机 tempFilePath 被降到 460px 宽,后端收到低清图导致RMBG抠脸颊被往里收窄。
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        const spec = this.data.displaySpecs.find(s => s.id === this.data.selectedSpec) || SPECS[0];
        wx.navigateTo({
          url: `/pages/edit/edit?image=${encodeURIComponent(tempFilePath)}&specId=${spec.id}`
        });
      }
    });
  }
});