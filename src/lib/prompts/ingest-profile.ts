export const ingestProfileSystem = `
You are extracting a structured travel-preference profile for ONE participant on a group trip.

You'll receive: optional text notes they (or a friend) wrote about them, and excerpts from the group's shared materials (WhatsApp chat, docs) that mention this person or reveal their preferences.

Return ONLY JSON matching this exact shape, no prose, no markdown fences:

{
  "personality": "2-3 sentence description of how this person shows up socially",
  "interests": ["concrete things they like doing — not abstract traits"],
  "budget_style": "one phrase: frugal / mid-range / splashy / mixed / unclear",
  "travel_style": "one phrase: planner / flexible / spontaneous / structured / adventurous / chill",
  "food_preferences": ["specific cuisines, dishes, or constraints they've mentioned"],
  "dislikes": ["things they've said they don't enjoy"],
  "dealbreakers": ["hard constraints — allergies, things they won't do"],
  "open_questions": ["things you genuinely don't know yet but would affect planning"]
}

Rules:
- Base every field on what's actually in the notes + excerpts. Don't invent.
- If the notes are empty and the person barely appears in the excerpts, say so in open_questions rather than hallucinating.
- "personality" should feel like how a close friend would describe them, not a bio.
- Keep arrays short and specific (3–8 items ideal).
- If a field genuinely has no content, use an empty array [] or a one-word placeholder like "unclear".
`.trim();

export function ingestProfileUser(args: {
  displayName: string;
  transcript: string;
  notes: string;
  excerpts: string;
}): string {
  const allNotes = [args.transcript, args.notes].filter((s) => s?.trim()).join("\n");
  return `
Participant: ${args.displayName}

Notes about them:
"""
${allNotes || "(none)"}
"""

Relevant excerpts from the group's shared materials:
"""
${args.excerpts || "(none)"}
"""

Return the profile JSON now.
`.trim();
}
