import {createHash, randomUUID, timingSafeEqual} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {isIP} from 'node:net';
import {createServer} from 'node:http';
import {join, resolve} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = resolve(process.env.RELAY_DATA_DIR || './data');
const GROUPS_DIR = join(DATA_DIR, 'groups');
const SAVES_DIR = join(DATA_DIR, 'saves');
const MAX_SAVE_BYTES = 90 * 1024 * 1024;
const MAX_IP_STORAGE_BYTES = 180 * 1024 * 1024;
const MAX_ACTIVE_SHARES_PER_IP = 10;
const MAX_IP_GROUPS = 10_000;
const SHARE_TTL_MS = 10 * 60 * 1000;
const REQUEST_LIMIT_PER_MINUTE = 120;
const AUTH_FAILURE_LIMIT_PER_MINUTE = 10;
const SHARE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const groupLocks = new Map();
const groupKeys = new Set();
const rateCounters = new Map();
const authFailureCounters = new Map();
const configuredSecret = process.env.RELAY_SECRET || '';
const secret = Buffer.from(configuredSecret, 'utf8');
const configuredStorageLimit = Number(process.env.RELAY_MAX_STORAGE_BYTES || 1024 * 1024 * 1024);
let storedBytes = 0;
let reservedBytes = 0;
let storageLock = Promise.resolve();

class HttpError extends Error
{
  constructor(status, message)
  {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value)
{
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(body);
}

function isAuthorized(request)
{
  const supplied = Buffer.from(request.headers['x-relay-secret'] || '', 'utf8');
  return supplied.length == secret.length && timingSafeEqual(supplied, secret);
}

function getGroupKey(request)
{
  const address = request.headers['x-relay-client-ip'];
  if (typeof address != 'string' || isIP(address) == 0)
    throw new HttpError(400, 'Client network address is invalid.');
  return createHash('sha256').update(address).digest('hex');
}

function getShareKeyHash(request, headerName)
{
  const key = request.headers[headerName];
  if (typeof key != 'string' || !/^[0-9a-f]{32}$/i.test(key))
    return '';
  return createHash('sha256').update(key.toLowerCase()).digest('hex');
}

function shareKeyMatches(suppliedHash, expectedHash)
{
  if (!suppliedHash || typeof expectedHash != 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))
    return false;
  return timingSafeEqual(Buffer.from(suppliedHash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function takeRateLimit(counterMap, key, limit)
{
  const now = Date.now();
  let counter = counterMap.get(key);
  if (!counter && counterMap.size >= 10_000)
    return false;
  if (!counter || counter.windowStart <= now - 60_000) {
    counter = {count: 0, windowStart: now};
    counterMap.set(key, counter);
  }
  counter.count += 1;
  return counter.count <= limit;
}

function takeAuthFailure(groupKey, id)
{
  return takeRateLimit(authFailureCounters, `${groupKey}:${id}`, AUTH_FAILURE_LIMIT_PER_MINUTE);
}

async function withStorageLock(operation)
{
  const previous = storageLock;
  let release;
  storageLock = new Promise(resolveLock => {
    release = resolveLock;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

async function reserveStorage(bytes)
{
  await withStorageLock(() => {
    if (storedBytes + reservedBytes + bytes > configuredStorageLimit)
      throw new HttpError(507, 'The save relay storage limit has been reached.');
    reservedBytes += bytes;
  });
  let released = false;
  return async commit => {
    if (released)
      return;
    released = true;
    await withStorageLock(() => {
      reservedBytes -= bytes;
      if (commit)
        storedBytes += bytes;
    });
  };
}

async function removeStoredSave(id)
{
  let size;
  try {
    size = (await stat(savePath(id))).size;
  } catch (error) {
    if (error.code == 'ENOENT')
      return;
    throw error;
  }
  await rm(savePath(id), {force: true});
  await withStorageLock(() => {
    storedBytes = Math.max(0, storedBytes - size);
  });
}

function sanitizeFilename(value)
{
  if (typeof value != 'string')
    return '';
  const filename = value.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim();
  return filename.length <= 180 && filename.toLowerCase().endsWith('.weathersandbox') ?
    filename : '';
}

function sanitizeDeviceLabel(value)
{
  if (typeof value != 'string')
    return 'Computer';
  const label = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return label || 'Computer';
}

async function withGroupLock(groupKey, operation)
{
  const previous = groupLocks.get(groupKey) || Promise.resolve();
  let release;
  const current = new Promise(resolveLock => {
    release = resolveLock;
  });
  groupLocks.set(groupKey, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (groupLocks.get(groupKey) == current)
      groupLocks.delete(groupKey);
  }
}

function groupPath(groupKey)
{
  return join(GROUPS_DIR, `${groupKey}.json`);
}

function savePath(id)
{
  return join(SAVES_DIR, `${id}.bin`);
}

async function readGroup(groupKey)
{
  try {
    const data = await readFile(groupPath(groupKey), 'utf8');
    const value = JSON.parse(data);
    if (!Array.isArray(value.shares))
      throw new Error('Invalid save relay group data.');
    return value.shares;
  } catch (error) {
    if (error.code == 'ENOENT')
      return [];
    throw error;
  }
}

async function writeGroup(groupKey, shares)
{
  const destination = groupPath(groupKey);
  if (shares.length == 0) {
    await rm(destination, {force: true});
    groupKeys.delete(groupKey);
    return;
  }
  if (!groupKeys.has(groupKey) && groupKeys.size >= MAX_IP_GROUPS)
    throw new HttpError(507, 'The save relay has reached its network metadata limit.');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({shares}), {flag: 'wx'});
    await rename(temporary, destination);
    groupKeys.add(groupKey);
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}

async function pruneGroup(groupKey, shares)
{
  const now = Date.now();
  const active = shares.filter(share =>
    share && typeof share.id == 'string' && SHARE_ID_PATTERN.test(share.id) &&
    Number.isSafeInteger(share.size) && typeof share.readKeyHash == 'string' &&
    /^[0-9a-f]{64}$/.test(share.readKeyHash) && typeof share.ownerKeyHash == 'string' &&
    /^[0-9a-f]{64}$/.test(share.ownerKeyHash) &&
    Number.isFinite(share.expiresAt) && share.expiresAt > now
  );
  const activeIds = new Set(active.map(share => share.id));
  const removed = shares.filter(share => share && typeof share.id == 'string' &&
    SHARE_ID_PATTERN.test(share.id) && !activeIds.has(share.id));
  if (active.length != shares.length) {
    await writeGroup(groupKey, active);
    await Promise.all(removed.map(share => removeStoredSave(share.id)));
  }
  return active;
}

async function storeUpload(request, id, expectedLength)
{
  const temporary = `${savePath(id)}.upload`;
  let bytesWritten = 0;
  const byteLimit = new Transform({
    transform(chunk, encoding, callback)
    {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_SAVE_BYTES)
        callback(new HttpError(413, 'Save file exceeds the 90 MiB limit.'));
      else if (bytesWritten > expectedLength)
        callback(new HttpError(400, 'Save data length did not match the declared upload length.'));
      else
        callback(null, chunk);
    }
  });

  try {
    await pipeline(request, byteLimit, createWriteStream(temporary, {flags: 'wx'}));
    if (bytesWritten < 4 || bytesWritten != expectedLength)
      throw new HttpError(400, 'Save data must contain at least 4 bytes and match the declared upload length.');
    await rename(temporary, savePath(id));
  } catch (error) {
    await rm(temporary, {force: true});
    throw error;
  }
}

async function createShare(request, url, groupKey)
{
  const filename = sanitizeFilename(url.searchParams.get('name'));
  if (!filename)
    throw new HttpError(400, 'A valid .weathersandbox filename is required.');
  if ((request.headers['content-type'] || '').split(';', 1)[0].trim() != 'application/octet-stream')
    throw new HttpError(415, 'Save data must use application/octet-stream.');

  const contentLength = Number(request.headers['x-upload-length']);
  if (!Number.isSafeInteger(contentLength) || contentLength < 4 || contentLength > MAX_SAVE_BYTES)
    throw new HttpError(413, `Save files must be between 4 bytes and ${MAX_SAVE_BYTES} bytes.`);
  const readKeyHash = getShareKeyHash(request, 'x-share-read-key');
  const ownerKeyHash = getShareKeyHash(request, 'x-share-owner-key');
  if (!readKeyHash || !ownerKeyHash)
    throw new HttpError(400, 'Valid per-share read and owner keys are required.');

  return withGroupLock(groupKey, async () => {
    const shares = await pruneGroup(groupKey, await readGroup(groupKey));
    if (shares.length == 0 && !groupKeys.has(groupKey) && groupKeys.size >= MAX_IP_GROUPS)
      throw new HttpError(507, 'The save relay has reached its network metadata limit.');
    if (shares.length >= MAX_ACTIVE_SHARES_PER_IP)
      throw new HttpError(429, 'This network already has the maximum number of active shares.');
    const activeBytes = shares.reduce((total, share) =>
      total + (Number.isSafeInteger(share.size) ? share.size : 0), 0);
    if (activeBytes + contentLength > MAX_IP_STORAGE_BYTES)
      throw new HttpError(429, 'This network has reached its active save storage limit.');
    if (!takeRateLimit(rateCounters, `upload:${groupKey}`, 3))
      throw new HttpError(429, 'Too many save uploads from this network. Try again shortly.');

    const id = randomUUID();
    const share = {
      id,
      filename,
      device: sanitizeDeviceLabel(url.searchParams.get('device')),
      size: contentLength,
      readKeyHash,
      ownerKeyHash,
      expiresAt: Date.now() + SHARE_TTL_MS
    };
    const releaseReservation = await reserveStorage(contentLength);
    let fileStored = false;
    try {
      await storeUpload(request, id, contentLength);
      fileStored = true;
      await writeGroup(groupKey, [...shares, share]);
      await releaseReservation(true);
    } catch (error) {
      if (fileStored)
        await rm(savePath(id), {force: true});
      await releaseReservation(false);
      throw error;
    }
    return share;
  });
}

async function updateShare(groupKey, id, action, ownerKeyHash)
{
  return withGroupLock(groupKey, async () => {
    const shares = await pruneGroup(groupKey, await readGroup(groupKey));
    const index = shares.findIndex(share => share.id == id);
    if (index < 0)
      throw new HttpError(404, 'This save is no longer shared on your network.');
    if (!shareKeyMatches(ownerKeyHash, shares[index].ownerKeyHash)) {
      if (!takeAuthFailure(groupKey, id))
        throw new HttpError(429, 'Too many invalid access code attempts. Try again later.');
      throw new HttpError(403, 'A valid owner key is required.');
    }
    authFailureCounters.delete(`${groupKey}:${id}`);

    if (action == 'heartbeat') {
      shares[index] = {...shares[index], expiresAt: Date.now() + SHARE_TTL_MS};
      await writeGroup(groupKey, shares);
      return {expiresAt: shares[index].expiresAt};
    }

    const remaining = shares.filter(share => share.id != id);
    await writeGroup(groupKey, remaining);
    await removeStoredSave(id);
    shares.splice(index, 1);
    return {ok: true};
  });
}

async function serveDiscovery(response, groupKey)
{
  const shares = await withGroupLock(groupKey, async () =>
    pruneGroup(groupKey, await readGroup(groupKey))
  );
  sendJson(response, 200, {shares: shares.map(share => ({
    id: share.id,
    filename: share.filename,
    device: share.device,
    expiresAt: share.expiresAt
  }))});
}

async function serveDownload(response, groupKey, id, readKeyHash)
{
  return withGroupLock(groupKey, async () => {
    const shares = await pruneGroup(groupKey, await readGroup(groupKey));
    const share = shares.find(item => item.id == id);
    if (!share)
      throw new HttpError(404, 'This save is no longer shared on your network.');
    if (!shareKeyMatches(readKeyHash, share.readKeyHash)) {
      if (!takeAuthFailure(groupKey, id))
        throw new HttpError(429, 'Too many invalid access code attempts. Try again later.');
      throw new HttpError(403, 'A valid save access code is required.');
    }
    authFailureCounters.delete(`${groupKey}:${id}`);

    let fileInfo;
    try {
      fileInfo = await stat(savePath(id));
    } catch (error) {
      if (error.code == 'ENOENT')
        throw new HttpError(404, 'The shared save has expired.');
      throw error;
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(share.filename)}`,
      'Content-Length': fileInfo.size,
      'Content-Type': 'application/x-binary'
    });
    const file = createReadStream(savePath(id));
    file.on('error', error => {
      console.error('Could not stream a shared save.', error);
      response.destroy(error);
    });
    file.pipe(response);
  });
}

async function cleanExpiredShares()
{
  const groupFiles = await readdir(GROUPS_DIR);
  for (const filename of groupFiles) {
    if (!/^[0-9a-f]{64}\.json$/.test(filename))
      continue;
    const groupKey = filename.slice(0, -5);
    await withGroupLock(groupKey, async () =>
      pruneGroup(groupKey, await readGroup(groupKey))
    );
  }
}

async function initializeStoredBytes()
{
  const referencedIds = new Set();
  const groupFiles = await readdir(GROUPS_DIR);
  for (const filename of groupFiles) {
    if (!/^[0-9a-f]{64}\.json$/.test(filename))
      continue;
    const groupKey = filename.slice(0, -5);
    groupKeys.add(groupKey);
    const shares = await readGroup(groupKey);
    for (const share of shares)
      if (share && typeof share.id == 'string' && SHARE_ID_PATTERN.test(share.id))
        referencedIds.add(share.id);
  }

  let total = 0;
  for (const filename of await readdir(SAVES_DIR)) {
    const uploadMatch = filename.match(/^([0-9a-f-]+)\.bin\.upload$/i);
    if (uploadMatch) {
      await rm(join(SAVES_DIR, filename), {force: true});
      continue;
    }
    const saveMatch = filename.match(/^([0-9a-f-]+)\.bin$/i);
    if (!saveMatch || !SHARE_ID_PATTERN.test(saveMatch[1]) || !referencedIds.has(saveMatch[1])) {
      await rm(join(SAVES_DIR, filename), {force: true});
      continue;
    }
    total += (await stat(join(SAVES_DIR, filename))).size;
  }
  if (total > configuredStorageLimit)
    throw new Error('Existing save data exceeds RELAY_MAX_STORAGE_BYTES; raise the limit or remove old saves.');
  if (groupKeys.size > MAX_IP_GROUPS)
    throw new Error('The relay has more network groups than its configured metadata limit.');
  storedBytes = total;
}

async function handleRequest(request, response)
{
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname == '/health' && request.method == 'GET') {
    sendJson(response, 200, {ok: true});
    return;
  }
  if (!isAuthorized(request)) {
    sendJson(response, 403, {error: 'Forbidden.'});
    return;
  }

  try {
    const groupKey = getGroupKey(request);
    if (!takeRateLimit(rateCounters, `request:${groupKey}`, REQUEST_LIMIT_PER_MINUTE))
      throw new HttpError(429, 'Too many save relay requests from this network. Try again shortly.');
    if (url.pathname == '/api/discovery' && request.method == 'GET') {
      await serveDiscovery(response, groupKey);
      return;
    }
    if (url.pathname == '/api/shares' && request.method == 'POST') {
      const share = await createShare(request, url, groupKey);
      sendJson(response, 201, {id: share.id, expiresAt: share.expiresAt});
      return;
    }

    const match = url.pathname.match(/^\/api\/shares\/([0-9a-f-]+)(?:\/(heartbeat))?$/i);
    if (!match)
      throw new HttpError(404, 'Not found.');
    const [, id, action] = match;
    if (!SHARE_ID_PATTERN.test(id))
      throw new HttpError(400, 'Invalid share ID.');
    if (request.method == 'GET' && !action) {
      await serveDownload(response, groupKey, id, getShareKeyHash(request, 'x-share-read-key'));
      return;
    }
    if (request.method == 'POST' && action == 'heartbeat') {
      sendJson(response, 200, await updateShare(groupKey, id, action,
        getShareKeyHash(request, 'x-share-owner-key')));
      return;
    }
    if (request.method == 'DELETE' && !action) {
      sendJson(response, 200, await updateShare(groupKey, id, 'delete',
        getShareKeyHash(request, 'x-share-owner-key')));
      return;
    }
    throw new HttpError(405, 'Method not allowed.');
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = error instanceof HttpError ? error.status : 500;
    if (status == 500)
      console.error('Save relay request failed.', error);
    sendJson(response, status, {
      error: status == 500 ? 'The save relay could not complete the request.' : error.message
    });
  }
}

async function start()
{
  if (secret.length < 32)
    throw new Error('RELAY_SECRET must be set to a random value of at least 32 characters.');
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535)
    throw new Error('PORT must be a valid TCP port.');
  if (!Number.isSafeInteger(configuredStorageLimit) || configuredStorageLimit < 4)
    throw new Error('RELAY_MAX_STORAGE_BYTES must be a positive integer of at least 4 bytes.');
  await mkdir(GROUPS_DIR, {recursive: true});
  await mkdir(SAVES_DIR, {recursive: true});

  for (const filename of await readdir(GROUPS_DIR))
    if (/^[0-9a-f]{64}\.json$/.test(filename))
      groupKeys.add(filename.slice(0, -5));
  await cleanExpiredShares();
  await initializeStoredBytes();

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });
  server.requestTimeout = 5 * 60 * 1000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Self-hosted save relay listening on port ${PORT}.`);
  });

  const cleanupTimer = setInterval(() => {
    cleanExpiredShares().catch(error => console.error('Save cleanup failed.', error));
    const cutoff = Date.now() - 60_000;
    for (const counters of [rateCounters, authFailureCounters])
      for (const [key, counter] of counters)
        if (counter.windowStart <= cutoff)
          counters.delete(key);
  }, 60_000);
  cleanupTimer.unref();
}

start().catch(error => {
  console.error('Could not start the self-hosted save relay.', error);
  process.exitCode = 1;
});
