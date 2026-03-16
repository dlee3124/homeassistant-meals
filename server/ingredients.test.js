import test from "node:test";
import assert from "node:assert/strict";

import { aggregateShoppingList, normalizeIngredient } from "./ingredients.js";

test("normalizeIngredient extracts quantity, unit, and normalized name", () => {
  const ingredient = normalizeIngredient("1 1/2 cups fresh tomatoes, chopped");

  assert.equal(ingredient.quantity, 1.5);
  assert.equal(ingredient.quantityMax, 1.5);
  assert.equal(ingredient.unit, "cup");
  assert.equal(ingredient.name, "tomato");
  assert.equal(ingredient.displayName, "Tomato");
});

test("aggregateShoppingList combines quantities across planned recipes", () => {
  const shoppingList = aggregateShoppingList([
    {
      id: "recipe-1",
      title: "Pasta",
      ingredients: ["2 onions", "1 tbsp olive oil"],
    },
    {
      id: "recipe-2",
      title: "Soup",
      ingredients: ["1 onion", "2 tbsp olive oil"],
    },
  ]);

  assert.equal(shoppingList.uncategorized.length, 0);
  assert.equal(shoppingList.items.length, 2);

  const onion = shoppingList.items.find((item) => item.name === "onion");
  assert.ok(onion);
  assert.equal(onion.quantityLabel, "3 item");
  assert.deepEqual(onion.recipes, ["Pasta", "Soup"]);

  const oil = shoppingList.items.find((item) => item.name === "olive oil");
  assert.ok(oil);
  assert.equal(oil.quantityLabel, "3 tbsp");
});
