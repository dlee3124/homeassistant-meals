import { useEffect, useMemo, useRef, useState } from "react";

const mealSlotLabels = {
  breakfast: "Breakfast",
  snackAm: "AM Snack",
  lunch: "Lunch",
  snackPm: "PM Snack",
  dinner: "Dinner",
  dessert: "Dessert",
};

const mealTypeOptions = ["breakfast", "snack", "lunch", "dinner", "dessert"];

const navItems = [
  { key: "today", path: "/today", label: "Today", eyebrow: "Planned meals" },
  { key: "weeklyView", path: "/", label: "Overview", eyebrow: "This week" },
  { key: "planner", path: "/planner", label: "Plan", eyebrow: "Meal slots" },
  { key: "library", path: "/library", label: "Library", eyebrow: "Recipe browser" },
  { key: "shoppingList", path: "/shopping-list", label: "Shopping", eyebrow: "Combined list" },
  { key: "importer", path: "/import", label: "Import", eyebrow: "Add recipes" },
];

const emptyDraft = {
  id: "",
  title: "",
  description: "",
  mealTypes: [],
  servings: "",
  prepTimeMinutes: "",
  cookTimeMinutes: "",
  ingredients: [],
  steps: [],
  tags: [],
  notes: "",
  source: "ChatGPT",
  createdAt: "",
  updatedAt: "",
};

export default function App() {
  const [route, setRoute] = useState(parseRoute(window.location.pathname));
  const [recipes, setRecipes] = useState([]);
  const [selectedRecipeId, setSelectedRecipeId] = useState(null);
  const [recipeSearch, setRecipeSearch] = useState("");
  const [currentWeekStart, setCurrentWeekStart] = useState(getWeekStartMonday(new Date()));
  const [plan, setPlan] = useState(null);
  const [shoppingList, setShoppingList] = useState(null);
  const [importText, setImportText] = useState("");
  const [draftRecipe, setDraftRecipe] = useState(null);
  const [loading, setLoading] = useState({ app: true, parse: false, saveRecipe: false, shoppingList: false });
  const [notice, setNotice] = useState(null);
  const [planSaveState, setPlanSaveState] = useState("idle");
  const pendingPlanRef = useRef(null);
  const pendingPlanTimerRef = useRef(null);
  const planSaveInFlightRef = useRef(false);
  const currentWeekStartRef = useRef(currentWeekStart);

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      setLoading((current) => ({ ...current, app: true, shoppingList: true }));

      try {
        const [recipesPayload, planPayload, shoppingListPayload] = await Promise.all([
          fetchJson("/api/recipes"),
          fetchJson(`/api/plans/${currentWeekStart}`),
          fetchJson(`/api/shopping-list/${currentWeekStart}`),
        ]);

        if (!active) {
          return;
        }

        setRecipes(recipesPayload.recipes);
        setPlan(planPayload.plan);
        setShoppingList(shoppingListPayload.shoppingList);
        setPlanSaveState("idle");
      } catch (error) {
        if (active) {
          showNotice(setNotice, error.message || "Could not load the application.", "error");
        }
      } finally {
        if (active) {
          setLoading((current) => ({ ...current, app: false, shoppingList: false }));
        }
      }
    }

    bootstrap();

    return () => {
      active = false;
    };
  }, [currentWeekStart]);

  useEffect(() => {
    currentWeekStartRef.current = currentWeekStart;
  }, [currentWeekStart]);

  useEffect(() => {
    if ((route.name === "recipe" || route.name === "recipeEdit") && route.recipeId) {
      setSelectedRecipeId(route.recipeId);
      return;
    }

    if (!selectedRecipeId && recipes[0]) {
      setSelectedRecipeId(recipes[0].id);
    }
  }, [route, recipes, selectedRecipeId]);

  useEffect(() => {
    if (!notice) {
      return undefined;
    }

    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(
    () => () => {
      if (pendingPlanTimerRef.current) {
        window.clearTimeout(pendingPlanTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (route.name !== "shoppingList") {
      return;
    }

    void refreshShoppingList(currentWeekStart);
  }, [route.name, currentWeekStart]);

  const recipeIndex = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  const activeRecipeId = route.recipeId || selectedRecipeId;
  const selectedRecipe = activeRecipeId ? recipeIndex.get(activeRecipeId) || null : null;
  const visibleRecipes = useMemo(
    () => recipes.filter((recipe) => matchesRecipeSearch(recipe, recipeSearch)),
    [recipes, recipeSearch],
  );
  const weekDays = useMemo(() => listWeekDates(currentWeekStart), [currentWeekStart]);
  const plannedMealCount = countPlannedMeals(plan);
  const weekProgress = Math.round((plannedMealCount / (weekDays.length * Object.keys(mealSlotLabels).length || 1)) * 100);
  const fallbackShoppingList = useMemo(() => buildFallbackShoppingList(plan, recipeIndex), [plan, recipeIndex]);
  const effectiveShoppingList =
    shoppingList?.recipeTitles?.length || shoppingList?.items?.length || !plannedMealCount ? shoppingList : fallbackShoppingList;

  async function navigateTo(path, options = {}) {
    const nextPath = normalizeRoutePath(path);

    if (!options.replace && window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }

    setRoute(parseRoute(nextPath));
  }

  async function refreshRecipes(selectRecipeId) {
    const payload = await fetchJson("/api/recipes");
    setRecipes(payload.recipes);

    if (selectRecipeId) {
      setSelectedRecipeId(selectRecipeId);
    } else if (!selectedRecipeId && payload.recipes[0]) {
      setSelectedRecipeId(payload.recipes[0].id);
    }
  }

  async function refreshShoppingList(weekStart = currentWeekStart) {
    setLoading((current) => ({ ...current, shoppingList: true }));

    try {
      const payload = await fetchJson(`/api/shopping-list/${weekStart}`);

      if (weekStart === currentWeekStartRef.current) {
        setShoppingList(payload.shoppingList);
      }
    } finally {
      setLoading((current) => ({ ...current, shoppingList: false }));
    }
  }

  async function handleParseRecipe() {
    if (!importText.trim()) {
      showNotice(setNotice, "Paste a recipe first.", "error");
      return;
    }

    setLoading((current) => ({ ...current, parse: true }));

    try {
      const payload = await fetchJson("/api/recipes/import/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });

      setDraftRecipe(payload.recipe);
      showNotice(setNotice, "Recipe parsed. Review it before saving.", "success");
    } catch (error) {
      showNotice(setNotice, error.message || "Could not parse recipe.", "error");
    } finally {
      setLoading((current) => ({ ...current, parse: false }));
    }
  }

  async function handleSaveRecipe(event, options = {}) {
    event.preventDefault();

    const mode = options.mode || "create";
    const baseRecipe =
      options.baseRecipe ||
      draftRecipe || {
        ...emptyDraft,
        id: "",
        createdAt: new Date().toISOString(),
      };
    const recipePayload = buildRecipePayload(event.currentTarget, baseRecipe);
    const endpoint = mode === "update" ? `/api/recipes/${encodeURIComponent(baseRecipe.id)}` : "/api/recipes";
    const method = mode === "update" ? "PUT" : "POST";

    setLoading((current) => ({ ...current, saveRecipe: true }));

    try {
      const payload = await fetchJson(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recipePayload),
      });

      if (mode === "create") {
        setImportText("");
        setDraftRecipe(null);
      }

      await Promise.all([refreshRecipes(payload.recipe.id), refreshShoppingList(currentWeekStart)]);
      showNotice(setNotice, mode === "update" ? "Recipe updated." : "Recipe saved to the library.", "success");
      await navigateTo(mode === "update" ? `/recipes/${payload.recipe.id}` : "/planner");
    } catch (error) {
      showNotice(setNotice, error.message || "Could not save recipe.", "error");
    } finally {
      setLoading((current) => ({ ...current, saveRecipe: false }));
    }
  }

  function queuePlanSave(nextPlan) {
    pendingPlanRef.current = {
      weekStart: nextPlan.weekStart,
      plan: structuredClone(nextPlan),
    };

    if (pendingPlanTimerRef.current) {
      window.clearTimeout(pendingPlanTimerRef.current);
    }

    setPlanSaveState("queued");
    pendingPlanTimerRef.current = window.setTimeout(() => {
      void flushPendingPlanSave();
    }, 450);
  }

  async function flushPendingPlanSave() {
    if (planSaveInFlightRef.current) {
      return;
    }

    if (pendingPlanTimerRef.current) {
      window.clearTimeout(pendingPlanTimerRef.current);
      pendingPlanTimerRef.current = null;
    }

    if (!pendingPlanRef.current) {
      if (planSaveState !== "error") {
        setPlanSaveState("idle");
      }
      return;
    }

    const queued = pendingPlanRef.current;
    pendingPlanRef.current = null;
    planSaveInFlightRef.current = true;
    setPlanSaveState("saving");

    try {
      const payload = await fetchJson(`/api/plans/${queued.weekStart}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queued.plan),
      });

      if (queued.weekStart === currentWeekStart) {
        setPlan(payload.plan);
      }

      await refreshShoppingList(queued.weekStart);
      setPlanSaveState("idle");
    } catch (error) {
      pendingPlanRef.current = queued;
      setPlanSaveState("error");
      showNotice(setNotice, error.message || "Could not update meal plan.", "error");
    } finally {
      planSaveInFlightRef.current = false;

      if (pendingPlanRef.current) {
        void flushPendingPlanSave();
      }
    }
  }

  function handlePlanChange(day, slot, recipeId) {
    if (!plan) {
      return;
    }

    const nextPlan = structuredClone(plan);
    nextPlan.days[day][slot] = recipeId || null;
    nextPlan.updatedAt = new Date().toISOString();
    setPlan(nextPlan);
    queuePlanSave(nextPlan);
  }

  async function goToWeek(offsetDays) {
    await flushPendingPlanSave();
    setCurrentWeekStart((current) => shiftWeek(current, offsetDays));
  }

  async function openToday() {
    await flushPendingPlanSave();
    setCurrentWeekStart(getWeekStartMonday(new Date()));
    await navigateTo("/today");
  }

  const routeView = (() => {
    if (loading.app && !plan) {
      return <LoadingView />;
    }

    if (route.name === "today") {
      return <TodayPage currentWeekStart={currentWeekStart} plan={plan} recipeIndex={recipeIndex} onNavigate={navigateTo} />;
    }

    if (route.name === "planner") {
      return (
        <PlannerPage
          currentWeekStart={currentWeekStart}
          onPreviousWeek={() => void goToWeek(-7)}
          onNextWeek={() => void goToWeek(7)}
          weekDays={weekDays}
          plan={plan}
          recipes={recipes}
          recipeIndex={recipeIndex}
          selectedRecipe={selectedRecipe}
          onPlanChange={handlePlanChange}
          onNavigate={navigateTo}
          planSaveState={planSaveState}
        />
      );
    }

    if (route.name === "library") {
      return (
        <LibraryPage
          selectedRecipe={selectedRecipe}
          selectedRecipeId={selectedRecipeId}
          onSelectRecipe={setSelectedRecipeId}
          recipeSearch={recipeSearch}
          onSearchChange={setRecipeSearch}
          visibleRecipes={visibleRecipes}
          recipes={recipes}
          onNavigate={navigateTo}
        />
      );
    }

    if (route.name === "shoppingList") {
      return (
        <ShoppingListPage
          currentWeekStart={currentWeekStart}
          onPreviousWeek={() => void goToWeek(-7)}
          onNextWeek={() => void goToWeek(7)}
          onNavigate={navigateTo}
          shoppingList={effectiveShoppingList}
          hasPlannedMeals={plannedMealCount > 0}
          loading={loading.shoppingList}
        />
      );
    }

    if (route.name === "importer") {
      return (
        <ImporterPage
          importText={importText}
          onImportTextChange={setImportText}
          onParseRecipe={handleParseRecipe}
          onClearImport={() => {
            setImportText("");
            setDraftRecipe(null);
          }}
          draftRecipe={draftRecipe}
          onSaveRecipe={(event) => handleSaveRecipe(event)}
          parsing={loading.parse}
          saving={loading.saveRecipe}
          onNavigate={navigateTo}
        />
      );
    }

    if (route.name === "recipeEdit") {
      return (
        <RecipeEditorPage
          recipe={selectedRecipe}
          onNavigate={navigateTo}
          onSaveRecipe={(event) => handleSaveRecipe(event, { mode: "update", baseRecipe: selectedRecipe })}
          saving={loading.saveRecipe}
        />
      );
    }

    if (route.name === "recipe") {
      return (
        <RecipePage
          recipe={selectedRecipe}
          currentWeekStart={currentWeekStart}
          onNavigate={navigateTo}
          weekDays={weekDays}
          plan={plan}
        />
      );
    }

    return (
      <OverviewPage
        currentWeekStart={currentWeekStart}
        onPreviousWeek={() => void goToWeek(-7)}
        onNextWeek={() => void goToWeek(7)}
        weekDays={weekDays}
        recipeIndex={recipeIndex}
        plan={plan}
        onNavigate={navigateTo}
      />
    );
  })();

  return (
    <div className="app-shell">
      <Sidebar
        route={route}
        recipesCount={recipes.length}
        plannedMeals={plannedMealCount}
        weekProgress={weekProgress}
        onNavigate={navigateTo}
        onOpenToday={openToday}
      />

      <main className="workspace">{routeView}</main>

      <Toast notice={notice} />
    </div>
  );
}

function Sidebar({ route, recipesCount, plannedMeals, weekProgress, onNavigate, onOpenToday }) {
  return (
    <aside className="sidebar">
      <div className="brand-card">
        <div className="brand-mark">M</div>
        <div>
          <p className="eyebrow">Meal Atlas</p>
          <h1>Meal Atlas</h1>
          <p className="muted">Plan the week, browse your library, and turn meals into one shopping list.</p>
        </div>
      </div>

      <nav className="nav-card" aria-label="Primary">
        {navItems.map((item) => {
          const active = item.key === "weeklyView" ? route.name === "weeklyView" : route.name === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`nav-link ${active ? "active" : ""}`}
              onClick={() => (item.key === "today" ? void onOpenToday() : onNavigate(item.path))}
            >
              <span className="nav-link-label">{item.label}</span>
              <span className="nav-link-note">{item.eyebrow}</span>
            </button>
          );
        })}
      </nav>

      <section className="metrics-card">
        <Metric label="Recipes" value={String(recipesCount).padStart(2, "0")} />
        <Metric label="Meals" value={String(plannedMeals).padStart(2, "0")} />
        <Metric label="Coverage" value={`${weekProgress}%`} accent />
      </section>
    </aside>
  );
}

function TodayPage({ currentWeekStart, plan, recipeIndex, onNavigate }) {
  const todayKey = toIsoDate(new Date());
  const todayPlan = plan?.days?.[todayKey];
  const plannedItems = Object.entries(mealSlotLabels)
    .map(([slot, label]) => {
      const recipeId = todayPlan?.[slot];
      const recipe = recipeId ? recipeIndex.get(recipeId) : null;
      return recipe ? { slot, label, recipe } : null;
    })
    .filter(Boolean);

  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Today"
        title={formatTodayHeading(todayKey)}
        copy={`Current planning week: ${formatWeekHeading(currentWeekStart)}`}
        actions={
          <>
            <button type="button" className="button ghost" onClick={() => onNavigate("/")}>
              Overview
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
              Plan
            </button>
          </>
        }
      />

      <section className="panel today-panel">
        {plannedItems.length ? (
          <div className="today-list">
            {plannedItems.map((item) => (
              <button key={item.slot} type="button" className="meal-pill today-pill" onClick={() => onNavigate(`/recipes/${item.recipe.id}`)}>
                <span>{item.label}</span>
                <strong>{item.recipe.title}</strong>
              </button>
            ))}
          </div>
        ) : (
          <EmptyBlock
            title="Nothing planned for today"
            copy="Use the planner to assign meals for the current day."
            actionLabel="Plan today"
            onAction={() => onNavigate("/planner")}
          />
        )}
      </section>
    </section>
  );
}

function OverviewPage({ currentWeekStart, onPreviousWeek, onNextWeek, weekDays, recipeIndex, plan, onNavigate }) {
  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Overview"
        title="This week"
        copy={formatWeekHeading(currentWeekStart)}
        actions={
          <>
            <button type="button" className="button ghost" onClick={onPreviousWeek}>
              Previous
            </button>
            <button type="button" className="button ghost" onClick={onNextWeek}>
              Next
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/shopping-list")}>
              Shopping list
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
              Plan meals
            </button>
          </>
        }
      />

      <section className="panel overview-panel">
        <div className="overview-grid">
          {weekDays.map((day) => (
            <OverviewCard key={day.key} day={day} dayPlan={plan?.days?.[day.key]} recipeIndex={recipeIndex} onNavigate={onNavigate} />
          ))}
        </div>
      </section>
    </section>
  );
}

function PlannerPage({
  currentWeekStart,
  onPreviousWeek,
  onNextWeek,
  weekDays,
  plan,
  recipes,
  onPlanChange,
  onNavigate,
  planSaveState,
}) {
  if (!recipes.length) {
    return (
      <section className="page-stack">
        <SectionHeader
          eyebrow="Plan"
          title="Plan meals"
          copy={formatWeekHeading(currentWeekStart)}
          actions={
            <button type="button" className="button primary" onClick={() => onNavigate("/import")}>
              Add recipe
            </button>
          }
        />

        <section className="panel onboarding-panel">
          <EmptyBlock
            title="No recipes yet"
            copy="Add a recipe before planning meals for the week."
            actionLabel="Add recipe"
            onAction={() => onNavigate("/import")}
          />
        </section>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Plan"
        title="Plan meals"
        copy={formatWeekHeading(currentWeekStart)}
        actions={
          <>
            <button type="button" className="button ghost" onClick={onPreviousWeek}>
              Previous
            </button>
            <button type="button" className="button ghost" onClick={onNextWeek}>
              Next
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/library")}>
              Library
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/shopping-list")}>
              Shopping list
            </button>
          </>
        }
      />

      <section className="panel planner-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Planner</p>
            <h3>Daily slots</h3>
          </div>
          <PlanStatus state={planSaveState} />
        </div>

        <div className="planner-board">
          {weekDays.map((day) => (
            <PlannerDayCard key={day.key} day={day} dayPlan={plan?.days?.[day.key]} recipes={recipes} onPlanChange={onPlanChange} />
          ))}
        </div>
      </section>
    </section>
  );
}

function LibraryPage({
  selectedRecipe,
  selectedRecipeId,
  onSelectRecipe,
  recipeSearch,
  onSearchChange,
  visibleRecipes,
  recipes,
  onNavigate,
}) {
  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Library"
        title="Recipe library"
        copy="Browse, preview, and edit saved recipes."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("/import")}>
            Add recipe
          </button>
        }
      />

      <div className="content-grid">
        <section className="panel library-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Recipes</p>
              <h3>Saved recipes</h3>
            </div>
          </div>

          <input
            className="field"
            value={recipeSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search titles, ingredients, tags"
          />

          {visibleRecipes.length ? (
            <div className="recipe-list">
              {visibleRecipes.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  active={recipe.id === selectedRecipeId}
                  onSelect={() => onSelectRecipe(recipe.id)}
                  onOpen={() => onNavigate(`/recipes/${recipe.id}`)}
                  onEdit={() => onNavigate(`/recipes/${recipe.id}/edit`)}
                />
              ))}
            </div>
          ) : (
            <EmptyBlock
              title={recipes.length ? "No matching recipes" : "No recipes yet"}
              copy={
                recipes.length
                  ? "Try a broader search term or import a new recipe."
                  : "Add a recipe to start building the library."
              }
              actionLabel="Add recipe"
              onAction={() => onNavigate("/import")}
            />
          )}
        </section>

        <section className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Preview</p>
              <h3>Selected recipe</h3>
            </div>
            {selectedRecipe ? (
              <div className="action-row">
                <button type="button" className="button secondary" onClick={() => onNavigate(`/recipes/${selectedRecipe.id}`)}>
                  Open
                </button>
                <button type="button" className="button ghost" onClick={() => onNavigate(`/recipes/${selectedRecipe.id}/edit`)}>
                  Edit
                </button>
              </div>
            ) : null}
          </div>

          {selectedRecipe ? (
            <RecipeDetail recipe={selectedRecipe} />
          ) : (
            <EmptyBlock title="No recipe selected" copy="Choose a recipe from the library to preview it here." />
          )}
        </section>
      </div>
    </section>
  );
}

function ShoppingListPage({ currentWeekStart, onPreviousWeek, onNextWeek, onNavigate, shoppingList, hasPlannedMeals, loading }) {
  const items = shoppingList?.items || [];
  const recipeTitles = shoppingList?.recipeTitles || [];
  const uncategorized = shoppingList?.uncategorized || [];
  const hasPlannedRecipes = recipeTitles.length > 0;
  const [openSources, setOpenSources] = useState({});
  const groupedItems = useMemo(() => groupShoppingItemsByCategory(items), [items]);

  function toggleSources(key) {
    setOpenSources((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Shopping"
        title="Combined shopping list"
        copy={formatWeekHeading(currentWeekStart)}
        actions={
          <>
            <button type="button" className="button ghost" onClick={onPreviousWeek}>
              Previous
            </button>
            <button type="button" className="button ghost" onClick={onNextWeek}>
              Next
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
              Plan
            </button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Recipes</p>
            <h3>
              {hasPlannedRecipes
                ? `${recipeTitles.length} planned recipe${recipeTitles.length === 1 ? "" : "s"}`
                : loading
                  ? "Loading shopping list"
                  : hasPlannedMeals
                    ? "Planned meals found"
                    : "Nothing planned yet"}
            </h3>
          </div>
          <div className={`status-chip ${loading ? "saving" : ""}`}>{loading ? "Refreshing..." : "Up to date"}</div>
        </div>

        {hasPlannedRecipes ? (
          <div className="chip-row">
            {recipeTitles.map((title) => (
              <span key={title} className="chip chip-accent">
                {title}
              </span>
            ))}
          </div>
        ) : hasPlannedMeals ? (
          <EmptyBlock
            title="Shopping list still syncing"
            copy="The planner has meals for this week. Reopen this page or change weeks if the grouped list has not filled in yet."
          />
        ) : (
          <EmptyBlock
            title={loading ? "Refreshing shopping list" : "No planned recipes"}
            copy={loading ? "Checking the current week for planned meals." : "Plan meals for the week to generate a combined shopping list."}
            actionLabel={loading ? undefined : "Plan meals"}
            onAction={loading ? undefined : () => onNavigate("/planner")}
          />
        )}
      </section>

      {items.length ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Items</p>
              <h3>Checklist</h3>
            </div>
          </div>

          <div className="shopping-category-list">
            {groupedItems.map((group) => (
              <section key={group.category} className="shopping-category-section">
                <div className="shopping-category-header">
                  <p className="eyebrow">{group.category}</p>
                </div>

                <div className="shopping-checklist">
                  {group.items.map((item) => (
                    <article key={item.key} className="shopping-checklist-item">
                      <div className="shopping-checklist-row">
                        <label className="shopping-check">
                          <input type="checkbox" />
                          <span className="shopping-check-copy">
                            <strong>{item.quantityLabel ? `${item.quantityLabel} ${item.displayName}` : item.displayName}</strong>
                          </span>
                        </label>
                        <button type="button" className="text-button" onClick={() => toggleSources(item.key)}>
                          {openSources[item.key] ? "Hide source" : "Source"}
                        </button>
                      </div>
                      {openSources[item.key] ? (
                        <div className="shopping-source-list">
                          {item.recipes.map((recipeTitle) => (
                            <span key={`${item.key}-${recipeTitle}`} className="chip">
                              {recipeTitle}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      ) : null}

      {uncategorized.length ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Review</p>
              <h3>Items to check manually</h3>
            </div>
          </div>
          <ul className="detail-list">
            {uncategorized.map((entry) => (
              <li key={`${entry.recipeId}-${entry.ingredient}`}>{entry.ingredient}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ImporterPage({
  importText,
  onImportTextChange,
  onParseRecipe,
  onClearImport,
  draftRecipe,
  onSaveRecipe,
  parsing,
  saving,
  onNavigate,
}) {
  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Import"
        title="Import recipe"
        copy="Paste recipe text and review it before saving."
        actions={
          <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
            Back to plan
          </button>
        }
      />

      <div className="content-grid importer-grid">
        <section className="panel import-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h3>Paste recipe text</h3>
            </div>
          </div>

          <textarea
            className="field field-area source-area"
            value={importText}
            onChange={(event) => onImportTextChange(event.target.value)}
            placeholder="Paste a ChatGPT recipe or other structured text here."
          />

          <div className="action-row">
            <button type="button" className="button primary" onClick={onParseRecipe} disabled={parsing}>
              {parsing ? "Parsing..." : "Parse recipe"}
            </button>
            <button type="button" className="button ghost" onClick={onClearImport}>
              Clear
            </button>
          </div>
        </section>

        <section className="panel review-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h3>Review before saving</h3>
            </div>
            <p className="muted">Check the title, ingredients, steps, and tags.</p>
          </div>

          {draftRecipe ? (
            <DraftForm recipe={draftRecipe} onSubmit={onSaveRecipe} saving={saving} submitLabel="Save recipe" />
          ) : (
            <EmptyBlock title="Nothing to review yet" copy="Paste recipe text and run the parser to fill this form." />
          )}
        </section>
      </div>
    </section>
  );
}

function RecipePage({ recipe, currentWeekStart, onNavigate, weekDays, plan }) {
  if (!recipe) {
    return (
      <section className="page-stack">
        <SectionHeader
          eyebrow="Recipe"
          title="Recipe not found"
          copy="The selected recipe is not available in the local library."
          actions={
            <button type="button" className="button secondary" onClick={() => onNavigate("/")}>
              Back home
            </button>
          }
        />
      </section>
    );
  }

  const placements = weekDays
    .map((day) => {
      const slots = Object.entries(mealSlotLabels)
        .filter(([slot]) => plan?.days?.[day.key]?.[slot] === recipe.id)
        .map(([, label]) => label);
      return slots.length ? { day: day.label, slots } : null;
    })
    .filter(Boolean);

  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Recipe"
        title={recipe.title}
        copy={recipe.description || "Ingredients and method."}
        actions={
          <>
            <div className="hero-chip">{formatWeekHeading(currentWeekStart)}</div>
            <button type="button" className="button ghost" onClick={() => onNavigate("/")}>
              Overview
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate(`/recipes/${recipe.id}/edit`)}>
              Edit
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
              Plan
            </button>
          </>
        }
      />

      {placements.length ? (
        <section className="panel placement-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">This week</p>
              <h3>Scheduled meals</h3>
            </div>
          </div>
          <div className="placement-list">
            {placements.map((entry) => (
              <div key={entry.day} className="placement-chip">
                <strong>{entry.day}</strong>
                <span>{entry.slots.join(", ")}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel detail-panel">
        <RecipeDetail recipe={recipe} />
      </section>
    </section>
  );
}

function RecipeEditorPage({ recipe, onNavigate, onSaveRecipe, saving }) {
  if (!recipe) {
    return (
      <section className="page-stack">
        <SectionHeader
          eyebrow="Edit"
          title="Recipe not found"
          copy="The recipe you tried to edit is not available in the local library."
          actions={
            <button type="button" className="button secondary" onClick={() => onNavigate("/planner")}>
              Back to plan
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="page-stack">
      <SectionHeader
        eyebrow="Edit"
        title={`Edit ${recipe.title}`}
        copy="Update the saved recipe in your local library."
        actions={
          <>
            <button type="button" className="button ghost" onClick={() => onNavigate(`/recipes/${recipe.id}`)}>
              View recipe
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate("/library")}>
              Back to library
            </button>
          </>
        }
      />

      <section className="panel review-panel">
        <DraftForm recipe={recipe} onSubmit={onSaveRecipe} saving={saving} submitLabel="Update recipe" />
      </section>
    </section>
  );
}

function PlannerDayCard({ day, dayPlan, recipes, onPlanChange }) {
  return (
    <article className="planner-day-card">
      <div className="day-card-header">
        <div>
          <h4>{day.label}</h4>
          <span>{formatDayNumber(day.key)}</span>
        </div>
        <div className="day-badge">{Object.values(dayPlan || {}).filter(Boolean).length} planned</div>
      </div>

      <div className="slot-list">
        {Object.entries(mealSlotLabels).map(([slot, label]) => (
          <label className="slot-field" key={slot}>
            <span>{label}</span>
            <select className="field" value={dayPlan?.[slot] || ""} onChange={(event) => onPlanChange(day.key, slot, event.target.value)}>
              <option value="">Unplanned</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </article>
  );
}

function OverviewCard({ day, dayPlan, recipeIndex, onNavigate }) {
  const items = Object.entries(mealSlotLabels)
    .map(([slot, label]) => {
      const recipeId = dayPlan?.[slot];
      const recipe = recipeId ? recipeIndex.get(recipeId) : null;
      return recipe ? { label, recipe } : null;
    })
    .filter(Boolean);

  return (
    <article className="overview-card">
      <div className="day-card-header">
        <div>
          <h4>{day.label}</h4>
          <span>{formatDayNumber(day.key)}</span>
        </div>
      </div>

      {items.length ? (
        <div className="meal-pill-list">
          {items.map((item) => (
            <button key={`${day.key}-${item.label}`} type="button" className="meal-pill" onClick={() => onNavigate(`/recipes/${item.recipe.id}`)}>
              <span>{item.label}</span>
              <strong>{item.recipe.title}</strong>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-slot-note">No meals planned yet.</div>
      )}
    </article>
  );
}

function RecipeCard({ recipe, active, onSelect, onOpen, onEdit }) {
  return (
    <article className={`recipe-card ${active ? "active" : ""}`}>
      <div className="recipe-card-top">
        <div>
          <strong>{recipe.title}</strong>
          <p className="muted">{recipe.description || "No description."}</p>
        </div>
        <button type="button" className="mini-button" onClick={onSelect}>
          Preview
        </button>
      </div>

      <div className="chip-row">
        {recipe.mealTypes.map((mealType) => (
          <span key={mealType} className="chip chip-accent">
            {mealType}
          </span>
        ))}
      </div>

      <div className="chip-row">
        {recipe.tags.slice(0, 4).map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <div className="card-footer">
        <span>{recipe.ingredients.length} ingredients</span>
        <div className="action-row">
          <button type="button" className="text-button" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="text-button" onClick={onOpen}>
            Open
          </button>
        </div>
      </div>
    </article>
  );
}

function RecipeDetail({ recipe }) {
  return (
    <div className="recipe-detail">
      <div className="detail-intro">
        <div>
          <h3>{recipe.title}</h3>
          <p className="muted">{recipe.description || "No description."}</p>
        </div>
        <div className="chip-row">
          {recipe.servings ? <span className="chip chip-accent">Serves {recipe.servings}</span> : null}
          {recipe.prepTimeMinutes ? <span className="chip">Prep {recipe.prepTimeMinutes} min</span> : null}
          {recipe.cookTimeMinutes ? <span className="chip">Cook {recipe.cookTimeMinutes} min</span> : null}
        </div>
      </div>

      <div className="chip-row">
        {recipe.mealTypes.map((mealType) => (
          <span key={mealType} className="chip chip-accent">
            {mealType}
          </span>
        ))}
        {recipe.tags.map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <div className="recipe-columns">
        <section className="detail-card">
          <p className="eyebrow">Ingredients</p>
          <ul className="detail-list">
            {recipe.ingredients.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="detail-card">
          <p className="eyebrow">Method</p>
          <ol className="detail-list ordered">
            {recipe.steps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </div>

      {recipe.notes ? (
        <section className="detail-card">
          <p className="eyebrow">Notes</p>
          <p className="muted">{recipe.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

function DraftForm({ recipe, onSubmit, saving, submitLabel }) {
  return (
    <form className="draft-form" onSubmit={onSubmit}>
      <div className="form-grid">
        <label className="form-field full-span">
          <span>Title</span>
          <input className="field" name="title" defaultValue={recipe.title} />
        </label>

        <label className="form-field">
          <span>Servings</span>
          <input className="field" name="servings" defaultValue={recipe.servings || ""} />
        </label>

        <label className="form-field">
          <span>Source</span>
          <input className="field" name="source" defaultValue={recipe.source || "ChatGPT"} />
        </label>

        <label className="form-field">
          <span>Prep minutes</span>
          <input className="field" name="prepTimeMinutes" type="number" min="0" defaultValue={recipe.prepTimeMinutes ?? ""} />
        </label>

        <label className="form-field">
          <span>Cook minutes</span>
          <input className="field" name="cookTimeMinutes" type="number" min="0" defaultValue={recipe.cookTimeMinutes ?? ""} />
        </label>

        <label className="form-field full-span">
          <span>Description</span>
          <textarea className="field field-area compact-area" name="description" defaultValue={recipe.description || ""} />
        </label>

        <fieldset className="form-field full-span">
          <legend>Meal types</legend>
          <div className="checkbox-row">
            {mealTypeOptions.map((mealType) => (
              <label key={mealType} className="check-chip">
                <input type="checkbox" name="mealTypes" value={mealType} defaultChecked={recipe.mealTypes.includes(mealType)} />
                <span>{mealType}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="form-field full-span">
          <span>Ingredients, one per line</span>
          <textarea className="field field-area" name="ingredients" defaultValue={recipe.ingredients.join("\n")} />
        </label>

        <label className="form-field full-span">
          <span>Steps, one per line</span>
          <textarea className="field field-area" name="steps" defaultValue={recipe.steps.join("\n")} />
        </label>

        <label className="form-field full-span">
          <span>Tags, one per line</span>
          <textarea className="field field-area compact-area" name="tags" defaultValue={recipe.tags.join("\n")} />
        </label>

        <label className="form-field full-span">
          <span>Notes</span>
          <textarea className="field field-area compact-area" name="notes" defaultValue={recipe.notes || ""} />
        </label>
      </div>

      <div className="action-row">
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

function PlanStatus({ state }) {
  const labels = {
    idle: "All changes saved",
    queued: "Changes queued",
    saving: "Saving changes...",
    error: "Save failed",
  };

  return <div className={`status-chip ${state === "queued" ? "pending" : state === "saving" ? "saving" : ""}`}>{labels[state] || labels.idle}</div>;
}

function SectionHeader({ eyebrow, title, copy, actions }) {
  return (
    <section className="section-header-block">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        <p className="muted">{copy}</p>
      </div>
      <div className="action-row">{actions}</div>
    </section>
  );
}

function Metric({ label, value, accent = false }) {
  return (
    <div className={`metric-card ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyBlock({ title, copy, actionLabel, onAction }) {
  return (
    <div className="empty-block">
      <strong>{title}</strong>
      <p className="muted">{copy}</p>
      {actionLabel && onAction ? (
        <button type="button" className="button secondary" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function LoadingView() {
  return (
    <section className="page-stack">
      <div className="panel loading-panel">
        <div className="loading-orb" />
        <h3>Loading</h3>
        <p className="muted">Fetching recipes, this week&apos;s plan, and the shopping list.</p>
      </div>
    </section>
  );
}

function Toast({ notice }) {
  if (!notice) {
    return null;
  }

  return (
    <div className={`toast ${notice.kind}`}>
      <strong>{notice.kind === "error" ? "Error" : "Saved"}</strong>
      <span>{notice.message}</span>
    </div>
  );
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    if (contentType.includes("application/json")) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new Error("The server returned invalid JSON.");
      }
    } else if (!response.ok) {
      const fallbackMessage = response.status ? `Request failed with status ${response.status}.` : "Request failed.";
      throw new Error(fallbackMessage);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  return payload || {};
}

function buildRecipePayload(form, baseRecipe) {
  const formData = new FormData(form);

  return {
    ...baseRecipe,
    title: formData.get("title")?.toString().trim() || "Untitled Recipe",
    description: formData.get("description")?.toString().trim() || "",
    servings: formData.get("servings")?.toString().trim() || "",
    prepTimeMinutes: toOptionalNumber(formData.get("prepTimeMinutes")),
    cookTimeMinutes: toOptionalNumber(formData.get("cookTimeMinutes")),
    ingredients: textAreaToList(formData.get("ingredients")),
    steps: textAreaToList(formData.get("steps")),
    tags: textAreaToList(formData.get("tags")),
    notes: formData.get("notes")?.toString().trim() || "",
    source: formData.get("source")?.toString().trim() || "ChatGPT",
    mealTypes: Array.from(form.querySelectorAll('input[name="mealTypes"]:checked')).map((input) => input.value),
    createdAt: baseRecipe.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function showNotice(setNotice, message, kind) {
  setNotice({ message, kind });
}

function matchesRecipeSearch(recipe, search) {
  if (!search.trim()) {
    return true;
  }

  const haystack = [recipe.title, recipe.description, recipe.ingredients.join(" "), recipe.tags.join(" ")]
    .join(" ")
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function parseRoute(pathname) {
  const normalized = normalizeRoutePath(pathname);

  if (normalized === "/" || normalized === "/home") {
    return { name: "weeklyView" };
  }

  if (normalized === "/today") {
    return { name: "today" };
  }

  if (normalized === "/planner") {
    return { name: "planner" };
  }

  if (normalized === "/library") {
    return { name: "library" };
  }

  if (normalized === "/shopping-list") {
    return { name: "shoppingList" };
  }

  if (normalized === "/import") {
    return { name: "importer" };
  }

  const recipeEditMatch = normalized.match(/^\/recipes\/([^/]+)\/edit$/);

  if (recipeEditMatch) {
    return { name: "recipeEdit", recipeId: decodeURIComponent(recipeEditMatch[1]) };
  }

  const recipeMatch = normalized.match(/^\/recipes\/([^/]+)$/);

  if (recipeMatch) {
    return { name: "recipe", recipeId: decodeURIComponent(recipeMatch[1]) };
  }

  return { name: "weeklyView" };
}

function normalizeRoutePath(pathname) {
  const value = pathname || "/";
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function listWeekDates(weekStart) {
  const start = parseIsoDate(weekStart);
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "long" });

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      key: toIsoDate(date),
      label: formatter.format(date),
    };
  });
}

function countPlannedMeals(plan) {
  if (!plan?.days) {
    return 0;
  }

  return Object.values(plan.days).reduce((count, day) => count + Object.values(day).filter(Boolean).length, 0);
}

function formatWeekHeading(weekStart) {
  const start = parseIsoDate(weekStart);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

  return `${formatter.format(start)} to ${formatter.format(end)}`;
}

function formatDayNumber(isoDate) {
  const date = parseIsoDate(isoDate);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
}

function formatTodayHeading(isoDate) {
  const date = parseIsoDate(isoDate);
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(date);
}

function buildFallbackShoppingList(plan, recipeIndex) {
  const grouped = new Map();
  const recipeTitles = new Set();

  for (const dayPlan of Object.values(plan?.days || {})) {
    for (const recipeId of Object.values(dayPlan || {})) {
      if (!recipeId) {
        continue;
      }

      const recipe = recipeIndex.get(recipeId);

      if (!recipe) {
        continue;
      }

      recipeTitles.add(recipe.title);

      for (const ingredient of recipe.ingredients || []) {
        const displayName = String(ingredient || "").trim();

        if (!displayName) {
          continue;
        }

        const key = displayName.toLowerCase();
        const entry =
          grouped.get(key) ||
          {
            key,
            displayName,
            category: "Other",
            quantityLabel: "",
            recipes: new Set(),
          };

        entry.recipes.add(recipe.title);
        grouped.set(key, entry);
      }
    }
  }

  return {
    weekStart: plan?.weekStart || "",
    recipeIds: [],
    recipeTitles: Array.from(recipeTitles).sort((left, right) => left.localeCompare(right)),
    items: Array.from(grouped.values())
      .map((entry) => ({
        key: entry.key,
        displayName: entry.displayName,
        quantityLabel: entry.quantityLabel,
        recipes: Array.from(entry.recipes).sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    uncategorized: [],
  };
}

function groupShoppingItemsByCategory(items) {
  const groups = new Map();

  for (const item of items) {
    const category = item.category || "Other";
    const existing = groups.get(category) || [];
    existing.push(item);
    groups.set(category, existing);
  }

  return Array.from(groups.entries())
    .map(([category, groupedItems]) => ({
      category,
      items: groupedItems.sort((left, right) => left.displayName.localeCompare(right.displayName)),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function getWeekStartMonday(date) {
  const value = new Date(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  return toIsoDate(value);
}

function shiftWeek(weekStart, days) {
  const date = parseIsoDate(weekStart);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function textAreaToList(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toOptionalNumber(value) {
  const input = String(value || "").trim();
  return input ? Number(input) : null;
}
