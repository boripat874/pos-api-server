  class ErrorHandler extends Error {
    constructor(statusCode, message) {
      super();
      this.statusCode = statusCode;
      this.message = message;
    }
  }
  
  function handleError(error, res) {
    const status = error.status || 500;
    res.status(status).json({
        message: error.message || "Internal Server Error"
    });
  }
  
  module.exports = {
    ErrorHandler,
    handleError,
  };