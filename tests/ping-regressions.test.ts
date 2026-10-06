import { expect, test, describe } from "bun:test";
import { parsePing, summarizePing } from "../src/sim/parsers.js";
describe("ping regressions",()=>{
  test("unreachable is not an echo response even with Windows received statistics",()=>{const r=parsePing("Reply from 192.0.2.1: Destination host unreachable.\nPackets: Sent = 4, Received = 4, Lost = 0","192.0.2.8");expect(r.received).toBe(0);expect(r.status).toBe("unreachable");expect(r.successRate).toBe(0);});
  test("partial echo does not claim completed success",()=>{const r=parsePing("Reply from 192.0.2.1: bytes=32 time<1ms TTL=255","192.0.2.1");expect(r.received).toBe(1);expect(r.complete).toBe(false);expect(summarizePing(r)).not.toContain("100%");});
  test("DNS failure is terminal and explicit",()=>{expect(parsePing("Ping request could not find host missing.example.","missing.example")).toMatchObject({complete:true,status:"dns_error",received:0});});
  test("exclamation marks in arbitrary errors do not count",()=>{expect(parsePing("ERROR: failed!","host").received).toBe(0);});
  test("partial loss remains distinct from success",()=>{expect(parsePing("Packets: Sent = 4, Received = 3, Lost = 1","host")).toMatchObject({status:"loss",complete:true,successRate:75});});
});
