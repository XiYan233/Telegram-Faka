/**
 * 错误响应处理函数
 * 
 * @param {Error} error - 错误对象
 * @param {Object} res - Express响应对象
 * @param {number} statusCode - HTTP状态码，默认500
 */
function errorResponse(error, res, statusCode = 500) {
  console.error('服务器错误:', error);
  
  const errorMessage = process.env.NODE_ENV === 'production'
    ? '服务器遇到意外错误，请稍后再试'
    : error.message || '未知错误';
  
  return res.status(statusCode).json({
    success: false,
    error: errorMessage
  });
}

/**
 * 通用错误处理中间件
 * 
 * @param {Error} err - 错误对象
 * @param {Object} req - Express请求对象
 * @param {Object} res - Express响应对象
 * @param {Function} next - Express下一个中间件
 */
function errorHandler(err, req, res, next) {
  let statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  let message = err.message;

  // 处理MongoDB错误
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    statusCode = 404;
    message = '找不到资源';
  }
  
  // 处理验证错误
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map(val => val.message).join(', ');
  }
  
  errorResponse({
    message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack
  }, res, statusCode);
}

module.exports = {
  errorResponse,
  errorHandler
}; 