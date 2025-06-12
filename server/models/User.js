const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true, // 自動轉換為小寫
        trim: true // 去除首尾空格
    },
    password: { 
        type: String, 
        required: true 
    },
    streamKey: { 
        type: String, 
        required: true, 
        unique: true 
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLogin: {
        type: Date,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // 串流相關字段
    lastStreamTime: {
        type: Date,
        default: null
    },
    lastStreamEndTime: {
        type: Date,
        default: null
    },
    streamCount: {
        type: Number,
        default: 0
    },
    streamKeyUpdatedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true // 自動添加 createdAt 和 updatedAt
});

// 添加索引以提高查詢性能
userSchema.index({ username: 1 });
userSchema.index({ streamKey: 1 });
userSchema.index({ lastStreamTime: 1 }); // 用於查詢在線用戶
userSchema.index({ isActive: 1, lastStreamTime: 1 }); // 複合索引用於在線用戶查詢

module.exports = mongoose.model('User', userSchema);