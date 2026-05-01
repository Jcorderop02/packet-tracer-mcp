import { describe, expect, test } from "bun:test";
import { previewWifiLan, wifiLan } from "../src/recipes/topologies/wifi_lan.js";

describe("wifiLan recipe", () => {
  test("rejects invalid client counts", () => {
    expect(() => wifiLan({ clients: 0 })).toThrow(/at least 1/);
    expect(() => wifiLan({ clients: 13 })).toThrow(/caps at 12/);
  });

  test("builds router + AP + N wireless clients", () => {
    const bp = wifiLan({ clients: 2, ssid: "LAB", psk: "secret123", channel: 6 });
    expect(bp.devices.map(d => d.name)).toEqual(["WGW", "AP1", "WCLIENT1", "WCLIENT2"]);
    expect(bp.links).toEqual([
      {
        aDevice: "WGW",
        aPort: "GigabitEthernet0/0",
        bDevice: "AP1",
        bPort: "Port 0",
        cable: "straight",
      },
    ]);
  });

  test("configures router LAN DHCP and wireless intents", () => {
    const bp = wifiLan({ clients: 2, ssid: "LAB", psk: "secret123" });
    expect(bp.lans).toEqual([
      {
        gatewayDevice: "WGW",
        gatewayPort: "GigabitEthernet0/0",
        endpoints: [],
        cidr: "192.168.0.0/24",
        dhcp: true,
      },
    ]);
    expect(bp.wireless?.aps?.[0]).toMatchObject({
      device: "AP1",
      ssid: "LAB",
      security: "wpa2-psk",
      psk: "secret123",
    });
    expect(bp.wireless?.clients?.map(c => c.device)).toEqual(["WCLIENT1", "WCLIENT2"]);
    expect(bp.wireless?.clients?.every(c => c.dhcp === true)).toBe(true);
  });

  test("open security omits PSK", () => {
    const bp = wifiLan({ clients: 1, security: "open" });
    expect(bp.wireless?.aps?.[0]?.security).toBe("open");
    expect(bp.wireless?.aps?.[0]?.psk).toBeUndefined();
    expect(bp.wireless?.clients?.[0]?.psk).toBeUndefined();
  });

  test("preview agrees with deterministic allocation", () => {
    expect(previewWifiLan({ clients: 1, lanPool: "10.44.0.0/16" })).toEqual({
      network: "10.44.0.0/24",
      gateway: "10.44.0.1",
      mask: "255.255.255.0",
    });
  });
});
