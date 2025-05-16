FROM node:18-alpine

WORKDIR /app

# 安装netcat用于服务可用性检查和其他工具
RUN apk add --no-cache netcat-openbsd curl

# 先复制package.json文件
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制应用代码
COPY . .

# 设置启动脚本权限
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 使用启动脚本
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"] 