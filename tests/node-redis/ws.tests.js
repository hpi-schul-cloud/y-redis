import { Redis } from 'ioredis'
import * as array from 'lib0/array'
import * as jwt from 'lib0/crypto/jwt'
import * as promise from 'lib0/promise'
import * as t from 'lib0/testing'
import * as time from 'lib0/time'
import { WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import * as api from '../../src/api.js'
import { createYWebsocketServer } from '../../src/server.js'
import * as utils from '../utils.js'

const redisPrefix = 'ytestsnoderedis'
export const yredisPort = 9998
export const yredisUrl = `ws://localhost:${yredisPort}/`

const authToken = await jwt.encodeJwt(utils.authPrivateKey, {
  iss: 'my-auth-server',
  exp: time.getUnixTime() + 60 * 60 * 1000, // token expires in one hour
  yuserid: 'user1' // fill this with a unique id of the authorized user
})

/**
 * @param {t.TestCase} tc
 * @param {string} room
 */
const createWsClient = (tc, room) => {
  const ydoc = new Y.Doc()
  const roomPrefix = tc.testName
  const provider = new WebsocketProvider(yredisUrl, roomPrefix + '-' + room, ydoc, { WebSocketPolyfill: /** @type {any} */ (WebSocket), disableBc: true, params: {}, protocols: [`yauth-${authToken}`] })
  return { ydoc, provider }
}

const createWorker = async (redis) => {
  const worker = await api.createWorker(utils.store, redisPrefix, {}, redis)
  worker.client.redisMinMessageLifetime = 800
  worker.client.redisTaskDebounce = 500
  utils.prevClients.push(worker.client)
  return worker
}

const createServer = async () => {
  const redis = new Redis(api.redisUrl)

  const server = await createYWebsocketServer({ port: yredisPort, store: utils.store, redisPrefix: redisPrefix, checkPermCallbackUrl: utils.checkPermCallbackUrl, redis })
  utils.prevClients.push(server)
  return server
}
/**
 * 
 * @param {Redis} redis 
 * @returns 
 */
const createApiClient = async (redis) => {
  const client = await api.createApiClient(utils.store, redisPrefix, redis)
  utils.prevClients.push(client)
  return client
}

/**
 * @param {t.TestCase} tc
 */
const createTestCase = async tc => {
  await promise.all(utils.prevClients.map(c => c.destroy()))
  utils.prevClients.length = 0
  const redisClient = new Redis(api.redisUrl)
  // flush existing content
  const keysToDelete = await redisClient.keys(redisPrefix + ':*')
  await redisClient.del(keysToDelete)
  utils.prevClients.push({ destroy: () => redisClient.quit().then(() => {}) })
  const server = await createServer()
  const redis1 = new Redis(api.redisUrl)
  const redis2 = new Redis(api.redisUrl)

  const [apiClient, worker] = await promise.all([createApiClient(redis1), createWorker(redis2)])
  return {
    redisClient,
    apiClient,
    server,
    worker,
    createWsClient: /** @param {string} room */ (room) => createWsClient(tc, room)
  }
}

/**
 * @param {Y.Doc} ydoc1
 * @param {Y.Doc} ydoc2
 */
const waitDocsSynced = (ydoc1, ydoc2) => {
  console.info('waiting for docs to sync...')
  return promise.until(0, () => {
    const e1 = Y.encodeStateAsUpdateV2(ydoc1)
    const e2 = Y.encodeStateAsUpdateV2(ydoc2)
    const isSynced = array.equalFlat(e1, e2)
    isSynced && console.info('docs sycned!')
    return isSynced
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testSyncAndCleanup = async tc => {
  const { createWsClient, worker, redisClient } = await createTestCase(tc)
  const { ydoc: doc1 } = createWsClient('map')
  // doc2: can retrieve changes propagated on stream
  const { ydoc: doc2 } = createWsClient('map')
  doc1.getMap().set('a', 1)
  t.info('docs syncing (0)')
  await waitDocsSynced(doc1, doc2)
  t.info('docs synced (1)')
  const docStreamExistsBefore = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + '-' + 'map', 'index', redisPrefix))
  t.assert(doc2.getMap().get('a') === 1)
  // doc3 can retrieve older changes from stream
  const { ydoc: doc3 } = createWsClient('map')
  await waitDocsSynced(doc1, doc3)
  t.info('docs synced (2)')
  t.assert(doc3.getMap().get('a') === 1)
  await promise.wait(worker.client.redisMinMessageLifetime * 5)
  const docStreamExists = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + '-' + 'map', 'index', redisPrefix))
  const workerLen = await redisClient.xlen(redisPrefix + ':worker')
  t.assert(!docStreamExists && docStreamExistsBefore)
  t.assert(workerLen === 0)
  t.info('stream cleanup after initial changes')
  // doc4 can retrieve the document again from MemoryStore
  const { ydoc: doc4 } = createWsClient('map')
  await waitDocsSynced(doc3, doc4)
  t.info('docs synced (3)')
  t.assert(doc3.getMap().get('a') === 1)
  const memRetrieved = await utils.store.retrieveDoc(tc.testName + '-' + 'map', 'index')
  t.assert(memRetrieved?.references.length === 1)
  t.info('doc retrieved')
  // now write another updates that the worker will collect
  doc1.getMap().set('a', 2)
  await promise.wait(worker.client.redisMinMessageLifetime * 2)
  t.assert(doc2.getMap().get('a') === 2)
  const memRetrieved2 = await utils.store.retrieveDoc(tc.testName + '-' + 'map', 'index')
  t.info('map retrieved')
  // should delete old references
  t.assert(memRetrieved2?.references.length === 1)
  await promise.all(utils.prevClients.reverse().map(c => c.destroy()))
}
