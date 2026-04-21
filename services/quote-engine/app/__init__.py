"""Quick3DQuote quote-engine.

FastAPI service that analyses uploaded meshes (STL/OBJ/3MF) and computes
the authoritative price for a given material + process + quantity.

Stateless, HMAC/shared-secret authenticated, deployed on Fly.io (lhr).
"""

__version__ = "0.1.0"
