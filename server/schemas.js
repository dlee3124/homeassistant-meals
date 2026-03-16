import { z } from "zod";

export const mealTypes = [
  "breakfast",
  "snack",
  "lunch",
  "dinner",
  "dessert",
];

export const recipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  mealTypes: z.array(z.enum(mealTypes)).default([]),
  servings: z.string().default(""),
  prepTimeMinutes: z.number().int().min(0).nullable(),
  cookTimeMinutes: z.number().int().min(0).nullable(),
  ingredients: z.array(z.string().min(1)).min(1),
  steps: z.array(z.string().min(1)).min(1),
  tags: z.array(z.string().min(1)).default([]),
  notes: z.string().default(""),
  source: z.string().default("ChatGPT"),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const dayPlanSchema = z.object({
  breakfast: z.string().nullable().default(null),
  snackAm: z.string().nullable().default(null),
  lunch: z.string().nullable().default(null),
  snackPm: z.string().nullable().default(null),
  dinner: z.string().nullable().default(null),
  dessert: z.string().nullable().default(null),
});

export const mealPlanSchema = z.object({
  weekStart: z.string().min(1),
  days: z.record(dayPlanSchema),
  updatedAt: z.string().min(1),
});
