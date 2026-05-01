import { describe, expect, test } from "bun:test";
import {
  accessPortCli,
  etherChannelCli,
  portSecurityCli,
  trunkPortCli,
  vlanCreateCli,
  wrapInConfig,
} from "../src/recipes/switching/cli.js";

describe("vlanCreateCli", () => {
  test("creates a VLAN without a name", () => {
    expect(vlanCreateCli({ switch: "SW", id: 10 })).toBe(
      ["vlan 10", " exit"].join("\n"),
    );
  });

  test("includes a sanitised name when present", () => {
    expect(vlanCreateCli({ switch: "SW", id: 20, name: "Sales Team" })).toBe(
      ["vlan 20", " name Sales_Team", " exit"].join("\n"),
    );
  });
});

describe("accessPortCli", () => {
  test("emits switchport access vlan + no shutdown", () => {
    expect(accessPortCli("FastEthernet0/3", 30)).toBe(
      [
        "interface FastEthernet0/3",
        " switchport mode access",
        " switchport access vlan 30",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });
});

describe("trunkPortCli", () => {
  test("dot1q with allowed list and native VLAN on 3560", () => {
    const cli = trunkPortCli({
      switch: "SW",
      switchModel: "3560-24PS",
      port: "GigabitEthernet0/1",
      encapsulation: "dot1q",
      allowed: [30, 10, 20],
      native: 99,
    });
    expect(cli).toBe(
      [
        "interface GigabitEthernet0/1",
        " switchport trunk encapsulation dot1q",
        " switchport mode trunk",
        " switchport trunk allowed vlan 10,20,30",
        " switchport trunk native vlan 99",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("omits explicit trunk encapsulation on 2960", () => {
    const cli = trunkPortCli({
      switch: "SW",
      switchModel: "2960-24TT",
      port: "GigabitEthernet0/1",
      encapsulation: "dot1q",
      allowed: [10, 20],
    });

    expect(cli).toBe(
      [
        "interface GigabitEthernet0/1",
        " switchport mode trunk",
        " switchport trunk allowed vlan 10,20",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("omits explicit trunk encapsulation on 3650", () => {
    expect(
      trunkPortCli({
        switch: "SW",
        switchModel: "3650-24PS",
        port: "Gi1/0/1",
        encapsulation: "dot1q",
      }),
    ).not.toContain("switchport trunk encapsulation");
  });

  test("3650 multilayer emits the full 3-line trunk in running-config order (regression-guard for F2-MULTILAYER-VLAN-NATIVE)", () => {
    // Smoke 2026-05-01_114559 PASS confirmó que el path CLI puro renderiza
    // las 3 líneas (`mode trunk` + `allowed vlan` + `native vlan`) en el
    // running-config del 3650, mientras que la API nativa
    // (`addTrunkVlans` + `setNativeVlanId`) omitía la línea allowed.
    // Este test fija el contrato CLI sin requerir PT abierto.
    const cli = trunkPortCli({
      switch: "SW",
      switchModel: "3650-24PS",
      port: "GigabitEthernet1/0/24",
      allowed: [40, 30],
      native: 99,
    });
    expect(cli).toBe(
      [
        "interface GigabitEthernet1/0/24",
        " switchport mode trunk",
        " switchport trunk allowed vlan 30,40",
        " switchport trunk native vlan 99",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("omits explicit trunk encapsulation on IE-3400 / IE-9320 (IOS XE parser stub)", () => {
    // PT 9's IOS XE parser drops the `encapsulation` verb — verified
    // 2026-05-01 via scripts/probe-encapsulation-parser.ts.
    for (const switchModel of ["IE-3400", "IE-9320"]) {
      const cli = trunkPortCli({
        switch: "SW",
        switchModel,
        port: "GigabitEthernet1/1",
        encapsulation: "dot1q",
      });
      expect(cli).not.toContain("switchport trunk encapsulation");
      expect(cli).toContain(" switchport mode trunk");
    }
  });

  test("omits encapsulation, allowed and native when not provided", () => {
    expect(trunkPortCli({ switch: "SW", port: "Gi0/1" })).toBe(
      [
        "interface Gi0/1",
        " switchport mode trunk",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });
});

describe("portSecurityCli", () => {
  test("renders maxMac, sticky and violation", () => {
    const cli = portSecurityCli({
      switch: "SW",
      port: "FastEthernet0/2",
      maxMac: 2,
      sticky: true,
      violation: "restrict",
    });
    expect(cli).toBe(
      [
        "interface FastEthernet0/2",
        " switchport mode access",
        " switchport port-security",
        " switchport port-security maximum 2",
        " switchport port-security mac-address sticky",
        " switchport port-security violation restrict",
        " exit",
      ].join("\n"),
    );
  });

  test("emits the basic enable line when only the rule itself is requested", () => {
    expect(portSecurityCli({ switch: "SW", port: "Fa0/2" })).toBe(
      [
        "interface Fa0/2",
        " switchport mode access",
        " switchport port-security",
        " exit",
      ].join("\n"),
    );
  });
});

describe("etherChannelCli", () => {
  test("groups members under interface range", () => {
    expect(
      etherChannelCli({
        switch: "SW",
        ports: ["Fa0/1", "Fa0/2", "Fa0/3"],
        group: 1,
        mode: "active",
      }),
    ).toBe(
      [
        "interface range Fa0/1,Fa0/2,Fa0/3",
        " channel-group 1 mode active",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("defaults mode to 'on'", () => {
    expect(etherChannelCli({ switch: "SW", ports: ["Fa0/1", "Fa0/2"], group: 2 })).toContain(
      "channel-group 2 mode on",
    );
  });

  test("rejects fewer than 2 member ports", () => {
    expect(() =>
      etherChannelCli({ switch: "SW", ports: ["Fa0/1"], group: 1 }),
    ).toThrow(/at least 2/);
  });

  test("throws transparent error on IE-9320 (parser stub drops channel-group)", () => {
    expect(() =>
      etherChannelCli({
        switch: "SW",
        ports: ["GigabitEthernet1/27", "GigabitEthernet1/28"],
        group: 1,
        mode: "active",
        switchModel: "IE-9320",
      }),
    ).toThrow(/not supported.*IE-9320.*IOS XE parser stub/i);
  });

  test("does not gate models that accept channel-group (3650/IE-3400/3560)", () => {
    for (const model of ["3560-24PS", "3650-24PS", "IE-3400"]) {
      expect(() =>
        etherChannelCli({
          switch: "SW",
          ports: ["Gi1/0/23", "Gi1/0/24"],
          group: 1,
          mode: "active",
          switchModel: model,
        }),
      ).not.toThrow();
    }
  });

  test("does not gate when switchModel is omitted (trust by default)", () => {
    expect(() =>
      etherChannelCli({
        switch: "SW",
        ports: ["Fa0/1", "Fa0/2"],
        group: 1,
      }),
    ).not.toThrow();
  });
});

describe("wrapInConfig", () => {
  test("wraps the body in enable + configure terminal + end", () => {
    expect(wrapInConfig("vlan 10\n exit")).toBe(
      "enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\nvlan 10\n exit\nend",
    );
  });
});
