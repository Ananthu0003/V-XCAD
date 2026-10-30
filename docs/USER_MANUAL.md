# VΞXCAD (V-XCAD) User Manual
*A Complete End-to-End Guide: From 2D Blueprint to Machine-Ready CNC G-Code*

> [!NOTE]
> The primary copy of this document is maintained at [USER_MANUAL.md](file:///c:/Users/user/Downloads/VEXCAD/USER_MANUAL.md) in the project root.

---

## Table of Contents

1. [Introduction to VΞXCAD](#1-introduction-to-vxcad)
   - [What is VΞXCAD?](#what-is-vxcad)
   - [Core Design Philosophy](#core-design-philosophy)
   - [System Requirements & Browser Compatibility](#system-requirements--browser-compatibility)
2. [Getting Started & Account Setup](#2-getting-started--account-setup)
   - [Registration and Authentication](#registration-and-authentication)
   - [Navigating the Home Portal](#navigating-the-home-portal)
   - [Managing Sessions & Projects](#managing-sessions--projects)
3. [The Workspace Interface](#3-the-workspace-interface)
   - [Overview of the 3-Pane Layout](#overview-of-the-3-pane-layout)
   - [The Stage Switcher & Workflow Pipeline](#the-stage-switcher--workflow-pipeline)
   - [3D Viewport Controls & Navigation](#3d-viewport-controls--navigation)
   - [The View Cube & Preset Perspectives](#the-view-cube--preset-perspectives)
   - [Theme & Display Settings](#theme--display-settings)
4. [Stage 1: AI CAD Generation (Blueprint to 3D)](#4-stage-1-ai-cad-generation-blueprint-to-3d)
   - [Prompt Engineering & Drawing Uploads](#prompt-engineering--drawing-uploads)
   - [Supported Drawing Formats & Best Practices](#supported-drawing-formats--best-practices)
   - [Model Selection & Inference Settings](#model-selection--inference-settings)
   - [Real-time Generation & Parametric Extraction](#real-time-generation--parametric-extraction)
   - [Live Dimension Sync & AST Subprocess Compilation](#live-dimension-sync--ast-subprocess-compilation)
   - [The CAD Prompt Assistant (Multimodal Discrepancy Inspection)](#the-cad-prompt-assistant)
   - [Revision History & Rollback](#revision-history--rollback)
5. [Stage 2: Manual CAD Workspace (Direct Modeling)](#5-stage-2-manual-cad-workspace-direct-modeling)
   - [Entering the Manual CAD Environment](#entering-the-manual-cad-environment)
   - [Selection Filters (Body, Face, Edge)](#selection-filters-body-face-edge)
   - [Transform Operations (Move, Rotate, Scale, Mirror, Align)](#transform-operations)
   - [Adding and Cutting Primitives (Box, Cylinder, Sphere, Cone)](#adding-and-cutting-primitives)
   - [Hole Wizard with Standard Presets (M3–M8, 1/4")](#hole-wizard)
   - [Pocket Cuts & Boss/Pad Extrusions](#pocket-cuts--bosspad-extrusions)
   - [Edge Treatments: Fillet & Chamfer](#edge-treatments-fillet--chamfer)
   - [Face Push/Pull, Shelling, and Offset](#face-pushpull-shelling-and-offset)
   - [Splitting by Plane & Patterning (Linear / Polar)](#splitting-by-plane--patterning)
   - [Mesh Healing & Geometry Inspection](#mesh-healing--geometry-inspection)
   - [Interactive Measurement & Section View Plane](#interactive-measurement--section-view-plane)
6. [Stage 3: CAM Setup & Operation Planning](#6-stage-3-cam-setup--operation-planning)
   - [The Automated CAM Pipeline Explained](#the-automated-cam-pipeline-explained)
   - [Machine Matrix Selection (Haas, Fanuc, Siemens, Mazak, etc.)](#machine-matrix-selection)
   - [Workpiece Material Selection & Machinability Database](#workpiece-material-selection)
   - [Stock Definition & WCS Datum Positioning (G54/G55/G56)](#stock-definition--wcs-datum-positioning)
   - [B-Rep Topological Feature Recognition](#b-rep-topological-feature-recognition)
   - [Multi-Setup Management & Fixture Clearance](#multi-setup-management)
   - [Tool Library & Holder Management](#tool-library--holder-management)
   - [Operation Planning & Sequencing Strategy](#operation-planning--sequencing-strategy)
   - [Fine-Tuning Cutting Parameters (Speed, Feed, Stepdown, Stepover)](#fine-tuning-cutting-parameters)
7. [Stage 4: 3D Toolpath Simulation & Verification](#7-stage-4-3d-toolpath-simulation--verification)
   - [Toolpath Visual Coding (Rapid, Linear, Arcs, Plunges)](#toolpath-visual-coding)
   - [Simulation Player Controls (Play, Pause, Scrub, Speed)](#simulation-player-controls)
   - [Volumetric Stock Removal & Gouge Detection](#volumetric-stock-removal--gouge-detection)
   - [Tool Shank & Holder Interference Checking](#tool-shank--holder-interference-checking)
8. [Stage 5: G-Code Post-Processing & Production Export](#8-stage-5-g-code-post-processing--production-export)
   - [Selecting the Appropriate Post-Processor](#selecting-the-appropriate-post-processor)
   - [Machine Capability & Safety Constraint Validation](#machine-capability--safety-constraint-validation)
   - [Interactive G-Code Viewer & Toolpath Synchronizer](#interactive-g-code-viewer)
   - [Exporting Production Deliverables (G-Code, STEP, STL, DXF, Setup Sheet)](#exporting-production-deliverables)
9. [Tool & Holder Library Administration](#9-tool--holder-library-administration)
   - [Defining Custom Endmills, Ballmills, Drills, and Taps](#defining-custom-tools)
   - [Configuring Tool Holders & Gauge Lengths](#configuring-tool-holders)
   - [Importing and Exporting Tool Libraries (JSON Backup)](#importing-and-exporting-tool-libraries)
10. [Troubleshooting & Best Practices](#10-troubleshooting--best-practices)
    - [Resolving WebGL & 3D Canvas Context Resets](#resolving-webgl-context-resets)
    - [Overcoming AI Generation Failures & Geometric Repair](#overcoming-ai-generation-failures)
    - [CAM Validation Error Resolutions](#cam-validation-error-resolutions)
    - [Physical CNC Machine Pre-Flight Checklist](#physical-cnc-machine-pre-flight-checklist)
11. [Keyboard Shortcuts & Quick Reference Matrix](#11-keyboard-shortcuts--quick-reference-matrix)

---

## 1. Introduction to VΞXCAD

### What is VΞXCAD?
**VΞXCAD** (internally designated *V-XCAD*) is a modern, cloud-native, AI-driven CAD/CAM platform engineered to compress the traditional manufacturing lifecycle from hours into seconds. 

By unifying **Large Language Model (LLM) geometric synthesis**, **boundary-representation (B-Rep) parametric CAD modeling**, and **automated Computer-Aided Manufacturing (CAM) toolpath generation**, VΞXCAD takes an engineer or machinist from an initial 2D engineering drawing or prompt to machine-ready, verified CNC G-code in an integrated browser-based workflow.

### Core Design Philosophy
- **"From Sketch to Spindle in Seconds"**: Eliminate the friction of transferring files across disconnected CAD authoring tools, external CAM packages, and third-party post-processors.
- **Parametric by Construction**: All models are synthesized as programmatic Python scripts using the state-of-the-art `build123d` CAD kernel. Changing a dimension does not deform a dumb polygonal mesh—it re-evaluates the true mathematical solid.
- **Strict Coordinate Safety**: G-code post-processing is strictly constrained by a deterministic machine capability matrix. If an operation violates axis travel limits, tool clearance, or machine capabilities (e.g., attempting a 5-axis simultaneous toolpath on a 3-axis mill), generation is automatically blocked.
- **Human-in-the-Loop (HITL) Precision**: AI provides the initial velocity; human engineering provides the final authority. Operators retain granular control to manually edit geometry, manipulate sub-shapes, override speeds and feeds, configure setups, and inspect simulations.

### System Requirements & Browser Compatibility
- **Browser**: Google Chrome 115+, Microsoft Edge 115+, Mozilla Firefox 120+, or Apple Safari 17+ (WebGL 2.0 and Hardware Acceleration enabled).
- **GPU**: Dedicated GPU recommended (NVIDIA GTX 1050 / AMD Radeon RX 560 or Apple M-Series equivalent or better) for smooth 60 FPS 3D rendering and volumetric toolpath simulation.
- **Display Resolution**: 1920 × 1080 (Full HD) minimum recommended; supports 2K and 4K ultra-wide monitors.
- **Input**: 3-button mouse with scroll wheel strongly recommended for professional CAD navigation.

---

## 2. Getting Started & Account Setup

### Registration and Authentication
1. Launch the web interface by navigating to your deployment URL (default local address: `http://localhost:3000`).
2. If you are a new user, click **Get Started** in the top-right navigation bar to navigate to `/register`.
3. Enter your **Full Name**, **Work Email**, and a secure **Password**.
4. Once registered, log in at `/login`. Your active session uses secure, encrypted JWT cookies.

### Navigating the Home Portal
The Landing Page showcases:
- **Interactive 3D Hero Canvas**: Test-drive 3D viewport rotation, zoom, and wireframe toggles before opening a project.
- **"How It Works" Section**: Visual overview of Blueprint Analysis, AI Geometry Generation, and CNC Post-Processing.
- **Feature Matrix**: Details on the parametric CAD kernel, B-Rep recognition engine, and multi-controller G-code generators.
- Click **Open Workspace** in the top navigation to enter the primary engineering studio.

### Managing Sessions & Projects
- **Automatic Persistence**: All sessions, conversation histories, geometric parameters, and CAM operations are automatically stored in PostgreSQL.
- **Session Browser Modal**: Inside the workspace, click the **Folder / Project** icon (`FolderKanban`) in the top navigation to browse saved sessions, switch between customer jobs, or spawn a fresh workspace.
- **Session Reset**: Click the **New Job (+)** button to clear the current workspace canvas and begin a new CAD/CAM session.

---

## 3. The Workspace Interface

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ ① TOP BAR: Project Name | Revision Picker | Undo/Redo | Export [▼] | Stage Switcher       │
├──────────────┬───────────────────────────────────────────────────────────┬───────────────┤
│ ② LEFT PANEL │ ③ 3D VIEWPORT                                             │ ④ RIGHT DOCK  │
│              │                                              ┌──────────┐ │               │
│ - Chat Panel │                                              │VIEW CUBE │ │ - Parameters  │
│ - Blueprint  │                                              └──────────┘ │ - Feature Tree│
│   Inspector  │                                                           │ - CAM Ops     │
│ - Prompt     │                                                           │ - G-Code      │
│   Assistant  │                                                           │   Viewer      │
├──────────────┴───────────────────────────────────────────────────────────┴───────────────┤
│ ⑤ BOTTOM DOCK: Engineering Diagnostics Console | Subprocess Logs | AST Syntax Inspector    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Overview of the 3-Pane Layout
The workspace is split into three responsive, resizable panels:
1. **Left Panel (Control & Input)**: Contains the AI Chat panel, file upload dropzone, target portion selectors, and the visual CAD Prompt Assistant.
2. **Center Panel (3D Viewport)**: High-performance Three.js WebGL canvas displaying real-time 3D geometry, dimensions, gizmos, and animated toolpaths.
3. **Right Dock (Parametric & CAM Data)**: Dynamically switches based on the active workflow stage (Displays editable parameters in AI CAD, direct modeling tools in Manual CAD, and operations/G-code in CAM Setup).
4. **Engineering Console (Bottom Drawer)**: Expandable drawer providing real-time build logs, AST security audit traces, Python script views, and raw diagnostic output.

### The Stage Switcher & Workflow Pipeline
At the top of the screen is the **Stage Switcher** and **Workflow Pipeline Navigation**. You can seamlessly transition between:
- **AI CAD**: Natural language and blueprint-driven CAD generation.
- **Manual CAD**: Direct topological sub-shape manipulation (Fusion/FreeCAD style).
- **CAM Setup**: Toolpath generation, machining operations, simulation, and G-code export.

### 3D Viewport Controls & Navigation
The 3D canvas adheres to standard engineering CAD navigation standards:

| Action | Mouse Input | Trackpad / Gesture | Shortcut Key |
| :--- | :--- | :--- | :--- |
| **Orbit / Rotate** | Right-Click + Drag *or* Middle-Click + Drag | Two-finger drag | Arrow Keys |
| **Pan / Translate** | Shift + Middle-Click + Drag *or* Shift + Right-Click + Drag | Shift + Two-finger drag | — |
| **Zoom In / Out** | Scroll Wheel Up / Down | Pinch In / Out | `+` / `-` |
| **Fit to Screen** | Double-Click Background | — | `Home` or `F` |
| **Clear Selection** | Left-Click Empty Space | Tap Empty Space | `Esc` |

### The View Cube & Preset Perspectives
Located in the upper-right corner of the 3D viewport:
- Click **FRONT**, **BACK**, **TOP**, **BOTTOM**, **LEFT**, or **RIGHT** to snap the camera to pure orthographic alignment.
- Click corner chamfers on the cube for standard isometric views (e.g., Isometric Northeast).
- Click the **Home Icon** above the cube to reset the camera to the default engineering perspective.

### Theme & Display Settings
Toggle between dark and light modes via the **Theme Toggle** (`Sun`/`Moon` icon).
- **Dark Mode**: Optimized for low-light shop-floor environments with high-contrast cyan/emerald accents.
- **Light Mode**: High-visibility clean paper aesthetic for inspection and technical reports.
- **Grid Options**: Infinite ground grid with 10 mm major grid spacing and 1 mm minor divisions for instantaneous visual scale estimation.

---

## 4. Stage 1: AI CAD Generation (Blueprint to 3D)

### Prompt Engineering & Drawing Uploads
To generate a 3D part from scratch:
1. Locate the **AI Chat Panel** on the left.
2. In the text input, provide a descriptive natural language prompt specifying overall dimensions, primary features, and functional intent.
   - *Example Prompt*: `"Create a rectangular aluminum mounting bracket 120 mm long, 80 mm wide, and 15 mm thick. Add four M6 clearance counterbored holes spaced 15 mm from each corner. Mill a central pocket 50 mm by 30 mm, 8 mm deep, with 3 mm internal corner radii."`
3. If working from an existing physical drawing, click the **Attach / Blueprint Upload** icon or drag and drop your file into the chat dropzone.

### Supported Drawing Formats & Best Practices
- **Supported File Types**: `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`.
- **Optimal Drawing Characteristics**:
  - High resolution (minimum 150 DPI; 300 DPI preferred).
  - Clean engineering blueprints showing orthographic 3-view projections (Top, Front, Side).
  - Explicit dimension lines, tolerances, and title blocks.
  - Avoid handwritten sketches with illegible annotations.

### Model Selection & Inference Settings
In the model selector dropdown at the top of the chat panel, choose your AI reasoning engine:
- **Gemini 2.5 Flash / Gemini 3.1 Flash-Lite (Recommended)**: Ultra-fast generation, excellent vision parsing of engineering blueprints, optimized for parametric scripts.
- **OpenRouter Fallbacks**: DeepSeek R1, Claude 3.5 Sonnet, or GPT-4o for complex multi-stage geometric reasoning.

### Real-time Generation & Parametric Extraction
When you click **Submit / Generate**:
1. **Stage 1 (Vision Extraction)**: The AI Engine parses the blueprint image, identifying bounding dimensions, hole patterns (PCD or rectangular), datums, and thread callouts.
2. **Stage 2 (Code Synthesis)**: The engine streams Python tokens via Server-Sent Events (SSE). The generated script utilizes `build123d` and encapsulates all dimensions within a top-level `PARAMETERS` dictionary.
3. **Stage 3 (AST Security Audit)**: The backend inspects the code tree to ensure no malicious modules (e.g., `os`, `socket`, `subprocess`) are present.
4. **Stage 4 (Isolated Compilation)**: The script executes in a sandboxed worker subprocess.
5. **Instant 3D Preview**: The generated `.stl` and `.step` solids are sent back to your browser and automatically rendered in the 3D viewport.

### Live Dimension Sync & AST Subprocess Compilation
Once generated, the right-hand **Parameters Drawer** reveals all extracted variables:
- Bounding Box Dimensions: `length`, `width`, `height`, `thickness`.
- Feature Sizes: `hole_diameter`, `pocket_depth`, `fillet_radius`.
- **Modifying Values**: Simply adjust any numeric input box or slider.
- Click **Sync to Engine**: VΞXCAD uses Python Abstract Syntax Tree (AST) injection to rewrite the `PARAMETERS` dictionary without prompting the LLM again. The solid re-renders in under 500 ms!

### The CAD Prompt Assistant (Multimodal Discrepancy Inspection)
If the AI-generated model diverges from your technical drawing:
1. Click the **Prompt Assistant** button (`Sparkles` icon) in the left panel.
2. The assistant captures high-resolution WebGL multi-angle snapshots of your current 3D canvas and compares them against your original blueprint.
3. It generates an automated **Discrepancy Report**:
   - Missed features (e.g., *"Blueprint specifies 4 counterbored holes; 3D model only has through-holes"*).
   - Dimensional mismatches (e.g., *"Pocket depth is 6 mm instead of 10 mm"*).
4. Click **Apply Suggested Prompt**: The assistant loads a targeted correction prompt with explicit coordinate fixes directly into your chat.

### Revision History & Rollback
- Every successful compilation creates an immutable **Revision Node** (e.g., `rev_001`, `rev_002`).
- Open the **Revision History Dropdown** at the top bar to inspect parameter diffs, review the visual summary of changes, or revert to an earlier iteration with a single click.

---

## 5. Stage 2: Manual CAD Workspace (Direct Modeling)

When you need exact, human-guided modifications without prompting the AI, toggle the stage switcher to **Manual CAD**. This activates a direct 3D modeling environment built on the OpenCASCADE/B-Rep kernel.

### Entering the Manual CAD Environment
The viewport updates with:
- **Left Tool Rail**: Grouped CAD ribbons (Select, Transform, Primitives, Features, Modifiers, Split, Pattern, Inspect).
- **Selection Context Bar**: Quick-toggle filter chips for **Body**, **Face**, and **Edge**.
- **Interactive Transform Gizmos**: On-canvas 3D translation arrows and rotation arcs.

### Selection Filters (Body, Face, Edge)
- **Body Filter (`B`)**: Selects the entire component. Used for global transformations, mirroring, bed alignment, scaling, and shelling.
- **Face Filter (`V`)**: Highlights planar, cylindrical, conical, or toroidal faces. Hovering displays a soft cyan highlight; clicking selects with an accent glow.
- **Edge Filter (`E`)**: Snaps to topological boundary lines and loops. Essential for fillets and chamfers.

### Transform Operations
Select the solid body to access the Transform ribbon:
- **Move (`G`)**: Translate along X, Y, or Z axes. Use on-screen arrows or input explicit millimeter offsets.
- **Rotate (`R`)**: Rotate about the X, Y, or Z axis around either the part's geometric center or the global origin.
- **Scale (`S`)**: Uniform scaling or independent anisotropic per-axis scaling (X/Y/Z factors).
- **Mirror (`M`)**: Reflect the body across standard planes (`XY`, `YZ`, `XZ`) or across any selected planar face. Option to keep the original solid for symmetrical enclosures.
- **Align to Bed (`A`)**: One-click alignment options:
  - *Drop to Bed*: Translates the bottom-most point to $Z = 0$.
  - *Face Down*: Rotates a selected face flat against the $XY$ plane.
  - *Center Origin*: Centers the bounding box at $(X:0, Y:0)$.

### Adding and Cutting Primitives
Click **Add / Cut Shape (`N`)** to spawn parameterized primitives:
- **Shapes**: Box, Cylinder, Sphere, Cone.
- **Boolean Modes**:
  - **Add (Union)**: Joins the primitive to the active part.
  - **Subtract (Cut)**: Uses the primitive to bore cavities or cut reliefs.
  - **Intersect**: Retains only the overlapping volume between the primitive and the body.

### Hole Wizard
1. Select any planar face on your model.
2. Click **Hole Wizard (`H`)**.
3. Choose the **Hole Type**:
   - **Blind**: User-defined diameter and depth.
   - **Through**: Automatically pierces the solid down to the opposing face.
   - **Counterbore**: Includes Counterbore Diameter and Counterbore Depth.
   - **Countersink**: Includes Countersink Diameter and Angle (Standard 90° or 82°).
4. **Standard Presets Dropdown**: Instantly populate standard metric and imperial tapping clearance sizes: `M3`, `M4`, `M5`, `M6`, `M8`, or `1/4"`.
5. Adjust position $(U, V)$ coordinates or drag the placement handle directly on the face.
6. Click **Apply (`Enter`)** to execute.

### Pocket Cuts & Boss/Pad Extrusions
- **Pocket Cut (`P`)**:
  - Select a planar face.
  - Select profile geometry: **Rectangle**, **Circle**, or **Slot**.
  - Specify Width, Length/Diameter, Depth, Corner Radius, and Rotation angle.
  - Click **Apply** to mill the pocket into the solid.
- **Pad / Boss (`E`)**:
  - Select a planar face.
  - Define profile (Rectangle or Circle) and extrusion height.
  - Creates a raised mounting boss seamlessly fused to the parent face.

### Edge Treatments: Fillet & Chamfer
- **Fillet (`F`)**: Select one or more edges. Input radius (e.g., 2.0 mm). Generates a smooth tangential blend. VΞXCAD pre-calculates the maximum allowable radius to prevent self-intersecting geometry.
- **Chamfer (`C`)**: Select edges and specify distance (e.g., 1.0 mm). Creates a uniform 45° bevel. Ideal for deburring and lead-in edges.

### Face Push/Pull, Shelling, and Offset
- **Push / Pull Face**: Click any planar face and use the arrow handle to extend or recess the surface along its normal vector.
- **Shell (`T`)**: Select a body, choose an open face, and specify wall thickness (e.g., 2.0 mm). Hollows out the interior to produce lightweight castings or enclosures.
- **Offset (`O`)**: Uniformly expands or contracts the entire external surface envelope.

### Splitting by Plane & Patterning
- **Split by Plane (`L`)**: Bisect the part using the $XY$, $YZ$, or $XZ$ plane (or a selected face). Select whether to keep the top portion, bottom portion, or preserve both halves.
- **Linear Pattern (`Y`)**: Duplicate the part or feature across a defined pitch count $(N)$ and directional spacings $(ΔX, ΔY, ΔZ)$.
- **Polar Pattern (`U`)**: Create radial arrays around an axis (e.g., 6 instances spaced across 360°).

### Mesh Healing & Geometry Inspection
Click **Heal / Clean (`K`)** to clean up messy geometry:
- Fix boundary loop orientation.
- Merge co-planar split faces into single uninterrupted B-Rep surfaces.
- Discard disconnected solid artifacts.

### Interactive Measurement & Section View Plane
- **Measure Tool (`M`)**: Click between any two vertices, edges, or faces to reveal real-time 3D dimension callouts (center-to-center distance, edge lengths, surface areas, and cylinder diameters).
- **Section View**: Toggle the clipping plane in the viewport context bar. Drag the plane slider along X, Y, or Z to slice open the visual model and inspect internal cavities, bores, and wall thicknesses without altering underlying geometry.

---

## 6. Stage 3: CAM Setup & Operation Planning

Once your 3D CAD geometry is finalized, switch the stage to **CAM Setup**. VΞXCAD shifts into an industrial CAM environment.

### The Automated CAM Pipeline Explained
The VΞXCAD CAM Engine executes an automated 8-stage manufacturing sequence:

```
[STEP Import] ──▶ [B-Rep Feature Recognition] ──▶ [Machinability & Material Rules]
                                                             │
[Post-Processing] ◀── [Toolpath Generation] ◀── [Operation Planning & Setups]
```

Every candidate operation is validated against physical physics: tool reach, spindle torque limits, flute lengths, and coordinate envelopes.

### Machine Matrix Selection
Click the **Machine Selection Modal** to designate your CNC machine:
- **Kinematic Types**: 3-Axis Vertical Machining Center (VMC), 4-Axis VMC, 5-Axis VMC, CNC Lathe, Mill-Turn, Drill-Tap Center, or CNC Router.
- **Machine Profiles**:
  - *Haas VF-2 / VF-4* (Haas NGC)
  - *Fanuc Robodrill* (Fanuc 31i-B5)
  - *DMG Mori CMX 1100V* (Siemens 840D)
  - *Mazak VCN-530C* (Mazak SmoothG)
  - *Datron neo* (High-Speed Machining Router)
  - *Generic Open-Source* (LinuxCNC, GRBL, Mach3)
- **Constraint Enforcement**: The engine checks machine travel limits $(X_{\max}, Y_{\max}, Z_{\max})$, rapid traverse rates, and maximum spindle RPM.

### Workpiece Material Selection
Open the **Material Selection Modal** to pick from 8 primary material categories:
1. **Aluminum Alloys**: 6061-T6, 7075-T6 (High cutting speeds, flood coolant, carbide tooling).
2. **Carbon & Alloy Steels**: 1018 Mild Steel, 4140 Chromoly (Moderate speeds, heavy chip loads).
3. **Tool Steels**: D2, O1, P20 (Hardened die steels, high rigidity requirements).
4. **Stainless Steels**: 304, 316, 17-4 PH (Work-hardening mitigation, peck drilling).
5. **Titanium & Superalloys**: Grade 5 Titanium (Ti-6Al-4V), Inconel 718 (Low surface speeds, high-pressure coolant).
6. **Copper, Brass & Bronze**: C360 Free-Machining Brass (Dry or mist cutting, high surface speeds).
7. **Cast Irons**: Class 30 Gray Iron (Abrasive dust, dry cutting).
8. **Engineering Plastics**: Delrin (Acetal), PEEK, UHMW (Sharp positive rake tooling, prevent heat warping).

*Selecting a material automatically loads baseline surface speeds ($V_c$ in m/min), feed per tooth ($f_z$ in mm), and recommended coolant modes into every subsequent operation.*

### Stock Definition & WCS Datum Positioning
1. Open the **Volumetric Stock Panel**.
2. Select your **Stock Mode**:
   - **Auto Bounding Box**: Wraps the part with configurable safety offsets (e.g., $+2.0\text{ mm}$ top facing allowance, $+5.0\text{ mm}$ perimeter margin).
   - **Standard Bar Stock**: Snaps to nearest commercially available rectangular or round billet dimensions.
3. **Work Coordinate System (WCS)**:
   - Designate fixture offset: `G54`, `G55`, `G56`, etc.
   - Choose origin placement: *Top Center*, *Top Corner (Left-Front)*, or *Bottom Center*.
   - Align the spindle axis ($Z+$) normal to the top machining face.

### B-Rep Topological Feature Recognition
Click **Analyze Features**. The engine scans the exact topological B-Rep entity tree and categorizes:
- **Prismatic Holes**: Blind Holes, Through Holes, Counterbores, Countersinks.
- **Bores**: Precision cylindrical inner diameters requiring helical interpolation or boring bars.
- **Pockets**: Closed planar bottom pockets, open boundary pockets, through pockets.
- **Slots & Steps**: Keyways, T-slots, side shoulders, steps.
- **Planar Walls**: External contours, vertical boundary perimeters, facing regions.
- **Bosses**: Raised circular and rectangular islands.
- **Transitions**: Corner fillets and chamfers.

Each recognized feature shows its bounding box, floor depth, diameter, and tool accessibility status.

### Multi-Setup Management
If a component features geometry on multiple sides that cannot be reached from a single tool axis:
1. Open the **Multi-Setup Manager**.
2. The engine groups features into independent setups:
   - **Setup 1 (Top Operations)**: Primary facing, roughing, pockets, and holes.
   - **Setup 2 (Flip Operations)**: Secondary flip over $X$ or $Y$ to face off stock hat, chamfer bottom edges, or drill back-side holes.
3. Configure datum references and vise clamping boundaries for each setup.

### Tool Library & Holder Management
Assign tools to operations from the active **Tool Library**:
- **Tool Types**: Flat Endmills, Ball Endmills, Bull Nose (Corner Radius) Mills, Drills, Center Drills, Reamers, Taps, Chamfer Mills, Face Mills.
- **Tool Geometry**: Diameter, Flute Length, Overall Length (OAL), Number of Flutes, Tool Material (Carbide, HSS, Cobalt, Diamond/PCD).
- **Holders**: ER Collet Chucks, Side-Lock Endmill Holders, Hydraulic Chucks, Shrink-Fit Holders. Specifying gauge length ensures accurate holder collision detection during deep pocketing.

### Operation Planning & Sequencing Strategy
The **Operation Tree** automatically organizes manufacturing logic:
1. **Facing (`G54`)**: Removes top stock skin to establish a precision $Z=0$ reference.
2. **Adaptive / Pocket Roughing**: Rapidly clears bulk material using constant tool-engagement trochoidal paths.
3. **Rest Machining**: Uses a smaller endmill to clear corners left behind by large roughing cutters.
4. **Semi-Finishing**: Leaves a uniform $0.2\text{ mm}$ finish allowance along walls and floors.
5. **Wall & Floor Finishing**: High-speed, light chip load contouring for mirror surface finishes ($Ra < 0.8\text{ µm}$).
6. **Hole Making Sequence**:
   - Spot Drilling (pre-locates drill tip).
   - Deep Hole Peck Drilling (`G83` / `G73`).
   - Counterboring / Chamfering.
   - Reaming or Rigid Tapping (`G84`).
7. **Deburring & Edge Breaking**: Chamfer mill sweeps the top perimeter.

### Fine-Tuning Cutting Parameters
Click on any operation in the table to modify its parameters in the **Cutting Parameters Section**:
- **Spindle Speed ($S$)**: Explicit RPM or calculated via surface speed:
  $$S = \frac{V_c \times 1000}{\pi \times D}$$
- **Cutting Feed ($F$)**: Feed rate in mm/min:
  $$F = S \times z \times f_z$$
- **Axial Depth of Cut ($A_p$)**: Stepdown per pass (mm).
- **Radial Depth of Cut ($A_e$)**: Stepover percentage (e.g., 40% tool diameter).
- **Coolant Trigger**: `Flood`, `Mist`, `Air Blast`, `Through-Spindle (TSC)`, or `Off`.

---

## 7. Stage 4: 3D Toolpath Simulation & Verification

Before sending any code to an expensive CNC machine, verify the operations in the 3D Simulation Engine.

### Toolpath Visual Coding
Toolpaths are rendered directly over the 3D model with industry-standard color encoding:

| Color | Movement Type | G-Code Equivalent | Description |
| :--- | :--- | :--- | :--- |
| **Yellow** | Rapid Traverse | `G0` / `G00` | Non-cutting high-speed repositioning above clearance plane |
| **Cyan / Bright Blue** | Linear Cutting Feed | `G1` / `G01` | Controlled material removal feed |
| **Green** | Circular / Arc Interpolation | `G2` / `G3` | Clockwise / Counter-clockwise precision arc motions |
| **Orange / Amber** | Helical Ramp / Entry | `G1` / `G2` Ramp | Smooth lead-in entering solid stock without plunge chatter |
| **Red** | Direct Plunge | `G1` $(Z-)$ | Pure vertical descent into holes or pre-drilled reliefs |
| **Magenta / Purple** | Retract / Lead-Out | `G0` / `G1` | Safe tool withdrawal to clearance height |

### Simulation Player Controls
The floating **Simulation Controller** bar allows full temporal control:
- **Play / Pause (`Space`)**: Start or freeze the simulation.
- **Scrubbing Slider**: Drag the progress bar to instantly jump to any point in the machining timeline.
- **Speed Multiplier**: Adjust playback speed ($0.25\times$, $1\times$, $2\times$, $5\times$, $10\times$).
- **Step Forward / Backward**: Step through one individual motion block at a time.
- **Tool Display**: Renders accurate 3D spindle, tool holder, shank, and cutting flutes rotating and traversing along the path.

### Volumetric Stock Removal & Gouge Detection
- Enable **Volumetric Stock Simulation**: The raw billet stock is rendered as a semi-transparent solid block.
- As the cutting flutes pass through the block, material is carved away in real time.
- **Remaining Stock Heatmap**: Displays residual un-machined material. Blue represents in-tolerance finished surfaces; green indicates remaining stock allowance; orange/red warns of overcuts.
- **Gouge Detection**: If the tool flutes cut deeper than the CAD model boundary, the simulation pauses immediately and highlights the gouged surface in flashing red with an alert coordinate.

### Tool Shank & Holder Interference Checking
- **Holder Collision**: If the tool stickout length is too short and the tool holder collar contacts the raw workpiece or vise clamps, the simulation triggers a **Fatal Collision Alarm**.
- **Clearance Verification**: All rapid traverses (`G0`) are verified to ensure they clear clamps and tall islands by at least the specified Retract Plane distance (default: $5.0\text{ mm}$ above stock).

---

## 8. Stage 5: G-Code Post-Processing & Production Export

### Selecting the Appropriate Post-Processor
Click **Post-Process** and select the controller format matching your machine's CNC control:
- **`HAAS_NGC_3X_MILL`**: Haas Next Generation Control (Standard Haas canned cycles, `G187` smoothing).
- **`FANUC_3X_MILL`**: Industry standard Fanuc 0i-MF / 31i (Strict ISO standard, `G80` cancels, `M08`/`M09` coolant).
- **`SIEMENS_840D_ONE_3X_MILL`**: Siemens Sinumerik (High-precision `CYCLE800` plane support, `CYCLE83` deep hole peck).
- **`HEIDENHAIN_TNC_3X_MILL`**: Heidenhain Klartext / ISO format.
- **`MAZAK_SMOOTH_EIA_3X_MILL`**: Mazak EIA/ISO conversational-compatible formatting.
- **`LINUXCNC_3X_MILL`**: Open-source PC-based industrial controllers.
- **`GRBL_3X_ROUTER`**: Lightweight desktop CNC routers and hobby mills.

### Machine Capability & Safety Constraint Validation
Before generating G-code, VΞXCAD runs the post-processor through the **Safety Validation Matrix**:
- Validates that spindle speed does not exceed the machine profile's maximum motor capacity.
- Confirms all axes $(X, Y, Z)$ remain strictly within physical machine travel limits.
- Blocks unsupported cycles (e.g., attempting rigid tapping without machine encoder support).
- *If any violation occurs, G-code generation is strictly halted, displaying the exact operation ID and required corrective action.*

### Interactive G-Code Viewer & Toolpath Synchronizer
Once post-processing succeeds, the right-hand panel opens the **G-Code Viewer**:
- **Syntax Highlighting**: Line numbers (`N...`), coordinates (`X... Y... Z...`), feed rates (`F...`), spindle speeds (`S...`), and M-codes are distinctly colored.
- **Two-Way Synchronization**:
  - Click any line of G-code in the editor: The 3D viewport immediately jumps the camera and tool position to that exact toolpath segment.
  - Click any toolpath segment in the 3D canvas: The G-code editor scrolls automatically to the corresponding line of code.
- **Cycle Time Estimator**: Displays total estimated cycle time broken down by rapid time, cutting time, tool change pauses, and peck dwell durations.

### Exporting Production Deliverables
Click the **Export** menu in the top bar to download all production files:
1. **G-Code (`.nc`, `.tap`, `.gcode`)**: Production-ready numerical control file ready to load onto your machine via USB or DNC network.
2. **CAD Solid Models**:
   - **`STEP (.step)`**: Universal AP214/AP242 boundary representation solid.
   - **`STL (.stl)`**: High-density triangulated surface mesh for 3D printing or rendering.
   - **`DXF (.dxf)`**: 2D flat layout profiles for laser, plasma, or waterjet cutting.
3. **Setup Sheet (PDF / Summary)**:
   - Comprehensive operator document detailing:
     - Part name, material specification, and raw stock dimensions.
     - Work Coordinate System (WCS) datum location with reference diagram.
     - Tool list table (Tool Number, Tool Name, Diameter, Flute Length, Holder type, Stickout gauge length).
     - Operation sequence list with estimated cycle times.

---

## 9. Tool & Holder Library Administration

Manage your shop floor's physical tooling inventory through the dedicated Tooling portals.

### Defining Custom Endmills, Ballmills, Drills, and Taps
Navigate to `/tools` or open the **Manage Tools** tab in CAM:
1. Click **Add New Tool**.
2. Fill in the tool specification:
   - **Tool Name / Description** (e.g., *"10mm 4-Flute AlTiN Roughing Endmill"*).
   - **Type**: Flat Endmill, Ball Endmill, Bull Nose, Drill, Tap, etc.
   - **Diameter ($D$)**: Cutting diameter in mm.
   - **Flute Length ($L_c$)**: Maximum permissible cutting depth.
   - **Overall Length ($L$)**: Total length from shank base to tip.
   - **Flute Count**: Number of cutting edges.
   - **Tool Material**: Solid Carbide, HSS, HSS-Cobalt, Diamond.
3. Click **Save Tool**. The tool is assigned a unique tool number (`T01`, `T02`) in your database.

### Configuring Tool Holders & Gauge Lengths
Navigate to `/holders` or open the **Manage Holders** tab:
1. Click **Add New Holder**.
2. Choose holder style (ER32 Collet Chuck, BT40 Shrink-fit, CAT40 Endmill Holder).
3. Specify collar diameter and projection gauge length.
4. The 3D collision engine uses these exact dimensions when verifying clearance near part walls and clamping fixtures.

### Importing and Exporting Tool Libraries
Navigate to `/import-export`:
- **Export Tool Library**: Click **Export to JSON** to download a complete backup of all configured tools, speeds, feeds, and holders.
- **Import Tool Library**: Restore or migrate tool tables between different workstations or company machines.

---

## 10. Troubleshooting & Best Practices

### Resolving WebGL & 3D Canvas Context Resets
- **Symptom**: The 3D viewport displays a *"3D Graphics Context Resetting"* card or turns black after waking your computer from sleep.
- **Cause**: The operating system or browser GPU driver temporarily terminated the WebGL context to conserve power.
- **Solution**:
  - Click the **Restore 3D Viewport** button on the error card.
  - Alternatively, press `Ctrl + R` (or `Cmd + R`) to refresh the page; all parameters and session data will remain intact via PostgreSQL persistence.

### Overcoming AI Generation Failures & Geometric Repair
- **Symptom**: AI generation returns an execution error (e.g., *"Self-intersecting wire"* or *"Fillet radius exceeds edge length"*).
- **Solutions**:
  1. Open the bottom **Engineering Console** to view the exact Python traceback line number.
  2. Use the **CAD Prompt Assistant**: Click the sparkles icon to let the vision model inspect the geometry and suggest an automatic fix.
  3. Switch to **Manual CAD**: Select the offending face or edge directly and adjust the parameter to a valid size.

### CAM Validation Error Resolutions
- **Error: "Feature Inaccessible with Current Tool Axis"**:
  - *Cause*: A hole or pocket is oriented sideways or undercut relative to the active spindle direction.
  - *Fix*: Create a secondary setup in the **Multi-Setup Manager** and rotate the tool axis normal to the feature.
- **Error: "Spindle RPM exceeds Machine Limit"**:
  - *Cause*: The material's cutting speed formula requested an RPM higher than the machine profile supports (e.g., 18,000 RPM on a 10,000 RPM mill).
  - *Fix*: Override the spindle speed in the Cutting Parameters section or select a higher-speed machine profile.
- **Error: "Tool Holder Collision Detected"**:
  - *Cause*: Tool stickout length is shorter than the pocket depth.
  - *Fix*: Increase the tool's flute length/stickout or select a longer collet extension in the Tool Library.

### Physical CNC Machine Pre-Flight Checklist
Before pressing the Green Cycle Start button on your CNC machine:
1. [ ] **Verify Work Offset**: Probe and confirm physical $X, Y, Z$ datum coordinates match the WCS (`G54`) origin shown in the VΞXCAD Setup Sheet.
2. [ ] **Measure Tool Stickouts**: Ensure physical tool gauge lengths match or exceed the minimum stickout specified in the simulation.
3. [ ] **Dry Run / Air Cut**: Run the G-code program $50\text{ mm}$ above the workpiece with Rapid Override at 25% to visually verify toolpaths.
4. [ ] **Check Clearance**: Ensure clamps, vise jaws, and fixture bolts do not intersect rapid traverse planes.

---

## 11. Keyboard Shortcuts & Quick Reference Matrix

### Viewport Navigation
| Shortcut | Action |
| :--- | :--- |
| `Right-Click + Drag` | Orbit / Rotate Viewport |
| `Shift + Right-Click + Drag` | Pan Viewport |
| `Scroll Wheel` | Zoom to Cursor |
| `F` or `Home` | Fit Part to Screen |
| `Numpad 1` | Front View |
| `Numpad 3` | Right View |
| `Numpad 7` | Top View |
| `Esc` | Clear Active Selection / Close Open Tool Dialog |

### Manual CAD Modeling Shortcuts
| Shortcut | Tool / Action | Selection Requirement |
| :--- | :--- | :--- |
| `V` | Selection Tool | None |
| `G` | Move / Translate | Whole Body or Feature |
| `R` | Rotate | Whole Body |
| `S` | Scale | Whole Body |
| `M` | Mirror | Whole Body |
| `A` | Align to Bed | Whole Body (Optional Face) |
| `N` | Add / Cut Primitive Shape | Whole Body |
| `H` | Hole Wizard | Planar Face |
| `P` | Pocket Cut | Planar Face |
| `E` | Pad / Boss Extrusion | Planar Face |
| `F` | Edge Fillet | One or More Edges |
| `C` | Edge Chamfer | One or More Edges |
| `T` | Shell Solid Body | Body + Open Face |
| `O` | Offset Envelope | Whole Body |
| `L` | Split by Plane | Body + Plane / Face |
| `Y` | Linear Pattern | Whole Body |
| `U` | Polar Pattern | Whole Body |
| `K` | Heal & Clean Geometry | Whole Body |
| `D` | Measure Distance & Area | Two Entities (Vertices, Edges, Faces) |
| `Ctrl + Z` | Undo Last Modification | — |
| `Ctrl + Shift + Z` | Redo Modification | — |

### CAM & Simulation Controls
| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause Toolpath Simulation |
| `[` / `]` | Decrease / Increase Simulation Playback Speed |
| `Left Arrow` / `Right Arrow` | Step One Block Backward / Forward in G-Code |
| `S` | Toggle Stock Model Visibility |
| `T` | Toggle Toolpath Line Visibility |

---

*VΞXCAD Documentation & User Manual • Version 1.0.0 • Maintained by the V-XCAD Engineering Team*
