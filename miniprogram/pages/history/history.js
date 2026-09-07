const { getHistory, clearHistory } = require('../../utils/storage.js');

Page({
  data: {
    records: [],
    empty: true
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const records = getHistory().map(r => ({
      ...r,
      timeText: this.formatTime(r.time)
    }));
    this.setData({ records, empty: records.length === 0 });
  },

  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onClear() {
    wx.showModal({
      title: '清空记录',
      content: '确定清空全部使用记录吗？记录仅保存在本机。',
      confirmText: '清空',
      success: res => {
        if (res.confirm) {
          clearHistory();
          this.refresh();
        }
      }
    });
  }
});