// Shared pt-BR date formatting for the staff area — documents' upload dates and events'
// start times both need the same "how does a date read to a Brazilian church secretary"
// treatment, so it lives here once instead of being reimplemented per page.
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(date: Date): string {
  return DATE_TIME_FORMATTER.format(date);
}

// Shared USD-cost formatter for the staff area (M7): both `/staff/uso` and the staff hub tile
// show the same underlying total (month-to-date AI spend), and used to format it with two
// different precisions (`.toFixed(4)` vs `.toFixed(2)`) — one function, used in both places,
// so they can't drift again. Four decimals, not two: these amounts are fractions of a cent per
// call, and two decimals would print "US$ 0.00" for almost every row.
export function formatUsd4(value: number): string {
  return `US$ ${value.toFixed(4)}`;
}
