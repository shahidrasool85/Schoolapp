import QRCode from "qrcode";

/** Encode a public form URL as SVG. Never pass secrets or applicant data. */
export async function qrSvg(value: string): Promise<string> {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    throw new Error("QR payload must be an http(s) URL");
  }
  return QRCode.toString(value, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 256,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
