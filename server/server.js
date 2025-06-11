const express = require('express');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
dotenv.config();
connectDB();

const app = express();
app.use(express.json());
app.use('/api/auth', require('./routes/auth'));
app.use('/api/stream', require('./routes/stream'));
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
