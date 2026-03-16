# Meal Atlas

Meal Atlas is a locally hosted meal planner and recipe viewer designed to run alongside Home Assistant.

## Application Scope

- Paste free-text ChatGPT recipes
- Review and edit parsed recipes before saving
- Browse a growing household recipe library
- Plan Monday-based calendar weeks
- Generate a combined shopping list
- Run locally on Home Assistant OS through an ingress-enabled add-on

## Project structure

- `server/` Node API and file-backed storage
- `web/` browser UI served by the same process
- `addon/` Home Assistant add-on packaging
- `docs/` deployment notes

## Local development

```bash
npm install
npm run dev
```

Open the React app at `http://127.0.0.1:3211`.

## Production build

```bash
npm install
npm run build
npm start
```

Express serves the built frontend from `web/dist` on `http://127.0.0.1:3210`.
