import sys
import json
import numpy as np
from sentence_transformers import SentenceTransformer

# Suppress warnings for a clean JSON output
import warnings
warnings.filterwarnings("ignore")

# Load a small, fast, but high-quality model
# all-MiniLM-L6-v2 is perfect for semantic similarity in real-time
model = SentenceTransformer('all-MiniLM-L6-v2')

def compute_similarity(text1, text2):
    # Compute embeddings
    embeddings = model.encode([text1, text2])
    
    # Compute cosine similarity
    # similarity = (A . B) / (||A|| * ||B||)
    a = embeddings[0]
    b = embeddings[1]
    
    similarity = np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
    return float(similarity)

def main():
    # Signal readiness to the parent process
    print("READY", flush=True)
    
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            if data.get("action") == "similarity":
                s1 = data.get("text1", "")
                s2 = data.get("text2", "")
                score = compute_similarity(s1, s2)
                print(json.dumps({"score": score}), flush=True)
            elif data.get("action") == "ping":
                print(json.dumps({"status": "pong"}), flush=True)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)

if __name__ == "__main__":
    main()
