module.exports = async (req, res) => {
  const { app, bootstrapPromise } = require('../server');
  await bootstrapPromise;
  return app(req, res);
};
