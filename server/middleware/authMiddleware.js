const jwt = require('jsonwebtoken');

/**
 * 環境變數驗證
 */
const validateEnvironment = () => {
 if (!process.env.JWT_SECRET) {
 console.error('❌ JWT_SECRET 環境變數未設定');
 return false;
 }

 if (process.env.JWT_SECRET.length < 32) {
 console.warn('⚠️ JWT_SECRET 長度較短，建議使用至少32字元的金鑰');
 }

 return true;
};

/**
 * JWT 驗證中介軟體
 * 支援多種 token 傳遞方式
 */
const verifyToken = (req, res, next) => {
 let token = null;

 try {
 // 1. 從 Authorization header 取得 token
 const authHeader = req.headers.authorization;
 if (authHeader && authHeader.startsWith('Bearer ')) {
 token = authHeader.substring(7); // 移除 "Bearer " 前綴
 }

 // 2. 從 query parameter 取得 token (用於某些特殊情況)
 if (!token && req.query && req.query.token) {
 token = req.query.token;
 }

 // 3. 從 body 取得 token (用於表單提交)
 if (!token && req.body && req.body.token) {
 token = req.body.token;
 }

 // 4. 從 cookies 取得 token (如果使用 cookie 認證)
 if (!token && req.cookies && req.cookies.token) {
 token = req.cookies.token;
 }

 if (!token) {
 return res.status(401).json({
 success: false,
 message: '存取被拒絕，未提供認證令牌',
 code: 'NO_TOKEN'
 });
 }

 // 驗證環境配置
 if (!validateEnvironment()) {
 return res.status(500).json({
 success: false,
 message: '伺服器設定錯誤',
 code: 'SERVER_CONFIG_ERROR'
 });
 }

 // 驗證 token
 const decoded = jwt.verify(token, process.env.JWT_SECRET);

 // 檢查 token 是否包含必要資訊
 if (!decoded.id || !decoded.username) {
 return res.status(401).json({
 success: false,
 message: '令牌格式無效',
 code: 'INVALID_TOKEN_FORMAT'
 });
 }

 // 檢查 token 的發行者和受眾（如果設定了）
 const expectedIssuer = 'live-streaming-platform';
 const expectedAudience = 'streaming-users';

 if (decoded.iss && decoded.iss !== expectedIssuer) {
 return res.status(401).json({
 success: false,
 message: '令牌發行者無效',
 code: 'INVALID_ISSUER'
 });
 }

 if (decoded.aud && decoded.aud !== expectedAudience) {
 return res.status(401).json({
 success: false,
 message: '令牌受眾無效',
 code: 'INVALID_AUDIENCE'
 });
 }

 // 將使用者資訊附加到請求對象
 req.user = {
 id: decoded.id,
 username: decoded.username,
 streamKey: decoded.streamKey,
 iat: decoded.iat,
 exp: decoded.exp
 };

 // 檢查 token 是否即將過期（在 1 小時內）
 const currentTime = Math.floor(Date.now() / 1000);
 const timeUntilExpiry = decoded.exp - currentTime;

 if (timeUntilExpiry < 3600) { // 1 小時 = 3600 秒
 res.setHeader('X-Token-Expires-Soon', 'true');
 res.setHeader('X-Token-Expires-In', timeUntilExpiry.toString());
 }

 // 記錄成功的認證（在偵錯模式下）
 if (process.env.NODE_ENV === 'development') {
 console.log(`[AUTH] 使用者認證成功: ${decoded.username}`);
 }

 next();

 } catch (err) {
 console.error('JWT 驗證錯誤:', {
 error: err.message,
 name: err.name,
 token: token ? `${token.substring(0, 10)}...` : 'null'
 });

 // 根據不同的錯誤類型傳回不同的回應
 if (err.name === 'TokenExpiredError') {
 return res.status(401).json({
 success: false,
 message: '令牌已過期，請重新登入',
 code: 'TOKEN_EXPIRED',
 expiredAt: err.expiredAt
 });
 } else if (err.name === 'JsonWebTokenError') {
 return res.status(401).json({
 success: false,
 message: '令牌無效',
 code: 'INVALID_TOKEN'
 });
 } else if (err.name === 'NotBeforeError') {
 return res.status(401).json({
 success: false,
 message: '令牌尚未生效',
 code: 'TOKEN_NOT_ACTIVE',
 notBefore: err.date
 });
 } else {
 return res.status(401).json({
 success: false,
 message: '令牌驗證失敗',
 code: 'TOKEN_VERIFICATION_FAILED'
 });
 }
 }
};

/**
 * 可選的認證中間件（不強制要求登入）
 */
const optionalAuth = (req, res, next) => {
 const authHeader = req.headers.authorization;

 if (!authHeader) {
 req.user = null;
 return next();
 }

 // 使用正常的驗證流程，但捕獲錯誤
 try {
 verifyToken(req, res, next);
 } catch (error) {
 req.user = null;
 next();
 }
};

/* 
 * 檢查使用者角色的中間件（如果需要角色管理）
*/
const requireRole = (roles) => {
 // 確保 roles 是數組
 const allowedRoles = Array.isArray(roles) ? roles : [roles];

 return (req, res, next) => {
 if (!req.user) {
 return res.status(401).json({
 success: false,
 message: '需要認證',
 code: 'AUTHENTICATION_REQUIRED'
 });
 }

 // 若使用者沒有角色訊息，預設為一般用戶
 const userRole = req.user.role || 'user';

 if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
 return res.status(403).json({
 success: false,
 message: '權限不足',
 code: 'INSUFFICIENT_PERMISSIONS',
 requiredRoles: allowedRoles,
 userRole: userRole
 });
 }

 next();
 };
};

/**
 * API 頻率限制中間件工廠
 */
const createRateLimit = (windowMs = 15 * 60 * 1000, maxRequests = 100) => {
 const requests = new Map();

 return (req, res, next) => {
 const identifier = req.ip || req.connection.remoteAddress || 'unknown';
 const now = Date.now();
 const windowStart = now - windowMs;

 // 清理過期的記錄
 if (requests.has(identifier)) {
 const userRequests = requests.get(identifier);
 const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
 requests.set(identifier, validRequests);
 }

 const userRequests = requests.get(identifier) || [];

 if (userRequests.length >= maxRequests) {
 return res.status(429).json({
 success: false,
 message: '請求過於頻繁，請稍後再試',
 code: 'RATE_LIMIT_EXCEEDED',
 retryAfter: Math.ceil((userRequests[0] - windowStart) / 1000)
 });
 }

 userRequests.push(now);
 requests.set(identifier, userRequests);

 // 設定回應頭
 res.setHeader('X-RateLimit-Limit', maxRequests);
 res.setHeader('X-RateLimit-Remaining', maxRequests - userRequests.length);
 res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

 next();
 };
};

/**
 * 驗證 API Key 的中間件（用於伺服器間通訊）
 */
const verifyApiKey = (req, res, next) => {
 const apiKey = req.headers['x-api-key'] || req.query.api_key;

 if (!apiKey) {
 return res.status(401).json({
 success: false,
 message: '缺少 API 金鑰',
 code: 'MISSING_API_KEY'
 });
 }

 // 這裡應該從資料庫或配置中驗證 API Key
 const validApiKey = process.env.API_KEY;

 if (!validApiKey || apiKey !== validApiKey) {
 return res.status(401).json({
 success: false,
 message: 'API 金鑰無效',
 code: 'INVALID_API_KEY'
 });
 }

 next();
};

module.exports = {
 verifyToken,
 optionalAuth,
 requireRole,
 createRateLimit,
 verifyApiKey,
 validateEnvironment
};