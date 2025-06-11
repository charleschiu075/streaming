const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

/**
 * RTMP on_publish 驗證介面
 * Nginx 會以 POST 送來 stream key 資訊
 */
router.post('/verify', async (req, res) => {
    try {
        // 記錄請求資訊以便調試
        console.log('[RTMP] 收到推流驗證請求:', {
            body: req.body,
            headers: req.headers,
            ip: req.ip
        });
        
        // 從不同可能的字段獲取 stream key
        const streamKey = req.body.name || req.body.key || req.body.stream_key;
        
        if (!streamKey) {
            console.log('[RTMP] ❌ 缺少串流密鑰');
            return res.status(400).json({
                success: false,
                message: '缺少串流密鑰',
                code: 'MISSING_STREAM_KEY'
            });
        }
        
        // 驗證 stream key 格式
        if (typeof streamKey !== 'string' || streamKey.length < 10) {
            console.log('[RTMP] ❌ 串流密鑰格式無效:', streamKey);
            return res.status(400).json({
                success: false,
                message: '串流密鑰格式無效',
                code: 'INVALID_STREAM_KEY_FORMAT'
            });
        }
        
        // 查找對應的用戶
        const user = await User.findOne({ streamKey });
        
        if (!user) {
            console.log('[RTMP] ❌ 未找到對應的串流密鑰:', streamKey);
            return res.status(403).json({
                success: false,
                message: '串流密鑰無效',
                code: 'INVALID_STREAM_KEY'
            });
        }
        
        // 檢查用戶是否被禁用
        if (!user.isActive) {
            console.log('[RTMP] ❌ 用戶帳戶已被禁用:', user.username);
            return res.status(403).json({
                success: false,
                message: '帳戶已被禁用',
                code: 'ACCOUNT_DISABLED'
            });
        }
        
        // 更新用戶的最後推流時間
        user.lastStreamTime = new Date();
        await user.save();
        
        console.log(`[RTMP] ✅ 推流驗證成功: ${user.username} (${streamKey})`);
        
        // 返回成功響應（Nginx 需要 200 狀態碼）
        return res.status(200).json({
            success: true,
            message: '推流驗證成功',
            username: user.username
        });
        
    } catch (error) {
        console.error('[RTMP] 推流驗證錯誤:', error);
        return res.status(500).json({
            success: false,
            message: '服務器內部錯誤',
            code: 'INTERNAL_SERVER_ERROR'
        });
    }
});

/**
 * 推流結束回調
 * Nginx 可以在推流結束時調用此接口
 */
router.post('/end', async (req, res) => {
    try {
        const streamKey = req.body.name || req.body.key || req.body.stream_key;
        
        if (streamKey) {
            const user = await User.findOne({ streamKey });
            if (user) {
                user.lastStreamEndTime = new Date();
                await user.save();
                console.log(`[RTMP] 推流結束: ${user.username}`);
            }
        }
        
        res.status(200).json({
            success: true,
            message: '推流結束記錄成功'
        });
        
    } catch (error) {
        console.error('[RTMP] 推流結束記錄錯誤:', error);
        res.status(500).json({
            success: false,
            message: '服務器內部錯誤'
        });
    }
});

/**
 * 獲取用戶的推流狀態
 */
router.get('/status', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '用戶不存在',
                code: 'USER_NOT_FOUND'
            });
        }
        
        // 判斷是否正在推流（簡單的時間判斷，實際應用中可能需要更複雜的邏輯）
        const isStreaming = user.lastStreamTime && 
            (Date.now() - user.lastStreamTime.getTime()) < 60000; // 1分鐘內有推流活動
        
        res.json({
            success: true,
            data: {
                username: user.username,
                streamKey: user.streamKey,
                isStreaming,
                lastStreamTime: user.lastStreamTime,
                lastStreamEndTime: user.lastStreamEndTime,
                streamUrl: `rtmp://3.107.21.209:1935/live`,
                watchUrl: `http://3.107.21.209:8000/live/${user.username}/index.m3u8`
            }
        });
        
    } catch (error) {
        console.error('獲取推流狀態錯誤:', error);
        res.status(500).json({
            success: false,
            message: '獲取推流狀態失敗',
            code: 'STATUS_FETCH_FAILED'
        });
    }
});

/**
 * 重新生成串流密鑰
 */
router.post('/regenerate-key', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '用戶不存在',
                code: 'USER_NOT_FOUND'
            });
        }
        
        // 生成新的串流密鑰
        const { v4: uuidv4 } = require('uuid');
        let newStreamKey;
        let isUnique = false;
        let attempts = 0;
        const maxAttempts = 5;
        
        while (!isUnique && attempts < maxAttempts) {
            newStreamKey = `${user.username}_${uuidv4()}`;
            const existingUser = await User.findOne({ streamKey: newStreamKey });
            if (!existingUser) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            return res.status(500).json({
                success: false,
                message: '無法生成唯一的串流密鑰',
                code: 'KEY_GENERATION_FAILED'
            });
        }
        
        user.streamKey = newStreamKey;
        user.streamKeyUpdatedAt = new Date();
        await user.save();
        
        console.log(`[STREAM] 用戶 ${user.username} 重新生成串流密鑰`);
        
        res.json({
            success: true,
            message: '串流密鑰重新生成成功',
            data: {
                streamKey: newStreamKey,
                updatedAt: user.streamKeyUpdatedAt
            }
        });
        
    } catch (error) {
        console.error('重新生成串流密鑰錯誤:', error);
        res.status(500).json({
            success: false,
            message: '重新生成串流密鑰失敗',
            code: 'KEY_REGENERATION_FAILED'
        });
    }
});

/**
 * 獲取公開的串流資訊（不需要認證）
 */
router.get('/public/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        if (!username) {
            return res.status(400).json({
                success: false,
                message: '用戶名為必填項',
                code: 'USERNAME_REQUIRED'
            });
        }
        
        const user = await User.findOne({ 
            username: { $regex: new RegExp(`^${username}$`, 'i') }
        }).select('username lastStreamTime');
        
        if (!user || !user.isActive) {
            return res.status(404).json({
                success: false,
                message: '用戶不存在或已被禁用',
                code: 'USER_NOT_FOUND'
            });
        }
        
        // 判斷是否正在推流
        const isStreaming = user.lastStreamTime && 
            (Date.now() - user.lastStreamTime.getTime()) < 60000;
        
        res.json({
            success: true,
            data: {
                username: user.username,
                isStreaming,
                watchUrl: `http://3.107.21.209:8000/live/${user.username}/index.m3u8`
            }
        });
        
    } catch (error) {
        console.error('獲取公開串流資訊錯誤:', error);
        res.status(500).json({
            success: false,
            message: '獲取串流資訊失敗',
            code: 'PUBLIC_INFO_FETCH_FAILED'
        });
    }
});

/**
 * 健康檢查端點
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: '串流服務運行正常',
        timestamp: new Date().toISOString()
    });
});

module.exports = router;