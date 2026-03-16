import fs from "node:fs/promises";
import path from "node:path";

const fileQueues = new Map();

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getQueue(filePath) {
  return fileQueues.get(filePath) || Promise.resolve();
}

function setQueue(filePath, promise) {
  fileQueues.set(filePath, promise);
  promise.finally(() => {
    if (fileQueues.get(filePath) === promise) {
      fileQueues.delete(filePath);
    }
  });
}

async function ensureDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readFileJson(filePath, fallback) {
  try {
    await ensureDirectory(filePath);
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return typeof fallback === "function" ? fallback() : cloneJson(fallback);
    }

    throw error;
  }
}

async function writeFileJsonAtomic(filePath, value) {
  await ensureDirectory(filePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(16).slice(2)}.tmp`;

  await fs.writeFile(tempPath, serialized, "utf8");
  await fs.rename(tempPath, filePath);
}

function enqueue(filePath, operation) {
  const next = getQueue(filePath)
    .catch(() => undefined)
    .then(operation);

  setQueue(filePath, next);
  return next;
}

export function createJsonFileStore(filePath, fallback) {
  let cachedValue;
  let hasCache = false;

  async function readFresh() {
    const value = await readFileJson(filePath, fallback);
    cachedValue = cloneJson(value);
    hasCache = true;
    return value;
  }

  return {
    async read() {
      await getQueue(filePath).catch(() => undefined);

      if (hasCache) {
        return cloneJson(cachedValue);
      }

      const value = await readFresh();
      return cloneJson(value);
    },

    async write(value) {
      const nextValue = cloneJson(value);

      return enqueue(filePath, async () => {
        await writeFileJsonAtomic(filePath, nextValue);
        cachedValue = cloneJson(nextValue);
        hasCache = true;
        return cloneJson(nextValue);
      });
    },

    async update(updater) {
      return enqueue(filePath, async () => {
        const currentValue = hasCache ? cloneJson(cachedValue) : await readFresh();
        const nextValue = cloneJson(await updater(cloneJson(currentValue)));

        await writeFileJsonAtomic(filePath, nextValue);
        cachedValue = cloneJson(nextValue);
        hasCache = true;
        return cloneJson(nextValue);
      });
    },
  };
}
