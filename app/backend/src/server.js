require('dotenv').config();
const app = require('./app');
const subscriptionSweep = require('./jobs/subscriptionSweep');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`The School Management App API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  subscriptionSweep.start();
});
