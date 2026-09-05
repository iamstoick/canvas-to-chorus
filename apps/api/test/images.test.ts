import "./setup.js";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { normalizeUpload, toModelImage } from "../src/services/images.js";
import { HttpError } from "../src/lib/errors.js";

async function png(w = 64, h = 48) {
  return sharp({ create: { width: w, height: h, channels: 3, background: "#4060a0" } }).png().toBuffer();
}

describe("normalizeUpload", () => {
  it("accepts a PNG and reports dimensions", async () => {
    const out = await normalizeUpload(await png());
    expect(out.mimeType).toBe("image/png");
    expect(out.ext).toBe("png");
    expect(out.width).toBe(64);
    expect(out.height).toBe(48);
  });

  it("detects type by magic bytes, not by claimed extension", async () => {
    const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).jpeg().toBuffer();
    const out = await normalizeUpload(jpeg);
    expect(out.mimeType).toBe("image/jpeg");
  });

  it("rejects non-image bytes with 400 unsupported_type", async () => {
    await expect(normalizeUpload(Buffer.from("hello world, definitely not an image"))).rejects.toMatchObject({
      status: 400,
      code: "unsupported_type",
    } satisfies Partial<HttpError>);
  });

  it("rejects SVG", async () => {
    const svg = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    await expect(normalizeUpload(svg)).rejects.toMatchObject({ code: "unsupported_type" });
  });

  it("strips metadata on re-encode", async () => {
    const withExif = await sharp(await png()).withMetadata({ exif: { IFD0: { Copyright: "secret" } } }).jpeg().toBuffer();
    const out = await normalizeUpload(withExif);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
  });
});

describe("toModelImage", () => {
  it("downscales to at most 1568px on the longest edge and returns JPEG base64", async () => {
    const big = await png(3000, 1500);
    const out = await toModelImage(big);
    expect(out.mediaType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1568);
  });

  it("does not upscale small images", async () => {
    const out = await toModelImage(await png(64, 48));
    const meta = await sharp(Buffer.from(out.data, "base64")).metadata();
    expect(meta.width).toBe(64);
  });
});
