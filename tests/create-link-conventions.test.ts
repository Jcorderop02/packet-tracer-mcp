import { describe, expect, test } from "bun:test";
import { portsLookLikeConsole } from "../src/tools/create-link.js";

describe("portsLookLikeConsole", () => {
  test("Console <-> RS-232 (typical PC↔Router)", () => {
    expect(portsLookLikeConsole("Console", "RS-232")).toBe(true);
    expect(portsLookLikeConsole("RS-232", "Console")).toBe(true);
  });

  test("Both Console (router-to-router console pass-through)", () => {
    expect(portsLookLikeConsole("Console", "Console")).toBe(true);
  });

  test("Both RS-232 / RS232 with and without dash", () => {
    expect(portsLookLikeConsole("RS-232", "RS232")).toBe(true);
    expect(portsLookLikeConsole("rs232", "rs-232")).toBe(true);
  });

  test("Case-insensitive match", () => {
    expect(portsLookLikeConsole("CONSOLE", "rs-232")).toBe(true);
  });

  test("Refuses Ethernet ports — typical misuse the validator must catch", () => {
    expect(portsLookLikeConsole("GigabitEthernet0/0", "FastEthernet0/1")).toBe(false);
    expect(portsLookLikeConsole("Console", "GigabitEthernet0/0")).toBe(false);
    expect(portsLookLikeConsole("FastEthernet0/0", "Console")).toBe(false);
  });

  test("Refuses Serial ports (which would deserve cable=serial, not console)", () => {
    expect(portsLookLikeConsole("Serial0/1/0", "Serial0/1/0")).toBe(false);
  });
});
