import { expect, test } from "bun:test";
import { resolvedAddress } from "../../src/tools/verify-dns.js";
test("Packet Tracer resolves hostname but prints only the numeric IP",()=>expect(resolvedAddress("Pinging 192.0.2.33 with 32 bytes of data:")).toBe("192.0.2.33"));
test("Windows hostname with bracketed IP",()=>expect(resolvedAddress("Pinging test.example [192.0.2.33] with 32 bytes of data:")).toBe("192.0.2.33"));
test("IOS resolution",()=>expect(resolvedAddress("Sending 5, 100-byte ICMP Echos to 192.0.2.33, timeout is 2 seconds:")).toBe("192.0.2.33"));
test("DNS failure does not invent an address from unreachable reply",()=>expect(resolvedAddress("Ping request could not find host test.example. Reply from 192.0.2.1: Destination host unreachable.")).toBeUndefined());
