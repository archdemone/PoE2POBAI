# PoB2 addon placeholder

This directory is reserved for the future Path of Building 2 bridge/addon work.

The first bridge goal should be minimal:

1. Export or read the current PoB2 build code/XML.
2. POST it to the local PoBAI server's `/api/build/import` endpoint.
3. Open the PoBAI web UI at `http://localhost:5173`.

Direct live build mutation should remain disabled until snapshot/diff/revert tooling exists.
