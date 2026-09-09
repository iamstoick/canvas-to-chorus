import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod/v4";
import { HttpError } from "../lib/errors.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") },
    });
    return;
  }
  if (err instanceof multer.MulterError) {
    const code = err.code === "LIMIT_FILE_SIZE" ? "file_too_large" : "upload_error";
    const message = err.code === "LIMIT_FILE_SIZE" ? "That image is larger than 10 MB. Please use a smaller file." : err.message;
    res.status(400).json({ error: { code, message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal_error", message: "Something went wrong." } });
};
