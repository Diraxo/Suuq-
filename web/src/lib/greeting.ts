// Which home.greeting* translation key fits the hour of day (device local time).
// Copied from lib/greeting.ts on mobile — keep the two identical.
export type GreetingKey =
  | 'home.greeting'
  | 'home.greetingAfternoon'
  | 'home.greetingEvening'
  | 'home.greetingNight';

export function greetingKey(date: Date = new Date()): GreetingKey {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'home.greeting';
  if (h >= 12 && h < 17) return 'home.greetingAfternoon';
  if (h >= 17 && h < 21) return 'home.greetingEvening';
  return 'home.greetingNight';
}
