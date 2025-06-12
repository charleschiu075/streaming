const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

// 導入middleware和模型
let User;
let verifyToken;
let streamMiddleware;

try {
    User = require('../models/User');
    const authMiddleware = require('../middleware/authmiddleware');
    streamMiddleware = require('../middleware/streamMiddleware');
    verifyToken = authMiddleware.verifyToken;
} catch (error) {
    console.error('模块导入错误:', error);
}

// 解構middleware函數
const {
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
} = streamMiddleware;

/**
 * RTMP on_publish 驗證接口
 * Nginx 以 POST 送来 stream key 訊息
 */
router.post('/verify', 
    checkUserModel(User),
    logRTMPRequest,
    validateStreamKeyMiddleware,
    async (req, res) => {
        try {
            const streamKey = req.validatedStreamKey;
            
            // 查找用戶
            const user = await req.User.findOne({ streamKey }).select('username isActive lastStreamTime');
            
            if (!user) {
                console.log('[RTMP] ❌ 未找到对应的串流密钥:', streamKey.substring(0, 10) + '...');
                return res.status(403).json({
                    success: false,
                    message: '串流密钥无效',
                    code: 'INVALID_STREAM_KEY'
                });
            }
            
            // 檢查用戶禁用狀態
            if (!user.isActive) {
                console.log('[RTMP] ❌ 用户账户已被禁用:', user.username);
                return res.status(403).json({
                    success: false,
                    message: '账户已被禁用',
                    code: 'ACCOUNT_DISABLED'
                });
            }
            
            // 更新用户的最後推流時間
            const updateResult = await req.User.updateOne(
                { _id: user._id },
                { 
                    lastStreamTime: new Date(),
                    $inc: { streamCount: 1 } // 紀錄推流次數
                }
            );
            
            if (updateResult.acknowledged) {
                console.log(`[RTMP] ✅ 推流验证成功: ${user.username} (${streamKey.substring(0, 10)}...)`);
            }
            
            // 返回成功（Nginx 需要 200 状态码）
            return res.status(200).json({
                success: true,
                message: '推流验证成功',
                username: user.username,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('[RTMP] 推流验证错误:', error);
            return res.status(500).json({
                success: false,
                message: '服务器内部错误',
                code: 'INTERNAL_SERVER_ERROR'
            });
        }
    }
);

/**
 * 推流结束回調
 * Nginx 可以在推流結束時調用此接口
 */
router.post('/end',
    checkUserModel(User),
    handleStreamEnd,
    async (req, res) => {
        try {
            const { streamKey } = req.streamEndData;
            
            if (streamKey) {
                const user = await req.User.findOne({ streamKey }).select('username');
                if (user) {
                    await req.User.updateOne(
                        { _id: user._id },
                        { lastStreamEndTime: new Date() }
                    );
                    console.log(`[RTMP] 推流结束: ${user.username}`);
                }
            }
            
            res.status(200).json({
                success: true,
                message: '推流结束记录成功',
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('[RTMP] 推流结束记录错误:', error);
            res.status(500).json({
                success: false,
                message: '服务器内部错误'
            });
        }
    }
);

/**
 * 獲取用戶的推流狀態
 */
router.get('/status', 
    verifyToken,
    checkUserModel(User),
    async (req, res) => {
        try {
            const user = await req.User.findById(req.user.id).select(
                'username streamKey lastStreamTime lastStreamEndTime isActive'
            );
            
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: '用户不存在',
                    code: 'USER_NOT_FOUND'
                });
            }
            
            // 使用格式化函數建構響應數據
            const responseData = formatUserStreamData(user, true);
            
            res.json({
                success: true,
                data: responseData
            });
            
        } catch (error) {
            console.error('获取推流状态错误:', error);
            res.status(500).json({
                success: false,
                message: '获取推流状态失败',
                code: 'STATUS_FETCH_FAILED'
            });
        }
    }
);

/**
 * 重新生成串流金鑰
 */
router.post('/regenerate-key',
    verifyToken,
    checkUserModel(User),
    async (req, res) => {
        try {
            const user = await req.User.findById(req.user.id).select('username streamKey');
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: '用户不存在',
                    code: 'USER_NOT_FOUND'
                });
            }
            
            // 檢查是否正在推流
            if (isUserStreaming(user)) {
                return res.status(409).json({
                    success: false,
                    message: '推流进行中，无法重新生成密钥',
                    code: 'STREAMING_IN_PROGRESS'
                });
            }
            
            // 生成新的串流金鑰
            let newStreamKey;
            let isUnique = false;
            let attempts = 0;
            const maxAttempts = 5;
            
            while (!isUnique && attempts < maxAttempts) {
                // 生成更安全的 stream key
                const timestamp = Date.now().toString(36);
                const randomPart = uuidv4().replace(/-/g, '').substring(0, 16);
                newStreamKey = `${user.username}_${timestamp}_${randomPart}`;
                
                const existingUser = await req.User.findOne({ streamKey: newStreamKey });
                if (!existingUser) {
                    isUnique = true;
                }
                attempts++;
            }
            
            if (!isUnique) {
                return res.status(500).json({
                    success: false,
                    message: '无法生成唯一的串流密钥',
                    code: 'KEY_GENERATION_FAILED'
                });
            }
            
            // 更新用户的串流金鑰
            const updateResult = await req.User.updateOne(
                { _id: user._id },
                { 
                    streamKey: newStreamKey,
                    streamKeyUpdatedAt: new Date()
                }
            );
            
            if (!updateResult.acknowledged) {
                return res.status(500).json({
                    success: false,
                    message: '更新串流密钥失败',
                    code: 'KEY_UPDATE_FAILED'
                });
            }
            
            console.log(`[STREAM] 用户 ${user.username} 重新生成串流密钥`);
            
            res.json({
                success: true,
                message: '串流密钥重新生成成功',
                data: {
                    streamKey: newStreamKey,
                    updatedAt: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error('重新生成串流密钥错误:', error);
            res.status(500).json({
                success: false,
                message: '重新生成串流密钥失败',
                code: 'KEY_REGENERATION_FAILED'
            });
        }
    }
);

/**
 * 獲取公開的串流訊息（不需要認證）
 */
router.get('/public/:username',
    validateUsername,
    checkUserModel(User),
    async (req, res) => {
        try {
            const { username } = req.params;
            
            const user = await req.User.findOne({ 
                username: { $regex: new RegExp(`^${username}$`, 'i') }
            }).select('username lastStreamTime isActive');
            
            if (!user || !user.isActive) {
                return res.status(404).json({
                    success: false,
                    message: '用户不存在或已被禁用',
                    code: 'USER_NOT_FOUND'
                });
            }
            
            // 使用格式化函數建構響應數據
            const responseData = formatUserStreamData(user, false);
            
            res.json({
                success: true,
                data: responseData
            });
            
        } catch (error) {
            console.error('获取公开串流信息错误:', error);
            res.status(500).json({
                success: false,
                message: '获取串流信息失败',
                code: 'PUBLIC_INFO_FETCH_FAILED'
            });
        }
    }
);

/**
 * 獲取所有在線用戶列表(公開接口)
 */
router.get('/online',
    checkUserModel(User),
    limitResults(50),
    async (req, res) => {
        try {
            // 查找最近1分鐘內有推流的用戶
            const oneMinuteAgo = new Date(Date.now() - 60000);
            
            const onlineUsers = await req.User.find({
                isActive: true,
                lastStreamTime: { $gte: oneMinuteAgo }
            }).select('username lastStreamTime').limit(req.resultLimit);
            
            const formattedUsers = onlineUsers.map(user => ({
                username: user.username,
                watchUrl: generateStreamUrls(user.username).watchUrl,
                streamStartTime: user.lastStreamTime
            }));
            
            res.json({
                success: true,
                data: {
                    onlineCount: formattedUsers.length,
                    users: formattedUsers,
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error('获取在线用户列表错误:', error);
            res.status(500).json({
                success: false,
                message: '获取在线用户列表失败',
                code: 'ONLINE_USERS_FETCH_FAILED'
            });
        }
    }
);

/**
 * 健康檢查端點
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: '串流服务运行正常',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

/**
 * 服務統計訊息（需要認證）
 */
router.get('/stats',
    verifyToken,
    checkUserModel(User),
    async (req, res) => {
        try {
            const oneMinuteAgo = new Date(Date.now() - 60000);
            const oneDayAgo = new Date(Date.now() - 86400000);
            
            const [totalUsers, activeUsers, onlineUsers, recentStreams] = await Promise.all([
                req.User.countDocuments({}),
                req.User.countDocuments({ isActive: true }),
                req.User.countDocuments({ 
                    isActive: true,
                    lastStreamTime: { $gte: oneMinuteAgo }
                }),
                req.User.countDocuments({
                    lastStreamTime: { $gte: oneDayAgo }
                })
            ]);
            
            res.json({
                success: true,
                data: {
                    totalUsers,
                    activeUsers,
                    onlineUsers,
                    recentStreams,
                    timestamp: new Date().toISOString()
                }
            });
            
        } catch (error) {
            console.error('获取服务统计信息错误:', error);
            res.status(500).json({
                success: false,
                message: '获取统计信息失败',
                code: 'STATS_FETCH_FAILED'
            });
        }
    }
);

module.exports = router;