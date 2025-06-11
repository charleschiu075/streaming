const jwt = require('jsonwebtoken');

/**
 * JWT 驗證中間件
 * 支援多種 token 傳遞方式
 */
const verifyToken = (req, res, next) => {
    let token = null;
    
    // 1. 從 Authorization header 獲取 token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // 移除 "Bearer " 前綴
    }
    
    // 2. 從 query parameter 獲取 token (用於某些特殊情況)
    if (!token && req.query.token) {
        token = req.query.token;
    }
    
    // 3. 從 body 獲取 token (用於表單提交)
    if (!token && req.body.token) {
        token = req.body.token;
    }
    
    if (!token) {
        return res.status(401).json({ 
            success: false,
            message: '訪問被拒絕，未提供認證令牌',
            code: 'NO_TOKEN'
        });
    }
    
    try {
        // 驗證 JWT_SECRET 是否存在
        if (!process.env.JWT_SECRET) {
            console.error('JWT_SECRET 未設定');
            return res.status(500).json({ 
                success: false,
                message: '服務器配置錯誤',
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
        
        // 將用戶資訊附加到請求對象
        req.user = {
            id: decoded.id,
            username: decoded.username,
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
        
        next();
        
    } catch (err) {
        console.error('JWT 驗證錯誤:', err.message);
        
        // 根據不同的錯誤類型返回不同的響應
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
                code: 'TOKEN_NOT_ACTIVE'
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
    
    // 使用正常的驗證流程，但不返回錯誤
    verifyToken(req, res, (err) => {
        if (err) {
            req.user = null;
        }
        next();
    });
};

/**
 * 檢查用戶角色的中間件（如果需要角色管理）
 */
const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                message: '需要認證',
                code: 'AUTHENTICATION_REQUIRED'
            });
        }
        
        if (roles && !roles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false,
                message: '權限不足',
                code: 'INSUFFICIENT_PERMISSIONS'
            });
        }
        
        next();
    };
};

module.exports = {
    verifyToken,
    optionalAuth,
    requireRole
};