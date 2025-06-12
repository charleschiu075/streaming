const jwt = require('jsonwebtoken');

// 用於儲存已登出的 token
const tokenBlacklist = new Set();

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

 // 檢查 JWT 過期時間設定
 if (!process.env.JWT_EXPIRES_IN) {
 console.warn('⚠️ JWT_EXPIRES_IN 未設定，使用預設值 24h');
 }

 return true;
};

/**
 * 將 token 加入黑名單
 */
const addToBlacklist = (token) => {
 try {
 const decoded = jwt.decode(token);
 if (decoded && decoded.exp) {
 // 只儲存未過期的 token
 const currentTime = Math.floor(Date.now() / 1000);
 if (decoded.exp > currentTime) {
 tokenBlacklist.add(token);
 // 設定自動清理（當 token 過期時）
 setTimeout(() => {
 tokenBlacklist.delete(token);
 }, (decoded.exp - currentTime) * 1000);
 }
 }
 } catch (error) {
 console.error('Token 黑名單處理錯誤:', error);
 }
};

/**
 * 檢查 token 是否在黑名單中
 */
const isTokenBlacklisted = (token) => {
 return tokenBlacklist.has(token);
};

/**
 * JWT 驗證中介軟體
 */
const verifyToken = (req, res, next) => {
  try {
    // 從 Authorization header 取得 token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: '未提供有效的認證令牌',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.substring(7);

    // 檢查 token 是否在黑名單中
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        message: '令牌已被撤銷',
        code: 'TOKEN_REVOKED'
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

    // 將使用者資訊附加到請求對象
    req.user = {
      id: decoded.id,
      username: decoded.username,
      streamKey: decoded.streamKey
    };

    next();
  } catch (err) {
    console.error('JWT 驗證錯誤:', err.message);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: '令牌已過期，請重新登入',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      success: false,
      message: '令牌驗證失敗',
      code: 'TOKEN_VERIFICATION_FAILED'
    });
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
 validateEnvironment,
 addToBlacklist,
 isTokenBlacklisted
};