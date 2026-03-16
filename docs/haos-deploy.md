# Meal Atlas on Home Assistant OS

## What this version does

- Runs the meal planner as a local Home Assistant add-on
- Stores data on the Home Assistant box
- Exposes the app through Home Assistant ingress
- Supports recipe import, recipe browsing, and weekly planning

## Install on HAOS

1. Copy this repository to a machine you can access from Home Assistant.
2. In Home Assistant, add this repository as a local add-on repository.
3. Build and install the `Meal Atlas` add-on.
4. Start the add-on.
5. Click `OPEN WEB UI` from the add-on page, or use the `Meal Atlas` sidebar entry in Home Assistant.

## Data location

The add-on writes data to:

- `/data/meal-atlas/recipes.json`
- `/data/meal-atlas/meal-plans.json`

## Development

Run locally:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3210
```
