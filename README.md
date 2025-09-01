# Travel Assistant (Node.js + TypeScript)

This is a lightweight conversational travel assistant that integrates **LLMs** and external APIs (e.g., weather).

## Features
- Conversation history per user (in-memory)
- Calls external API (OpenWeatherMap) when queries mention weather/time-sensitive info
- Prompt-engineered responses with TL;DR, bullets, caveats, sources
- Multi-step "Plan → Recommendation" format for itineraries
- Minimal web UI (static chat)

## Setup
1. Clone repo & install:
   ```bash
   npm install
