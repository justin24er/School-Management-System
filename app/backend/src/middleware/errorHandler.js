const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', '..', 'logs', 'app-error.log');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const entry = {
    time: new Date().toISOString(),
    message: err.message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    userId: req.user ? req.user.id : null,
  };
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (_) {
    // Logging must never crash the request.
  }
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(err);
  }

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Something went wrong on our end. Please try again.' : err.message,
  });
}

module.exports = errorHandler;
