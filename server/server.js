const express = require('express');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, '../public')));

app.listen(8000, () => {
  console.log('Web server running at http://3.107.21.209:8000');
});
