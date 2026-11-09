FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /opt/runner
RUN npm init -y && npm install --save-exact playwright@1.65.0
COPY infra/browser-server.cjs ./browser-server.cjs
USER pwuser
