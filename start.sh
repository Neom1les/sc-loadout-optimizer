#!/bin/bash
echo ""
echo "  ================================================"
echo "   SC LOADOUT OPTIMIZER - Alpha 4.8.0-LIVE"
echo "  ================================================"
echo ""

PORT=8765
cd "$(dirname "$0")"

if ! command -v python3 &> /dev/null; then
    echo "  [ERROR] Python3 not found. Install it first."
    exit 1
fi

echo "  Starting server on http://localhost:$PORT ..."
echo "  Press Ctrl+C to stop."
echo ""

# Open browser after 1 second
(sleep 1 && open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null) &

python3 -m http.server $PORT
