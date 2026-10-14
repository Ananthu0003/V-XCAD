# V-XCAD Manual CAD — Professional UI Plan

Goal: make the Manual CAD stage feel like a real 3D editing tool (FreeCAD / Fusion 360 / Onshape),
not a form beside a model. The viewport is the product; everything else stays out of its way.

Principles
1. **Viewport first.** At least 65% of the screen is 3D. Panels dock, collapse and never cover the model.
2. **Select, then act.** The UI always shows what is selected and which tools that selection allows.
3. **Direct manipulation.** Move, rotate and scale use on-model handles, not only number boxes.
4. **Everything previews, nothing is destructive.** Every tool shows a live ghost preview, and Accept / Cancel are always visible. History is non-destructive (revisions already exist).
5. **Keyboard and mouse like the pros.** Orbit / pan / zoom, shortcuts, right-click menus, a command search.

---

## 1. Screen layout

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ① TOP BAR   V-XCAD › Part name   rev_007 ▾    ↶ Undo  ↷ Redo   [ Export ▾ ]  [ → CAM ]   │
├────┬─────────────────────────────────────────────────────────────────────┬───────────────┤
│    │ ③ CONTEXT BAR:  [Body|Face|Edge]  [Wireframe|Shaded|Edges]  [Snap ⌗]   │ ⑤ RIGHT DOCK  │
│ ②  │                                                                      │ ┌───────────┐ │
│ T  │                                                    ┌──────┐          │ │ Model tree│ │
│ O  │                                                    │ VIEW │ ④        │ │  ▸ Body   │ │
│ O  │                                                    │ CUBE │          │ │  ▸ Faces  │ │
│ L  │              ⑥ 3D VIEWPORT                         └──────┘          │ │  ▸ Edges  │ │
│ R  │         (grid, axes, model, gizmo,                                   │ ├───────────┤ │
│ A  │          ghost preview, dimensions)                                  │ │ Properties│ │
│ I  │                                                                      │ │ (selected)│ │
│ L  │                                                                      │ ├───────────┤ │
│    │   ┌────────────────────────────┐                                     │ │ Task panel│ │
│    │   │ ⑦ FLOATING TOOL DIALOG     │                                     │ │ (tool     │ │
│    │   │  Move  X [  ] Y [  ] Z [  ]│                                     │ │  params)  │ │
│    │   │        [ Cancel ] [ Apply ]│                                     │ └───────────┘ │
│    │   └────────────────────────────┘                                     │               │
├────┴─────────────────────────────────────────────────────────────────────┴───────────────┤
│ ⑧ HISTORY TIMELINE:  ● base ─ ● move ─ ● hole ─ ● shell ─ ● fillet ▸ (active)                │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ ⑨ STATUS BAR:  Sel: Face_12 planar 240 mm²   X 12.4  Y -3.1  Z 0.0   mm ▾   ✔ Valid solid  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

| # | Area | Maps to existing code | Change |
|---|------|-----------------------|--------|
| ① | Top bar | stage switcher in `ManualCadWorkspace.tsx` | Add undo/redo, Export menu, revision picker, "→ CAM" button |
| ② | Tool rail (left) | `ManualCadToolbar.tsx` | Grouped, icon-only vertical rail with flyouts |
| ③ | Context bar | `FilterControl` + viewport header | Selection filter, display mode, snap, units |
| ④ | View cube | `GizmoViewcube` in `CadViewport.tsx` | Keep; add click-to-face and "fit" / "home" buttons |
| ⑤ | Right dock | `TopologyPropertiesPanel.tsx`, `TaskPanel.tsx` | Tabs: Tree / Properties / Task |
| ⑥ | Viewport | `CadViewport.tsx`, `SubShapeRaycaster.tsx` | Add transform gizmo, section view, dimension overlays |
| ⑦ | Floating tool dialog | `OperationForm.tsx` | Anchor near the model for quick tools |
| ⑧ | Timeline | `HistoryTimelineBar.tsx` | Keep; add hover thumbnails, drag-to-reorder later |
| ⑨ | Status bar | `ViewportStatus` | Live cursor coordinates, units, validity |

---

## 2. Tool rail (left) — grouped like a pro CAD ribbon

Icon-only, 40 px wide. Hover shows name + shortcut. Groups are separated by thin dividers.
A small corner triangle marks groups with a flyout.

| Group | Tools | Shortcut | Needs selection |
|-------|-------|----------|-----------------|
| **Select** | Select (V), Box select (B) | V, B | none |
| **Transform** | Move, Rotate, Scale, Mirror | G, R, S, M | whole body |
| **Place** | Align to bed (drop / face-down / centre) | A | optional face |
| **Add / Cut** | Primitive (box, cylinder, sphere, cone; add / subtract / intersect), Pad / Boss, Pocket, Hole Wizard | N, E, P, H | face for Pad/Pocket/Hole |
| **Modify** | Fillet, Chamfer, Shell, Offset, Edit Feature | F, C, T, O, X | edges, faces or body |
| **Cut / Split** | Split by plane | L | plane or face |
| **Pattern** | Linear pattern, Polar pattern | Shift+L, Shift+P | whole body |
| **Repair** | Heal / clean | Shift+H | whole body |
| **Inspect** | Measure, Section view, Check geometry | D, Shift+S | face / edge |

Behaviour rules
- A tool that does not apply to the current selection is **dimmed** with a tooltip saying what to select (this already exists in `capabilities.ts`).
- Clicking a dimmed tool switches the selection filter to the right mode (already exists).
- `Esc` cancels the active tool. `Enter` applies. `Ctrl+Z` / `Ctrl+Shift+Z` undo / redo.
- Remove the old standalone "Edit Feature" icon that reuses the Hole icon; give it its own icon and put it under Modify.

---

## 3. Viewport behaviour

**Navigation (same as Fusion / Onshape)**
- Orbit: middle-mouse drag, or right-drag. Pan: Shift + middle-drag. Zoom: wheel, zoom-to-cursor.
- `F` fit selection, `Home` fit all. Numpad 1 / 3 / 7 for front / right / top.
- View cube click snaps to a face or corner; double-click the cube to reset.

**Display**
- Shaded, Shaded + edges (default), Wireframe, X-ray. Toggle in the context bar.
- Ground grid with fading, axis triad at origin (X red, Y green, Z blue).
- **Section view:** a draggable clipping plane (X / Y / Z) with a cap fill, to inspect shells and hollow parts. Non-destructive.
- Build-volume box (optional) to check the part fits the printer or machine.

**Selection and highlight**
- Hover: soft highlight. Selected: solid accent colour. Face = filled tint, edge = thick line, body = outline glow.
- Selection filter chips: Body / Face / Edge. Shift-click adds to the selection, Ctrl-click removes.
- Right-click opens a context menu that lists only the tools valid for the entity (existing `ContextMenu.tsx`).

**On-model manipulation (the biggest "feels pro" upgrade)**
- Move: 3-axis arrow gizmo plus plane handles. Drag to translate, type a value to be exact.
- Rotate: 3 coloured rings. Snap to 15° with Shift.
- Scale: corner and axis handles; uniform by default, hold Alt for non-uniform.
- Every drag updates the preview live. The numeric fields in the task panel stay in sync both ways.
- Pad / Pocket / Hole: drag handle along the face normal to set depth or height, with a live dimension label.

**Ghost preview**
- Result geometry drawn semi-transparent over the current model: added material in green, removed in red.
- Volume delta badge: `+1 240 mm³` / `−380 mm³` (already returned by the preview API).
- Failed preview shows the error text from the backend in a red banner with a suggestion, not a toast that vanishes.

**Dimensions and measure**
- Measure tool draws a leader line with the distance, and shows min distance, centre distance and angle (backend now returns these).
- Bounding-box dimensions can be pinned on screen (X × Y × Z).

---

## 4. Right dock

Three tabs. The dock is resizable (260–420 px) and collapsible with `Tab`.

**Tree**
```
▾ Part
  ▾ Bodies (1)         👁 🔒
  ▾ Features
      ● Base (AI generated)
      ● Move
      ● Hole Ø6
      ● Shell 2 mm      ← double-click to edit parameters
  ▸ Faces (24)
  ▸ Edges (60)
```
- Click a row to select it in the viewport. Eye icon hides, lock prevents edits.
- Double-click a feature to edit; this uses the existing `edit_params` recompute.
- Right-click a feature: Edit, Suppress, Delete (with recompute warning).

**Properties** (existing `TopologyPropertiesPanel`)
- Shows only fields that exist for the entity type (already implemented).
- Add an editable **Position / Rotation / Size** block for the whole body, so users can type exact values.
- Add a **Body info** block: volume, surface area, bounding box, face / edge count, valid solid / not.

**Task panel** (existing `TaskPanel` + `OperationForm`)
- Title, short description, parameters, **Preview**, **Apply**, **Cancel**.
- Parameter fields use stepper inputs with units, drag-to-scrub on the label, and quick-preset chips (already used by the hole presets).
- "Advanced" section collapsed by default.
- Remember the last values per tool for the session.

---

## 5. Tool parameter panels (what each tool shows)

| Tool | Fields |
|------|--------|
| Move | X, Y, Z distance (mm) |
| Rotate | Axis (X / Y / Z), Angle (°), Pivot (centre / origin) |
| Scale | Mode (uniform / per-axis), Factor or Sx Sy Sz, Pivot |
| Mirror | Plane (XY / YZ / XZ) or selected face, Offset, Keep original (symmetric) |
| Align | Mode: Drop to bed · Face down · Centre XY · Centre origin |
| Primitive | Shape, Mode (add / subtract / intersect), Size, Position (or on selected face) |
| Shell | Wall thickness, Direction (in / out), Open faces (selected) |
| Offset | Amount (± mm), for print tolerance or clearance |
| Split | Plane or selected face, Offset, Keep (top / bottom / both) |
| Linear pattern | Count, Spacing X Y Z |
| Polar pattern | Count, Total angle, Axis, Centre X Y Z |
| Heal | Fix shape, Merge co-planar faces, Remove loose solids |
| Pad / Pocket / Hole / Fillet / Chamfer / Edit Feature | Unchanged |

---

## 6. Visual design

- **Theme:** dark by default, light available. Neutral grey chrome (`#16181d` panels, `#1d2027` surfaces), one accent colour (blue `#3b82f6`) for selection and primary actions. No purple gradient on chrome.
- **Viewport background:** soft vertical gradient (`#2a2f3a` → `#14161b`), like Fusion / Blender, so the model stands out.
- **Typography:** system UI font 12–13 px for panels, tabular numbers for all dimensions, monospace only for coordinates.
- **Density:** compact rows (28 px), 8 px grid, 1 px dividers, no heavy shadows. Icons from one set (lucide), 18 px, stroke 1.75.
- **Feedback:** every long action shows a thin progress bar under the top bar. Errors stay visible until dismissed.
- **Accessibility:** all tools reachable by keyboard, visible focus ring, tooltips with shortcuts, colour is never the only signal.

---

## 7. Keyboard shortcuts

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| V | Select | G | Move |
| R | Rotate | S | Scale |
| M | Mirror | A | Align to bed |
| H | Hole | P | Pocket |
| E | Pad / extrude | F | Fillet (or fit view when nothing is selected) |
| C | Chamfer | T | Shell |
| L | Split | D | Measure |
| Esc | Cancel tool | Enter | Apply |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo | Ctrl+K | Command search |
| Tab | Toggle right dock | Home | Fit all |

A **command search** (`Ctrl+K`) lists every tool by name, so nothing depends on memorising icons.

---

## 8. Export menu (top bar)

Download current revision as **STL**, **STEP**, **OBJ** or **3MF**. Backend: `GET /api/v1/cad/modify/export/{session_id}?fmt=stl|step|obj|3mf&revision_id=…`. A "→ CAM" button hands the active STEP revision to the CAM stage.

---

## 9. Build phases

| Phase | Scope | Main files |
|-------|-------|------------|
| **1. Layout shell** | Top bar, left rail, right dock with tabs, status bar, dark theme tokens | `ManualCadWorkspace.tsx`, new `layout/` components |
| **2. Tool rail + registry** | Grouped rail, new tool ids wired to the registry and capability matrix, forms for each new tool | `ManualCadToolbar.tsx`, `operations/registry.ts`, `operations/capabilities.ts` |
| **3. Preview polish** | Ghost preview colours, volume delta badge, persistent error banner, Apply / Cancel always visible | `TaskPanel.tsx`, `CadViewport.tsx` |
| **4. On-model gizmos** | Move / rotate / scale handles (three.js `TransformControls` or drei `PivotControls`), live sync with fields | `CadViewport.tsx`, new `TransformGizmo.tsx` |
| **5. Tree + properties** | Feature tree with edit / suppress / delete, body info block | `HistoryTimelineBar.tsx`, `TopologyPropertiesPanel.tsx` |
| **6. Inspect tools** | Section view, richer measure overlay, build-volume box | `CadViewport.tsx` |
| **7. Command search + shortcuts** | `Ctrl+K` palette, shortcut help overlay | new `CommandPalette.tsx` |

Suggested order: 1 → 2 → 3 first (the screen already looks professional and every new tool is usable), then 4, which gives the biggest "real 3D editor" feel.

---

## 10. Open decisions for you

1. **Theme:** dark only, or dark + light? (Recommended: dark default with a light option.)
2. **Gizmo library:** drei `PivotControls` (faster to ship) or three.js `TransformControls` (more precise, more code). Recommended: `TransformControls`.
3. **Units:** millimetres only, or add inch toggle? (Recommended: mm default, inch toggle in the status bar.)
4. **Mesh-only edits:** tools such as decimate or smooth only apply to raw STL, not the STEP model. Do you want a separate "Mesh" mode for these, or keep everything on the STEP model? (Recommended: keep STEP-only for now, since CAM needs the exact B-Rep.)
