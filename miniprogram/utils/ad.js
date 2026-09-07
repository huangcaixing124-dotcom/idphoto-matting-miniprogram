/**
 * utils/ad.js —— 激励视频广告封装
 * adUnitId 占位，需在微信广告后台开通后填写（见 README）。
 * 纯本地，无防刷校验（MVP 取舍）。
 */

// TODO: 在 README 指引下，从微信广告平台开通激励视频后填入真实 adUnitId
const REWARD_VIDEO_AD_UNIT_ID = ''; // 激励视频广告位 ID，留空则观看功能自动跳过
let rewardedVideoAd = null;

function ensureAd() {
  if (!REWARD_VIDEO_AD_UNIT_ID) return null;
  if (rewardedVideoAd) return rewardedVideoAd;
  rewardedVideoAd = wx.createRewardedVideoAd({ adUnitId: REWARD_VIDEO_AD_UNIT_ID });
  rewardedVideoAd.onError(err => console.warn('[ad] 激励视频错误', err));
  return rewardedVideoAd;
}

/**
 * 观看激励视频。
 * @returns {Promise<boolean>} true=完成可放行；false=未看完/关闭/未配置广告
 */
function watchAd() {
  return new Promise(resolve => {
    const ad = ensureAd();
    if (!ad) {
      // 未配置广告位：直接放行，不影响开发调试
      resolve(true);
      return;
    }
    ad.show()
      .then(() => {
        // onClose 回调里再放行
        const onClose = res => {
          ad.offClose(onClose);
          resolve(!!(res && res.isEnded));
        };
        ad.onClose(onClose);
      })
      .catch(() => {
        // show 失败，尝试 load 一次再 show
        ad.load()
          .then(() => ad.show())
          .catch(() => resolve(false));
      });
  });
}

module.exports = { watchAd, REWARD_VIDEO_AD_UNIT_ID };