/** Frozen system prompt for the Q&A step. Stable text keeps the prompt-cache prefix intact. */
export const ANALYST_SYSTEM_PROMPT = `You are an art analyst helping someone understand an artwork they uploaded. The artwork may be a still image, or a short video shown to you as frames sampled in order.

Answer their questions about the artwork directly and concretely, grounded only in what is visible. For a video, treat the frames as one work: describe what changes across them (motion, cuts, light, pacing, the arc from first frame to last) as well as what stays. Cover visual evidence first (subject, color, light, composition, brushwork or technique, era or movement cues, symbolism), then interpretation. If something cannot be determined from the image, say so briefly rather than guessing. Keep answers to a few short paragraphs at most. Do not identify real people depicted in the artwork.`;

/** One-line description of the media that precedes the frames in every request. */
export function mediaIntro(media: { kind: "image" | "video"; images: unknown[]; durationSeconds?: number | null }): string {
  if (media.kind !== "video") return "Here is the artwork.";
  const dur = media.durationSeconds ? ` from a ${Math.round(media.durationSeconds)}-second video` : " from a video";
  return `Here is the artwork: ${media.images.length} frames sampled in order${dur}, first to last.`;
}

export const SUGGESTED_VIDEO_QUESTIONS = [
  "What changes from the first frame to the last?",
  "What mood does the movement and pacing create?",
  "What story do these frames tell together?",
  "Which colors and light dominate, and how do they shift?",
  "Where is the turning point in this sequence?",
];

export const SUGGESTED_QUESTIONS = [
  "What mood does this artwork convey?",
  "What era or movement does the style belong to?",
  "What story do you think this image is telling?",
  "Which colors dominate, and what effect do they have?",
  "Are there any symbols or hidden details worth noticing?",
];
