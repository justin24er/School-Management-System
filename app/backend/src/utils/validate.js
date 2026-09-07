function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(400).json({
        error: 'Please check the information you entered.',
        details: error.details.map(d => d.message),
      });
    }
    req.body = value;
    next();
  };
}

module.exports = { validateBody };
