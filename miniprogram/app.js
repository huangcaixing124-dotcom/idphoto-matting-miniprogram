App({
  onLaunch() {
    // 证照抠图走自建后端：本地图片 PNG→base64 → HTTPS POST 到 idphoto.hcxserver.xyz/extract，
    // 后端即时抠图后返图；结果按图片内容哈希在服务器暂存用于去重复用，超容量自动清理，不用于任何其他目的。
    // 已不再使用微信云开发（旧 wx.cloud.init 痕迹已移除，避免无必要的身份/轨迹采集）。
  },
  globalData: {
    // 最近处理结果的临时路径，仅在当前会话内存中保存
    lastResultPath: ''
  }
})