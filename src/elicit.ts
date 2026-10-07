// Forms the MCP server shows the rider through elicitation, and how their
// answers become decisions. Pure functions: the server sends and receives.
import type { ReviewDecision, RideReview } from "./feedback.ts";

/** A flat form, as MCP elicitation takes it: primitive fields only. */
export interface ElicitForm {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<
      string,
      | { type: "integer"; title: string; description?: string; minimum: number; maximum: number; default?: number }
      | { type: "boolean"; title: string; description?: string; default: boolean }
    >;
    required?: string[];
  };
}

/** One rating field and one dismiss box per placed note, the proposal filled in. Null when nothing to ask. */
export function reviewForm(review: RideReview): ElicitForm | null {
  const placed = review.notes.filter((n) => n.placement);
  if (!placed.length) return null;
  const properties: ElicitForm["requestedSchema"]["properties"] = {};
  for (const { note, placement } of placed) {
    const where = `${placement!.road}, ${placement!.from} to ${placement!.to}${placement!.approximate ? " (approximate)" : ""}`;
    properties[`rating_${note.id}`] = {
      type: "integer",
      title: `"${note.text}" (${placement!.window})`,
      description: `${where}. 0 never again, 5 loved.`,
      minimum: 0,
      maximum: 5,
      ...(placement!.proposedRating === null ? {} : { default: placement!.proposedRating }),
    };
    properties[`dismiss_${note.id}`] = {
      type: "boolean",
      title: `Dismiss "${note.text}"`,
      description: "Drop this note without rating the road",
      default: false,
    };
  }
  return {
    message: `Rate the roads of roadbook #${review.ride.id} "${review.ride.name}" from your notes. Ratings steer later plans: 0-1 avoided, 4-5 sought out.`,
    requestedSchema: { type: "object", properties },
  };
}

/** The rider's answers as review decisions; a note left without a rating is skipped, not guessed. */
export function reviewDecisions(review: RideReview, content: Record<string, unknown>): ReviewDecision[] {
  return review.notes.flatMap(({ note, placement }): ReviewDecision[] => {
    if (!placement) return [];
    if (content[`dismiss_${note.id}`] === true) return [{ noteId: note.id, dismiss: true }];
    const rating = content[`rating_${note.id}`];
    return typeof rating === "number" && Number.isInteger(rating) ? [{ noteId: note.id, rating }] : [];
  });
}

/** The question asked before saving a ride that repeats a saved one. */
export function duplicateForm(reason: string): ElicitForm {
  return {
    message: `${reason}\nSave it anyway as a separate ride?`,
    requestedSchema: {
      type: "object",
      properties: { save: { type: "boolean", title: "Save a copy anyway", default: false } },
      required: ["save"],
    },
  };
}
