import { describe, expect, test } from "bun:test";
import {
  addSimplePduJs,
  clearCanvasJs,
  deletePduJs,
  firePduJs,
  getSimulationStateJs,
  listDeviceNamesJs,
  setSimulationModeJs,
  simulationControlJs,
  workspaceImageBase64Js,
} from "../src/ipc/sim.js";

describe("setSimulationModeJs", () => {
  test("simulation calls showSimulationMode", () => {
    const js = setSimulationModeJs("simulation");
    expect(js).toContain("getRSSwitch()");
    expect(js).toContain("showSimulationMode()");
    expect(js).not.toContain("showRealtimeMode()");
  });

  test("realtime calls showRealtimeMode", () => {
    const js = setSimulationModeJs("realtime");
    expect(js).toContain("showRealtimeMode()");
    expect(js).not.toContain("showSimulationMode()");
  });
});

describe("getSimulationStateJs", () => {
  test("reads SimulationPanel.isPlaying and returns JSON", () => {
    const js = getSimulationStateJs();
    expect(js).toContain("getSimulationPanel()");
    expect(js).toContain("isPlaying()");
    expect(js).toContain("JSON.stringify");
  });
});

describe("simulationControlJs", () => {
  test("play maps to play()", () => {
    expect(simulationControlJs("play")).toContain(".play()");
  });
  test("forward maps to forward()", () => {
    expect(simulationControlJs("forward")).toContain(".forward()");
  });
  test("back maps to back()", () => {
    expect(simulationControlJs("back")).toContain(".back()");
  });
  test("reset maps to resetSimulation()", () => {
    const js = simulationControlJs("reset");
    expect(js).toContain(".resetSimulation()");
  });
});

describe("addSimplePduJs / firePduJs / deletePduJs", () => {
  test("addSimplePdu uses UserCreatedPDU and quotes both names", () => {
    const js = addSimplePduJs("PC1", "PC2");
    expect(js).toContain("getUserCreatedPDU()");
    expect(js).toContain("addSimplePdu(\"PC1\",\"PC2\")");
    expect(js).toContain("OK|0"); // success protocol
    expect(js).toContain("ERR:add_pdu");
  });

  test("addSimplePdu escapes embedded quotes", () => {
    const js = addSimplePduJs('weird"name', "PC2");
    expect(js).toContain('"weird\\"name"');
  });

  test("firePduJs coerces index to int", () => {
    expect(firePduJs(3)).toContain("firePDU(3)");
    expect(firePduJs(3.7)).toContain("firePDU(3)");
  });

  test("deletePduJs coerces index to int", () => {
    expect(deletePduJs(0)).toContain("deletePDU(0)");
  });
});

describe("clearCanvasJs", () => {
  test("prompt=true passes true to fileNew", () => {
    expect(clearCanvasJs(true)).toContain("fileNew(true)");
  });

  test("prompt=false passes false to fileNew", () => {
    expect(clearCanvasJs(false)).toContain("fileNew(false)");
  });

  test("returns OK|<bool> success protocol", () => {
    const js = clearCanvasJs(false);
    expect(js).toContain("OK|");
    expect(js).toContain("ERR:file_new");
  });
});

describe("workspaceImageBase64Js", () => {
  test("PNG passes 'PNG' to getWorkspaceImage", () => {
    expect(workspaceImageBase64Js("PNG")).toContain('getWorkspaceImage("PNG")');
  });

  test("JPG passes 'JPG' to getWorkspaceImage", () => {
    expect(workspaceImageBase64Js("JPG")).toContain('getWorkspaceImage("JPG")');
  });

  test("includes the standard base64 alphabet", () => {
    const js = workspaceImageBase64Js("PNG");
    expect(js).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");
    expect(js).toContain("B64|");
  });

  test("guards against empty bytes", () => {
    expect(workspaceImageBase64Js("PNG")).toContain("ERR:empty_image");
  });
});

describe("listDeviceNamesJs", () => {
  test("uses getDeviceCount + getDeviceAt and returns JSON array", () => {
    const js = listDeviceNamesJs();
    expect(js).toContain("getDeviceCount()");
    expect(js).toContain("getDeviceAt(i)");
    expect(js).toContain("JSON.stringify(names)");
  });
});
