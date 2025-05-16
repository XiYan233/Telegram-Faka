#!/bin/sh
set -e

echo "等待MongoDB就绪..."
# 使用更健壮的等待逻辑
max_retries=15
retries=0

# 等待MongoDB启动
echo "检查MongoDB服务..."
while [ $retries -lt $max_retries ]; do
  if nc -z mongodb 27017; then
    echo "MongoDB服务已启动！"
    break
  fi
  retries=$((retries+1))
  echo "等待MongoDB服务启动... ($retries/$max_retries)"
  sleep 3
done

# 重置重试计数
retries=0

# 等待MongoDB可以进行连接
echo "尝试连接MongoDB..."
while [ $retries -lt $max_retries ]; do
  if mongosh --host mongodb --eval "db.adminCommand('ping').ok" --quiet >/dev/null 2>&1; then
    echo "MongoDB连接成功！"
    break
  fi
  retries=$((retries+1))
  echo "等待MongoDB连接就绪... ($retries/$max_retries)"
  sleep 2
done

if [ $retries -eq $max_retries ]; then
  echo "警告: 无法连接到MongoDB，将使用直接URI尝试连接..."
  # 直接使用环境变量中的URI尝试连接
  if mongosh "$MONGODB_URI" --eval "db.adminCommand('ping').ok" --quiet >/dev/null 2>&1; then
    echo "使用环境变量URI连接MongoDB成功！"
  else
    echo "无法连接到MongoDB，应用可能无法正常工作"
  fi
fi

# 检查是否已经初始化
NEED_INIT=false

# 使用环境变量中的URI进行初始化检查
echo "检查数据库是否需要初始化..."
if [ "$(mongosh "$MONGODB_URI" --quiet --eval "db.products.count()" 2>/dev/null || echo "0")" = "0" ]; then
  NEED_INIT=true
  echo "数据库为空，需要初始化"
else
  echo "数据库已包含数据，无需初始化"
fi

# 是否由环境变量控制初始化
if [ "${INIT_DB:-true}" = "true" ] && [ "$NEED_INIT" = "true" ]; then
  echo "初始化数据库..."
  if [ -f "src/scripts/init-data.js" ]; then
    node src/scripts/init-data.js || echo "初始化脚本执行失败，但将继续启动应用"
  else
    echo "警告: 初始化脚本不存在"
  fi
else
  echo "跳过数据库初始化，数据库已包含数据或初始化被禁用"
fi

echo "启动应用..."
exec "$@" 