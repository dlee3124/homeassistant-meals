import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createRecipe,
  getPlanForWeek,
  getShoppingListForWeek,
  listRecipes,
  parseRecipeText,
  updatePlanForWeek,
  updateRecipe,
} from "./store.js";
import { mealPlanSchema, recipeSchema } from "./schemas.js";
import { getWeekStartMonday, isIsoDate } from "./week.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "../web/dist");

const app = express();
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || "127.0.0.1";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/recipes", async (_request, response) => {
  const recipes = await listRecipes();
  response.json({ recipes });
});

app.get("/api/plans/:weekStart", async (request, response) => {
  const { weekStart } = request.params;

  if (!isIsoDate(weekStart)) {
    response.status(400).json({ error: "Week must be an ISO date." });
    return;
  }

  const normalizedWeekStart = getWeekStartMonday(weekStart);
  const plan = await getPlanForWeek(normalizedWeekStart);
  response.json({ plan });
});

app.get("/api/shopping-list/:weekStart", async (request, response) => {
  const { weekStart } = request.params;

  if (!isIsoDate(weekStart)) {
    response.status(400).json({ error: "Week must be an ISO date." });
    return;
  }

  const normalizedWeekStart = getWeekStartMonday(weekStart);
  const shoppingList = await getShoppingListForWeek(normalizedWeekStart);
  response.json({ shoppingList });
});

app.post("/api/recipes/import/parse", async (request, response) => {
  const text = String(request.body?.text || "").trim();

  if (!text) {
    response.status(400).json({ error: "Recipe text is required." });
    return;
  }

  const draft = parseRecipeText(text);
  response.json({ recipe: draft });
});

app.post("/api/recipes", async (request, response) => {
  const parsed = recipeSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Recipe validation failed.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const recipe = await createRecipe(parsed.data);
  response.status(201).json({ recipe });
});

app.put("/api/recipes/:recipeId", async (request, response) => {
  const parsed = recipeSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Recipe validation failed.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const recipe = await updateRecipe(request.params.recipeId, parsed.data);

  if (!recipe) {
    response.status(404).json({ error: "Recipe not found." });
    return;
  }

  response.json({ recipe });
});

app.put("/api/plans/:weekStart", async (request, response) => {
  const { weekStart } = request.params;

  if (!isIsoDate(weekStart)) {
    response.status(400).json({ error: "Week must be an ISO date." });
    return;
  }

  const normalizedWeekStart = getWeekStartMonday(weekStart);
  const body = {
    ...request.body,
    weekStart: normalizedWeekStart,
  };
  const parsed = mealPlanSchema.safeParse(body);

  if (!parsed.success) {
    response.status(400).json({
      error: "Meal plan validation failed.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const plan = await updatePlanForWeek(normalizedWeekStart, parsed.data);
  response.json({ plan });
});

app.get("*", (_request, response) => {
  response.sendFile(path.join(publicDir, "index.html"));
});

app.listen(port, host, () => {
  console.log(`Meal planner running on http://${host}:${port}`);
});
