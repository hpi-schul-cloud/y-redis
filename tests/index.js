/* eslint-env node */
import { authServerStarted } from '../bin/auth-server-example.js'; // starts the example server

import { runTests } from 'lib0/testing';
import * as api from './api.tests.js';
import * as auth from './auth.tests.js';
import * as storage from './storage.tests.js';
import * as ws from './ws.tests.js';

await authServerStarted

runTests({
  storage,
  api,
  auth,
  ws
}).then(success => {
  process.exit(success ? 0 : 1)
})
