const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

// 載入環境變數
dotenv.config();

// 連接資料庫
connectDB();

const app = express();

// 中間件
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 移除 CORS 設定，由 Nginx 處理

// 路由 - 移除 /api 前綴，因為 Nginx 已經處理了
app.use('/auth', require('./routes/auth'));
app.use('/stream', require('./routes/stream'));

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error('錯誤:', err.stack);
  
  // 根據錯誤類型返回不同的狀態碼
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: '輸入驗證失敗',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: '無效的認證令牌',
      code: 'INVALID_TOKEN'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: '認證令牌已過期',
      code: 'TOKEN_EXPIRED'
    });
  }
  
  // 預設錯誤回應
  res.status(500).json({
    success: false,
    message: '伺服器內部錯誤',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

// 404 處理
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: '找不到請求的路由',
    code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});