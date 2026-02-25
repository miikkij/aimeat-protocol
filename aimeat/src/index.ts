import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';

const config = loadConfig();
const app = createServer(config);

app.listen(config.port, () => {
  logger.info(`🥩 AIMEAT node started`, {
    nodeId: config.nodeId,
    port: config.port,
    storage: config.dbUrl ? 'mongodb' : 'in-memory',
  });
  logger.info(`   GET http://localhost:${config.port}/`);
  logger.info(`   Protocol: AIMEAT v1.2 | License: MIT`);
});
