/** "Good evening, Jayden." by the hour of `now` (local time). */
export function greeting(now: Date, name: string): string {
  const hour = now.getHours()
  const part =
    hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening'
  return name ? `Good ${part}, ${name}.` : `Good ${part}.`
}

/**
 * What to call the signed-in person: the first word of their name, else the part of their email
 * before the @ (also when the "name" is just the email, as it is for an account made with only one).
 */
export function firstName(name: string, email: string): string {
  const first = name.trim().split(/\s+/)[0] ?? ''
  if (first && !first.includes('@')) return first
  const address = first || email
  return address.split('@')[0] ?? ''
}
