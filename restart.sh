#!/bin/bash
# 重启前后端服务的脚本

echo "=== 正在重启服务 ==="
echo ""

# 0. 读取环境配置
if [ -f ".env.worktree" ]; then
    echo "检测到 .env.worktree 配置文件"
    export $(grep -v '^#' .env.worktree | xargs)
else
    echo "使用默认配置"
fi

FRONTEND_PORT=${FRONTEND_PORT:-3000}
BACKEND_PORT=${PORT:-8080}

echo "前端端口: $FRONTEND_PORT"
echo "后端端口: $BACKEND_PORT"
echo "开发验证码: ${MULTICA_DEV_VERIFICATION_CODE:-未设置}"
echo ""

# 1. 停止现有服务
echo "1. 停止现有服务..."

# 停止前端服务
FRONTEND_PID=$(netstat -ano | findstr ":$FRONTEND_PORT" | findstr "LISTENING" | awk '{print $5}' | head -1)
if [ -n "$FRONTEND_PID" ]; then
    echo "停止前端服务 (PID: $FRONTEND_PID, 端口: $FRONTEND_PORT)..."
    taskkill //F //PID $FRONTEND_PID 2>/dev/null || true
fi

# 停止后端服务
BACKEND_PID=$(netstat -ano | findstr ":$BACKEND_PORT" | findstr "LISTENING" | awk '{print $5}' | head -1)
if [ -n "$BACKEND_PID" ]; then
    echo "停止后端服务 (PID: $BACKEND_PID, 端口: $BACKEND_PORT)..."
    taskkill //F //PID $BACKEND_PID 2>/dev/null || true
fi

# 等待端口释放
echo "等待端口释放..."
sleep 2

# 2. 创建日志目录
echo ""
echo "2. 创建日志目录..."
mkdir -p logs

# 3. 启动后端服务
echo ""
echo "3. 启动后端服务..."
cd server
go run ./cmd/server > ../logs/server.log 2>&1 &
cd ..
echo "后端服务已启动 (端口: $BACKEND_PORT)"

# 等待后端启动
sleep 3

# 4. 启动前端服务
echo ""
echo "4. 启动前端服务..."
# 传递所有必要的环境变量给前端
FRONTEND_PORT=$FRONTEND_PORT \
BACKEND_PORT=$BACKEND_PORT \
NEXT_PUBLIC_API_URL=http://localhost:$BACKEND_PORT \
pnpm dev:web > logs/web.log 2>&1 &
echo "前端服务已启动 (端口: $FRONTEND_PORT)"
echo "前端 API 代理: http://localhost:$BACKEND_PORT"

# 等待服务启动
echo ""
echo "等待服务启动..."
sleep 5

# 5. 检查服务状态
echo ""
echo "5. 检查服务状态..."
netstat -ano | findstr -E ":$BACKEND_PORT|:$FRONTEND_PORT" | findstr "LISTENING"

echo ""
echo "=== 服务重启完成 ==="
echo ""
echo "后端服务: http://localhost:$BACKEND_PORT"
echo "前端服务: http://localhost:$FRONTEND_PORT"
echo ""
echo "日志文件:"
echo "  后端: logs/server.log"
echo "  前端: logs/web.log"
