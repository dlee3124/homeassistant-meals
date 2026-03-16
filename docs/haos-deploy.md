# Meal Atlas on Home Assistant OS

## What this version does

- Runs the meal planner as a local Home Assistant add-on
- Stores data on the Home Assistant box
- Exposes the app on port `3210`
- Supports recipe import, recipe browsing, and weekly planning

## Install on HAOS

1. Copy this repository to a machine you can access from Home Assistant.
2. In Home Assistant, add this repository as a local add-on repository.
3. Build and install the `Meal Atlas` add-on.
4. Start the add-on.
5. Open `http://homeassistant.local:3210` on your local network.

## Embed in Home Assistant

For the first version, the simplest approach is to embed the local app as an iframe panel.

Add this to your Home Assistant `configuration.yaml`:

```yaml
panel_iframe:
  meal_atlas:
    title: Meal Atlas
    icon: mdi:silverware-fork-knife
    url: http://homeassistant.local:3210
```

Then restart Home Assistant.

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
