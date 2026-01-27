#!/bin/bash
echo "Starting local server at http://localhost:8080"
echo "Press Ctrl+C to stop"
python3 -m http.server 8080
