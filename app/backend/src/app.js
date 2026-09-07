require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const { attachUser } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimits');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const onboardingRoutes = require('./routes/onboardingRoutes');
const adminRoutes = require('./routes/adminRoutes');
const schoolRoutes = require('./routes/schoolRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // the static frontend loads its own CSP-friendly config; see server.js
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.use(session({
  name: 'sma.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 8 * 60 * 60 * 1000, // 8 hour idle-friendly session; rotated on login
  },
}));

app.use(attachUser);
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

const frontendPublic = path.join(__dirname, '..', '..', 'frontend', 'public');
const frontendPages = path.join(__dirname, '..', '..', 'frontend', 'pages');
app.use(express.static(frontendPublic));
app.use('/dashboards', express.static(path.join(frontendPages, 'dashboards')));
app.get('/', (req, res) => res.redirect('/index.html'));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(errorHandler);

module.exports = app;
