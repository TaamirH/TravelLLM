# Travel Assistant - Prompt Engineering Decisions

## System Prompt Strategy

### Core Design Philosophy
I designed the system prompt to be **structured and specific** rather than open-ended, because travel queries require actionable, practical responses.

### Key Prompt Elements

#### 1. Clear Identity & Role
```
"You are TravelGenie — a concise, friendly, expert travel assistant."
```
**Why**: Establishes expertise and tone. "TravelGenie" is memorable and suggests magical problem-solving.

#### 2. Clarification Behavior
```
"Ask clarifying questions if the user's input is vague (missing dates, budget, preferences)."
```
**Why**: Travel planning requires specific constraints. Vague requests like "suggest a trip" are unhelpful without budget, timeframe, or interests.

#### 3. External Data Integration
```
"If 'ExternalContext' is provided, ground your answers in it and cite sources."
```
**Why**: Prevents hallucination of weather/factual data. Forces LLM to use real API data when available.

#### 4. Structured Output Format
```
Plan:
1. [step 1]
2. [step 2]
...
Recommendation: [actual advice]
```
**Why**: Shows chain-of-thought reasoning. Mirrors real travel planning process (research → decide → recommend).

#### 5. Response Structure
```
"TL;DR (1 line), 3–6 bullets, short caveat, Sources (if used)"
```
**Why**: Scannable format. Busy travelers need quick answers with details available.

## Chain-of-Thought Implementation

### Why Explicit Planning Steps?
Instead of asking the LLM for "hidden reasoning," I use visible planning steps because:

1. **Assignment Requirement**: Shows multi-step thinking process
2. **User Value**: Travelers can see the reasoning behind recommendations
3. **Debug-friendly**: Can identify where the logic breaks down
4. **Trust Building**: Transparent process builds user confidence

### Example Flow
```
User: "Plan a 3-day Tokyo trip in cherry blossom season"

Plan:
1. Identify cherry blossom timing (late March-early May)
2. Choose 3 must-see hanami spots
3. Allocate travel time between districts
4. Note crowd management strategies
5. Weather/packing considerations

Recommendation:
Day 1: Shinjuku Gyoen (morning, fewer crowds)
Day 2: Chidorigafuchi (evening, illuminated blossoms)
Day 3: Ueno Park (afternoon, combine with museums)
```

## External API Integration Strategy

### Decision Logic
I use **keyword-based triggering** rather than LLM-based classification:

```typescript
function needsExternal(query: string): boolean {
  const keywords = ["weather", "temperature", "forecast", "climate", "today", "now"];
  return keywords.some(k => query.toLowerCase().includes(k));
}
```

**Why Keyword-Based?**
- **Reliable**: No LLM variability in the decision
- **Fast**: No extra API call to decide
- **Debuggable**: Clear rules, easy to test
- **Cost-effective**: Saves LLM tokens

### Data Blending Pattern
```
ExternalContext:
{
  "weather": {
    "location": "Tokyo",
    "summary": "light rain",
    "temp": 15
  }
}
```

**Why JSON Format?**
- **Structured**: LLM can parse consistently  
- **Extensible**: Easy to add more APIs (currency, events, etc.)
- **Sourceable**: Clear attribution for fact-checking

## Error Handling & Hallucination Prevention

### Conservative Response Strategy
```
"If unsure about facts, say 'I don't know — want me to check?' instead of guessing."
```

**Why This Works**:
- **Builds trust**: Better to admit uncertainty than give wrong info
- **Actionable**: Offers to get real data
- **Travel-safe**: Wrong weather/visa info can ruin trips

### Fallback Patterns
1. **API Failure**: Continue without external data, note limitations
2. **LLM Confusion**: Ask clarifying questions
3. **Contradictory Data**: Defer to external APIs over LLM knowledge

## Testing & Iteration Notes

### What I Optimized For
1. **Conversation Quality**: Natural back-and-forth flow
2. **Practical Value**: Actionable travel advice
3. **Factual Accuracy**: Real-time data integration
4. **User Trust**: Transparent reasoning and limitations

### Key Prompt Iterations
- **v1**: Too verbose, overwhelming responses
- **v2**: Added bullet format, much more scannable
- **v3**: Added explicit "Plan:" structure for complex queries
- **v4**: Strengthened external data citation requirements

This prompt engineering approach prioritizes **practical travel value** over generic helpfulness.