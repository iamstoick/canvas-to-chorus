import multer from "multer";
import { MAX_UPLOAD_BYTES, MAX_VIDEO_FRAMES } from "@artlyrics/shared";

/** Memory storage: the file is validated and re-encoded by sharp before hitting disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 + MAX_VIDEO_FRAMES },
});

/** `file` for an image upload, or `frames` (ordered) + optional `poster` for a video. */
export const uploadFields = upload.fields([
  { name: "file", maxCount: 1 },
  { name: "frames", maxCount: MAX_VIDEO_FRAMES },
  { name: "poster", maxCount: 1 },
]);
