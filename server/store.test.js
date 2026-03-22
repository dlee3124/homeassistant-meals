import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function importStoreModule(dataDir) {
  process.env.MEALS_DATA_DIR = dataDir;
  const moduleUrl = new URL(`./store.js?test=${Date.now()}-${Math.random()}`, pathToFileURL(`${process.cwd()}/server/`));
  return import(moduleUrl.href);
}

function createRecipe(id, title, ingredients = ["1 onion"], steps = ["Cook it"]) {
  const timestamp = new Date().toISOString();

  return {
    id,
    title,
    description: "",
    mealTypes: ["dinner"],
    servings: "2",
    prepTimeMinutes: 10,
    cookTimeMinutes: 20,
    ingredients,
    steps,
    tags: [],
    notes: "",
    source: "Test",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("createRecipe serializes concurrent writes without losing data", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "meal-atlas-store-"));
  const store = await importStoreModule(dataDir);

  try {
    await Promise.all([
      store.createRecipe(createRecipe("recipe-1", "Pasta", ["1 onion"])),
      store.createRecipe(createRecipe("recipe-2", "Soup", ["2 carrots"])),
    ]);

    const recipes = await store.listRecipes();
    assert.equal(recipes.length, 2);
    assert.deepEqual(
      recipes.map((recipe) => recipe.id).sort(),
      ["recipe-1", "recipe-2"],
    );
  } finally {
    delete process.env.MEALS_DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("getShoppingListForWeek combines ingredients from planned recipes", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "meal-atlas-shopping-"));
  const store = await importStoreModule(dataDir);
  const weekStart = "2026-03-16";

  try {
    await store.createRecipe(createRecipe("recipe-1", "Pasta", ["2 onions", "1 tbsp olive oil"]));
    await store.createRecipe(createRecipe("recipe-2", "Soup", ["1 onion", "2 tbsp olive oil"]));

    const plan = await store.getPlanForWeek(weekStart);
    plan.days["2026-03-16"].dinner.recipeId = "recipe-1";
    plan.days["2026-03-17"].dinner.recipeId = "recipe-2";
    plan.updatedAt = new Date().toISOString();
    await store.updatePlanForWeek(weekStart, plan);

    const shoppingList = await store.getShoppingListForWeek(weekStart);
    assert.deepEqual(shoppingList.recipeTitles, ["Pasta", "Soup"]);

    const onion = shoppingList.items.find((item) => item.name === "onion");
    assert.ok(onion);
    assert.equal(onion.quantityLabel, "3 item");

    const oil = shoppingList.items.find((item) => item.name === "olive oil");
    assert.ok(oil);
    assert.equal(oil.quantityLabel, "3 tbsp");
  } finally {
    delete process.env.MEALS_DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("getPlanForWeek migrates legacy string slots to structured slot objects", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "meal-atlas-plan-migration-"));
  const weekStart = "2026-03-16";
  const legacyPlan = {
    weekStart,
    days: {
      "2026-03-16": {
        breakfast: null,
        snackAm: null,
        lunch: "recipe-legacy",
        snackPm: null,
        dinner: null,
        dessert: null,
      },
    },
    updatedAt: "2026-03-22T00:00:00.000Z",
  };
  await fs.writeFile(path.join(dataDir, "meal-plans.json"), `${JSON.stringify({ [weekStart]: legacyPlan }, null, 2)}\n`);
  const store = await importStoreModule(dataDir);

  try {
    const plan = await store.getPlanForWeek(weekStart);
    assert.deepEqual(plan.days["2026-03-16"].lunch, { recipeId: "recipe-legacy", required: true });
    assert.deepEqual(plan.days["2026-03-16"].dinner, { recipeId: null, required: true });
  } finally {
    delete process.env.MEALS_DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("getShoppingListForWeek ignores slots marked as not required", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "meal-atlas-optional-slot-"));
  const store = await importStoreModule(dataDir);
  const weekStart = "2026-03-16";

  try {
    await store.createRecipe(createRecipe("recipe-1", "Pasta", ["2 onions"]));

    const plan = await store.getPlanForWeek(weekStart);
    plan.days["2026-03-16"].dinner = { recipeId: "recipe-1", required: false };
    plan.updatedAt = new Date().toISOString();
    await store.updatePlanForWeek(weekStart, plan);

    const shoppingList = await store.getShoppingListForWeek(weekStart);
    assert.deepEqual(shoppingList.recipeTitles, []);
    assert.deepEqual(shoppingList.items, []);
  } finally {
    delete process.env.MEALS_DATA_DIR;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
