import multer from "multer";
import { MAX_UPLOAD_BYTES } from "@artlyrics/shared";

/** Memory storage: the file is validated and re-encoded by sharp before hitting disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});
