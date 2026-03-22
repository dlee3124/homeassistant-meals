import { aggregateShoppingList } from "./ingredients.js";

export function buildShoppingList(plan, recipes) {
  const recipeLookup = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const usedRecipes = [];

  for (const [day, dayPlan] of Object.entries(plan?.days || {})) {
    for (const [slot, slotValue] of Object.entries(dayPlan || {})) {
      const recipeId = getRecipeId(slotValue);

      if (!recipeId) {
        continue;
      }

      const recipe = recipeLookup.get(recipeId);

      if (!recipe) {
        continue;
      }

      usedRecipes.push({
        ...recipe,
        plannedDay: day,
        plannedSlot: slot,
      });
    }
  }

  const aggregated = aggregateShoppingList(usedRecipes);

  return {
    weekStart: plan?.weekStart || "",
    recipeIds: Array.from(new Set(usedRecipes.map((recipe) => recipe.id))),
    recipeTitles: Array.from(new Set(usedRecipes.map((recipe) => recipe.title))).sort((left, right) =>
      left.localeCompare(right),
    ),
    items: aggregated.items,
    uncategorized: aggregated.uncategorized,
  };
}

function getRecipeId(slotValue) {
  if (slotValue && typeof slotValue === "object" && !Array.isArray(slotValue)) {
    if (slotValue.required === false) {
      return null;
    }

    return typeof slotValue.recipeId === "string" ? slotValue.recipeId : null;
  }

  return typeof slotValue === "string" ? slotValue : null;
}
