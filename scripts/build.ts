const executable = "dist/packet-tracer-mcp";
const commands = [["bun", "build", "src/index.ts", "--compile", "--outfile", executable]];

// Bun 1.2 can emit an invalid signature after embedding the bundle on arm64.
if (process.platform === "darwin") {
  commands.push(["codesign", "--force", "--sign", "-", executable]);
}

for (const command of commands) {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (!result.success) process.exit(result.exitCode || 1);
}
