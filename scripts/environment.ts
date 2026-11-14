import { childEnvironment } from '../apps/broker/src/policy/index.js';
export function verificationEnvironment(source = process.env) {
  return childEnvironment(source, ['npm_execpath', 'npm_node_execpath', 'PLAYWRIGHT_BROWSERS_PATH', 'NO_COLOR', 'CESTON_E2E_ROOT', 'CESTON_E2E_STATIC', 'CESTON_E2E_WEB_PORT', 'CESTON_E2E_API_PORT', 'CESTON_DEV_WEB_PORT', 'CESTON_DEV_API_PORT']);
}
