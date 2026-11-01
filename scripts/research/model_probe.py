"""Check the existing restricted model transport without requesting inference."""
import importlib.util
import json
from pathlib import Path
import resource


def main():
    spec=importlib.util.spec_from_file_location('finn_codex_transport','/home/azureuser/finn-personal/worker.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    client=module.Codex('/home/azureuser/.local/bin/codex',str(Path.cwd()))
    try:
        models=client.models()
    finally:
        client.close()
    print(json.dumps({'models':models,'childPeakMb':round(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss/1024,1),'parentPeakMb':round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,1),'inferenceRequested':False}))


if __name__=='__main__':
    main()
