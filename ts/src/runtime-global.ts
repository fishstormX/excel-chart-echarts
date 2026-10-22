/* x2e-runtime.js — browser global X2E = { prepare, fmtNumber, fmtDate, renderers }.
   Usage: chart.setOption(X2E.prepare(option)). Built from runtime.ts. */
import { fmtDate, fmtNumber, prepare, registerMaps, renderers } from "./runtime.js";
(globalThis as any).X2E = { prepare, fmtNumber, fmtDate, renderers, registerMaps };
