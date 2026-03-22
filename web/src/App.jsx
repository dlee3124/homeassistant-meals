import { useEffect, useMemo, useRef, useState } from "react";

const appBasePath = getAppBasePath();

const mealSlotLabels = {
  breakfast: "Breakfast",
  snackAm: "AM Snack",
  lunch: "Lunch",
  snackPm: "PM Snack",
  dinner: "Dinner",
  dessert: "Dessert",
};
const mealSlotKeys = Object.keys(mealSlotLabels);

const mealTypeOptions = ["breakfast", "snack", "lunch", "dinner", "dessert"];

const primaryNavItems = [
  { key: "plan", path: "/", label: "Plan", note: "Weekly board" },
  { key: "cook", path: "/cook", label: "Cook", note: "Today and next" },
  { key: "shop", path: "/shop", label: "Shop", note: "Weekly list" },
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
  const [route, setRoute] = useState(parseRoute(getCurrentAppPath()));
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
    const onPopState = () => setRoute(parseRoute(getCurrentAppPath()));
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
    if (route.name !== "shop") {
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
  const fallbackShoppingList = useMemo(() => buildFallbackShoppingList(plan, recipeIndex), [plan, recipeIndex]);
  const effectiveShoppingList =
    shoppingList?.recipeTitles?.length || shoppingList?.items?.length || !plannedMealCount ? shoppingList : fallbackShoppingList;

  async function navigateTo(path, options = {}) {
    const nextPath = normalizeRoutePath(path);
    const browserPath = withAppBasePath(nextPath);

    if (!options.replace && window.location.pathname !== browserPath) {
      window.history.pushState({}, "", browserPath);
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
      await navigateTo(mode === "update" ? `/recipes/${payload.recipe.id}` : "/");
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

      if (queued.weekStart === currentWeekStartRef.current) {
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

  function handlePlanChange(day, slot, nextSlotValue) {
    if (!plan) {
      return;
    }

    const nextPlan = structuredClone(plan);
    nextPlan.days[day][slot] = normalizeMealSlot(nextSlotValue);
    nextPlan.updatedAt = new Date().toISOString();
    setPlan(nextPlan);
    queuePlanSave(nextPlan);
  }

  function handleBulkPlanChange(days, slot, nextSlotValue) {
    if (!plan || !days.length) {
      return;
    }

    const nextPlan = structuredClone(plan);

    for (const day of days) {
      nextPlan.days[day][slot] = normalizeMealSlot(nextSlotValue);
    }

    nextPlan.updatedAt = new Date().toISOString();
    setPlan(nextPlan);
    queuePlanSave(nextPlan);
  }

  function handleClearWeek() {
    if (!plan) {
      return;
    }

    const nextPlan = {
      ...plan,
      days: Object.fromEntries(weekDays.map((day) => [day.key, createEmptyDayPlan()])),
      updatedAt: new Date().toISOString(),
    };

    setPlan(nextPlan);
    queuePlanSave(nextPlan);
  }

  async function goToWeek(offsetDays) {
    await flushPendingPlanSave();
    setCurrentWeekStart((current) => shiftWeek(current, offsetDays));
  }

  async function openCurrentWeek(nextRoute = "/cook") {
    await flushPendingPlanSave();
    setCurrentWeekStart(getWeekStartMonday(new Date()));
    await navigateTo(nextRoute);
  }

  const routeView = (() => {
    if (loading.app && !plan) {
      return <LoadingView />;
    }

    if (route.name === "cook") {
      return <CookPage currentWeekStart={currentWeekStart} plan={plan} recipeIndex={recipeIndex} onNavigate={navigateTo} />;
    }

    if (route.name === "plan") {
      return (
        <PlanPage
          currentWeekStart={currentWeekStart}
          weekDays={weekDays}
          plan={plan}
          recipes={recipes}
          recipeIndex={recipeIndex}
          onNavigate={navigateTo}
          onPlanChange={handlePlanChange}
          onBulkPlanChange={handleBulkPlanChange}
          onClearWeek={handleClearWeek}
          planSaveState={planSaveState}
        />
      );
    }

    if (route.name === "shop") {
      return (
        <ShopPage
          currentWeekStart={currentWeekStart}
          onNavigate={navigateTo}
          shoppingList={effectiveShoppingList}
          hasPlannedMeals={plannedMealCount > 0}
          loading={loading.shoppingList}
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

    return null;
  })();

  return (
    <div className="app-shell">
      <ProductShell
        route={route}
        currentWeekStart={currentWeekStart}
        recipesCount={recipes.length}
        planSaveState={planSaveState}
        onNavigate={navigateTo}
        onPreviousWeek={() => void goToWeek(-7)}
        onNextWeek={() => void goToWeek(7)}
        onOpenCurrentWeek={() => void openCurrentWeek(getTaskRoutePath(route))}
      />

      <main className="workspace">{routeView}</main>

      <Toast notice={notice} />
    </div>
  );
}

function ProductShell({
  route,
  currentWeekStart,
  recipesCount,
  planSaveState,
  onNavigate,
  onPreviousWeek,
  onNextWeek,
  onOpenCurrentWeek,
}) {
  const activeTask = getActiveTask(route);
  const weekIsCurrent = currentWeekStart === getWeekStartMonday(new Date());

  return (
    <header className="product-shell">
      <button type="button" className="brand-block" onClick={() => onNavigate("/")}>
        <span className="brand-mark">M</span>
        <span className="brand-copy">
          <strong>Meal Atlas</strong>
          <span>Weekly household planning</span>
        </span>
      </button>

      <nav className="primary-nav" aria-label="Primary">
        {primaryNavItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`primary-nav-link ${activeTask === item.key ? "active" : ""}`}
            onClick={() => onNavigate(item.path)}
          >
            <span>{item.label}</span>
            <small>{item.note}</small>
          </button>
        ))}
      </nav>

      <div className="shell-controls">
        <div className="week-switcher">
          <button type="button" className="icon-button" aria-label="Previous week" onClick={onPreviousWeek}>
            Prev
          </button>
          <div className="week-switcher-copy">
            <span className="eyebrow">Week</span>
            <strong>{formatWeekHeading(currentWeekStart)}</strong>
          </div>
          <button type="button" className="icon-button" aria-label="Next week" onClick={onNextWeek}>
            Next
          </button>
        </div>

        <div className="shell-utility-group">
          {!weekIsCurrent ? (
            <button type="button" className="utility-button" onClick={onOpenCurrentWeek}>
              This week
            </button>
          ) : null}
          <button type="button" className="utility-button" onClick={() => onNavigate("/library")}>
            Library
          </button>
          <button type="button" className="utility-button accent" onClick={() => onNavigate("/import")}>
            Import
          </button>
          <div className="shell-status-cluster">
            <span className="shell-count">{recipesCount} recipes</span>
            <PlanStatus state={planSaveState} />
          </div>
        </div>
      </div>
    </header>
  );
}

function PlanPage({
  currentWeekStart,
  weekDays,
  plan,
  recipes,
  recipeIndex,
  onNavigate,
  onPlanChange,
  onBulkPlanChange,
  onClearWeek,
  planSaveState,
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [expandedDays, setExpandedDays] = useState(() => createExpandedDaysState(weekDays));
  const [applyDays, setApplyDays] = useState(() => createApplyDaysState(weekDays));
  const [recipeSearch, setRecipeSearch] = useState("");
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showSlotEditor, setShowSlotEditor] = useState(false);

  const insights = useMemo(() => buildPlanInsights(plan, weekDays, recipeIndex), [plan, weekDays, recipeIndex]);
  const selectedSlotValue = selectedSlot ? normalizeMealSlot(plan?.days?.[selectedSlot.dayKey]?.[selectedSlot.slot]) : null;
  const selectedRecipe = selectedSlotValue?.recipeId ? recipeIndex.get(selectedSlotValue.recipeId) || null : null;
  const recipeGroups = useMemo(
    () => groupRecipesForInspector(recipes, selectedSlot?.slot, recipeSearch),
    [recipes, selectedSlot?.slot, recipeSearch],
  );

  useEffect(() => {
    setExpandedDays((current) => mergeExpandedDaysState(current, weekDays, selectedSlot?.dayKey));
  }, [weekDays, selectedSlot?.dayKey]);

  useEffect(() => {
    setApplyDays(createApplyDaysState(weekDays, selectedSlot?.dayKey));
  }, [weekDays, selectedSlot?.dayKey, selectedSlot?.slot]);

  useEffect(() => {
    setRecipeSearch("");
  }, [selectedSlot?.dayKey, selectedSlot?.slot]);

  useEffect(() => {
    if (!showClearDialog) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        setShowClearDialog(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showClearDialog]);

  function toggleDay(dayKey) {
    setExpandedDays((current) => ({
      ...current,
      [dayKey]: !current[dayKey],
    }));
  }

  function openSlotEditor(selection) {
    setSelectedSlot(selection);
    setExpandedDays((current) => ({
      ...mergeExpandedDaysState(current, weekDays, selection.dayKey),
      [selection.dayKey]: true,
    }));
    setShowSlotEditor(true);
  }

  function toggleApplyDay(dayKey) {
    setApplyDays((current) => ({
      ...current,
      [dayKey]: !current[dayKey],
    }));
  }

  function applyDayPreset(preset) {
    if (preset === "all") {
      setApplyDays(createApplyDaysState(weekDays, selectedSlot?.dayKey, (day) => day.key !== selectedSlot?.dayKey));
      return;
    }

    if (preset === "weekdays") {
      setApplyDays(
        createApplyDaysState(weekDays, selectedSlot?.dayKey, (_day, index) => index < 5 && weekDays[index].key !== selectedSlot?.dayKey),
      );
      return;
    }

    if (preset === "weekend") {
      setApplyDays(
        createApplyDaysState(weekDays, selectedSlot?.dayKey, (_day, index) => index >= 5 && weekDays[index].key !== selectedSlot?.dayKey),
      );
      return;
    }

    setApplyDays(createApplyDaysState(weekDays, selectedSlot?.dayKey));
  }

  function applyInspectorSelection(nextSlotValue) {
    if (!selectedSlot) {
      return;
    }

    const days = weekDays.filter((day) => applyDays[day.key]).map((day) => day.key);
    if (!days.length) {
      return;
    }

    onBulkPlanChange(days, selectedSlot.slot, nextSlotValue);
  }

  const metricCards = [
    {
      label: "Coverage",
      count: `${insights.coverage}%`,
      note: `${insights.coveredCount} of ${insights.totalCount} slots accounted for`,
    },
    {
      label: "At home meals",
      count: String(insights.assignedCount).padStart(2, "0"),
      note: `${insights.openCount} slots still open`,
    },
    {
      label: "Meals out",
      count: String(insights.optionalCount).padStart(2, "0"),
      note: "Intentionally marked not needed",
    },
  ];

  if (!recipes.length) {
    return (
      <section className="page-stack">
        <PageHeading
          title="Plan the week"
          eyebrow="Plan"
          copy="Build the recipe library first, then the weekly board becomes the single place to make planning decisions."
          actions={
            <button type="button" className="button primary" onClick={() => onNavigate("/import")}>
              Import first recipe
            </button>
          }
        />

        <section className="empty-surface">
          <EmptyBlock
            title="No recipes yet"
            copy="Import a recipe before planning. Once the library exists, the board and inspector can assign meals in one pass."
            actionLabel="Go to import"
            onAction={() => onNavigate("/import")}
          />
        </section>
      </section>
    );
  }

  return (
    <section className="page-stack">
      <section className="plan-toolbar">
        <div className="surface-header-meta">
          <PlanStatus state={planSaveState} />
        </div>
        <div className="action-row">
          <button type="button" className="button ghost small" onClick={() => setShowClearDialog(true)}>
            Clear all days
          </button>
        </div>
      </section>

      <section className="metric-strip" aria-label="Plan metrics">
        {metricCards.map((metric) => (
          <article key={metric.label} className="metric-card">
            <span>{metric.label}</span>
            <strong>{metric.count}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <section className="board-surface">
        <div className="lane-board compact">
          {weekDays.map((day) => (
            <DayLane
              key={day.key}
              day={day}
              dayPlan={plan?.days?.[day.key]}
              recipeIndex={recipeIndex}
              expanded={Boolean(expandedDays[day.key])}
              selectedSlot={selectedSlot}
              onToggleDay={() => toggleDay(day.key)}
              onSelectSlot={openSlotEditor}
            />
          ))}
        </div>
      </section>

      {showClearDialog ? (
        <ConfirmationDialog
          title="Clear this week?"
          copy="This will remove every recipe and reset every slot to open for the current week."
          confirmLabel="Clear all days"
          onCancel={() => setShowClearDialog(false)}
          onConfirm={() => {
            onClearWeek();
            setShowClearDialog(false);
          }}
        />
      ) : null}

      {showSlotEditor && selectedSlot && selectedSlotValue ? (
        <SlotEditorDialog
          currentWeekStart={currentWeekStart}
          weekDays={weekDays}
          selectedSlot={selectedSlot}
          selectedSlotValue={selectedSlotValue}
          selectedRecipe={selectedRecipe}
          recipeGroups={recipeGroups}
          recipeSearch={recipeSearch}
          applyDays={applyDays}
          onClose={() => setShowSlotEditor(false)}
          onRecipeSearchChange={setRecipeSearch}
          onToggleApplyDay={toggleApplyDay}
          onApplyDayPreset={applyDayPreset}
          onNavigate={onNavigate}
          onPlanChange={onPlanChange}
          onApplySelection={applyInspectorSelection}
        />
      ) : null}
    </section>
  );
}

function DayLane({ day, dayPlan, recipeIndex, expanded, selectedSlot, onToggleDay, onSelectSlot }) {
  const entries = Object.entries(mealSlotLabels).map(([slot, label]) => {
    const slotValue = normalizeMealSlot(dayPlan?.[slot]);
    const recipe = slotValue.recipeId ? recipeIndex.get(slotValue.recipeId) || null : null;

    return {
      slot,
      label,
      slotValue,
      recipe,
    };
  });

  const assignedCount = entries.filter((entry) => Boolean(entry.recipe)).length;
  const openCount = entries.filter((entry) => entry.slotValue.required && !entry.slotValue.recipeId).length;
  const optionalCount = entries.filter((entry) => !entry.slotValue.required).length;

  return (
    <article className="day-lane">
      <button type="button" className="day-lane-toggle" onClick={onToggleDay}>
        <div>
          <p className="day-lane-label">{day.label}</p>
          <span>{formatDayNumber(day.key)}</span>
        </div>

        <div className="day-lane-stats">
          <span>{assignedCount} planned</span>
          <span>{openCount} open</span>
          {optionalCount ? <span>{optionalCount} out</span> : null}
          <span className={`chevron ${expanded ? "open" : ""}`} aria-hidden="true" />
        </div>
      </button>

      {expanded ? (
        <div className="lane-slot-row compact">
          {entries.map((entry) => {
            const isSelected = selectedSlot?.dayKey === day.key && selectedSlot?.slot === entry.slot;

            return (
              <button
                key={`${day.key}-${entry.slot}`}
                type="button"
                className={`slot-token compact ${getSlotTone(entry.slotValue)} ${isSelected ? "selected" : ""}`}
                onClick={() => onSelectSlot({ dayKey: day.key, slot: entry.slot })}
              >
                <span className="slot-token-label">{entry.label}</span>
                <strong>{entry.recipe ? entry.recipe.title : entry.slotValue.required ? "Open" : "Meals out"}</strong>
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function SlotEditorDialog({
  currentWeekStart,
  weekDays,
  selectedSlot,
  selectedSlotValue,
  selectedRecipe,
  recipeGroups,
  recipeSearch,
  onRecipeSearchChange,
  applyDays,
  onToggleApplyDay,
  onApplyDayPreset,
  onClose,
  onNavigate,
  onPlanChange,
  onApplySelection,
}) {
  if (!selectedSlot || !selectedSlotValue) {
    return null;
  }

  const dayLabel = formatLongDayLabel(selectedSlot.dayKey);
  const applyCount = weekDays.filter((day) => applyDays[day.key]).length;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal-card slot-editor-modal" role="dialog" aria-modal="true" aria-labelledby="slot-editor-title" onClick={(event) => event.stopPropagation()}>
        <div className="surface-header">
          <div>
            <p className="eyebrow">{dayLabel}</p>
            <h3 id="slot-editor-title">{mealSlotLabels[selectedSlot.slot]}</h3>
            <p className="muted">{formatWeekHeading(currentWeekStart)}</p>
          </div>
          <div className="action-row">
            <span className={`state-pill ${getSlotTone(selectedSlotValue)}`}>
              {!selectedSlotValue.required ? "Meals out" : selectedRecipe ? "Planned" : "Open"}
            </span>
            <button type="button" className="button ghost small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div className="state-toggle-row">
          <button
            type="button"
            className={`segmented-button ${selectedSlotValue.required ? "active" : ""}`}
            onClick={() =>
              onPlanChange(selectedSlot.dayKey, selectedSlot.slot, {
                recipeId: selectedSlotValue.recipeId,
                required: true,
              })
            }
          >
            Meal needed
          </button>
          <button
            type="button"
            className={`segmented-button ${!selectedSlotValue.required ? "active" : ""}`}
            onClick={() => onPlanChange(selectedSlot.dayKey, selectedSlot.slot, { recipeId: null, required: false })}
          >
            Not needed
          </button>
          <button
            type="button"
            className="segmented-button"
            onClick={() => onPlanChange(selectedSlot.dayKey, selectedSlot.slot, { recipeId: null, required: true })}
          >
            Clear
          </button>
        </div>

        {selectedSlotValue.required ? (
          <>
            <section className="editor-section">
              <div className="block-header">
                <div>
                  <p className="eyebrow">Recipe</p>
                  <h4>{`Choose a ${mealSlotLabels[selectedSlot.slot].toLowerCase()} recipe`}</h4>
                </div>
              </div>

              <input
                className="field"
                value={recipeSearch}
                onChange={(event) => onRecipeSearchChange(event.target.value)}
                placeholder={`Search ${mealSlotLabels[selectedSlot.slot].toLowerCase()} recipes`}
              />

              <div className="recipe-option-columns compact">
                <div className="recipe-option-group">
                  <span className="group-label">Matching recipes</span>
                  <div className="recipe-option-list">
                    {recipeGroups.matches.length ? (
                      recipeGroups.matches.map((recipe) => (
                        <RecipeOption
                          key={recipe.id}
                          recipe={recipe}
                          active={selectedRecipe?.id === recipe.id}
                          onSelect={() =>
                            onPlanChange(selectedSlot.dayKey, selectedSlot.slot, {
                              recipeId: recipe.id,
                              required: true,
                            })
                          }
                        />
                      ))
                    ) : (
                      <div className="inline-empty">
                        {recipeSearch.trim()
                          ? "No recipes for this meal slot match the current search."
                          : "No recipes in the library are tagged for this meal slot yet."}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {selectedRecipe ? (
              <div className="inspector-inline-actions">
                <button type="button" className="button secondary small" onClick={() => onNavigate(`/recipes/${selectedRecipe.id}`)}>
                  Open recipe
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  onClick={() => onPlanChange(selectedSlot.dayKey, selectedSlot.slot, { recipeId: null, required: true })}
                >
                  Remove recipe
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="inline-empty">This meal is intentionally covered elsewhere and will stay out of the shopping list.</div>
        )}

        <section className="editor-section">
          <div className="block-header">
            <div>
              <p className="eyebrow">Multi-day apply</p>
              <h4>Reuse this decision</h4>
            </div>
            <span className="subtle-count">{applyCount} selected</span>
          </div>

          <div className="preset-row">
            <button type="button" className="mini-button" onClick={() => onApplyDayPreset("all")}>
              All week
            </button>
            <button type="button" className="mini-button" onClick={() => onApplyDayPreset("weekdays")}>
              Weekdays
            </button>
            <button type="button" className="mini-button" onClick={() => onApplyDayPreset("weekend")}>
              Weekend
            </button>
            <button type="button" className="mini-button" onClick={() => onApplyDayPreset("none")}>
              Clear
            </button>
          </div>

          <div className="apply-chip-grid">
            {weekDays.map((day) => (
              <label key={day.key} className={`apply-chip ${applyDays[day.key] ? "active" : ""} ${day.key === selectedSlot.dayKey ? "disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={Boolean(applyDays[day.key])}
                  disabled={day.key === selectedSlot.dayKey}
                  onChange={() => onToggleApplyDay(day.key)}
                />
                <span>{day.label.slice(0, 3)}</span>
              </label>
            ))}
          </div>

          <div className="apply-action-stack">
            <button
              type="button"
              className="button primary"
              disabled={!applyCount || (!selectedRecipe && selectedSlotValue.required)}
              onClick={() =>
                onApplySelection(
                  !selectedSlotValue.required
                    ? { recipeId: null, required: false }
                    : { recipeId: selectedSlotValue.recipeId, required: true },
                )
              }
            >
              {!selectedSlotValue.required ? "Mark selected days meals out" : selectedRecipe ? "Apply recipe to selected days" : "Select a recipe first"}
            </button>

            <div className="split-action-row">
              <button
                type="button"
                className="button secondary small"
                disabled={!applyCount}
                onClick={() => onApplySelection({ recipeId: null, required: false })}
              >
                Mark meals out
              </button>
              <button
                type="button"
                className="button ghost small"
                disabled={!applyCount}
                onClick={() => onApplySelection({ recipeId: null, required: true })}
              >
                Clear selected
              </button>
            </div>
          </div>
        </section>
      </section>
    </div>
  );
}

function RecipeOption({ recipe, active, onSelect }) {
  const secondaryLine = recipe.description?.trim() || getRecipeMeta(recipe);
  const detailLine = recipe.description?.trim() ? getRecipeMeta(recipe) : null;

  return (
    <button type="button" className={`recipe-option ${active ? "active" : ""}`} onClick={onSelect}>
      <strong>{recipe.title}</strong>
      <span>{secondaryLine}</span>
      {detailLine ? <small>{detailLine}</small> : null}
    </button>
  );
}

function CookPage({ currentWeekStart, plan, recipeIndex, onNavigate }) {
  const todayKey = toIsoDate(new Date());
  const activeWeekDays = listWeekDates(currentWeekStart);
  const containsToday = activeWeekDays.some((day) => day.key === todayKey);
  const todayPlan = containsToday ? plan?.days?.[todayKey] : null;
  const todayItems = Object.entries(mealSlotLabels)
    .map(([slot, label]) => {
      const slotValue = normalizeMealSlot(todayPlan?.[slot]);
      const recipe = slotValue.recipeId ? recipeIndex.get(slotValue.recipeId) || null : null;

      if (recipe) {
        return { slot, label, recipe, tone: "assigned" };
      }

      if (!slotValue.required) {
        return { slot, label, recipe: null, tone: "notNeeded" };
      }

      return null;
    })
    .filter(Boolean);

  const upcomingItems = listUpcomingCookItems(plan, activeWeekDays, recipeIndex, containsToday ? todayKey : activeWeekDays[0]?.key).slice(0, 6);

  return (
    <section className="page-stack">
      <PageHeading
        title="Cook"
        eyebrow="Cook"
        copy={
          containsToday
            ? `Today is ${formatTodayHeading(todayKey)}. Focus on what is planned now and what is coming next.`
            : `The active week is ${formatWeekHeading(currentWeekStart)}. Jump to the current week to see today's meals.`
        }
        actions={
          <>
            {!containsToday ? (
              <button type="button" className="button ghost" onClick={() => onNavigate("/")}>
                Open plan
              </button>
            ) : null}
            <button type="button" className="button secondary" onClick={() => onNavigate("/shop")}>
              Open shopping
            </button>
          </>
        }
      />

      <div className="support-layout">
        <section className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Today</p>
              <h3>{containsToday ? "Today's lineup" : "Today is outside this week"}</h3>
            </div>
          </div>

          {containsToday ? (
            todayItems.length ? (
              <div className="cook-list">
                {todayItems.map((item) => (
                  <article key={item.slot} className={`cook-card ${item.tone}`}>
                    <div>
                      <span className="eyebrow">{item.label}</span>
                      <h4>{item.recipe ? item.recipe.title : "Not needed"}</h4>
                      <p className="muted">
                        {item.recipe
                          ? item.recipe.description || getRecipeMeta(item.recipe)
                          : "This meal slot is intentionally covered elsewhere."}
                      </p>
                    </div>
                    <div className="action-row">
                      {item.recipe ? (
                        <button type="button" className="button secondary small" onClick={() => onNavigate(`/recipes/${item.recipe.id}`)}>
                          View recipe
                        </button>
                      ) : null}
                      <button type="button" className="button ghost small" onClick={() => onNavigate("/")}>
                        Adjust in plan
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyBlock
                title="Nothing queued for today"
                copy="Open the planner to assign meals or mark slots as intentionally not needed."
                actionLabel="Open plan"
                onAction={() => onNavigate("/")}
              />
            )
          ) : (
            <EmptyBlock
              title="Today's date is not in the active week"
              copy="Switch back to the current week from the shell if you want a live cooking view for today."
              actionLabel="Open current week plan"
              onAction={() => onNavigate("/")}
            />
          )}
        </section>

        <aside className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Next up</p>
              <h3>Coming soon</h3>
            </div>
          </div>

          {upcomingItems.length ? (
            <div className="queue-list">
              {upcomingItems.map((item) => (
                <button
                  key={`${item.dayKey}-${item.slot}`}
                  type="button"
                  className="queue-item detailed"
                  onClick={() => (item.recipe ? onNavigate(`/recipes/${item.recipe.id}`) : onNavigate("/"))}
                >
                  <span>{`${item.dayLabel} · ${item.slotLabel}`}</span>
                  <strong>{item.recipe ? item.recipe.title : "Not needed"}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="inline-empty">No upcoming meals are planned in this week yet.</div>
          )}
        </aside>
      </div>
    </section>
  );
}

function ShopPage({ currentWeekStart, onNavigate, shoppingList, hasPlannedMeals, loading }) {
  const items = shoppingList?.items || [];
  const recipeTitles = shoppingList?.recipeTitles || [];
  const uncategorized = shoppingList?.uncategorized || [];
  const groupedItems = useMemo(() => groupShoppingItemsByCategory(items), [items]);
  const [openSources, setOpenSources] = useState({});

  function toggleSources(key) {
    setOpenSources((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className="page-stack">
      <PageHeading
        title="Shop the week"
        eyebrow="Shop"
        copy={`${formatWeekHeading(currentWeekStart)} · Build one combined list from the planned recipes only.`}
        actions={
          <div className="hero-stat-group">
            <div className="hero-stat">
              <span>Recipes</span>
              <strong>{String(recipeTitles.length).padStart(2, "0")}</strong>
            </div>
            <div className="hero-stat">
              <span>Items</span>
              <strong>{String(items.length).padStart(2, "0")}</strong>
            </div>
          </div>
        }
      />

      {!recipeTitles.length && !loading ? (
        <section className="empty-surface">
          <EmptyBlock
            title={hasPlannedMeals ? "Shopping list still syncing" : "No planned recipes yet"}
            copy={
              hasPlannedMeals
                ? "Planned meals exist for this week, but the grouped shopping view has not filled in yet."
                : "Plan the week first. Slots marked not needed are intentionally excluded."
            }
            actionLabel="Open plan"
            onAction={() => onNavigate("/")}
          />
        </section>
      ) : (
        <div className="support-layout">
          <section className="support-surface">
            <div className="surface-header">
              <div>
                <p className="eyebrow">Checklist</p>
                <h3>{loading ? "Refreshing shopping list" : "Grouped items"}</h3>
              </div>
              <div className={`status-pill ${loading ? "saving" : ""}`}>{loading ? "Refreshing" : "Ready"}</div>
            </div>

            <div className="shopping-category-list">
              {groupedItems.map((group) => (
                <section key={group.category} className="shopping-group-card">
                  <div className="shopping-group-header">
                    <h4>{group.category}</h4>
                    <span>{group.items.length} items</span>
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

          <aside className="support-surface">
            <div className="surface-header">
              <div>
                <p className="eyebrow">Recipes in play</p>
                <h3>What is driving the list</h3>
              </div>
            </div>

            {recipeTitles.length ? (
              <div className="chip-cloud">
                {recipeTitles.map((title) => (
                  <span key={title} className="chip accent">
                    {title}
                  </span>
                ))}
              </div>
            ) : (
              <div className="inline-empty">No recipes have contributed items yet.</div>
            )}

            {uncategorized.length ? (
              <div className="manual-review-block">
                <span className="group-label">Manual review</span>
                <ul className="detail-list">
                  {uncategorized.map((entry) => (
                    <li key={`${entry.recipeId}-${entry.ingredient}`}>{entry.ingredient}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      )}
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
      <PageHeading
        title="Recipe library"
        eyebrow="Library"
        copy="Treat recipes as a shared asset system for planning, cooking, and shopping."
        actions={
          <button type="button" className="button primary" onClick={() => onNavigate("/import")}>
            Import recipe
          </button>
        }
      />

      <div className="support-layout wide-support-layout">
        <section className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Browse</p>
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
            <div className="recipe-library-grid">
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
              title={recipes.length ? "No recipes match this search" : "No recipes yet"}
              copy={
                recipes.length
                  ? "Try a broader search or import another recipe."
                  : "Import a recipe to begin using the planning board."
              }
              actionLabel="Import recipe"
              onAction={() => onNavigate("/import")}
            />
          )}
        </section>

        <aside className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Preview</p>
              <h3>{selectedRecipe ? selectedRecipe.title : "Selected recipe"}</h3>
            </div>
            {selectedRecipe ? (
              <div className="action-row">
                <button type="button" className="button secondary small" onClick={() => onNavigate(`/recipes/${selectedRecipe.id}`)}>
                  Open
                </button>
                <button type="button" className="button ghost small" onClick={() => onNavigate(`/recipes/${selectedRecipe.id}/edit`)}>
                  Edit
                </button>
              </div>
            ) : null}
          </div>

          {selectedRecipe ? (
            <RecipeDetail recipe={selectedRecipe} />
          ) : (
            <EmptyBlock title="Pick a recipe" copy="Choose a recipe from the library to preview its ingredients and method." />
          )}
        </aside>
      </div>
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
      <PageHeading
        title="Import a recipe"
        eyebrow="Import"
        copy="Paste recipe text, parse it, then review the structured draft before saving."
        actions={
          <button type="button" className="button ghost" onClick={() => onNavigate("/library")}>
            Library
          </button>
        }
      />

      <div className="support-layout wide-support-layout">
        <section className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Step 1</p>
              <h3>Paste source text</h3>
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

        <section className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Step 2</p>
              <h3>Review draft</h3>
            </div>
          </div>

          {draftRecipe ? (
            <DraftForm recipe={draftRecipe} onSubmit={onSaveRecipe} saving={saving} submitLabel="Save recipe" />
          ) : (
            <EmptyBlock title="No draft yet" copy="Run the parser to populate the editable recipe form." />
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
        <PageHeading
          title="Recipe not found"
          eyebrow="Recipe"
          copy="The selected recipe is not available in the local library."
          actions={
            <button type="button" className="button secondary" onClick={() => onNavigate("/library")}>
              Back to library
            </button>
          }
        />
      </section>
    );
  }

  const placements = weekDays
    .map((day) => {
      const slots = Object.entries(mealSlotLabels)
        .filter(([slot]) => getMealSlotRecipeId(plan?.days?.[day.key]?.[slot]) === recipe.id)
        .map(([, label]) => label);
      return slots.length ? { day: day.label, slots } : null;
    })
    .filter(Boolean);

  return (
    <section className="page-stack">
      <PageHeading
        title={recipe.title}
        eyebrow="Recipe"
        copy={recipe.description || "Ingredients and method."}
        actions={
          <>
            <div className="hero-stat">
              <span>Week</span>
              <strong>{formatWeekHeading(currentWeekStart)}</strong>
            </div>
            <button type="button" className="button ghost" onClick={() => onNavigate("/library")}>
              Library
            </button>
            <button type="button" className="button secondary" onClick={() => onNavigate(`/recipes/${recipe.id}/edit`)}>
              Edit
            </button>
          </>
        }
      />

      {placements.length ? (
        <section className="support-surface">
          <div className="surface-header">
            <div>
              <p className="eyebrow">Scheduled this week</p>
              <h3>Current placements</h3>
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

      <section className="support-surface">
        <RecipeDetail recipe={recipe} />
      </section>
    </section>
  );
}

function RecipeEditorPage({ recipe, onNavigate, onSaveRecipe, saving }) {
  if (!recipe) {
    return (
      <section className="page-stack">
        <PageHeading
          title="Recipe not found"
          eyebrow="Edit"
          copy="The recipe you tried to edit is not available in the local library."
          actions={
            <button type="button" className="button secondary" onClick={() => onNavigate("/library")}>
              Back to library
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="page-stack">
      <PageHeading
        title={`Edit ${recipe.title}`}
        eyebrow="Edit"
        copy="Update the saved recipe in the local library."
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

      <section className="support-surface">
        <DraftForm recipe={recipe} onSubmit={onSaveRecipe} saving={saving} submitLabel="Update recipe" />
      </section>
    </section>
  );
}

function RecipeCard({ recipe, active, onSelect, onOpen, onEdit }) {
  return (
    <article className={`recipe-card ${active ? "active" : ""}`}>
      <div className="recipe-card-top">
        <div>
          <strong>{recipe.title}</strong>
          <p className="muted">{recipe.description || getRecipeMeta(recipe)}</p>
        </div>
        <button type="button" className="mini-button" onClick={onSelect}>
          Preview
        </button>
      </div>

      <div className="chip-cloud">
        {recipe.mealTypes.map((mealType) => (
          <span key={mealType} className="chip accent">
            {mealType}
          </span>
        ))}
        {recipe.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="chip">
            {tag}
          </span>
        ))}
      </div>

      <div className="card-footer">
        <span>{getRecipeMeta(recipe)}</span>
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

        <div className="chip-cloud">
          {recipe.servings ? <span className="chip accent">Serves {recipe.servings}</span> : null}
          {recipe.prepTimeMinutes ? <span className="chip">Prep {recipe.prepTimeMinutes} min</span> : null}
          {recipe.cookTimeMinutes ? <span className="chip">Cook {recipe.cookTimeMinutes} min</span> : null}
        </div>
      </div>

      <div className="chip-cloud">
        {recipe.mealTypes.map((mealType) => (
          <span key={mealType} className="chip accent">
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

function PageHeading({ eyebrow, title, copy, actions }) {
  return (
    <section className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{copy}</p>
      </div>

      <div className="action-row">{actions}</div>
    </section>
  );
}

function PlanStatus({ state }) {
  const labels = {
    idle: "Saved",
    queued: "Queued",
    saving: "Saving",
    error: "Error",
  };

  return <span className={`status-pill ${state === "queued" ? "pending" : state === "saving" ? "saving" : state === "error" ? "error" : ""}`}>{labels[state] || labels.idle}</span>;
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

function ConfirmationDialog({ title, copy, confirmLabel, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirmation-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="modal-copy">
          <p className="eyebrow">Confirm</p>
          <h3 id="confirmation-dialog-title">{title}</h3>
          <p className="muted">{copy}</p>
        </div>

        <div className="action-row">
          <button type="button" className="button ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoadingView() {
  return (
    <section className="page-stack">
      <div className="loading-surface">
        <div className="loading-orb" />
        <h3>Loading Meal Atlas</h3>
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
  const response = await fetch(resolveAppUrl(url), options);
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

  if (normalized === "/" || normalized === "/home" || normalized === "/planner") {
    return { name: "plan" };
  }

  if (normalized === "/cook" || normalized === "/today") {
    return { name: "cook" };
  }

  if (normalized === "/shop" || normalized === "/shopping-list") {
    return { name: "shop" };
  }

  if (normalized === "/library") {
    return { name: "library" };
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

  return { name: "plan" };
}

function normalizeRoutePath(pathname) {
  const value = pathname || "/";
  return value.length > 1 && value.endsWith("/") ? value.slice(0, -1) : value;
}

function getAppBasePath() {
  const configuredBasePath =
    typeof window !== "undefined" && typeof window.__MEAL_ATLAS_BASENAME__ === "string" ? window.__MEAL_ATLAS_BASENAME__ : "/";

  return normalizeBasePath(configuredBasePath);
}

function getCurrentAppPath() {
  return stripBasePath(window.location.pathname);
}

function resolveAppUrl(url) {
  if (/^[a-z]+:/i.test(url)) {
    return url;
  }

  return withAppBasePath(url.startsWith("/") ? url : `/${url}`);
}

function withAppBasePath(pathname) {
  const normalizedPath = normalizeRoutePath(pathname);

  if (appBasePath === "/") {
    return normalizedPath;
  }

  return normalizedPath === "/" ? appBasePath : `${appBasePath}${normalizedPath}`;
}

function stripBasePath(pathname) {
  const normalizedPath = normalizeRoutePath(pathname);

  if (appBasePath === "/") {
    return normalizedPath;
  }

  if (normalizedPath === appBasePath) {
    return "/";
  }

  if (normalizedPath.startsWith(`${appBasePath}/`)) {
    return normalizeRoutePath(normalizedPath.slice(appBasePath.length));
  }

  return normalizedPath;
}

function normalizeBasePath(pathname) {
  const normalizedPath = normalizeRoutePath(pathname || "/");

  if (normalizedPath === "" || normalizedPath === "/") {
    return "/";
  }

  return normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
}

function getActiveTask(route) {
  if (route.name === "cook") {
    return "cook";
  }

  if (route.name === "shop") {
    return "shop";
  }

  return "plan";
}

function getTaskRoutePath(route) {
  if (route.name === "cook") {
    return "/cook";
  }

  if (route.name === "shop") {
    return "/shop";
  }

  return "/";
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

  return Object.values(plan.days).reduce(
    (count, day) => count + Object.values(day).filter((slotValue) => isMealSlotCovered(slotValue)).length,
    0,
  );
}

function buildPlanInsights(plan, weekDays, recipeIndex) {
  const totalCount = weekDays.length * mealSlotKeys.length;
  const queue = listOpenMealSlots(plan, weekDays);
  const optionalCount = Object.values(plan?.days || {}).reduce(
    (count, dayPlan) => count + Object.values(dayPlan || {}).filter((slotValue) => !normalizeMealSlot(slotValue).required).length,
    0,
  );
  const assignedRecipes = listPlannedRecipes(plan, recipeIndex);
  const assignedCount = Object.values(plan?.days || {}).reduce(
    (count, dayPlan) =>
      count +
      Object.values(dayPlan || {}).filter((slotValue) => {
        const normalized = normalizeMealSlot(slotValue);
        return normalized.required && Boolean(normalized.recipeId);
      }).length,
    0,
  );
  const coveredCount = countPlannedMeals(plan);

  return {
    totalCount,
    coveredCount,
    coverage: Math.round((coveredCount / (totalCount || 1)) * 100),
    openCount: queue.length,
    optionalCount,
    assignedCount,
    assignedRecipes,
    queue,
  };
}

function listOpenMealSlots(plan, weekDays) {
  return weekDays.flatMap((day) =>
    Object.entries(mealSlotLabels)
      .map(([slot, slotLabel]) => {
        const slotValue = normalizeMealSlot(plan?.days?.[day.key]?.[slot]);

        if (!slotValue.required || slotValue.recipeId) {
          return null;
        }

        return {
          dayKey: day.key,
          dayLabel: day.label,
          slot,
          slotLabel,
        };
      })
      .filter(Boolean),
  );
}

function listPlannedRecipes(plan, recipeIndex) {
  const seen = new Map();

  for (const dayPlan of Object.values(plan?.days || {})) {
    for (const slotValue of Object.values(dayPlan || {})) {
      const recipeId = getMealSlotRecipeId(slotValue);

      if (!recipeId || seen.has(recipeId)) {
        continue;
      }

      const recipe = recipeIndex.get(recipeId);
      if (recipe) {
        seen.set(recipeId, recipe);
      }
    }
  }

  return Array.from(seen.values()).sort((left, right) => left.title.localeCompare(right.title));
}

function flattenPlanSlots(plan, weekDays, recipeIndex) {
  return weekDays.flatMap((day) =>
    Object.entries(mealSlotLabels).map(([slot, slotLabel]) => {
      const slotValue = normalizeMealSlot(plan?.days?.[day.key]?.[slot]);
      const recipe = slotValue.recipeId ? recipeIndex.get(slotValue.recipeId) || null : null;

      return {
        dayKey: day.key,
        dayLabel: day.label,
        slot,
        slotLabel,
        slotValue,
        recipe,
      };
    }),
  );
}

function findPreferredSlot(plan, weekDays, lens, currentSelection) {
  if (currentSelection && plan?.days?.[currentSelection.dayKey]?.[currentSelection.slot]) {
    const currentValue = normalizeMealSlot(plan.days[currentSelection.dayKey][currentSelection.slot]);
    if (slotMatchesLens(currentValue, currentSelection.slot, lens)) {
      return currentSelection;
    }
  }

  const ordered = flattenPlanSlots(plan, weekDays, new Map());
  const matching = ordered.find((entry) => slotMatchesLens(entry.slotValue, entry.slot, lens));

  if (matching) {
    return { dayKey: matching.dayKey, slot: matching.slot };
  }

  const firstOpen = ordered.find((entry) => entry.slotValue.required && !entry.slotValue.recipeId);
  if (firstOpen) {
    return { dayKey: firstOpen.dayKey, slot: firstOpen.slot };
  }

  const firstSlot = ordered[0];
  return firstSlot ? { dayKey: firstSlot.dayKey, slot: firstSlot.slot } : null;
}

function slotMatchesLens(slotValue, slot, lens) {
  const normalized = normalizeMealSlot(slotValue);

  if (lens === "dinnerOpen") {
    return slot === "dinner" && normalized.required && !normalized.recipeId;
  }

  if (lens === "notNeeded") {
    return !normalized.required;
  }

  if (lens === "assigned") {
    return normalized.required && Boolean(normalized.recipeId);
  }

  return normalized.required && !normalized.recipeId;
}

function getLensHeading(lens) {
  if (lens === "dinnerOpen") {
    return "Dinner gaps first";
  }

  if (lens === "notNeeded") {
    return "Intentional skips";
  }

  if (lens === "assigned") {
    return "Recipes already in play";
  }

  return "Open planning decisions";
}

function getLensCopy(lens) {
  if (lens === "dinnerOpen") {
    return "Dinner usually anchors the week, so unresolved dinner slots are highlighted first.";
  }

  if (lens === "notNeeded") {
    return "These slots are covered elsewhere and excluded from the shopping list.";
  }

  if (lens === "assigned") {
    return "Assigned slots stay visible so repeated recipes and balance across the week are easy to spot.";
  }

  return "Every open slot is visible on the board. Select one to assign a recipe or mark it as not needed.";
}

function createApplyDaysState(weekDays, excludedDayKey, predicate = () => false) {
  return Object.fromEntries(
    weekDays.map((day, index) => [day.key, day.key === excludedDayKey ? false : Boolean(predicate(day, index))]),
  );
}

function createExpandedDaysState(weekDays, preferredDayKey = weekDays[0]?.key || null) {
  return Object.fromEntries(weekDays.map((day) => [day.key, day.key === preferredDayKey]));
}

function mergeExpandedDaysState(current, weekDays, preferredDayKey = null) {
  const next = Object.fromEntries(weekDays.map((day) => [day.key, Boolean(current?.[day.key])]));

  if (preferredDayKey && Object.hasOwn(next, preferredDayKey)) {
    next[preferredDayKey] = true;
    return next;
  }

  if (Object.values(next).some(Boolean)) {
    return next;
  }

  if (weekDays[0]) {
    next[weekDays[0].key] = true;
  }

  return next;
}

function groupRecipesForInspector(recipes, slot, search) {
  const visible = recipes.filter((recipe) => matchesRecipeSearch(recipe, search));
  return {
    matches: visible.filter((recipe) => recipeMatchesSlot(recipe, slot)),
  };
}

function listUpcomingCookItems(plan, weekDays, recipeIndex, startDayKey) {
  const flattened = flattenPlanSlots(plan, weekDays, recipeIndex)
    .filter((entry) => !entry.slotValue.required || entry.recipe)
    .sort((left, right) => {
      const leftOrder = weekDays.findIndex((day) => day.key === left.dayKey) * mealSlotKeys.length + mealSlotKeys.indexOf(left.slot);
      const rightOrder = weekDays.findIndex((day) => day.key === right.dayKey) * mealSlotKeys.length + mealSlotKeys.indexOf(right.slot);
      return leftOrder - rightOrder;
    });

  const startIndex = flattened.findIndex((entry) => entry.dayKey >= startDayKey);
  return startIndex >= 0 ? flattened.slice(startIndex) : flattened;
}

function getSlotTone(slotValue) {
  const normalized = normalizeMealSlot(slotValue);

  if (!normalized.required) {
    return "not-needed";
  }

  if (normalized.recipeId) {
    return "assigned";
  }

  return "open";
}

function getRecipeMeta(recipe) {
  const details = [];

  if (recipe.mealTypes?.length) {
    details.push(recipe.mealTypes[0]);
  }

  if (recipe.prepTimeMinutes) {
    details.push(`${recipe.prepTimeMinutes} min prep`);
  }

  if (recipe.ingredients?.length) {
    details.push(`${recipe.ingredients.length} ingredients`);
  }

  return details.join(" · ") || "Saved recipe";
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

function formatLongDayLabel(isoDate) {
  const date = parseIsoDate(isoDate);
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(date);
}

function buildFallbackShoppingList(plan, recipeIndex) {
  const grouped = new Map();
  const recipeTitles = new Set();

  for (const dayPlan of Object.values(plan?.days || {})) {
    for (const slotValue of Object.values(dayPlan || {})) {
      const recipeId = getMealSlotRecipeId(slotValue);

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
        category: entry.category,
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

function createEmptyDayPlan() {
  return Object.fromEntries(mealSlotKeys.map((slot) => [slot, { recipeId: null, required: true }]));
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

function getMealSlotRecipeId(slotValue) {
  const normalized = normalizeMealSlot(slotValue);
  return normalized.required ? normalized.recipeId : null;
}

function isMealSlotCovered(slotValue) {
  const normalized = normalizeMealSlot(slotValue);
  return !normalized.required || Boolean(normalized.recipeId);
}

function recipeMatchesSlot(recipe, slot) {
  const preferredTypes = {
    breakfast: ["breakfast"],
    snackAm: ["snack"],
    lunch: ["lunch"],
    snackPm: ["snack"],
    dinner: ["dinner"],
    dessert: ["dessert"],
  };

  return preferredTypes[slot]?.some((mealType) => recipe.mealTypes.includes(mealType)) || false;
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
  const stringValue = String(value || "").trim();
  return stringValue ? Number(stringValue) : null;
}
