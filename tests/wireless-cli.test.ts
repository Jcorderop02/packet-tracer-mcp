import { describe, expect, test } from "bun:test";
import {
  apSummary,
  clientSummary,
  standardChannel,
  validateApSsid,
  validateClientAssociation,
  WIRELESS_ENCRYPT,
} from "../src/recipes/wireless/cli.js";

describe("wireless helpers", () => {
  test("maps PT wireless encryption enum values", () => {
    expect(WIRELESS_ENCRYPT.open).toBe(0);
    expect(WIRELESS_ENCRYPT["wpa2-psk"]).toBe(4);
  });

  test("standardChannel converts human channel to PT zero-based enum", () => {
    expect(standardChannel(1)).toBe(0);
    expect(standardChannel(11)).toBe(10);
    expect(() => standardChannel(0)).toThrow(/1\.\.11/);
  });

  test("AP WPA2 requires a PSK", () => {
    expect(() => validateApSsid({ device: "AP1", ssid: "LAB", security: "wpa2-psk" })).toThrow(/psk/);
  });

  test("open AP rejects a PSK", () => {
    expect(() => validateApSsid({ device: "AP1", ssid: "LAB", security: "open", psk: "secret" })).toThrow(/open/);
  });

  test("client association requires SSID", () => {
    expect(() => validateClientAssociation({ device: "STA1", ssid: "" })).toThrow(/SSID/);
  });

  test("summaries are stable", () => {
    expect(apSummary({ device: "AP1", ssid: "LAB", security: "wpa2-psk", psk: "secret", channel: 6 })).toBe(
      "ssid=LAB security=wpa2-psk channel=6",
    );
    expect(clientSummary({ device: "STA1", ssid: "LAB" })).toBe("ssid=LAB dhcp");
  });
});
