import { describe, expect, test } from "bun:test";
import {
  cmeCli,
  ephoneCli,
  ephoneDnCli,
  routerVoipBody,
  switchVoipBody,
  validateCme,
  validateEphone,
  validateEphoneDn,
  validateVoiceVlan,
  voiceVlanCli,
  wrapInConfig,
} from "../src/recipes/voip/cli.js";
import { dhcpPoolCli } from "../src/recipes/services/cli.js";

describe("voip cme/ephone CLI", () => {
  test("cmeCli emits telephony-service block with sane defaults", () => {
    const cli = cmeCli({
      device: "CME",
      maxEphones: 10,
      maxDn: 24,
      sourceIp: "10.0.0.1",
    });
    expect(cli).toContain("telephony-service");
    expect(cli).toContain(" max-ephones 10");
    expect(cli).toContain(" max-dn 24");
    expect(cli).toContain(" ip source-address 10.0.0.1 port 2000");
    expect(cli.endsWith(" exit")).toBe(true);
  });

  test("cmeCli respects custom port, autoAssign, systemMessage", () => {
    const cli = cmeCli({
      device: "CME",
      maxEphones: 4,
      maxDn: 4,
      sourceIp: "192.168.10.1",
      sourcePort: 2050,
      autoAssign: { first: 1, last: 4 },
      systemMessage: "Lab",
    });
    expect(cli).toContain(" ip source-address 192.168.10.1 port 2050");
    expect(cli).toContain(" auto assign 1 to 4");
    expect(cli).toContain(" system message Lab");
  });

  test("ephoneDnCli emits number and optional name", () => {
    expect(ephoneDnCli({ device: "CME", dnTag: 1, number: "1001" })).toBe(
      ["ephone-dn 1", " number 1001", " exit"].join("\n"),
    );
    expect(ephoneDnCli({ device: "CME", dnTag: 2, number: "1002", name: "Alice" })).toContain(" name Alice");
  });

  test("ephoneCli defaults to type 7960 and uses 1:1 button mapping", () => {
    const cli = ephoneCli({ device: "CME", ephoneNumber: 1, mac: "0001.4321.ABCD", buttons: [1] });
    expect(cli).toContain("ephone 1");
    expect(cli).toContain(" mac-address 0001.4321.ABCD");
    expect(cli).toContain(" type 7960");
    expect(cli).toContain(" button 1:1");
  });

  test("ephoneCli supports explicit button:dnTag pairs", () => {
    const cli = ephoneCli({
      device: "CME",
      ephoneNumber: 2,
      mac: "0010.AAAA.BBBB",
      type: "7970",
      buttons: [{ button: 1, dnTag: 5 }, { button: 2, dnTag: 6 }],
    });
    expect(cli).toContain(" type 7970");
    expect(cli).toContain(" button 1:5 2:6");
  });

  test("voiceVlanCli emits voice + data + qos trust by default", () => {
    const cli = voiceVlanCli({ switch: "SW", port: "FastEthernet0/1", voiceVlanId: 100, dataVlanId: 10 });
    expect(cli).toContain("interface FastEthernet0/1");
    expect(cli).toContain(" switchport mode access");
    expect(cli).toContain(" switchport access vlan 10");
    expect(cli).toContain(" switchport voice vlan 100");
    expect(cli).toContain(" mls qos trust device cisco-phone");
    expect(cli).toContain(" spanning-tree portfast");
  });

  test("voiceVlanCli omits qos trust when trustCiscoPhone is false", () => {
    const cli = voiceVlanCli({ switch: "SW", port: "Fa0/2", voiceVlanId: 100, trustCiscoPhone: false });
    expect(cli).not.toContain("mls qos trust");
  });

  test("routerVoipBody chains cme + dns + phones", () => {
    const body = routerVoipBody(
      [{ device: "CME", maxEphones: 2, maxDn: 2, sourceIp: "10.0.0.1" }],
      [{ device: "CME", dnTag: 1, number: "1001" }],
      [{ device: "CME", ephoneNumber: 1, mac: "0001.AAAA.BBBB", buttons: [1] }],
    );
    const lines = body.split("\n");
    expect(lines[0]).toBe("telephony-service");
    expect(body.indexOf("telephony-service")).toBeLessThan(body.indexOf("ephone-dn 1"));
    expect(body.indexOf("ephone-dn 1")).toBeLessThan(body.indexOf("ephone 1"));
  });

  test("switchVoipBody concatenates per-port blocks", () => {
    const body = switchVoipBody([
      { switch: "SW", port: "Fa0/1", voiceVlanId: 100, dataVlanId: 10 },
      { switch: "SW", port: "Fa0/2", voiceVlanId: 100, dataVlanId: 10 },
    ]);
    expect(body.match(/interface Fa0\/1/g)).toHaveLength(1);
    expect(body.match(/interface Fa0\/2/g)).toHaveLength(1);
  });

  test("wrapInConfig wraps body with the canonical PT-9-safe prologue", () => {
    expect(wrapInConfig("foo")).toBe(
      "enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\nfoo\nend",
    );
  });
});

describe("voip validation", () => {
  test("validateCme rejects bad IPv4", () => {
    expect(() => validateCme({ device: "X", maxEphones: 1, maxDn: 1, sourceIp: "1.2.3" })).toThrow(/IPv4/);
  });

  test("validateCme bounds maxEphones/maxDn", () => {
    expect(() => validateCme({ device: "X", maxEphones: 0, maxDn: 1, sourceIp: "1.1.1.1" })).toThrow(/maxEphones/);
    expect(() => validateCme({ device: "X", maxEphones: 1, maxDn: 1000, sourceIp: "1.1.1.1" })).toThrow(/maxDn/);
  });

  test("validateCme.autoAssign cannot exceed maxDn", () => {
    expect(() =>
      validateCme({ device: "X", maxEphones: 4, maxDn: 4, sourceIp: "1.1.1.1", autoAssign: { first: 1, last: 5 } }),
    ).toThrow(/autoAssign\.last/);
  });

  test("validateEphoneDn requires digit-only number", () => {
    expect(() => validateEphoneDn({ device: "X", dnTag: 1, number: "" })).toThrow(/empty/);
    expect(() => validateEphoneDn({ device: "X", dnTag: 1, number: "1A0" })).toThrow(/digits/);
  });

  test("validateEphone enforces Cisco-dotted MAC and non-empty buttons", () => {
    expect(() => validateEphone({ device: "X", ephoneNumber: 1, mac: "BAD-MAC", buttons: [1] })).toThrow(/Cisco-dotted/);
    expect(() => validateEphone({ device: "X", ephoneNumber: 1, mac: "0001.AAAA.BBBB", buttons: [] })).toThrow(/at least one/);
  });

  test("validateVoiceVlan bounds vlan ids", () => {
    expect(() => validateVoiceVlan({ switch: "S", port: "Fa0/1", voiceVlanId: 0 })).toThrow(/voiceVlanId/);
    expect(() => validateVoiceVlan({ switch: "S", port: "", voiceVlanId: 100 })).toThrow(/empty/);
  });
});

describe("dhcp option-150 support", () => {
  test("dhcpPoolCli emits option 150 ip when tftpServer is set", () => {
    const cli = dhcpPoolCli({
      device: "R1",
      name: "VOICE",
      network: "10.10.10.0/24",
      defaultRouter: "10.10.10.1",
      tftpServer: "10.0.0.1",
    });
    expect(cli).toContain(" option 150 ip 10.0.0.1");
    expect(cli).toContain(" default-router 10.10.10.1");
  });

  test("dhcpPoolCli omits option 150 when tftpServer is missing", () => {
    const cli = dhcpPoolCli({ device: "R1", name: "DATA", network: "10.10.10.0/24" });
    expect(cli).not.toContain("option 150");
  });
});
