import { expect, test } from "bun:test";

const modules = ["read-endpoint", "read-wireless-router", "configure-wireless-router", "read-dns", "configure-dns", "verify-dns", "read-server-dhcp", "install-wireless-adapter", "read-wireless-client", "associate-default-wireless", "checkpoint-pkt", "latest-checkpoint"];
for (const name of modules) {
  test(`${name} exports schema, builder and decoder`, async () => {
    const module = await import(`../../src/tools/${name}.ts`) as Record<string, unknown>;
    expect(module.InputSchema).toBeDefined();
    expect(typeof module.buildJs).toBe("function");
    expect(typeof module.decodeReply).toBe("function");
  });
}
