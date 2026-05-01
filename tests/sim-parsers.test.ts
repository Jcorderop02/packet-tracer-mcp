import { describe, expect, test } from "bun:test";
import {
  parsePing,
  parseTraceroute,
  summarizePing,
  summarizeTraceroute,
} from "../src/sim/parsers.js";

describe("parsePing — PC (Windows-like)", () => {
  test("4/4 reply parsed as 100% from PC", () => {
    const raw = [
      "Pinging 192.168.1.1 with 32 bytes of data:",
      "Reply from 192.168.1.1: bytes=32 time<1ms TTL=255",
      "Reply from 192.168.1.1: bytes=32 time=1ms TTL=255",
      "Reply from 192.168.1.1: bytes=32 time=1ms TTL=255",
      "Reply from 192.168.1.1: bytes=32 time=1ms TTL=255",
      "",
      "Ping statistics for 192.168.1.1:",
      "    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),",
    ].join("\n");
    const r = parsePing(raw, "192.168.1.1");
    expect(r.source).toBe("pc");
    expect(r.target).toBe("192.168.1.1");
    expect(r.sent).toBe(4);
    expect(r.received).toBe(4);
    expect(r.lost).toBe(0);
    expect(r.successRate).toBe(100);
  });

  test("partial loss reports the right successRate", () => {
    const raw = [
      "Pinging 8.8.8.8 with 32 bytes of data:",
      "Request timed out.",
      "Reply from 8.8.8.8: bytes=32 time=20ms TTL=51",
      "Reply from 8.8.8.8: bytes=32 time=21ms TTL=51",
      "Reply from 8.8.8.8: bytes=32 time=20ms TTL=51",
      "",
      "Ping statistics for 8.8.8.8:",
      "    Packets: Sent = 4, Received = 3, Lost = 1 (25% loss),",
    ].join("\n");
    const r = parsePing(raw, "8.8.8.8");
    expect(r.source).toBe("pc");
    expect(r.sent).toBe(4);
    expect(r.received).toBe(3);
    expect(r.lost).toBe(1);
    expect(r.successRate).toBe(75);
  });
});

describe("parsePing — Router IOS", () => {
  test("5/5 router reports 100 percent", () => {
    const raw = [
      "Type escape sequence to abort.",
      "Sending 5, 100-byte ICMP Echos to 1.1.1.1, timeout is 2 seconds:",
      "!!!!!",
      "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/2/4 ms",
    ].join("\n");
    const r = parsePing(raw, "1.1.1.1");
    expect(r.source).toBe("router");
    expect(r.target).toBe("1.1.1.1");
    expect(r.sent).toBe(5);
    expect(r.received).toBe(5);
    expect(r.lost).toBe(0);
    expect(r.successRate).toBe(100);
  });

  test("4/5 router reports 80 percent", () => {
    const raw = [
      "Sending 5, 100-byte ICMP Echos to 10.0.0.2, timeout is 2 seconds:",
      "!.!!!",
      "Success rate is 80 percent (4/5), round-trip min/avg/max = 1/1/2 ms",
    ].join("\n");
    const r = parsePing(raw, "10.0.0.2");
    expect(r.source).toBe("router");
    expect(r.sent).toBe(5);
    expect(r.received).toBe(4);
    expect(r.lost).toBe(1);
    expect(r.successRate).toBe(80);
  });

  test("0/5 router reports 0 percent", () => {
    const raw = [
      "Sending 5, 100-byte ICMP Echos to 10.0.0.99, timeout is 2 seconds:",
      ".....",
      "Success rate is 0 percent (0/5)",
    ].join("\n");
    const r = parsePing(raw, "10.0.0.99");
    expect(r.successRate).toBe(0);
    expect(r.received).toBe(0);
    expect(r.sent).toBe(5);
  });
});

describe("parsePing — fallback / empty", () => {
  test("empty string returns zeros", () => {
    const r = parsePing("", "x");
    expect(r.sent).toBe(0);
    expect(r.received).toBe(0);
    expect(r.successRate).toBe(0);
  });

  test("partial output (only Reply lines) falls back to count", () => {
    const raw = [
      "Pinging 1.1.1.1 with 32 bytes of data:",
      "Reply from 1.1.1.1: bytes=32 time=1ms TTL=255",
      "Reply from 1.1.1.1: bytes=32 time=1ms TTL=255",
    ].join("\n");
    const r = parsePing(raw, "1.1.1.1");
    expect(r.received).toBe(2);
    expect(r.sent).toBe(2);
    expect(r.successRate).toBe(100);
  });
});

describe("parseTraceroute — PC", () => {
  test("complete trace with two hops", () => {
    const raw = [
      "Tracing route to 8.8.8.8 over a maximum of 30 hops:",
      "",
      "  1   1 ms     0 ms     1 ms     192.168.1.1",
      "  2   *        *        *        Request timed out.",
      "  3   20 ms    21 ms    20 ms    8.8.8.8",
      "",
      "Trace complete.",
    ].join("\n");
    const r = parseTraceroute(raw, "8.8.8.8");
    expect(r.source).toBe("pc");
    expect(r.complete).toBe(true);
    expect(r.hops.length).toBe(3);
    expect(r.hops[0]?.address).toBe("192.168.1.1");
    expect(r.hops[1]?.address).toBeNull();
    expect(r.hops[2]?.address).toBe("8.8.8.8");
    expect(r.hops[0]?.times).toEqual([1, 0, 1]);
    expect(r.hops[1]?.times).toEqual([null, null, null]);
  });

  test("incomplete trace flags complete=false", () => {
    const raw = [
      "Tracing route to 8.8.8.8 over a maximum of 30 hops:",
      "  1   *        *        *        Request timed out.",
    ].join("\n");
    const r = parseTraceroute(raw, "8.8.8.8");
    expect(r.complete).toBe(false);
    expect(r.hops.length).toBe(1);
  });
});

describe("parseTraceroute — Router IOS", () => {
  test("router trace with stars and full hop", () => {
    const raw = [
      "Type escape sequence to abort.",
      "Tracing the route to 8.8.8.8",
      "",
      "  1 192.168.1.1 4 msec 0 msec 0 msec",
      "  2 * * *",
      "  3 8.8.8.8 24 msec 24 msec 24 msec",
    ].join("\n");
    const r = parseTraceroute(raw, "8.8.8.8");
    expect(r.source).toBe("router");
    expect(r.hops.length).toBe(3);
    expect(r.hops[0]?.address).toBe("192.168.1.1");
    expect(r.hops[0]?.times).toEqual([4, 0, 0]);
    expect(r.hops[1]?.address).toBeNull();
    expect(r.hops[1]?.times).toEqual([null, null, null]);
    expect(r.hops[2]?.address).toBe("8.8.8.8");
  });
});

describe("summaries", () => {
  test("summarizePing renders one line", () => {
    const s = summarizePing({
      target: "1.1.1.1",
      sent: 5,
      received: 4,
      lost: 1,
      successRate: 80,
      source: "router",
      raw: "",
    });
    expect(s).toContain("ping 1.1.1.1");
    expect(s).toContain("4/5");
    expect(s).toContain("80%");
    expect(s).toContain("router");
  });

  test("summarizeTraceroute renders header + hop lines", () => {
    const s = summarizeTraceroute({
      target: "8.8.8.8",
      complete: true,
      source: "pc",
      hops: [
        { hop: 1, address: "192.168.1.1", times: [1, 0, 1] },
        { hop: 2, address: null, times: [null, null, null] },
      ],
      raw: "",
    });
    expect(s).toContain("traceroute 8.8.8.8");
    expect(s).toContain("2 hop(s)");
    expect(s).toContain("192.168.1.1");
    expect(s).toContain("*");
  });
});
