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
