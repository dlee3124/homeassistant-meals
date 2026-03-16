const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function getWeekStartMonday(dateInput) {
  const date = parseIsoDate(dateInput);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  date.setDate(date.getDate() + diff);
  return toIsoDate(date);
}

export function listWeekDates(weekStart) {
  const start = parseIsoDate(weekStart);

  return dayNames.map((dayName, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    return {
      key: toIsoDate(date),
      label: dayName,
      shortLabel: dayName.slice(0, 3),
    };
  });
}

export function getCurrentWeekStart() {
  return getWeekStartMonday(toIsoDate(new Date()));
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
