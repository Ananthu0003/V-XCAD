# Adding a Manual CAD Operation

This checklist walks through the process of adding a new direct modeling operation to the VEXCAD backend, using an "Offset Face" feature as a running example.

## 1. Backend Implementation (`ai-engine`)

### Define the Geometry Handler
Open `ai-engine/app/services/geometry/manual_cad_service.py` and implement the operation logic. The handler must have the standard signature:

```python
def _apply_offset_face(
    self,
    shape: bd.Shape,
    refs: List[GeometricReference],
    params: Dict[str, Any]
) -> Tuple[Optional[bd.Shape], OperationStatus, str, List[str], List[str]]:
    # Example logic:
    if not refs or refs[0].entity_type != "face":
        return None, OperationStatus.INVALID_REFERENCE, "Offset requires a planar face.", [], []
    
    face, status, msg = ReferenceResolver.resolve_face(shape, refs[0])
    if status != OperationStatus.VALID or face is None:
        return None, status, msg, [], []

    distance = float(params.get("distance", 1.0))
    # OpenCASCADE offset logic here...
    try:
        new_shape = bd.offset(shape, amount=distance, openings=[face]) # Pseudo-code
        return new_shape, OperationStatus.VALID, f"Offset face by {distance}mm", ["face_new"], []
    except Exception as e:
        return None, OperationStatus.GEOMETRY_FAILURE, str(e), [], []
```

### Register the Handler
In the same file, locate the `_operation_registry` property and map the operation type string to your handler function:

```python
@property
def _operation_registry(self):
    return {
        "fillet": self._apply_fillet,
        "chamfer": self._apply_chamfer,
        "hole": self._apply_hole,
        "pocket": self._apply_pocket,
        "pad": self._apply_pad,
        "offset_face": self._apply_offset_face, # <-- ADD HERE
    }
```

### Unit Tests
Create a test for the new geometry builder within the `ai-engine/tests` directory to verify parameter inputs, error handling, and robust execution on boundary cases.

## 2. Frontend Implementation (`web-ui`)

To expose the new operation to users, update the frontend configuration in `web-ui/components/manual-cad/operations/`.

### Add Capability Mapping
In `capabilities.ts`, update the `capabilities` matrix. Declare which geometric entity types are eligible to receive this operation:

```typescript
export const capabilities = {
    // ...
    offset_face: {
        appliesTo: ["face.planar", "face.cylindrical"],
        message: "Select a face to offset"
    }
};
```

### Define Form Schema
In `registry.ts`, define the UI form schema for the new operation. Provide default values and define validation bounds for each parameter:

```typescript
export const OPERATION_REGISTRY: Record<string, OperationSchema> = {
    // ...
    offset_face: {
        fields: [
            {
                name: "distance",
                type: "number",
                label: "Offset Distance (mm)",
                default: 5.0,
                min: -100.0,
                max: 100.0,
                step: 0.1
            }
        ],
        validate: (values) => {
            if (values.distance === 0) return { distance: "Distance cannot be exactly 0" };
            return {};
        }
    }
};
```

## Checklist Summary
- [ ] Implement backend `_apply_*` geometry method returning standard tuple.
- [ ] Register new method in `_operation_registry` dictionary.
- [ ] Write backend unit tests covering valid geometry and edge cases.
- [ ] Define operation target constraints in `capabilities.ts`.
- [ ] Add field schema and validation logic to `registry.ts`.
