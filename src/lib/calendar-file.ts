import { Platform } from 'react-native';

/** Web: download an .ics so the phone or computer offers to add it to the calendar. Does nothing elsewhere. */
export function downloadCalendar(ics: string, filename: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
