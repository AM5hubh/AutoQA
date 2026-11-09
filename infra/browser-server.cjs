const { chromium } = require('playwright');
chromium
  .launchServer({ headless: true, chromiumSandbox: true, host: '0.0.0.0', port: 3000, wsPath: '/' })
  .then((server) => {
    console.log('Sandboxed Chromium listening on port 3000');
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.on(signal, async () => {
        await server.close();
        process.exit(0);
      });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
