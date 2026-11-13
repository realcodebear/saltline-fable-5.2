# 提示词市集 API · 生产镜像
# 构建（上下文必须是仓库根目录，静态文件要一起打进去）：
#   docker build -f server/deploy/Dockerfile -t market-api .
# 运行：
#   docker run -d --name market -p 8790:8790 \
#     -e ADMIN_USER=admin -e ADMIN_PASSWORD='换成你的强密码' \
#     -v market-data:/data market-api

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8790 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_ROOT=/app

# 非 root 运行
RUN addgroup -S market && adduser -S -G market -h /app market

WORKDIR /app

# 依赖为零：直接拷代码 + 静态资源
COPY server/ ./server/
COPY market/ ./market/
COPY index.html ./index.html

RUN mkdir -p /data && chown -R market:market /app /data

USER market

VOLUME ["/data"]
EXPOSE 8790

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.mjs"]
