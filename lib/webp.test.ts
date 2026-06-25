import { describe, expect, it } from "vitest";

import { readWebpDimensions } from "./webp";

describe("readWebpDimensions", () => {
  it("reads VP8X dimensions", () => {
    const bytes = new Uint8Array(30);
    bytes.set([...Buffer.from("RIFF")], 0);
    bytes.set([...Buffer.from("WEBP")], 8);
    bytes.set([...Buffer.from("VP8X")], 12);
    bytes.set([0xff, 0x02, 0x00], 24);
    bytes.set([0xdf, 0x01, 0x00], 27);
    expect(readWebpDimensions(bytes)).toEqual({ width: 768, height: 480 });
  });

  it("rejects files without a WebP signature", () => {
    expect(readWebpDimensions(new Uint8Array(30))).toBeNull();
  });
});
