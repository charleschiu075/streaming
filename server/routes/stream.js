const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * RTMP on_publish 驗證介面
 * Nginx 會以 POST 送來 stream key 資訊
 */
router.post('/verify', async (req, res) => {
  const { name } = req.body; // name 是 OBS 設定的 stream key
  if (!name) return res.status(400).send('Missing stream name');

  try {
    const user = await User.findOne({ streamKey: name });
    if (user) {
      console.log(`[RTMP] ✅ Stream allowed: ${user.username}`);
      return res.status(200).send('OK'); // 允許推流
    } else {
      console.log(`[RTMP] ❌ Stream key not found: ${name}`);
      return res.status(403).send('Forbidden'); // 禁止推流
    }
  } catch (err) {
    console.error('Error verifying streamKey:', err);
    return res.status(500).send('Internal Error');
  }
});

module.exports = router;
