const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// 確保正確導入 User 模型和中間件
let User;
let verifyToken;

try {
    User = require('../models/User');
    const authMiddleware = require('../middleware/authMiddleware');
    verifyToken = authMiddleware.verifyToken;
} catch (error) {
    console.error('模塊導入錯誤:', error);
}

/**
 * 輸入驗證函數
 */
const validateRegistration = (username, password) => {
    const errors = [];
    
    // 用戶名驗證
    if (!username || typeof username !== 'string') {
        errors.push('用戶名為必填項');
    } else {
        if (username.length < 3 || username.length > 20) {
            errors.push('用戶名長度必須在 3-20 字符之間');
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            errors.push('用戶名只能包含字母、數字和下劃線');
        }
    }
    
    // 密碼驗證
    if (!password || typeof password !== 'string') {
        errors.push('密碼為必填項');
    } else {
        if (password.length < 6) {
            errors.push('密碼長度至少需要 6 個字符');
        }
        if (password.length > 100) {
            errors.push('密碼長度不能超過 100 個字符');
        }
    }
    
    return errors;
};

const validateLogin = (username, password) => {
    const errors = [];
    
    if (!username || typeof username !== 'string') {
        errors.push('用戶名為必填項');
    }
    
    if (!password || typeof password !== 'string') {
        errors.push('密碼為必填項');
    }
    
    return errors;
};

/**
 * 生成 JWT Token
 */
const generateToken = (user) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET 未設定');
    }
    
    const payload = {
        id: user._id.toString(), // 確保 ID 是字符串
        username: user.username,
        streamKey: user.streamKey
    };
    
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        issuer: 'live-streaming-platform',
        audience: 'streaming-users'
    });
};

/**
 * 用戶註冊
 */
router.post('/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 檢查必要的依賴是否存在
        if (!User) {
            return res.status(500).json({
                success: false,
                message: '服務器配置錯誤',
                code: 'SERVER_CONFIG_ERROR'
            });
        }
        
        // 輸入驗證
        const validationErrors = validateRegistration(username, password);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: '輸入驗證失敗',
                errors: validationErrors
            });
        }
        
        // 檢查用戶是否已存在（不區分大小寫）
        const existingUser = await User.findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        });
        
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: '用戶名已存在',
                code: 'USER_EXISTS'
            });
        }
        
        // 加密密碼
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // 生成唯一的 stream key
        let streamKey;
        let isStreamKeyUnique = false;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!isStreamKeyUnique && attempts < maxAttempts) {
            streamKey = `${username}_${uuidv4()}`;
            const existingStream = await User.findOne({ streamKey });
            if (!existingStream) {
                isStreamKeyUnique = true;
            }
            attempts++;
        }
        
        if (!isStreamKeyUnique) {
            return res.status(500).json({
                success: false,
                message: '無法生成唯一的串流密鑰，請稍後再試',
                code: 'STREAM_KEY_GENERATION_FAILED'
            });
        }
        
        // 創建新用戶
        const newUser = new User({
            username: username.toLowerCase(), // 統一使用小寫存儲
            password: hashedPassword,
            streamKey,
            createdAt: new Date(),
            lastLogin: null,
            isActive: true
        });
        
        const savedUser = await newUser.save();
        
        console.log(`[AUTH] 新用戶註冊成功: ${username}`);
        
        res.status(201).json({
            success: true,
            message: '註冊成功',
            data: {
                username: savedUser.username,
                streamKey: savedUser.streamKey,
                createdAt: savedUser.createdAt
            }
        });
        
    } catch (error) {
        console.error('註冊錯誤:', error);
        
        // 處理 MongoDB 重複鍵錯誤
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: '用戶名已存在',
                code: 'USER_EXISTS'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '註冊失敗，請稍後再試',
            code: 'REGISTRATION_FAILED'
        });
    }
});

/**
 * 用戶登入
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 檢查必要的依賴是否存在
        if (!User) {
            return res.status(500).json({
                success: false,
                message: '服務器配置錯誤',
                code: 'SERVER_CONFIG_ERROR'
            });
        }
        
        // 輸入驗證
        const validationErrors = validateLogin(username, password);
        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: '輸入驗證失敗',
                errors: validationErrors
            });
        }
        
        // 查找用戶（不區分大小寫）
        const user = await User.findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        });
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: '用戶名或密碼錯誤',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        // 檢查用戶是否被禁用
        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: '帳戶已被禁用，請聯繫管理員',
                code: 'ACCOUNT_DISABLED'
            });
        }
        
        // 驗證密碼
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: '用戶名或密碼錯誤',
                code: 'INVALID_CREDENTIALS'
            });
        }
        
        // 更新最後登入時間
        user.lastLogin = new Date();
        await user.save();
        
        // 生成 JWT token
        const token = generateToken(user);
        
        console.log(`[AUTH] 用戶登入成功: ${user.username}`);
        
        res.json({
            success: true,
            message: '登入成功',
            data: {
                token,
                username: user.username,
                streamKey: user.streamKey,
                lastLogin: user.lastLogin
            }
        });
        
    } catch (error) {
        console.error('登入錯誤:', error);
        res.status(500).json({
            success: false,
            message: '登入失敗，請稍後再試',
            code: 'LOGIN_FAILED'
        });
    }
});

/**
 * 刷新 Token
 */
router.post('/refresh', verifyToken, async (req, res) => {
    try {
        if (!User) {
            return res.status(500).json({
                success: false,
                message: '服務器配置錯誤',
                code: 'SERVER_CONFIG_ERROR'
            });
        }
        
        const user = await User.findById(req.user.id);
        if (!user || !user.isActive) {
            return res.status(401).json({
                success: false,
                message: '用戶不存在或已被禁用',
                code: 'USER_NOT_FOUND'
            });
        }
        
        const newToken = generateToken(user);
        
        res.json({
            success: true,
            message: 'Token 刷新成功',
            data: {
                token: newToken,
                username: user.username,
                streamKey: user.streamKey
            }
        });
        
    } catch (error) {
        console.error('Token 刷新錯誤:', error);
        res.status(500).json({
            success: false,
            message: 'Token 刷新失敗',
            code: 'TOKEN_REFRESH_FAILED'
        });
    }
});

/**
 * 獲取當前用戶資訊
 */
router.get('/profile', verifyToken, async (req, res) => {
    try {
        if (!User) {
            return res.status(500).json({
                success: false,
                message: '服務器配置錯誤',
                code: 'SERVER_CONFIG_ERROR'
            });
        }
        
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '用戶不存在',
                code: 'USER_NOT_FOUND'
            });
        }
        
        res.json({
            success: true,
            data: {
                username: user.username,
                streamKey: user.streamKey,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin,
                isActive: user.isActive
            }
        });
        
    } catch (error) {
        console.error('獲取用戶資訊錯誤:', error);
        res.status(500).json({
            success: false,
            message: '獲取用戶資訊失敗',
            code: 'PROFILE_FETCH_FAILED'
        });
    }
});

/**
 * 用戶登出（可選，主要用於記錄）
 */
router.post('/logout', verifyToken, async (req, res) => {
    try {
        console.log(`[AUTH] 用戶登出: ${req.user.username}`);
        
        res.json({
            success: true,
            message: '登出成功'
        });
        
    } catch (error) {
        console.error('登出錯誤:', error);
        res.status(500).json({
            success: false,
            message: '登出失敗',
            code: 'LOGOUT_FAILED'
        });
    }
});

module.exports = router;