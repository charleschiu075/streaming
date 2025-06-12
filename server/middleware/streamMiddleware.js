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

    // 檢查是否包含敏感字元
    const sensitiveChars = /[<>{}[\]\\]/;
    if (sensitiveChars.test(streamKey)) {
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

    // 檢查是否有異常的推流時間
    if (lastStreamTime > currentTime) {
        console.warn(`[STREAM] 異常的推流時間: ${user.username}, lastStreamTime: ${lastStreamTime}, currentTime: ${currentTime}`);
        return false;
    }

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

    // 檢查是否包含敏感字元
    const sensitiveChars = /[<>{}[\]\\]/;
    if (sensitiveChars.test(username)) {
        return res.status(400).json({
            success: false,
            message: '使用者名稱包含無效字元',
            code: 'INVALID_USERNAME_CHARS'
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
            console.error('[STREAM] ❌ User 模型未載入');
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
    try {
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
    } catch (error) {
        console.error('[RTMP] 串流金鑰驗證錯誤:', error);
        return res.status(500).json({
            success: false,
            message: '串流金鑰驗證失敗',
            code: 'STREAM_KEY_VALIDATION_ERROR'
        });
    }
};

/**
 * 記錄 RTMP 請求的中間件
 */
const logRTMPRequest = (req, res, next) => {
    try {
        const logData = {
            timestamp: new Date().toISOString(),
            body: req.body,
            headers: {
                'user-agent': req.headers['user-agent'],
                'content-type': req.headers['content-type']
            },
            ip: req.ip || req.connection.remoteAddress
        };

        console.log('[RTMP] 收到推流驗證請求:', logData);

        // 檢查是否有可疑的請求
        const suspiciousPatterns = [
            /\.\.\//,  // 路徑遍歷
            /<script>/, // XSS 嘗試
            /exec\(/,   // 命令注入
            /eval\(/    // 代碼注入
        ];

        const isSuspicious = suspiciousPatterns.some(pattern => 
            JSON.stringify(logData).match(pattern)
        );

        if (isSuspicious) {
            console.warn('[RTMP] ⚠️ 檢測到可疑請求:', logData);
        }

        next();
    } catch (error) {
        console.error('[RTMP] 請求記錄錯誤:', error);
        next(); // 繼續處理請求，不中斷
    }
};

/**
 * 檢查使用者是否正在推流的中間件
 */
const checkStreamingStatus = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: '使用者未認證',
                code: 'UNAUTHENTICATED'
            });
        }

        // 從資料庫重新查詢使用者資訊
        const user = await req.User.findById(req.user.id).select('lastStreamTime isActive');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: '使用者不存在',
                code: 'USER_NOT_FOUND'
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                success: false,
                message: '帳戶已被禁用',
                code: 'ACCOUNT_DISABLED'
            });
        }

        // 檢查推流狀態
        req.isCurrentlyStreaming = isUserStreaming(user);
        next();
    } catch (error) {
        console.error('[STREAM] 推流狀態檢查錯誤:', error);
        return res.status(500).json({
            success: false,
            message: '推流狀態檢查失敗',
            code: 'STREAM_STATUS_CHECK_FAILED'
        });
    }
};

/**
 * 處理串流結束記錄的中間件
 */
const handleStreamEnd = async (req, res, next) => {
    try {
        const streamKey = req.body.name || req.body.key || req.body.stream_key || req.body.streamKey;

        if (!streamKey) {
            console.warn('[RTMP] ⚠️ 推流結束通知缺少串流金鑰');
            return res.status(400).json({
                success: false,
                message: '缺少串流金鑰',
                code: 'MISSING_STREAM_KEY'
            });
        }

        console.log('[RTMP] 收到推流結束通知:', {
            streamKey: streamKey.substring(0, 10) + '...',
            ip: req.ip || req.connection.remoteAddress,
            timestamp: new Date().toISOString()
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
    const baseIp = process.env.STREAM_SERVER_IP || '3.107.21.209';
    const rtmpPort = process.env.RTMP_PORT || '1935';
    const httpPort = process.env.HTTP_PORT || '8000';

    return {
        streamUrl: `rtmp://${baseIp}:${rtmpPort}/live`,
        watchUrl: `http://${baseIp}:${httpPort}/live/${username}/index.m3u8`
    };
};

/**
 * 格式化使用者串流資料的輔助函數
 */
const formatUserStreamData = (user, includeStreamKey = false) => {
    try {
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
    } catch (error) {
        console.error('[STREAM] 資料格式化錯誤:', error);
        return {
            username: user.username,
            isStreaming: false,
            status: 'error',
            error: '資料格式化失敗'
        };
    }
};

/**
 * 限制傳回使用者數量的中間件
 */
const limitResults = (limit = 50) => {
    return (req, res, next) => {
        try {
            // 確保限制值在合理範圍內
            const maxLimit = 100;
            const minLimit = 1;
            
            req.resultLimit = Math.min(Math.max(limit, minLimit), maxLimit);
            next();
        } catch (error) {
            console.error('[STREAM] 結果限制設定錯誤:', error);
            req.resultLimit = 50; // 使用預設值
            next();
        }
    };
};

// 確保所有函數都被正確導出
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