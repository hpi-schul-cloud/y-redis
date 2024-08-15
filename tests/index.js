/* eslint-env node */
import { authServerStarted } from '../bin/auth-server-example.js'; // starts the example server

import { runTests } from 'lib0/testing';
import * as auth from './auth.tests.js';
import * as api from './io-redis/api.tests.js';
import * as ws from './io-redis/ws.tests.js';
import * as napi from './node-redis/api.tests.js';
import * as nws from './node-redis/ws.tests.js';
import * as storage from './storage.tests.js';

await authServerStarted

runTests({
  storage,
  api,
  napi,
  auth,
  ws,
  nws
}).then(success => {
  process.exit(success ? 0 : 1)
})
