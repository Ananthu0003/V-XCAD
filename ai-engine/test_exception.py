import traceback
from app.services.cam_pipeline_manager import CamPipelineManager

try:
    c = CamPipelineManager()
    
    script = """from build123d import *
with BuildPart() as p:
    Box(100, 100, 20)
    with Locations((0, 0, 10)):
        Cylinder(radius=10, height=10, align=(Align.CENTER, Align.CENTER, Align.MIN))
result = p.part"""
    from app.services.step_importer import StepImporter
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as f:
        from build123d import export_step, Box, BuildPart
        with BuildPart() as p:
            Box(10,10,10)
        export_step(p.part, f.name)
        step_path = f.name
        
    features, _ = c.analyze_features(step_path, '1', {}, False)
    feat_id = features[0]['id']
    ops = [{'id':'1','type':'2d_contour','featureId':feat_id,'toolId':'1','machining_strategy':'default','status':'planned'}]
    c.generate_toolpaths(step_path, '1', '1', {}, [], ops)
except Exception as e:
    traceback.print_exc()
