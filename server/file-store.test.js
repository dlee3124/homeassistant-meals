import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createJsonFileStore } from "./file-store.js";

test("createJsonFileStore serializes concurrent updates", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "meal-atlas-file-store-"));
  const filePath = path.join(tempDir, "recipes.json");
  const store = createJsonFileStore(filePath, { count: 0 });

  await Promise.all(
    Array.from({ length: 20 }, () =>
      store.update((current) => {
        current.count += 1;
        return current;
      }),
    ),
  );

  const value = await store.read();
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));

  assert.equal(value.count, 20);
  assert.deepEqual(persisted, value);
});
