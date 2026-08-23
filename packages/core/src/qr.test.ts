import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr.js";

describe("qrSvg", () => {
  it("encodes only an http(s) public URL as SVG", async () => {
    const svg = await qrSvg("https://greenwood.localhost/admissions/enquiry/year-3-enquiry");
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("secret");
    await expect(qrSvg("not-a-url")).rejects.toThrow(/http/);
  });
});
