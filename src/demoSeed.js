import { createEvent, createOrganizer } from "./db.js";

// Fictional showcase events, recreated for each ephemeral portfolio-demo session.
// The demo organizer has no login account, so visitors cannot delete these events.
export const demoEvents = [
  {
    title: "React & TypeScript Community Night",
    location: "Dortmund, Germany",
    startsAt: "2026-12-17T17:00:00Z",
    imageTheme: "tech",
    description: "An evening for frontend developers to share practical insights, discuss reusable React components and exchange lessons from real TypeScript projects.",
  },
  {
    title: "Indie Game Dev & Play Night",
    location: "Bochum, Germany",
    startsAt: "2027-01-14T17:00:00Z",
    imageTheme: "gaming",
    description: "Discover fresh indie game ideas, try playable prototypes and meet people who love gameplay, storytelling and creative problem-solving.",
  },
  {
    title: "Creative Coding Workshop",
    location: "Essen, Germany",
    startsAt: "2027-01-28T17:00:00Z",
    imageTheme: "workshop",
    description: "Build small interactive web experiences together. Explore animation, APIs and creative coding techniques in a hands-on workshop for curious developers.",
  },
];

export function seedDemoEvents(db) {
  db.exec("BEGIN");
  try {
    const organizerName = "Evendule Demo";
    let organizer = db.prepare("SELECT id FROM organizers WHERE name = ?").get(organizerName);
    if (!organizer) organizer = createOrganizer(db, { name: organizerName });

    let created = 0;
    const exists = db.prepare("SELECT id FROM events WHERE organizer_id = ? AND title = ?");
    for (const sample of demoEvents) {
      if (exists.get(organizer.id, sample.title)) continue;
      createEvent(db, { organizerId: organizer.id, ...sample });
      created += 1;
    }
    db.exec("COMMIT");
    return created;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
