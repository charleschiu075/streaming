/**
 * 輸入驗證函數
 */
const validateStreamKey = (streamKey) => {
    if (!streamKey || typeof streamKey !== 'string') {
        return false;
    }

 // 檢查長度和格式
 if (streamKey.length < 10 || streamKey.length > 100) {
 return false;
 }

 // 基本格式驗證（字母、數字、底線、連字號）
 if (!/^[a-zA-Z0-9_-]+$/.test(streamKey)) {
 return false;
 }

 return true;
};

/**
 * 檢查使用者是否正在推流
 */
const isUserStreaming = (user) => {
 if (!user || !user.lastStreamTime) {
 return false;
 }

 // 判斷是否在過去1分鐘內有推流活動
 const streamTimeout = 60000; // 1分鐘
 const currentTime = Date.now();
 const lastStreamTime = user.lastStreamTime.getTime();

 return (currentTime - lastStreamTime) < streamTimeout;
};

/**
 * 驗證使用者名稱格式的中間件
 */
const validateUsername = (req, res, next) => {
 const { username } = req.params;

 if (!username || typeof username !== 'string') {
 return res.status(400).json({
 success: false,
 message: '使用者名稱為必填項',
 code: 'USERNAME_REQUIRED'
 });
 }

 // 驗證使用者名稱格式
 if (username.length > 20 || !/^[a-zA-Z0-9_]+$/.test(username)) {
 return res.status(400).json({
 success: false,
 message: '使用者名稱格式無效',
 code: 'INVALID_USERNAME_FORMAT'
 });
 }

 next();
};

/**
 * 檢查使用者模型是否可用的中間件
 */
const checkUserModel = (User) => {
 return (req, res, next) => {
 if (!User) {
 return res.status(500).json({
 success: false,
 message: '伺服器設定錯誤',
 code: 'SERVER_CONFIG_ERROR'
 });
 }

 // 將 User 模型附加到請求對象，方便後續使用
 req.User = User;
 next();
 };
};

/**
 * 驗證串流金鑰格式的中間件
 */
const validateStreamKeyMiddleware = (req, res, next) => {
 // 從不同可能的欄位取得 stream key
 const streamKey = req.body.name || req.body.key || req.body.stream_key || req.body.streamKey;

 if (!streamKey) {
 console.log('[RTMP] ❌ 缺少流媒體金鑰');
 return res.status(400).json({
 success: false,
 message: '缺少流媒體金鑰',
 code: 'MISSING_STREAM_KEY'
 });
 }

 // 驗證 stream key 格式
 if (!validateStreamKey(streamKey)) {
 console.log('[RTMP] ❌ 串流金鑰格式無效:', streamKey);
 return res.status(400).json({
 success: false,
 message: '串流金鑰格式無效',
 code: 'INVALID_STREAM_KEY_FORMAT'
 });
 }

 // 將驗證後的 streamKey 附加到請求對象
 req.validatedStreamKey = streamKey;
 next();
};

/**
 * 記錄 RTMP 請求的中間件
 */
const logRTMPRequest = (req, res, next) => {
 console.log('[RTMP] 收到推流驗證請求:', {
 body: req.body,
 headers: {
 'user-agent': req.headers['user-agent'],
 'content-type': req.headers['content-type']
 },
 ip: req.ip || req.connection.remoteAddress
 });

 next();
};

/**
 * 檢查使用者是否正在推流的中間件
 */
const checkStreamingStatus = (req, res, next) => {
 if (!req.user) {
 return res.status(401).json({
 success: false,
 message: '使用者未認證',
 code: 'UNAUTHENTICATED'
 });
 }

 // 這裡需要取得使用者的完整資訊來檢查推流狀態
 // 在實際使用中，可能需要從資料庫重新查詢使用者信息
 req.isCurrentlyStreaming = isUserStreaming(req.user);
 next();
};

/**
 * 處理串流結束記錄的中間件
 */
const handleStreamEnd = async (req, res, next) => {
 try {
 const streamKey = req.body.name || req.body.key || req.body.stream_key || req.body.streamKey;

 console.log('[RTMP] 收到推流結束通知:', {
 streamKey: streamKey ? streamKey.substring(0, 10) + '...' : 'unknown',
 ip: req.ip || req.connection.remoteAddress
 });

 // 將處理結果附加到請求對象
 req.streamEndData = {
 streamKey,
 timestamp: new Date(),
 ip: req.ip || req.connection.remoteAddress
 };

 next();

 } catch (error) {
 console.error('[RTMP] 推流結束處理錯誤:', error);
 return res.status(500).json({
 success: false,
 message: '伺服器內部錯誤',
 code: 'INTERNAL_SERVER_ERROR'
 });
 }
};

/**
 * 產生流媒體 URL 的輔助函數
 */
const generateStreamUrls = (username) => {
 const baseIp = '3.107.21.209'; // 可以從環境變數取得

 return {
 streamUrl: `rtmp://${baseIp}:1935/live`,
 watchUrl: `http://${baseIp}:8000/live/${username}/index.m3u8`
 };
};

/**
 * 格式化使用者串流資料的輔助函數
 */
const formatUserStreamData = (user, includeStreamKey = false) => {
 const isStreaming = isUserStreaming(user);
 const urls = generateStreamUrls(user.username);

 const data = {
 username: user.username,
 isStreaming,
 status: isStreaming ? 'online' : 'offline',
 watchUrl: urls.watchUrl,
 lastStreamTime: isStreaming ? user.lastStreamTime : null
 };

 if (includeStreamKey) {
 data.streamKey = user.streamKey;
 data.streamUrl = urls.streamUrl;
 data.lastStreamEndTime = user.lastStreamEndTime;
    
}
    
    return data;
};

/**
 * 限制傳回使用者數量的中間件
 */
const limitResults = (limit = 50) => {
    return (req, res, next) => {
        req.resultLimit = limit;
        next();
    };
};

module.exports = {
    validateStreamKey,
    isUserStreaming,
    validateUsername,
    checkUserModel,
    validateStreamKeyMiddleware,
    logRTMPRequest,
    checkStreamingStatus,
    handleStreamEnd,
    generateStreamUrls,
    formatUserStreamData,
    limitResults
};