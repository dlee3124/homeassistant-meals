import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJsonFileStore } from "./file-store.js";
import { buildShoppingList } from "./shopping-list.js";
import { recipeSchema } from "./schemas.js";
import { getCurrentWeekStart, listWeekDates } from "./week.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = process.env.MEALS_DATA_DIR || path.resolve(__dirname, "../data");
const recipesPath = path.join(dataDir, "recipes.json");
const mealPlansPath = path.join(dataDir, "meal-plans.json");
const recipesStore = createJsonFileStore(recipesPath, []);
const mealPlansStore = createJsonFileStore(mealPlansPath, {});
const mealSlots = ["breakfast", "snackAm", "lunch", "snackPm", "dinner", "dessert"];

export async function listRecipes() {
  const recipes = await recipesStore.read();
  return recipes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createRecipe(recipe) {
  const validatedRecipe = recipeSchema.parse(recipe);

  await recipesStore.update((recipes) => {
    recipes.unshift(validatedRecipe);
    return recipes;
  });

  return validatedRecipe;
}

export async function updateRecipe(recipeId, recipeUpdate) {
  const validatedRecipe = recipeSchema.parse(recipeUpdate);
  let updatedRecipe = null;

  await recipesStore.update((recipes) => {
    const index = recipes.findIndex((recipe) => recipe.id === recipeId);

    if (index < 0) {
      return recipes;
    }

    recipes[index] = validatedRecipe;
    updatedRecipe = recipes[index];
    return recipes;
  });

  return updatedRecipe;
}

export async function getPlanForWeek(weekStart) {
  let plan = null;

  await mealPlansStore.update((draftPlans) => {
    const nextPlan = normalizePlan(draftPlans[weekStart], weekStart);
    draftPlans[weekStart] = nextPlan;
    plan = nextPlan;
    return draftPlans;
  });

  return plan;
}

export async function updatePlanForWeek(weekStart, planUpdate) {
  let updatedPlan = null;

  await mealPlansStore.update((plans) => {
    plans[weekStart] = normalizePlan(planUpdate, weekStart);
    updatedPlan = plans[weekStart];
    return plans;
  });

  return updatedPlan;
}

export async function getShoppingListForWeek(weekStart) {
  const [recipes, plan] = await Promise.all([listRecipes(), getPlanForWeek(weekStart)]);
  return buildShoppingList(plan, recipes);
}

export function parseRecipeText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = lines[0]?.replace(/^#+\s*/, "") || "Untitled Recipe";
  const lowerLines = lines.map((line) => line.toLowerCase());
  const ingredientsIndex = findHeadingIndex(lowerLines, ["ingredients"]);
  const stepsIndex = findHeadingIndex(lowerLines, ["method", "instructions", "steps", "directions"]);

  const ingredientLines =
    ingredientsIndex >= 0
      ? extractSection(lines, ingredientsIndex, stepsIndex >= 0 ? stepsIndex : lines.length)
      : lines.filter((line) => looksLikeIngredient(line));

  const stepLines =
    stepsIndex >= 0
      ? extractSection(lines, stepsIndex, lines.length)
      : lines.filter((line) => looksLikeStep(line));

  const descriptionLines = lines.slice(1, Math.max(ingredientsIndex, 1)).filter((line) => {
    const lower = line.toLowerCase();
    return !lower.startsWith("serves") && !lower.startsWith("prep") && !lower.startsWith("cook");
  });

  const servings = extractSingleValue(lines, /^serves?\s*[:\-]?\s*(.+)$/i);
  const prepTimeMinutes = extractMinutes(lines, /^prep(?:\s+time)?\s*[:\-]?\s*(.+)$/i);
  const cookTimeMinutes = extractMinutes(lines, /^cook(?:\s+time)?\s*[:\-]?\s*(.+)$/i);
  const mealTypes = inferMealTypes(text);

  return {
    id: createId(title),
    title,
    description: descriptionLines.join(" "),
    mealTypes,
    servings,
    prepTimeMinutes,
    cookTimeMinutes,
    ingredients: normalizeList(ingredientLines, sanitizeIngredient),
    steps: normalizeList(stepLines, sanitizeStep),
    tags: inferTags(text),
    notes: "",
    source: "ChatGPT",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyPlan(weekStart = getCurrentWeekStart()) {
  const days = Object.fromEntries(
    listWeekDates(weekStart).map(({ key }) => [key, createEmptyDayPlan()]),
  );

  return {
    weekStart,
    days,
    updatedAt: new Date().toISOString(),
  };
}

function createEmptyDayPlan() {
  return Object.fromEntries(mealSlots.map((slot) => [slot, createEmptyMealSlot()]));
}

function createEmptyMealSlot() {
  return {
    recipeId: null,
    required: true,
  };
}

function normalizePlan(plan, weekStart = getCurrentWeekStart()) {
  const normalizedWeekStart = weekStart || plan?.weekStart || getCurrentWeekStart();
  const days = Object.fromEntries(
    listWeekDates(normalizedWeekStart).map(({ key }) => [key, normalizeDayPlan(plan?.days?.[key])]),
  );

  return {
    weekStart: normalizedWeekStart,
    days,
    updatedAt: plan?.updatedAt || new Date().toISOString(),
  };
}

function normalizeDayPlan(dayPlan) {
  return Object.fromEntries(mealSlots.map((slot) => [slot, normalizeMealSlot(dayPlan?.[slot])]));
}

function normalizeMealSlot(slotValue) {
  if (slotValue && typeof slotValue === "object" && !Array.isArray(slotValue)) {
    return {
      recipeId: typeof slotValue.recipeId === "string" ? slotValue.recipeId : null,
      required: slotValue.required !== false,
    };
  }

  return {
    recipeId: typeof slotValue === "string" ? slotValue : null,
    required: true,
  };
}

function createId(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return `${slug || "recipe"}-${Date.now().toString(36)}`;
}

function extractSection(lines, headingIndex, endIndex) {
  return lines
    .slice(headingIndex + 1, endIndex)
    .filter((line) => !/^[A-Za-z ]+:$/.test(line));
}

function findHeadingIndex(lines, headings) {
  return lines.findIndex((line) =>
    headings.some((heading) => line === heading || line === `${heading}:`),
  );
}

function looksLikeIngredient(line) {
  return /^[-*•]/.test(line) || /^\d/.test(line) || /\b(cup|tbsp|tsp|g|kg|ml|l)\b/i.test(line);
}

function looksLikeStep(line) {
  return /^\d+[.)]/.test(line) || /^(step\s+\d+|heat|mix|stir|bake|cook|serve)\b/i.test(line);
}

function extractSingleValue(lines, pattern) {
  const match = lines.find((line) => pattern.test(line));
  return match ? match.match(pattern)?.[1]?.trim() || "" : "";
}

function extractMinutes(lines, pattern) {
  const value = extractSingleValue(lines, pattern);
  if (!value) {
    return null;
  }

  const minutes = value.match(/(\d+)/);
  return minutes ? Number(minutes[1]) : null;
}

function normalizeList(lines, mapper) {
  return lines.map(mapper).filter(Boolean);
}

function sanitizeIngredient(line) {
  return line
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function sanitizeStep(line) {
  return line
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^step\s+\d+\s*[:\-]?\s*/i, "")
    .trim();
}

function inferMealTypes(text) {
  const lower = text.toLowerCase();
  const types = new Set();

  if (/\bbreakfast|pancake|omelette|granola|porridge\b/.test(lower)) types.add("breakfast");
  if (/\bsnack|bar|bite|muffin\b/.test(lower)) types.add("snack");
  if (/\blunch|sandwich|salad|wrap\b/.test(lower)) types.add("lunch");
  if (/\bdinner|curry|pasta|roast|stir[- ]?fry\b/.test(lower)) types.add("dinner");
  if (/\bdessert|cake|cookie|slice|brownie|ice cream\b/.test(lower)) types.add("dessert");

  return Array.from(types);
}

function inferTags(text) {
  const lower = text.toLowerCase();
  const tags = [];

  if (/\bvegetarian\b/.test(lower)) tags.push("vegetarian");
  if (/\bvegan\b/.test(lower)) tags.push("vegan");
  if (/\bgluten[- ]?free\b/.test(lower)) tags.push("gluten-free");
  if (/\bhigh[- ]?protein\b/.test(lower)) tags.push("high-protein");
  if (/\bquick\b|\bunder 30\b/.test(lower)) tags.push("quick");

  return tags;
}

async function readJson(filePath, fallback) {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(dataDir, { recursive: true });
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempFilePath, filePath);
}

function withFileLock(filePath, operation) {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  const tracked = next.finally(() => {
    if (fileLocks.get(filePath) === tracked) {
      fileLocks.delete(filePath);
    }
  });
  fileLocks.set(filePath, tracked);
  return next;
}
