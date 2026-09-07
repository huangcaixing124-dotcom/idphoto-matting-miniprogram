/**
 * utils/storage.js —— 本地记录存取
 * 仅存元数据（时间/规格等），绝不保存用户照片，保障隐私合规。
 * 使用 wx.storage，纯本地，无后端。
 */

const KEY = 'idphoto_history';

function getHistory() {
  try {
    return wx.getStorageSync(KEY) || [];
  } catch (e) {
    return [];
  }
}

/**
 * 新增一条使用记录
 * @param {Object} item { size, color, hd } 等元数据
 */
function addRecord(item) {
  const list = getHistory();
  const record = Object.assign(
    { time: Date.now(), size: '', color: '', hd: false },
    item
  );
  list.unshift(record);
  // 最多保留 50 条
  if (list.length > 50) list.length = 50;
  try {
    wx.setStorageSync(KEY, list);
  } catch (e) {
    // 存储满等异常，静默失败
  }
  return record;
}

function clearHistory() {
  try {
    wx.removeStorageSync(KEY);
  } catch (e) {}
}

module.exports = { getHistory, addRecord, clearHistory };