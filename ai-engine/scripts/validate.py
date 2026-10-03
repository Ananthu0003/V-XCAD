import os
import requests
import json
import time
import argparse
from pathlib import Path

API_URL = os.getenv("API_URL", "http://localhost:8000/api/v1")

def run_validation(image_path: str, prompt: str = "Generate the part shown in the drawing."):
    path = Path(image_path)
    if not path.exists():
        print(f"[-] Error: Image not found at {path}")
        return False
        
    print(f"\n[*] Starting validation for: {path.name}")
    print("[*] 1. Requesting Generation (/generate)...")
    
    start_time = time.time()
    try:
        with open(path, "rb") as f:
            files = {"image": (path.name, f, "image/png")}
            data = {"prompt": prompt}
            # We use stream=True because it's an SSE endpoint
            response = requests.post(f"{API_URL}/generate", files=files, data=data, stream=True)
            response.raise_for_status()
            
            script = ""
            parameters = {}
            current_event = None
            for line in response.iter_lines():
                if line:
                    decoded = line.decode('utf-8')
                    if decoded.startswith("event: "):
                        current_event = decoded[7:]
                    elif decoded.startswith("data: "):
                        payload = json.loads(decoded[6:])
                        if current_event == "token" and "chunk" in payload:
                            print(".", end="", flush=True)
                        elif current_event == "done" and "script" in payload and "parameters" in payload:
                            script = payload["script"]
                            parameters = payload["parameters"]
                            print("\n[+] Generation complete!")
                        elif current_event == "error":
                            print(f"\n[-] Generation Error: {payload.get('message', 'Unknown error')} - {payload.get('hint', '')}")
                            return False
    except Exception as e:
        print(f"\n[-] Failed to connect or read generation stream: {e}")
        return False
        
    gen_time = time.time() - start_time
    print(f"[*] Generation took {gen_time:.2f}s")
    
    if not script:
        print("[-] Error: No script generated.")
        return False
        
    print("[*] 2. Requesting Render (/render)...")
    start_time = time.time()
    try:
        payload = {
            "python_script": script,
            "parameters": parameters,
            "session_id": f"test_{int(time.time())}"
        }
        response = requests.post(f"{API_URL}/render", json=payload)
        
        if response.status_code == 200:
            data = response.json()
            render_time = time.time() - start_time
            print(f"[+] Render SUCCESS in {render_time:.2f}s")
            print(f"[+] Artifacts: {data.get('artifacts', {}).get('stl_url')}")
            return True
        else:
            print(f"[-] Render FAILED with status {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        print(f"[-] Failed to call render endpoint: {e}")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Validate CAD generation engine")
    parser.add_argument("--image", type=str, help="Path to test image", required=True)
    parser.add_argument("--prompt", type=str, default="Generate the part shown in the drawing.", help="Prompt text")
    
    args = parser.parse_args()
    success = run_validation(args.image, args.prompt)
    if success:
        print("\n[PASS] VALIDATION PASSED")
        exit(0)
    else:
        print("\n[FAIL] VALIDATION FAILED")
        exit(1)
