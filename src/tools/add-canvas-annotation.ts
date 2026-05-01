import { z } from "zod";
import { addNoteJs, drawShapeJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * Three primitives, all reachable via LogicalWorkspace:
 *   - note:   addNote(x, y, fontSize, text)             → uuid
 *   - line:   drawLine(x1,y1,x2,y2, thick, r,g,b,a)     → uuid
 *   - circle: drawCircle(cx,cy, radius, thick, r,g,b,a) → uuid
 *
 * RGB defaults to (0,0,0) and alpha to 255 when not supplied. UUIDs are
 * returned so the caller can later reference the annotation (e.g. for
 * `changeNoteText`, future tool extensions).
 */
const InputSchema = {
  kind: z.enum(["note", "line", "circle"]).describe("Annotation primitive to draw."),
  x: z.number().describe("note/circle: x; line: x1."),
  y: z.number().describe("note/circle: y; line: y1."),
  x2: z.number().optional().describe("line: x2."),
  y2: z.number().optional().describe("line: y2."),
  radius: z.number().optional().describe("circle: radius (px)."),
  text: z.string().optional().describe("note: text content."),
  font_size: z.number().int().min(6).max(72).default(12).describe("note: font size."),
  thickness: z.number().int().min(1).max(20).default(2).describe("line/circle: stroke thickness."),
  r: z.number().int().min(0).max(255).default(0).describe("RGB red."),
  g: z.number().int().min(0).max(255).default(0).describe("RGB green."),
  b: z.number().int().min(0).max(255).default(0).describe("RGB blue."),
  alpha: z.number().int().min(0).max(255).default(255).describe("Alpha."),
};

export const registerAddCanvasAnnotationTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_add_canvas_annotation",
    "Decorate the canvas with a note, line, or circle (LogicalWorkspace.addNote/drawLine/drawCircle). Returns the new annotation's UUID.",
    InputSchema,
    async ({ kind, x, y, x2, y2, radius, text, font_size, thickness, r, g, b, alpha }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      let js: string;
      if (kind === "note") {
        if (!text) return errorResult("'note' requires `text`.");
        js = addNoteJs({ x, y, text, fontSize: font_size });
      } else if (kind === "line") {
        if (x2 === undefined || y2 === undefined) {
          return errorResult("'line' requires both x2 and y2.");
        }
        js = drawShapeJs({ kind: "line", a: x, b: y, c: x2, d: y2, thickness, r, g, b2: b, alpha });
      } else {
        if (radius === undefined) return errorResult("'circle' requires `radius`.");
        js = drawShapeJs({ kind: "circle", a: x, b: y, c: radius, thickness, r, g, b2: b, alpha });
      }

      const reply = await bridge.sendAndWait(js, { timeoutMs: 8_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);
      const uuid = reply.startsWith("OK|") ? reply.slice(3) : reply;
      return textResult(`Annotation '${kind}' added; uuid=${uuid}`);
    },
  );
};
