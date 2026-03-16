const UNICODE_FRACTIONS = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅛": "1/8",
};

const UNIT_ALIASES = new Map([
  ["tsp", "tsp"],
  ["teaspoon", "tsp"],
  ["teaspoons", "tsp"],
  ["tbsp", "tbsp"],
  ["tablespoon", "tbsp"],
  ["tablespoons", "tbsp"],
  ["g", "g"],
  ["gram", "g"],
  ["grams", "g"],
  ["kg", "kg"],
  ["kilogram", "kg"],
  ["kilograms", "kg"],
  ["ml", "ml"],
  ["milliliter", "ml"],
  ["milliliters", "ml"],
  ["millilitre", "ml"],
  ["millilitres", "ml"],
  ["l", "l"],
  ["liter", "l"],
  ["liters", "l"],
  ["litre", "l"],
  ["litres", "l"],
  ["cup", "cup"],
  ["cups", "cup"],
  ["can", "can"],
  ["cans", "can"],
  ["tin", "can"],
  ["tins", "can"],
  ["clove", "clove"],
  ["cloves", "clove"],
  ["slice", "slice"],
  ["slices", "slice"],
  ["piece", "piece"],
  ["pieces", "piece"],
  ["bunch", "bunch"],
  ["bunches", "bunch"],
  ["packet", "packet"],
  ["packets", "packet"],
  ["pack", "packet"],
  ["packs", "packet"],
]);

const UNIT_ORDER = ["kg", "g", "l", "ml", "cup", "tbsp", "tsp", "can", "packet", "bunch", "clove", "piece", "slice", "item"];

const DESCRIPTOR_WORDS = new Set([
  "small",
  "medium",
  "large",
  "extra-large",
  "extra",
  "fresh",
  "dried",
  "ground",
  "lean",
  "boneless",
  "skinless",
]);

const CATEGORY_RULES = [
  { category: "Produce", keywords: ["onion", "zucchini", "capsicum", "potato", "sweet potato", "tomato", "banana", "garlic"] },
  { category: "Dairy & Eggs", keywords: ["egg", "milk", "yoghurt", "yogurt", "butter", "cheese", "cream"] },
  { category: "Meat & Seafood", keywords: ["chicken", "beef", "pork", "fish", "salmon", "tuna", "prawn"] },
  { category: "Bakery", keywords: ["bread", "wrap", "tortilla", "bun", "roll"] },
  { category: "Baking", keywords: ["baking powder", "vanilla", "cocoa", "chocolate chip", "dark chocolate"] },
  { category: "Pantry", keywords: ["oat", "olive oil", "oil", "salt", "paprika", "maple syrup", "honey", "peanut butter", "powder"] },
  { category: "Frozen", keywords: ["frozen"] },
  { category: "Snacks", keywords: ["cookie", "chips", "bar"] },
];

export function aggregateShoppingList(recipes) {
  const grouped = new Map();
  const uncategorized = [];

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients || []) {
      const normalized = normalizeIngredient(ingredient);

      if (!normalized.name) {
        uncategorized.push({
          ingredient,
          recipeId: recipe.id,
          recipeTitle: recipe.title,
        });
        continue;
      }

      const key = `${normalized.name}__${normalized.unit || "none"}`;
      const entry = grouped.get(key) || createAggregateEntry(normalized);
      entry.recipes.add(recipe.title);
      entry.sources.push({
        recipeId: recipe.id,
        recipeTitle: recipe.title,
        original: ingredient,
      });

      if (normalized.quantity == null) {
        entry.hasUncountedItems = true;
      } else if (normalized.quantityMax != null && normalized.quantityMax !== normalized.quantity) {
        entry.quantity += normalized.quantity;
        entry.quantityMax += normalized.quantityMax;
      } else {
        entry.quantity += normalized.quantity;
        entry.quantityMax += normalized.quantity;
      }

      grouped.set(key, entry);
    }
  }

  const items = Array.from(grouped.values())
    .map(finalizeAggregateEntry)
    .sort(compareShoppingItems);

  return {
    items,
    uncategorized,
  };
}

export function normalizeIngredient(input) {
  const source = String(input || "").trim();

  if (!source) {
    return {
      original: source,
      quantity: null,
      quantityMax: null,
      unit: null,
      name: "",
      displayName: "",
    };
  }

  let working = normalizeFractions(source)
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const quantityInfo = extractLeadingQuantity(working);
  working = quantityInfo.rest;

  const unitInfo = extractUnit(working);
  working = unitInfo.rest;

  const cleanedName = normalizeIngredientName(working);
  const inferredUnit = unitInfo.unit || inferUnit(cleanedName, quantityInfo.quantity);

  return {
    original: source,
    quantity: quantityInfo.quantity,
    quantityMax: quantityInfo.quantityMax,
    unit: inferredUnit,
    name: cleanedName,
    displayName: toDisplayName(cleanedName),
  };
}

export function normalizeIngredientLine(input) {
  const normalized = normalizeIngredient(input);
  const noteMatches = String(input || "").match(/\(([^)]*)\)/g) || [];

  return {
    source: normalized.original,
    amount: normalized.quantity,
    unit: normalized.unit,
    name: normalized.name,
    notes: noteMatches.map((note) => note.replace(/[()]/g, "").trim()).filter(Boolean),
    key: `${normalized.name}|${normalized.unit || "item"}`,
  };
}

export function buildShoppingListItems(ingredients, recipeLookup) {
  const groups = new Map();

  for (const ingredient of ingredients) {
    const normalized = normalizeIngredientLine(ingredient.line);

    if (!normalized.name) {
      continue;
    }

    const existing =
      groups.get(normalized.key) ||
      {
        key: normalized.key,
        name: normalized.name,
        unit: normalized.unit,
        totalAmount: 0,
        amountKnown: true,
        recipeTitles: new Set(),
        sourceLines: [],
      };

    if (normalized.amount == null) {
      existing.amountKnown = false;
    } else {
      existing.totalAmount += normalized.amount;
    }

    const recipe = recipeLookup.get(ingredient.recipeId);
    if (recipe?.title) {
      existing.recipeTitles.add(recipe.title);
    }

    existing.sourceLines.push(ingredient.line);
    groups.set(normalized.key, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      display: formatShoppingDisplay(group.totalAmount, group.unit, group.name, group.amountKnown),
      quantityLabel: group.amountKnown ? formatShoppingAmount(group.totalAmount) : "",
      recipeTitles: Array.from(group.recipeTitles).sort(),
      sourceLines: group.sourceLines,
    }))
    .sort((left, right) => left.display.localeCompare(right.display));
}

function createAggregateEntry(normalized) {
  return {
    key: `${normalized.name}__${normalized.unit || "none"}`,
    name: normalized.name,
    displayName: normalized.displayName,
    unit: normalized.unit,
    quantity: 0,
    quantityMax: 0,
    hasUncountedItems: false,
    recipes: new Set(),
    sources: [],
  };
}

function finalizeAggregateEntry(entry) {
  return {
    key: entry.key,
    name: entry.name,
    displayName: entry.displayName,
    category: classifyIngredient(entry.name),
    unit: entry.unit,
    quantity: entry.quantity || null,
    quantityMax: entry.quantityMax || null,
    quantityLabel: formatQuantity(entry.quantity, entry.quantityMax, entry.unit, entry.hasUncountedItems),
    recipeCount: entry.recipes.size,
    recipes: Array.from(entry.recipes).sort(),
    sources: entry.sources,
    hasUncountedItems: entry.hasUncountedItems,
  };
}

function compareShoppingItems(left, right) {
  const categoryDiff = left.category.localeCompare(right.category);

  if (categoryDiff !== 0) {
    return categoryDiff;
  }

  const leftUnitIndex = UNIT_ORDER.indexOf(left.unit || "item");
  const rightUnitIndex = UNIT_ORDER.indexOf(right.unit || "item");
  const unitDiff = (leftUnitIndex === -1 ? UNIT_ORDER.length : leftUnitIndex) - (rightUnitIndex === -1 ? UNIT_ORDER.length : rightUnitIndex);
  if (unitDiff !== 0) {
    return unitDiff;
  }

  return left.displayName.localeCompare(right.displayName);
}

function normalizeFractions(value) {
  return value.replace(/[¼½¾⅓⅔⅛]/g, (match) => ` ${UNICODE_FRACTIONS[match]} `);
}

function extractLeadingQuantity(value) {
  const match = value.match(
    /^((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?))(?:\s*-\s*((?:\d+\s+\d+\/\d+)|(?:\d+\/\d+)|(?:\d+(?:\.\d+)?)))?\s+(.*)$/i,
  );

  if (!match) {
    return {
      quantity: null,
      quantityMax: null,
      rest: value,
    };
  }

  const quantity = parseQuantity(match[1]);
  const quantityMax = match[2] ? parseQuantity(match[2]) : quantity;

  return {
    quantity,
    quantityMax,
    rest: match[3].trim(),
  };
}

function extractUnit(value) {
  const [firstWord = "", ...rest] = value.split(" ");
  const normalizedWord = firstWord.toLowerCase().replace(/[.,]$/, "");
  const unit = UNIT_ALIASES.get(normalizedWord) || null;

  if (!unit) {
    return {
      unit: null,
      rest: value,
    };
  }

  return {
    unit,
    rest: rest.join(" ").trim(),
  };
}

function inferUnit(name, quantity) {
  if (quantity == null || !name) {
    return null;
  }

  return "item";
}

function normalizeIngredientName(value) {
  return value
    .toLowerCase()
    .split(",")[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(of|for)\b/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && DESCRIPTOR_WORDS.has(word)))
    .map((word) => singularize(word.replace(/[^a-z0-9-]/g, "")))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function toDisplayName(value) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function singularize(word) {
  if (!word || word.endsWith("ss")) {
    return word;
  }

  if (word.endsWith("ies") && word.length > 3) {
    return `${word.slice(0, -3)}y`;
  }

  if (word.endsWith("oes") && word.length > 3) {
    return word.slice(0, -2);
  }

  if (word.endsWith("s") && word.length > 2) {
    return word.slice(0, -1);
  }

  return word;
}

function parseQuantity(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();

  if (/^\d+\s+\d+\/\d+$/.test(normalized)) {
    const [whole, fraction] = normalized.split(/\s+/);
    return Number(whole) + parseQuantity(fraction);
  }

  if (/^\d+\/\d+$/.test(normalized)) {
    const [numerator, denominator] = normalized.split("/").map(Number);
    return denominator ? numerator / denominator : null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQuantity(quantity, quantityMax, unit, hasUncountedItems) {
  if (quantity == null) {
    return hasUncountedItems ? "Some" : "";
  }

  const value =
    quantityMax != null && quantityMax !== quantity
      ? `${formatNumber(quantity)}-${formatNumber(quantityMax)}`
      : formatNumber(quantity);
  const unitLabel = unit ? ` ${unit}` : "";
  const suffix = hasUncountedItems ? "+" : "";
  return `${value}${unitLabel}${suffix}`;
}

function formatNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function classifyIngredient(name) {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => name.includes(keyword))) {
      return rule.category;
    }
  }

  return "Other";
}

function formatShoppingDisplay(amount, unit, name, amountKnown) {
  if (!amountKnown) {
    return name;
  }

  const visibleUnit = unit === "item" ? null : unit;
  return [formatShoppingAmount(amount), visibleUnit, name].filter(Boolean).join(" ");
}

function formatShoppingAmount(value) {
  const whole = Math.trunc(value);
  const fraction = Math.round((value - whole) * 8) / 8;
  const fractionMap = new Map([
    [0.125, "1/8"],
    [0.25, "1/4"],
    [0.333, "1/3"],
    [0.375, "3/8"],
    [0.5, "1/2"],
    [0.625, "5/8"],
    [0.667, "2/3"],
    [0.75, "3/4"],
    [0.875, "7/8"],
  ]);
  const matchedFraction = Array.from(fractionMap.entries()).find(([candidate]) => Math.abs(candidate - fraction) < 0.02)?.[1];

  if (!matchedFraction) {
    return formatNumber(value);
  }

  if (whole === 0) {
    return matchedFraction;
  }

  return `${whole} ${matchedFraction}`;
}
